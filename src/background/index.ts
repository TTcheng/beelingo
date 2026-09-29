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
import { PublicSettingsSchema } from '../shared/storage/schema.js';
import { translate } from '../shared/translate/client.js';
import { configureRateLimit, tryConsume } from './rate-limit.js';

declare const __TARGET__: 'chrome' | 'firefox';

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

// ---------- 设置变更同步给 content ----------

onSettingsChanged((next) => {
  void configureRateLimit(next.rateLimitPerMinute);
  // 广播给所有 tab 的 content script
  chrome.tabs.query({}, (tabs) => {
    const publicSettings = PublicSettingsSchema.parse(next);
    for (const tab of tabs) {
      if (!tab.id) continue;
      void chrome.tabs.sendMessage(tab.id, {
        type: MessageType.SettingsUpdated,
        payload: publicSettings,
      } satisfies MessageEnvelope).catch(() => {
        // content 脚本可能还没注入或 tab 已关闭，忽略
      });
    }
  });
});

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void handleMessage(msg).then(sendResponse).catch((e: unknown) => {
    console.error('[beelingo] handler error:', e);
    sendResponse({ type: 'ERROR' });
  });
  return true; // 表示异步响应
});

async function handleMessage(raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== 'object') return { type: 'ERROR' };
  const env = raw as MessageEnvelope;
  switch (env.type) {
    case MessageType.TranslateRequest:
      return handleTranslate(env as TranslateRequestMessage);
    case MessageType.ValidateApiKey:
      return handleValidate();
    case MessageType.GetSettings:
      return handleGetSettings();
    default:
      return { type: 'ERROR', error: 'UNKNOWN_TYPE' };
  }
}

async function handleTranslate(msg: TranslateRequestMessage): Promise<TranslateResultMessage | TranslateErrorMessage> {
  const payload = msg.payload;
  if (!payload || typeof payload.text !== 'string') {
    return error('INVALID_TEXT', '请求缺少 text', false);
  }

  // 限流
  const allowed = await tryConsume();
  if (!allowed) {
    return error('RATE_LIMIT', '本分钟请求过多，请稍候再试', true);
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    return error('NO_API_KEY', '请先在设置中填写 API Key', false);
  }

  const outcome = await translate({
    text: payload.text,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    baseUrl: settings.apiBaseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
  });

  if (!outcome.ok) {
    return error(outcome.code, outcome.message, outcome.retryable);
  }

  return {
    type: MessageType.TranslateResult,
    requestId: msg.requestId,
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

async function handleGetSettings(): Promise<{ type: 'GET_SETTINGS'; payload: unknown }> {
  const settings = await getSettings();
  const publicSettings = PublicSettingsSchema.parse(settings);
  return { type: MessageType.GetSettings, payload: publicSettings };
}

function error(
  code: 'NO_API_KEY' | 'NETWORK' | 'QUOTA_EXCEEDED' | 'RATE_LIMIT' | 'INVALID_TEXT' | 'PROVIDER_ERROR' | 'UNKNOWN',
  message: string,
  retryable: boolean,
): TranslateErrorMessage {
  return {
    type: MessageType.TranslateError,
    payload: { code, message, retryable },
  };
}

// ---------- 右键菜单 ----------

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'beelingo-translate-selection') return;
  const text = info.selectionText;
  if (!text || !tab?.id) return;
  void chrome.tabs.sendMessage(tab.id, {
    type: 'BEELINGO_CONTEXT_MENU_TRIGGERED',
    payload: { text },
  });
});

// ---------- 命令快捷键 ----------

chrome.commands?.onCommand.addListener((command) => {
  if (command !== 'translate-selection') return;
  void chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    void chrome.tabs
      .sendMessage(tab.id, { type: 'BEELINGO_HOTKEY_TRIGGERED' })
      .catch(() => {
          /* content not ready */
        });
  });
});