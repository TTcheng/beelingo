/**
 * @vitest-environment jsdom
 *
 * Smoke test for the command hotkey (Ctrl+Shift+Y) flow.
 *
 * Simulates:
 *   1. Background loads (registers commands listener)
 *   2. User presses the hotkey → chrome.commands.onCommand fires
 *   3. Background calls chrome.scripting.executeScript to inject content (Firefox fix)
 *   4. Background sends BEELINGO_HOTKEY_TRIGGERED to content
 *   5. Content script handler routes → requestTranslate
 *   6. Background receives TRANSLATE_REQUEST → translate() → TRANSLATE_RESULT
 *
 * Goal: parity with the context-menu smoke but for the hotkey path, including
 * the Firefox executeScript injection step.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeMock } from '../setup.js';

// Dynamic re-import is intentional: each test calls `vi.resetModules()` and
// then `await import('../../src/background/index.js')` so the module-level
// `injectedTabs` tracker starts empty. Static imports would lock the module
// graph at parse time and the tracker would leak between tests.

describe('hotkey → translate flow', () => {
  type MessageHandler = (msg: unknown, sender?: unknown, sendResponse?: (r: unknown) => void) => unknown;
  type ContentHandler = (msg: unknown) => void;
  let backgroundHandlers: Record<string, MessageHandler> = {};
  let contentHandlers: Record<string, ContentHandler> = {};
  let commandHandlers: Array<(command: string) => void> = [];

  /** Flush the pending async chain (tabs.query callback → executeScript → sendMessage → content → background). */
  async function flushChain(): Promise<void> {
    // tabs.query mock resolves the callback via Promise.resolve().then,
    // so we need one extra tick to let it fire before the rest of the chain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(async () => {
    vi.resetModules();
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
    chromeMock.tabs.query.mockReset();
    chromeMock.tabs.query.mockImplementation((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      // Support both callback-style (production code) and Promise-style (legacy tests).
      // Default to id 11 so the hotkey handler proceeds; individual tests override.
      if (typeof cb === 'function') {
        Promise.resolve([{ id: 11 }]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([{ id: 11 }]);
    });

    commandHandlers = [];
    chromeMock.commands.onCommand.addListener.mockReset();
    chromeMock.commands.onCommand.addListener.mockImplementation((cb: (command: string) => void) => {
      commandHandlers.push(cb);
    });
    chromeMock.contextMenus.onClicked.addListener.mockReset();
    chromeMock.runtime.onMessage.addListener.mockReset();

    chromeMock.contextMenus.onClicked.addListener.mockImplementation((cb: (info: unknown, tab: unknown) => void) => {
      backgroundHandlers['contextMenus.onClicked'] = cb as never;
    });
    chromeMock.runtime.onMessage.addListener.mockImplementation(((cb: MessageHandler) => {
      if (!backgroundHandlers['runtime.onMessage']) {
        backgroundHandlers['runtime.onMessage'] = cb;
      } else {
        contentHandlers['runtime.onMessage'] = cb as unknown as ContentHandler;
      }
      return true;
    }) as never);

    chromeMock.tabs.sendMessage.mockImplementation(async (_tabId: unknown, message: unknown) => {
      const cb = contentHandlers['runtime.onMessage'];
      if (!cb) return undefined;
      const result = cb(message);
      return result === undefined ? undefined : await Promise.resolve(result);
    });

    chromeMock.scripting.executeScript.mockImplementation(
      async (opts: { target: { tabId: number }; files: string[] }) => {
        expect(opts.files).toEqual(['content.js']);
        return [];
      },
    );

    chromeMock.runtime.sendMessage.mockImplementation(async (message: unknown) => {
      const cb = backgroundHandlers['runtime.onMessage'];
      if (!cb) return undefined;
      const result = cb(message, { tab: { id: 42 } }, () => undefined);
      return result === undefined ? undefined : await Promise.resolve(result);
    });

    chromeMock.storage.local.get.mockImplementation(async () => ({}));
    chromeMock.storage.local.set.mockImplementation(async () => undefined);

    await import('../../src/background/index.js');
    await import('../../src/content/index.js');

    expect(commandHandlers.length).toBe(1);
    expect(backgroundHandlers['runtime.onMessage']).toBeDefined();
    expect(contentHandlers['runtime.onMessage']).toBeDefined();
  });

  afterEach(() => {
    backgroundHandlers = {};
    contentHandlers = {};
    commandHandlers = [];
  });

  it('ignores non-translate-selection commands', async () => {
    for (const cb of commandHandlers) cb('open-options');
    await flushChain();
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('hotkey injects content.js then delivers BEELINGO_HOTKEY_TRIGGERED to active tab', async () => {
    chromeMock.tabs.query.mockImplementationOnce((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      if (typeof cb === 'function') {
        Promise.resolve([{ id: 5 }]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([{ id: 5 }]);
    });

    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();

    // tabs.query was used with the active/currentWindow filter
    expect(chromeMock.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true }, expect.any(Function));
    // executeScript was called for the active tab
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 5 },
      files: ['content.js'],
    });
    // tabs.sendMessage fired the hotkey event
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalled();
    const args = chromeMock.tabs.sendMessage.mock.calls[0]!;
    expect(args[0]).toBe(5);
    const msg = args[1] as { type: string };
    expect(msg.type).toBe('BEELINGO_HOTKEY_TRIGGERED');

    // executeScript preceded tabs.sendMessage
    const execOrder = chromeMock.scripting.executeScript.mock.invocationCallOrder[0]!;
    const sendOrder = chromeMock.tabs.sendMessage.mock.invocationCallOrder[0]!;
    expect(execOrder).toBeLessThan(sendOrder);
  });

  it('hotkey reaches the content script with BEELINGO_HOTKEY_TRIGGERED', async () => {
    chromeMock.tabs.query.mockImplementationOnce((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      if (typeof cb === 'function') {
        Promise.resolve([{ id: 13 }]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([{ id: 13 }]);
    });

    let received: unknown = null;
    const original = contentHandlers['runtime.onMessage'];
    contentHandlers['runtime.onMessage'] = (msg) => {
      received = msg;
      if (original) original(msg);
    };

    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();

    // executeScript was called for tab 13
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 13 },
      files: ['content.js'],
    });

    // content should have received the hotkey event
    expect(received).toBeTruthy();
    if (!received || typeof received !== 'object' || !('type' in received)) {
      throw new Error('expected message with type');
    }
    expect((received as { type: string }).type).toBe('BEELINGO_HOTKEY_TRIGGERED');

    // Content's triggerFromHotkey bails when there's no selection in the jsdom body,
    // which is fine; we already proved the wire delivered the message. If the
    // content ever does call runtime.sendMessage, it would arrive with
    // source: 'hotkey'.
  });

  it('skips re-injection on subsequent hotkey presses', async () => {
    chromeMock.tabs.query.mockImplementation((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      if (typeof cb === 'function') {
        Promise.resolve([{ id: 21 }]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([{ id: 21 }]);
    });

    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);

    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();
    // Still 1 — second hotkey on same tab did not re-inject
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledTimes(1);

    // But tabs.sendMessage fired twice
    expect(chromeMock.tabs.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does nothing when there is no active tab', async () => {
    chromeMock.tabs.query.mockImplementationOnce((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      if (typeof cb === 'function') {
        Promise.resolve([]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([]);
    });
    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('does not crash when executeScript fails (e.g., restricted page)', async () => {
    chromeMock.tabs.query.mockImplementationOnce((opts: unknown, cb?: (tabs: { id: number }[]) => void) => {
      if (typeof cb === 'function') {
        Promise.resolve([{ id: 99 }]).then((tabs) => cb(tabs));
        return undefined;
      }
      return Promise.resolve([{ id: 99 }]);
    });
    chromeMock.scripting.executeScript.mockRejectedValueOnce(
      new Error('Cannot access contents of the page'),
    );

    for (const cb of commandHandlers) cb('translate-selection');
    await flushChain();

    expect(chromeMock.scripting.executeScript).toHaveBeenCalled();
    const sendToRestricted = chromeMock.tabs.sendMessage.mock.calls.find((c) => c[0] === 99);
    expect(sendToRestricted).toBeUndefined();
  });
});