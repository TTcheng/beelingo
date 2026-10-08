/**
 * Content script 入口 — 划词触发 + 译文气泡。
 *
 * 生命周期：
 *   1. 挂一个 <div> 到 body 作为 host（Shadow DOM 在其内部）
 *   2. 启动 watchSelection；选区变化 → showIcon
 *   3. 用户点图标 / 按快捷键 / 右键菜单 → 发 TranslateRequest → setLoading
 *   4. 收到 TranslateResult → setSuccess
 *   5. 收到 TranslateError → setError
 *
 * 幂等性：Firefox 127+ 在 host_permissions 已授权时会自动注入 content.js，
 * 右键菜单 / 快捷键再触发 chrome.scripting.executeScript 又会注入一次。
 * 第二次注入时 host 已经有 closed shadow root，再 `new Bubble(host)` 会抛
 * NotSupportedError 导致整个 IIFE 中止，所有副作用丢失，bug 表现是
 * "完全没反应 / 划词图标消失"。用一个全局标记守卫整个 init() 即可根治。
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
// 幂等标记：存在 host 元素的 dataset 属性里。Firefox 每次 chrome.scripting.executeScript
// 注入是新的 isolated world，globalThis 不共享，但 page DOM 是共享的，dataset 属性跨
// world 可读。第一次注入时 dataset.__beelingo === undefined；host 已经被 IIFE 创建后，
// 任何后续注入都能读到这个 dataset 标记为 true，跳过 init()。
const SELF_FLAG = '__beelingo';

function ensureHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const el = document.createElement('div');
  el.id = HOST_ID;
  // 定位必须用 inline style 直接写在 host 元素上：shadow DOM 里的 CSS
  // 只能影响 shadow 内部节点，:host { all: initial } 又把外部继承的
  // position 等都重置了，只有 host 自己的 style 属性会生效。
  el.style.position = 'fixed';
  el.style.zIndex = '2147483646';
  el.style.pointerEvents = 'auto';
  el.style.display = 'none';
  const parent = document.body ?? document.documentElement;
  if (!parent.contains(el)) parent.appendChild(el);
  return el;
}

function init(): void {
  const host = ensureHost();
  let currentSelection: SelectionInfo | null = null;
  let lastRequestId: string | null = null;
  let lastRect: SelectionInfo['rect'] | null = null;
  let pendingOriginal: string | null = null;

  const bubble = new Bubble(host, DEFAULT_BUBBLE_TTL_MS, {
    onIconClick: () => {
      if (!currentSelection) return;
      void requestTranslate(currentSelection, 'icon');
    },
  });

  // ---------- 选区监听 ----------

  const stopWatch = watchSelection((info) => {
    currentSelection = info;
    if (!info) {
      bubble.hideIcon();
      return;
    }
    bubble.showIcon(info.rect);
  });

  // ---------- 消息监听 ----------

  chrome.runtime.onMessage.addListener((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const env = raw as MessageEnvelope;
    // eslint-disable-next-line no-console
    console.log('[beelingo] content ← message', env.type, env);
    switch (env.type) {
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
        // 同 TranslateError：requestId 缺失时退化为「仍有 pending」即接受。
        if (m.requestId !== undefined && m.requestId !== lastRequestId) return;
        if (lastRequestId === null) return;
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
        // requestId 严格匹配是默认行为，但 background 旧版本可能漏了带 requestId，
        // 此时退化为「当前仍有 pending 请求」即接受。
        if (m.requestId !== undefined && m.requestId !== lastRequestId) return;
        if (lastRequestId === null) return;
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
        // Background 在 catch 里兜底发 `{type: 'ERROR'}`，避免气泡永久停在 loading。
        // env.type 已在上方 switch case 收窄到 MessageType 联合的「之外」，
        // 但 runtime.onMessage 可能收到来自 background catch 兜底的 {type: 'ERROR'}；
        // 直接读 raw 拿到原始字段，不依赖 env.type 收窄。
        if (
          raw !== null &&
          typeof raw === 'object' &&
          'type' in raw &&
          (raw as { type: unknown }).type === 'ERROR' &&
          lastRequestId !== null
        ) {
          bubble.setError(
            pendingOriginal ?? '',
            'UNKNOWN',
            '后台处理失败，请重试',
            true,
            lastRect ?? defaultRect(),
          );
          lastRequestId = null;
          pendingOriginal = null;
        }
        break;
    }
  });

  // ---------- 翻译请求 ----------

  function defaultRect(): { x: number; y: number; width: number; height: number } {
    return {
      x: Math.round(window.innerWidth / 2 - 100),
      y: Math.round(window.innerHeight / 2 - 50),
      width: 200,
      height: 24,
    };
  }

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
    // eslint-disable-next-line no-console
    console.log('[beelingo] → translate request', { source, len: sel.text.length });
    try {
      // 关键：不要 await sendMessage 的 Promise。Firefox ESR 上该 Promise 会过早
      // resolve 为 undefined（sendResponse 异步通道不稳），真正的响应靠 background
      // 主动 chrome.tabs.sendMessage 推回来，content 端 chrome.runtime.onMessage
      // listener 里 case TRANSLATE_RESULT / TRANSLATE_ERROR 会接住并更新气泡。
      //
      // 兜底：20s 兜底超时——如果 background 整段没回包（包括 background 死了或
      // tabs.sendMessage 没投递成功），就当 NETWORK 错误处理。
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('TIMEOUT: 翻译请求超过 20 秒未响应')),
          20_000,
        ),
      );
      const sendPromise = chrome.runtime.sendMessage(payload).catch(() => undefined);
      await Promise.race([sendPromise, timeout]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[beelingo] translate request failed:', e);
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

  async function triggerFromHotkey(): Promise<void> {
    if (!currentSelection) return;
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
}

// 幂等守卫：必须用 DOM 跨 world 共享的状态，不能用 globalThis。
// Firefox MV3 每次 chrome.scripting.executeScript 注入是新的 isolated world，
// globalThis 不共享；用 host 元素的 dataset 属性（page DOM 跨 world 可读）。
const guardHost = document.getElementById(HOST_ID);
if (guardHost && guardHost.dataset[SELF_FLAG] === '1') {
  // 重复注入：什么都不做，原 IIFE 已经接管了所有监听。
} else {
  const h = guardHost ?? ensureHost();
  h.dataset[SELF_FLAG] = '1';
  init();
}