/**
 * Content script 入口 — 划词触发 + 译文气泡。
 *
 * 生命周期：
 *   1. 挂一个 <div> 到 body 作为 host（Shadow DOM 在其内部）
 *   2. 启动 watchSelection；选区变化 → showIcon
 *   3. 用户点图标 / 按快捷键 / 右键菜单 → 发 TranslateRequest → setLoading
 *   4. 收到 TranslateResult → setSuccess
 *   5. 收到 TranslateError → setError
 */

import {
  MessageType,
  newRequestId,
  type TranslateRequestMessage,
  type TranslateResultMessage,
  type TranslateErrorMessage,
  type MessageEnvelope,
} from '../shared/messaging/protocol.js';
import { watchSelection, type SelectionInfo } from './selection.js';
import { Bubble } from './bubble.js';

const HOST_ID = 'beelingo-host';
const DEFAULT_BUBBLE_TTL_MS = 5000;

function ensureHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.style.display = 'none';
  (document.body ?? document.documentElement).appendChild(el);
  return el;
}

function loadSettings(): { trigger: 'icon' | 'hotkey' | 'both'; bubbleTtlMs: number } {
  return { trigger: 'both', bubbleTtlMs: DEFAULT_BUBBLE_TTL_MS };
}

const host = ensureHost();
let currentSelection: SelectionInfo | null = null;
let lastRequestId: string | null = null;

const bubble = new Bubble(host, DEFAULT_BUBBLE_TTL_MS, {
  onIconClick: () => {
    if (!currentSelection) return;
    void requestTranslate(currentSelection, 'icon');
  },
  onCopy: (text) => {
    void navigator.clipboard.writeText(text).catch(() => {
      // 兜底：execCommand 已被废弃，提示用户手动复制
      console.warn('[beelingo] clipboard write failed');
    });
  },
  onFavorite: (_orig, _trans) => {
    // M2 接入生词本
    console.info('[beelingo] favorite (M2)');
  },
});

// ---------- 选区监听 ----------

const stopWatch = watchSelection((info) => {
  currentSelection = info;
  if (!info) {
    bubble.hideIcon();
    return;
  }
  // 黑名单域名：留给 settings 同步后判断（M1 简化：始终显示图标）
  bubble.showIcon(info.rect);
});

// ---------- 消息监听 ----------

chrome.runtime.onMessage.addListener((raw) => {
  if (!raw || typeof raw !== 'object') return;
  const env = raw as MessageEnvelope;
  switch (env.type) {
    case MessageType.SettingsUpdated:
      // 后续：触发图标隐藏/快捷键启用等
      break;
    case MessageType.HotkeyTriggered:
      void triggerFromHotkey();
      break;
    case MessageType.ContextMenuTriggered: {
      const payload = env.payload;
      if (payload && typeof payload === 'object' && 'text' in payload) {
        const text = (payload as { text?: unknown }).text;
        if (typeof text === 'string' && text.length > 0) {
          void requestTranslate(
            { text, rect: lastRect ?? defaultRect() },
            'contextMenu',
          );
        }
      }
      break;
    }
    case MessageType.TranslateResult: {
      const m = env as TranslateResultMessage;
      if (m.requestId !== lastRequestId) return;
      const rect = lastRect ?? defaultRect();
      const p = m.payload;
      if (!p) break;
      bubble.setSuccess(pendingOriginal ?? '', p.translated, p.latencyMs, rect);
      lastRequestId = null;
      pendingOriginal = null;
      break;
    }
    case MessageType.TranslateError: {
      const m = env as TranslateErrorMessage;
      if (m.requestId !== lastRequestId) return;
      const rect = lastRect ?? defaultRect();
      const p = m.payload;
      if (!p) break;
      bubble.setError(
        pendingOriginal ?? '',
        p.code,
        p.message,
        p.retryable,
        rect,
      );
      lastRequestId = null;
      pendingOriginal = null;
      break;
    }
    default:
      break;
  }
});

// ---------- 翻译请求 ----------

let lastRect: SelectionInfo['rect'] | null = null;
let pendingOriginal: string | null = null;

async function requestTranslate(
  sel: { text: string; rect?: { x: number; y: number; width: number; height: number } },
  source: 'icon' | 'hotkey' | 'contextMenu',
): Promise<void> {
  const requestId = newRequestId();
  lastRequestId = requestId;
  pendingOriginal = sel.text;
  lastRect = sel.rect ?? defaultRect();

  bubble.setLoading(sel.text, lastRect);

  const payload: TranslateRequestMessage = {
    type: MessageType.TranslateRequest,
    requestId,
    payload: {
      text: sel.text,
      rect: lastRect ?? undefined,
      source,
    },
  };
  try {
    await chrome.runtime.sendMessage(payload);
  } catch (e) {
    bubble.setError(
      sel.text,
      'NETWORK',
      e instanceof Error ? e.message : '消息发送失败',
      true,
      lastRect ?? defaultRect(),
    );
    lastRequestId = null;
    pendingOriginal = null;
  }
}

function defaultRect(): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(window.innerWidth / 2 - 100),
    y: Math.round(window.innerHeight / 2 - 50),
    width: 200,
    height: 24,
  };
}

async function triggerFromHotkey(): Promise<void> {
  if (!currentSelection) return;
  const { trigger } = loadSettings();
  if (trigger === 'icon') return; // 关闭快捷键
  await requestTranslate(currentSelection, 'hotkey');
}

// ---------- 全局交互：点击外部/Esc 关闭 ----------

document.addEventListener(
  'mousedown',
  (e) => {
    const target = e.target as Node | null;
    if (target && host.contains(target)) return;
    // 内部 shadow DOM 事件 target 也指向 host，所以判断已包含
    bubble.hide();
  },
  true,
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') bubble.hide();
});

// 滚出视野自动收（> 200px 滚动）
let lastScrollY = window.scrollY;
window.addEventListener(
  'scroll',
  () => {
    if (Math.abs(window.scrollY - lastScrollY) > 200) {
      bubble.hide();
    }
    lastScrollY = window.scrollY;
  },
  { passive: true },
);

// 卸载时清理
window.addEventListener('pagehide', () => {
  stopWatch();
  bubble.destroy();
});

void loadSettings; // 占位防未用警告（M2 会真正读取）