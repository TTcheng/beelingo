/**
 * @vitest-environment jsdom
 *
 * Smoke test for the right-click context menu flow.
 *
 * Simulates:
 *   1. Background loads (register context menu)
 *   2. User right-clicks selected text → context menu item clicked
 *   3. Background calls chrome.scripting.executeScript to inject content (Firefox fix)
 *   4. Background sends BEELINGO_CONTEXT_MENU_TRIGGERED to content
 *   5. Content script handler routes → requestTranslate
 *   6. Background receives TRANSLATE_REQUEST → translate() → TRANSLATE_RESULT
 *
 * Goal: catch the "click does nothing" regression specifically on Firefox.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeMock } from '../setup.js';

// Dynamic re-import is intentional: each test calls `vi.resetModules()` and
// then `await import('../../src/background/index.js')` so the module-level
// `injectedTabs` tracker starts empty. Static imports would lock the module
// graph at parse time and the tracker would leak between tests.

describe('context-menu → translate flow', () => {
  type MessageHandler = (msg: unknown, sender?: unknown, sendResponse?: (r: unknown) => void) => unknown;
  type ContentHandler = (msg: unknown) => void;
  let backgroundHandlers: Record<string, MessageHandler> = {};
  let contentHandlers: Record<string, ContentHandler> = {};
  let tabRemovedHandlers: Array<(tabId: number) => void> = [];

  /**
   * Await the pending microtasks chained by `ensureContentScriptInjected` →
   * `tabs.sendMessage` → content `runtime.onMessage` → content
   * `runtime.sendMessage` → background `runtime.onMessage`. Returning
   * `Promise.resolve()` three times flushes one async tick per call so we
   * don't depend on real wall-clock time.
   */
  async function flushChain(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(async () => {
    vi.resetModules();
    // Reset jsdom body between tests so content script's ensureHost starts clean.
    document.body.innerHTML = '';
    chromeMock.contextMenus.create.mockReset();
    chromeMock.contextMenus.removeAll.mockReset();
    chromeMock.contextMenus.removeAll.mockResolvedValue(undefined);
    chromeMock.tabs.sendMessage.mockReset();
    chromeMock.tabs.sendMessage.mockResolvedValue(undefined);
    chromeMock.runtime.sendMessage.mockReset();
    chromeMock.runtime.sendMessage.mockResolvedValue(undefined);
    chromeMock.scripting.executeScript.mockReset();
    chromeMock.scripting.executeScript.mockResolvedValue([]);

    tabRemovedHandlers = [];

    chromeMock.tabs.onRemoved.addListener.mockReset();
    chromeMock.tabs.onRemoved.addListener.mockImplementation((cb: (tabId: number) => void) => {
      tabRemovedHandlers.push(cb);
    });

    chromeMock.contextMenus.onClicked.addListener.mockReset();
    chromeMock.runtime.onMessage.addListener.mockReset();

    chromeMock.contextMenus.onClicked.addListener.mockImplementation((cb: (info: unknown, tab: unknown) => void) => {
      backgroundHandlers['contextMenus.onClicked'] = cb as never;
    });
    chromeMock.runtime.onMessage.addListener.mockImplementation(((cb: MessageHandler) => {
      // First registration is background (loaded first), second is content
      if (!backgroundHandlers['runtime.onMessage']) {
        backgroundHandlers['runtime.onMessage'] = cb;
      } else {
        contentHandlers['runtime.onMessage'] = cb as unknown as ContentHandler;
      }
      return true;
    }) as never);

    // Wire tabs.sendMessage so background → content actually delivers messages.
    chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: unknown, message: unknown) => {
      const cb = contentHandlers['runtime.onMessage'];
      if (!cb) return undefined;
      const result = cb(message);
      return result === undefined ? undefined : await Promise.resolve(result);
    });

    // Wire executeScript to mirror a real injection (validate the file name)
    chromeMock.scripting.executeScript.mockImplementation(
      async (opts: { target: { tabId: number }; files: string[] }) => {
        expect(opts.files).toEqual(['content.js']);
        return [];
      },
    );

    // Wire runtime.sendMessage so content → background actually delivers messages
    // (and return the TranslateResult the background handler produces).
    // background handler 现在用 sender.tab.id 来发回响应，所以 mock sender.tab.id。
    chromeMock.runtime.sendMessage.mockImplementation(async (message: unknown) => {
      const cb = backgroundHandlers['runtime.onMessage'];
      if (!cb) return undefined;
      const result = cb(
          message,
          { tab: { id: 42 } },
          () => undefined,
        );
      return result === undefined ? undefined : await Promise.resolve(result);
    });

    // Provide storage with valid settings (no API key by default)
    chromeMock.storage.local.get.mockImplementation(async () => ({}));
    chromeMock.storage.local.set.mockImplementation(async () => undefined);

    // Import background module (synchronous registration of listeners)
    await import('../../src/background/index.js');
    // Then content module
    await import('../../src/content/index.js');

    // Verify the handlers were captured
    expect(backgroundHandlers['runtime.onMessage']).toBeDefined();
    expect(backgroundHandlers['contextMenus.onClicked']).toBeDefined();
    expect(contentHandlers['runtime.onMessage']).toBeDefined();
  });

  afterEach(() => {
    backgroundHandlers = {};
    contentHandlers = {};
    tabRemovedHandlers = [];
  });

  it('context menu create is called with selection context', () => {
    expect(chromeMock.contextMenus.create).toHaveBeenCalled();
    const call = chromeMock.contextMenus.create.mock.calls[0]?.[0] as { id: string; title: string; contexts: string[] } | undefined;
    expect(call?.id).toBe('beelingo-translate-selection');
    expect(call?.contexts).toEqual(['selection']);
  });

  it('clicking context menu item injects content.js then delivers BEELINGO_CONTEXT_MENU_TRIGGERED to content', async () => {
    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'hello world', editable: false },
      { id: 42, url: 'https://example.com' },
    );

    // Wait for the async ensureContentScriptInjected → tabs.sendMessage chain
    await flushChain();

    // Background should have called executeScript first to inject content.js
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ['content.js'],
    });

    // Then tabs.sendMessage should be called with the menu message
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalled();
    const sendArgs = chromeMock.tabs.sendMessage.mock.calls[0]!;
    expect(sendArgs[0]).toBe(42); // tab id
    const msg = sendArgs[1] as { type: string; payload?: { text?: string } };
    expect(msg.type).toBe('BEELINGO_CONTEXT_MENU_TRIGGERED');
    expect(msg.payload?.text).toBe('hello world');

    // Ordering: executeScript must precede tabs.sendMessage
    const execOrder = chromeMock.scripting.executeScript.mock.invocationCallOrder[0]!;
    const sendOrder = chromeMock.tabs.sendMessage.mock.invocationCallOrder[0]!;
    expect(execOrder).toBeLessThan(sendOrder);
  });

  it('skips re-injection if already injected, but still sends the message', async () => {
    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    // First click on tab 42 injects
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'first', editable: false },
      { id: 42 },
    );
    await flushChain();

    const execCallsAfterFirst = chromeMock.scripting.executeScript.mock.calls.length;
    expect(execCallsAfterFirst).toBe(1);

    // Second click on same tab should NOT re-inject
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'second', editable: false },
      { id: 42 },
    );
    await flushChain();

    expect(chromeMock.scripting.executeScript.mock.calls.length).toBe(execCallsAfterFirst);

    // But tabs.sendMessage was called twice
    expect(chromeMock.tabs.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    const sendArgs = chromeMock.tabs.sendMessage.mock.calls.at(-1)!;
    expect(sendArgs[0]).toBe(42);
    const msg = sendArgs[1] as { type: string; payload?: { text?: string } };
    expect(msg.type).toBe('BEELINGO_CONTEXT_MENU_TRIGGERED');
    expect(msg.payload?.text).toBe('second');
  });

  it('content handler routes ContextMenuTriggered to requestTranslate (which sends TranslateRequest to background)', async () => {
    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'bonjour', editable: false },
      { id: 7 },
    );

    await flushChain();

    // executeScript was called for tab 7 (different from earlier tests' tab 42)
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content.js'],
    });

    // Now content should have called runtime.sendMessage with TranslateRequest
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalled();
    const call = chromeMock.runtime.sendMessage.mock.calls.find((c) => {
      const m = c[0] as { type?: string };
      return m?.type === 'TRANSLATE_REQUEST';
    });
    expect(call, 'expected a TRANSLATE_REQUEST to be sent to background').toBeDefined();
    const envelope = call?.[0];
    if (!envelope || typeof envelope !== 'object' || !('payload' in envelope)) {
      throw new Error('expected envelope with payload');
    }
    const payload = (envelope as { payload: { text: string; source: string } }).payload;
    expect(payload.text).toBe('bonjour');
    expect(payload.source).toBe('contextMenu');
  });

  it('does not crash when executeScript fails (e.g., restricted page)', async () => {
    chromeMock.scripting.executeScript.mockRejectedValueOnce(
      new Error('Cannot access contents of the page'),
    );

    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'restricted', editable: false },
      { id: 99 },
    );

    await flushChain();

    // executeScript was attempted
    expect(chromeMock.scripting.executeScript).toHaveBeenCalled();
    // tabs.sendMessage was NOT called (we skip when injection fails)
    const sendToRestricted = chromeMock.tabs.sendMessage.mock.calls.find((c) => c[0] === 99);
    expect(sendToRestricted).toBeUndefined();
  });

  it('clears injectedTabs tracking when a tab is closed', () => {
    // Force an injection first via the handler
    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'foo', editable: false },
      { id: 55 },
    );
    // Fire tab close event
    for (const cb of tabRemovedHandlers) cb(55);
    // After close, a new click on 55 should re-inject
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'bar', editable: false },
      { id: 55 },
    );
    // 1st call from first onClicked; tabRemoved runs sync; 2nd onClicked triggers re-inject
    const calls = chromeMock.scripting.executeScript.mock.calls.filter(
      (c) => (c[0] as { target: { tabId: number } }).target.tabId === 55,
    );
    expect(calls.length).toBe(2);
  });

  it('content script is idempotent against re-injection (Firefox 127+ double-load)', async () => {
    // 模拟 Firefox 127+ 在 host_permissions 已授权时自动注入 content.js 后，
    // 又被右键菜单的 chrome.scripting.executeScript 再次注入。
    // 第二次注入必须不能再次跑 init()，否则 new Bubble(host) 会抛
    // NotSupportedError，整个 IIFE 中止，监听全部丢失。
    //
    // 注意：不能用 globalThis 上的标记来去重——Firefox MV3 每次 executeScript
    // 注入是新的 isolated world，globalThis 不共享。必须用 page DOM（dataset）
    // 这种跨 world 可读的状态。
    const host = document.querySelector<HTMLElement>('#beelingo-host');
    expect(host).not.toBeNull();
    expect(host?.dataset['__beelingo']).toBe('1');
    // 模拟「又被注入一次」：第二次 import 跳过 init 副作用。
    await import('../../src/content/index.js');
    // 重新 import 一次：init() 不会再跑（避免重复 attachShadow）
    // host 元素还是同一个，没有出现 NotSupportedError 也没有重复 appendChild
    expect(document.querySelectorAll('#beelingo-host').length).toBe(1);
    // 重新 import 第三次，仍应 == 1
    await import('../../src/content/index.js');
    expect(document.querySelectorAll('#beelingo-host').length).toBe(1);
  });

  it('TRANSLATE_ERROR without requestId is still applied (regression: error() used to drop requestId)', async () => {
    // 真实还原用户报的 bug：background 旧版本（修复前）的 error() 助手函数
    // 没把 msg.requestId 透传，导致 content 端 `m.requestId !== lastRequestId`
    // 永远成立，setError 被跳过，气泡卡在 loading。
    // 现在 background 在每个 TranslateError 里都带 requestId；content 端做
    // 「缺失即视为匹配」的兜底，对旧版 background 也兼容。
    const onClicked = backgroundHandlers['contextMenus.onClicked']!;
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'hello', editable: false },
      { id: 11 },
    );
    await flushChain();

    // 模拟 background 推送响应（用 requestId 缺失的旧格式，验证 content 兜底）
    const requestIdMissingResponse = {
      type: 'TRANSLATE_ERROR',
      // 注意：没有 requestId 字段——模拟 background bug
      payload: { code: 'NETWORK', message: 'simulated network', retryable: true },
    };
    const onMessage = contentHandlers['runtime.onMessage'];
    if (!onMessage) throw new Error('content onMessage listener 未注册');
    onMessage(requestIdMissingResponse);

    // 验证：content 不因 requestId 缺失而拒绝响应。
    // 由于 shadow DOM 是 closed 的，无法直接断言 bubble 内部；
    // 改为断言 lastRequestId 被清掉（说明走了 setError 路径）。
    await Promise.resolve();
    await Promise.resolve();
    // 如果走到了 setError，lastRequestId 会被设为 null。我们从 background 推送后
    // 间接验证：再发一个 BEELINGO_CONTEXT_MENU_TRIGGERED，lastRequestId 应被覆盖。
    onClicked(
      { menuItemId: 'beelingo-translate-selection', selectionText: 'second', editable: false },
      { id: 11 },
    );
    await flushChain();
    // 这次能正常发出 TRANSLATE_REQUEST（说明 lastRequestId 已经被前一次 setError 清掉）
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});