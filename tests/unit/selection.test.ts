// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchSelection } from '@/content/selection.js';

// jsdom 不实现 Range.getBoundingClientRect；统一打补丁给一个非零矩形，
// 让 selection.ts 走「有选区且非零」分支。特定测试需要 0 矩形再单独覆盖。
beforeEach(() => {
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        top: 0,
        bottom: 10,
        left: 0,
        right: 10,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  }
});

describe('watchSelection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function selectTextIn(element: Element): void {
    const range = document.createRange();
    range.selectNodeContents(element);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  it('emits null when no selection', async () => {
    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);
    expect(cb).toHaveBeenCalledWith(null);
    stop();
  });

  it('emits SelectionInfo when text is selected', async () => {
    const p = document.createElement('p');
    p.textContent = 'hello world';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    const lastCall = cb.mock.calls.at(-1)?.[0];
    expect(lastCall).not.toBeNull();
    expect(lastCall?.text).toBe('hello world');
    expect(lastCall?.rect).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    });
    stop();
  });

  it('rect uses viewport coords, NOT page coords (regression: scrollX/scrollY would shift icon off-screen)', async () => {
    // 早期实现里 selection.ts 把 getBoundingClientRect() 的 left/top 加上了
    // window.scrollX/scrollY，结果是 page coords 传给 position:fixed 的 host——
    // 一旦页面滚动，图标就跑到视口外面去了。修复后必须用纯 viewport 坐标。
    const p = document.createElement('p');
    p.textContent = 'a long scrollable page';
    document.body.appendChild(p);
    selectTextIn(p);

    // 把 Range 的 getBoundingClientRect 打补丁成固定值，方便断言
    const FAKE = {
      left: 50, top: 80, width: 200, height: 30, right: 250, bottom: 110,
      x: 50, y: 80, toJSON: () => ({}),
    } as DOMRect;
    const origGBCR = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = function () { return FAKE; };

    // 模拟页面被滚动了 1000px
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    const lastCall = cb.mock.calls.at(-1)?.[0];
    expect(lastCall).not.toBeNull();
    // 关键断言：rect.x === 50，rect.y === 80（即 viewport 坐标），而不是 1050 / 1080
    expect(lastCall?.rect.x).toBe(50);
    expect(lastCall?.rect.y).toBe(80);

    // 还原
    Range.prototype.getBoundingClientRect = origGBCR;
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    stop();
  });

  it('skips duplicate selections (debounced dedupe)', async () => {
    const p = document.createElement('p');
    p.textContent = 'foo bar baz';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    const nonEmpty = cb.mock.calls.filter((c) => c[0] !== null);
    expect(nonEmpty.length).toBe(1);
    stop();
  });

  it('does not emit anything for whitespace-only selection (same as no selection)', async () => {
    const p = document.createElement('p');
    p.textContent = '   ';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    // 初始 lastText 是 ''，trim 后仍是 ''，dedupe 直接跳过——
    // 这与「从一开始就没有选区」等价，不会向小气泡回调。
    expect(cb).not.toHaveBeenCalled();
    stop();
  });

  it('emits null after a real selection is cleared to whitespace', async () => {
    const p = document.createElement('p');
    p.textContent = 'first some text';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'first some text' }));

    // 把选区清成空白（trim 后为空）—— 与上次不同，dedupe 不跳过，应该回调 null
    p.textContent = '   ';
    selectTextIn(p);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    expect(cb).toHaveBeenLastCalledWith(null);
    stop();
  });

  it('emits null for too-long text', async () => {
    const p = document.createElement('p');
    p.textContent = 'a'.repeat(501);
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    expect(cb).toHaveBeenLastCalledWith(null);
    stop();
  });

  it('stop() removes all listeners', async () => {
    const p = document.createElement('p');
    p.textContent = 'unique content';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    stop();
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    expect(cb).not.toHaveBeenCalled();
  });

  it('responds to keyup', async () => {
    const p = document.createElement('p');
    p.textContent = 'keyboard select';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    await vi.advanceTimersByTimeAsync(200);

    const lastCall = cb.mock.calls.at(-1)?.[0];
    expect(lastCall).not.toBeNull();
    expect(lastCall?.text).toBe('keyboard select');
    stop();
  });

  it('emits null when range rect is zero-sized', async () => {
    const origGBCR = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        toJSON() {
          return {};
        },
      }) as DOMRect;

    const p = document.createElement('p');
    p.textContent = 'invisible selection';
    document.body.appendChild(p);
    selectTextIn(p);

    const cb = vi.fn();
    const stop = watchSelection(cb);
    document.dispatchEvent(new MouseEvent('mouseup'));
    await vi.advanceTimersByTimeAsync(200);

    expect(cb).toHaveBeenLastCalledWith(null);

    Range.prototype.getBoundingClientRect = origGBCR;
    stop();
  });
});