/**
 * Background service worker — 唯一持有 API Key 的上下文。
 *
 * 路由：
 *   TRANSLATE_REQUEST  → 检查限流 → 调 translate() → 回 TRANSLATE_RESULT / TRANSLATE_ERROR
 *   VALIDATE_API_KEY    → 用 Key 发一个最小请求（/models 或短 chat）验证有效性
 *   GET_SETTINGS       → 返回 public settings（去掉 apiKey/apiBaseUrl）
 *
 * 安装时设置右键菜单 "在蜂译中翻译"。
 */

import {
  MessageType,
  type TranslateRequestMessage,
  type TranslateResultMessage,
  type TranslateErrorMessage,
  type MessageEnvelope,
} from '../shared/messaging/protocol.js';
import { getSettings, onSettingsChanged } from '../shared/storage/keys.js';
import { translate } from '../shared/translate/client.js';
import { configureRateLimit, tryConsume } from './rate-limit.js';

declare const __TARGET__: 'chrome' | 'firefox';

// ---------- 按需注入 content script ----------
//
// Firefox 115-126 的临时加载：host_permissions 不会自动授权，导致 manifest
// 里的 content_scripts.matches 实际上不会被注入。右键菜单 / 命令快捷键
// 都依赖 content script 接收 BEELINGO_*_TRIGGERED，于是用户感知为「点了没反应」。
//
// 这里用 chrome.scripting.executeScript（manifest 里已经声明 activeTab +
// scripting 权限）在用户手势触发时按需注入，并记住已注入的 tab 避免重复
// 调用。activeTab 保证只在用户点击当前活动标签时才允许注入，
// restricted pages（about:debugging / view-source 等）执行会抛错，按设计吞掉。

const injectedTabs = new Set<number>();

async function ensureContentScriptInjected(tabId: number): Promise<boolean> {
  if (injectedTabs.has(tabId)) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    injectedTabs.add(tabId);
    return true;
  } catch (e) {
    // 受限页 / 脚本权限不足时执行会失败；保持静默，sendMessage 也不会发出
    if (__TARGET__ === 'chrome') {
      console.warn('[beelingo] executeScript failed:', e);
    }
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

async function setupContextMenu(): Promise<void> {
  const id = 'beelingo-translate-selection';
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
      id,
      title: '在蜂译中翻译',
      contexts: ['selection'],
    });
  } catch (e) {
    // Firefox 在某些版本上 create() 异步失败但实际已注册；忽略二次抛错
    if (__TARGET__ === 'chrome') {
      console.warn('[beelingo] contextMenus.create failed:', e);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void setupContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void setupContextMenu();
});

// 初次激活（service worker 冷启动）也尝试一次
void setupContextMenu();

// ---------- 设置变更：重建令牌桶 ----------

onSettingsChanged((next) => {
  void configureRateLimit(next.rateLimitPerMinute);
});

// ---------- 消息路由 ----------
//
// 设计：content → background 用 chrome.runtime.sendMessage（双向），但 background
// 收到 TranslateRequest 后，**不**通过 sendResponse 回包，改用 chrome.tabs.sendMessage
// 把 TRANSLATE_RESULT / TRANSLATE_ERROR 主动推回发起请求的那个 tab。
//
// 原因：Firefox ESR 上 chrome.runtime.sendMessage().then(sendResponse) 的异步响应通道
// 不稳——Promise 会过早 resolve 为 undefined，但 onMessage 的反方向消息通道没真正建立。
// 改成主动推送（tabs.sendMessage）后，content 端的 chrome.runtime.onMessage listener
// 100% 能收到响应。

chrome.runtime.onMessage.addListener((msg, sender, _sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  const env = msg as MessageEnvelope;
  if (env.type === MessageType.TranslateRequest) {
    const senderTabId = sender.tab?.id;
    void handleTranslate(env as TranslateRequestMessage)
      .then((response) => {
        if (senderTabId === undefined) {
          // eslint-disable-next-line no-console
          console.warn('[beelingo] translate response dropped: no sender.tab.id');
          return;
        }
        // eslint-disable-next-line no-console
        console.log('[beelingo] → translate response to tab', senderTabId, response.type);
        void chrome.tabs.sendMessage(senderTabId, response).catch(() => {
          /* tab closed */
        });
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[beelingo] translate handler error:', e);
      });
    return false; // 不需要 sendResponse 通道
  }
  // 其他消息类型：保持老的 sendResponse 通道
  void handleMessage(msg).then(_sendResponse).catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error('[beelingo] handler error:', e);
    _sendResponse({ type: 'ERROR' });
  });
  return true;
});

