// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bubble, type BubbleCallbacks } from '@/content/bubble.js';

describe('Bubble', () => {
  let host: HTMLElement;
  let bubble: Bubble;
  let cb: BubbleCallbacks;
  let shadow: ShadowRoot;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    cb = {
      onIconClick: vi.fn(),
    };
    bubble = new Bubble(host, 5000, cb);
    shadow = bubble.getShadowRoot();
  });

  afterEach(() => {
    bubble.destroy();
    host.remove();
  });

  describe('showIcon / hide', () => {
    it('makes host visible and positions it near the selection rect', () => {
      bubble.showIcon({ x: 100, y: 100, width: 50, height: 20 });
      expect(host.style.display).not.toBe('none');
      expect(host.style.left).toBe('136px');
      expect(host.style.top).toBe('86px');
    });

    it('renders a 🐝 button inside the shadow root', () => {
      bubble.showIcon({ x: 0, y: 0, width: 50, height: 20 });
      const icon = shadow.querySelector('.beelingo-icon');
      expect(icon).not.toBeNull();
      expect(icon?.textContent).toBe('🐝');
    });

    it('hides both host and shadow content', () => {
      bubble.showIcon({ x: 0, y: 0, width: 50, height: 20 });
      expect(shadow.querySelector('.beelingo-icon')).not.toBeNull();

      bubble.hide();
      expect(host.style.display).toBe('none');
      expect(shadow.querySelector('.beelingo-icon')).toBeNull();
    });
  });

  describe('icon click', () => {
    it('invokes onIconClick callback when the bee button is clicked', () => {
      bubble.showIcon({ x: 0, y: 0, width: 50, height: 20 });
      const icon = shadow.querySelector<HTMLButtonElement>('.beelingo-icon');
      expect(icon).not.toBeNull();
      icon?.click();
      expect(cb.onIconClick).toHaveBeenCalledTimes(1);
    });

    it('stops click propagation so document-level handlers are skipped', () => {
      bubble.showIcon({ x: 0, y: 0, width: 50, height: 20 });
      const docHandler = vi.fn();
      // 注意：捕获阶段监听 mousedown，模拟 index.ts 的全局监听
      document.addEventListener('mousedown', docHandler, true);

      const icon = shadow.querySelector<HTMLButtonElement>('.beelingo-icon');
      // jsdom 不模拟 shadow retarget；手动 dispatch 到 host
      host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      // 重要：click 事件才 stopPropagation；mousedown 仍冒泡
      icon?.click();
      // mousedown 应触发一次（捕获阶段）；click 因 stopPropagation 不再冒泡
      expect(docHandler).toHaveBeenCalledTimes(1);
      document.removeEventListener('mousedown', docHandler, true);
    });
  });

  describe('setLoading', () => {
    it('shows loading bubble and hides the icon', () => {
      bubble.setLoading('hello', { x: 10, y: 20, width: 100, height: 30 });
      expect(shadow.querySelector('.beelingo-bubble.loading')).not.toBeNull();
      expect(shadow.querySelector('.beelingo-icon')).toBeNull();
      expect(host.style.left).toBe('10px');
      expect(host.style.top).toBe('58px'); // 20 + 30 + 8
    });

    it('positions bubble above the selection when below would overflow viewport', () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      bubble.setLoading('hello', { x: 10, y: 700, width: 100, height: 20 });
      // 下方位置 = 700 + 20 + 8 = 728，再加 ~180 气泡高度 = 908 > 800，溢出
      // 应放到上方：700 - 180 - 4 = 516
      expect(parseInt(host.style.top, 10)).toBe(516);
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    });

    it('clears any pending autoClose timer when transitioning to loading', () => {
      vi.useFakeTimers();
      try {
        // 先设置 success 触发 auto-close timer
        bubble.setSuccess('a', 'b', 1, { x: 0, y: 0, width: 50, height: 20 });
        // 在 timer 触发前切到 loading —— 应当清掉旧 timer
        bubble.setLoading('c', { x: 0, y: 0, width: 50, height: 20 });
        vi.advanceTimersByTime(10_000);
        // loading 状态不应被旧 success 的 timer 隐藏
        expect(shadow.querySelector('.beelingo-bubble.loading')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets autoClose timer when calling setSuccess twice in a row', () => {
      vi.useFakeTimers();
      try {
        bubble.setSuccess('a', 'b', 1, { x: 0, y: 0, width: 50, height: 20 });
        // 第二次 setSuccess 必须 scheduleAutoClose 已有的 timer（truthy 分支）
        bubble.setSuccess('c', 'd', 2, { x: 0, y: 0, width: 50, height: 20 });
        vi.advanceTimersByTime(10_000);
        // 第二个 timer 触发 hide
        expect(host.style.display).toBe('none');
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets autoClose timer when switching success → error', () => {
      vi.useFakeTimers();
      try {
        bubble.setSuccess('a', 'b', 1, { x: 0, y: 0, width: 50, height: 20 });
        bubble.setError('c', 'NETWORK', 'oops', true, { x: 0, y: 0, width: 50, height: 20 });
        vi.advanceTimersByTime(10_000);
        expect(host.style.display).toBe('none');
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels any pending autoClose timer on hide()', () => {
      vi.useFakeTimers();
      try {
        bubble.setSuccess('a', 'b', 1, { x: 0, y: 0, width: 50, height: 20 });
        bubble.hide();
        // 旧 timer 已被清；现在重新显示并手动推进原 ttl
        vi.advanceTimersByTime(10_000);
        // host 仍应是 none（hide 没被旧 timer 重新触发）
        expect(host.style.display).toBe('none');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('setSuccess', () => {
    it('renders translation text only (no original, no actions, no latency)', () => {
      bubble.setSuccess('hello', '你好', 123, { x: 0, y: 0, width: 50, height: 20 });
      const bubble_el = shadow.querySelector('.beelingo-bubble');
      expect(bubble_el).not.toBeNull();
      // 只显示译文
      expect(bubble_el?.textContent).toContain('你好');
      // 不显示原文
      expect(bubble_el?.textContent).not.toContain('hello');
      // 没有 复制/收藏 按钮
      expect(findButtonByText(shadow, '复制')).toBeUndefined();
      expect(findButtonByText(shadow, '收藏')).toBeUndefined();
      // 没有 latency 标签
      expect(shadow.querySelector('.beelingo-bubble-header .source')).toBeNull();
    });

    it('success bubble has no close button (auto-dismiss only)', () => {
      bubble.setSuccess('hi', '嗨', 50, { x: 0, y: 0, width: 50, height: 20 });
      // 成功气泡只显示译文，没有关闭按钮 —— 用户偏好：自动消失即可。
      expect(shadow.querySelector('.beelingo-bubble-header .close')).toBeNull();
      expect(shadow.querySelector('.beelingo-bubble-translation')?.textContent).toContain('嗨');
    });
  });

  describe('setError', () => {
    it('renders an error message', () => {
      bubble.setError('hi', 'RATE_LIMIT', '请求过多', true, { x: 0, y: 0, width: 50, height: 20 });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl).not.toBeNull();
      expect(errEl?.textContent).toContain('请求过多');
    });

    it('renders friendly text for NO_API_KEY', () => {
      bubble.setError('hi', 'NO_API_KEY', '', false, { x: 0, y: 0, width: 50, height: 20 });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('API Key');
    });

    it('renders friendly text for AUTH_ERROR with detail', () => {
      bubble.setError('hi', 'AUTH_ERROR', '401 Unauthorized', false, {
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('API Key');
      expect(errEl?.textContent).toContain('401 Unauthorized');
    });

    it('renders friendly text for QUOTA_EXCEEDED with detail', () => {
      bubble.setError('hi', 'QUOTA_EXCEEDED', '401 invalid', false, {
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('401 invalid');
    });

    it('renders friendly text for NETWORK error', () => {
      bubble.setError('hi', 'NETWORK', 'timeout', true, { x: 0, y: 0, width: 50, height: 20 });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('网络异常');
      expect(errEl?.textContent).toContain('timeout');
    });

    it('renders the message verbatim for PROVIDER_ERROR', () => {
      bubble.setError('hi', 'PROVIDER_ERROR', 'upstream down', true, {
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('翻译服务异常');
      expect(errEl?.textContent).toContain('upstream down');
    });

    it('error bubble close button hides the bubble', () => {
      bubble.setError('hi', 'NETWORK', 'fail', true, { x: 0, y: 0, width: 50, height: 20 });
      const closeBtn = shadow.querySelector<HTMLButtonElement>('.beelingo-bubble-header .close');
      closeBtn?.click();
      expect(host.style.display).toBe('none');
    });

    it('renders the message verbatim for INVALID_TEXT', () => {
      bubble.setError('hi', 'INVALID_TEXT', 'empty selection', false, {
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('empty selection');
    });

    it('falls back to raw message for unknown error codes', () => {
      bubble.setError('hi', 'SOMETHING_NEW', 'weird code', true, {
        x: 0,
        y: 0,
        width: 50,
        height: 20,
      });
      const errEl = shadow.querySelector('.beelingo-bubble-error');
      expect(errEl?.textContent).toContain('weird code');
    });
  });

  describe('auto-close', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('hides the success bubble after ttlMs', () => {
      // 重建一个新的 Bubble（避免 fakeTimers 跨 beforeEach 影响）
      bubble.destroy();
      host.remove();
      host = document.createElement('div');
      document.body.appendChild(host);
      bubble = new Bubble(host, 1000, cb);
      shadow = bubble.getShadowRoot();
      bubble.setSuccess('a', 'b', 1, { x: 0, y: 0, width: 50, height: 20 });
      expect(shadow.querySelector('.beelingo-bubble')).not.toBeNull();
      vi.advanceTimersByTime(1100);
      expect(host.style.display).toBe('none');
    });
  });
});

function findButtonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  const buttons = root.querySelectorAll<HTMLButtonElement>('button');
  return Array.from(buttons).find((b) => b.textContent?.includes(text));
}