async function handleMessage(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object') return { type: 'ERROR' };
  const env = raw as MessageEnvelope;
  switch (env.type) {
    case MessageType.ValidateApiKey:
      return handleValidate();
    default:
      return { type: 'ERROR', error: 'UNKNOWN_TYPE' };
  }
}

async function handleTranslate(msg: TranslateRequestMessage): Promise<TranslateResultMessage | TranslateErrorMessage> {
  const payload = msg.payload;
  const requestId = msg.requestId;
  if (!payload || typeof payload.text !== 'string') {
    return {
      type: MessageType.TranslateError,
      requestId,
      payload: { code: 'INVALID_TEXT', message: '请求缺少 text', retryable: false },
    };
  }

  // 限流
  const allowed = await tryConsume();
  if (!allowed) {
    return {
      type: MessageType.TranslateError,
      requestId,
      payload: { code: 'RATE_LIMIT', message: '本分钟请求过多，请稍候再试', retryable: true },
    };
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    return {
      type: MessageType.TranslateError,
      requestId,
      payload: { code: 'NO_API_KEY', message: '请先在设置中填写 API Key', retryable: false },
    };
  }

  const outcome = await translate({
    text: payload.text,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    baseUrl: settings.apiBaseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    thinking: settings.thinking,
  });

  if (!outcome.ok) {
    // eslint-disable-next-line no-console
    console.log('[beelingo] translate failed:', outcome.code, outcome.message);
    return {
      type: MessageType.TranslateError,
      requestId,
      payload: { code: outcome.code, message: outcome.message, retryable: outcome.retryable },
    };
  }

  // eslint-disable-next-line no-console
  console.log('[beelingo] translate ok in', outcome.latencyMs, 'ms');
  return {
    type: MessageType.TranslateResult,
    requestId,
    payload: {
      translated: outcome.translated,
      detectedSource: outcome.detectedSource,
      latencyMs: outcome.latencyMs,
      cached: false,
    },
  };
}

async function handleValidate(): Promise<{ type: 'VALIDATE_API_KEY'; payload: { ok: boolean; error?: string } }> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return { type: MessageType.ValidateApiKey, payload: { ok: false, error: '未填写 API Key' } };
  }
  // 最小代价校验：向 /models 拉列表，不消耗 token
  const url = `${settings.apiBaseUrl.replace(/\/+$/, '')}/models`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    if (res.ok) {
      return { type: MessageType.ValidateApiKey, payload: { ok: true } };
    }
    return {
      type: MessageType.ValidateApiKey,
      payload: { ok: false, error: `${res.status} ${res.statusText}` },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { type: MessageType.ValidateApiKey, payload: { ok: false, error: msg } };
  }
}

// ---------- 右键菜单 ----------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'beelingo-translate-selection') return;
  const text = info.selectionText;
  if (!text || !tab?.id) return;
  void (async () => {
    const ok = await ensureContentScriptInjected(tab.id!);
    if (!ok) return;
    void chrome.tabs
      .sendMessage(tab.id!, {
        type: 'BEELINGO_CONTEXT_MENU_TRIGGERED',
        payload: { text },
      })
      .catch(() => {
        /* content script 注入后仍未就绪时忽略 */
      });
  })();
});

// ---------- 命令快捷键 ----------

chrome.commands?.onCommand.addListener((command) => {
  if (command !== 'translate-selection') return;
  void chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    const ok = await ensureContentScriptInjected(tab.id);
    if (!ok) return;
    void chrome.tabs
      .sendMessage(tab.id, { type: 'BEELINGO_HOTKEY_TRIGGERED' })
      .catch(() => {
        /* content not ready */
      });
  });
});