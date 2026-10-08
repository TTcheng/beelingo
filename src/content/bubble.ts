/**
 * 悬浮小蜜蜂图标 + 译文气泡（Shadow DOM 隔离样式）。
 *
 * 每个 UI 元素都挂在同一个 host 元素下；host 由 index.ts 创建并定位到页面。
 */

import cssText from './style.css?inline';

export interface BubbleCallbacks {
  /** 用户点击小蜜蜂时触发，由 index.ts 决定是否发起翻译 */
  onIconClick: () => void;
}

export type BubbleState =
  | { kind: 'idle' }
  | { kind: 'loading'; original: string }
  | { kind: 'success'; original: string; translation: string; latencyMs: number }
  | { kind: 'error'; original: string; code: string; message: string; retryable: boolean };

export class Bubble {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private state: BubbleState = { kind: 'idle' };
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ttlMs: number;

  constructor(host: HTMLElement, ttlMs: number, private readonly cb: BubbleCallbacks) {
    this.host = host;
    this.ttlMs = ttlMs;
    this.shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = cssText;
    this.shadow.appendChild(style);

    // 文档级 click 监听由 index.ts 统一处理（避免每个实例挂自己的）
  }

  /** 显示小蜜蜂图标 */
  showIcon(rect: { x: number; y: number; width: number; height: number }): void {
    this.hideBubble();
    this.host.style.display = '';
    this.host.style.left = `${Math.round(rect.x + rect.width - 14)}px`;
    this.host.style.top = `${Math.round(rect.y - 14)}px`;
    this.renderIcon();
  }

  /** 隐藏图标与气泡 */
  hide(): void {
    this.host.style.display = 'none';
    this.hideBubble();
    this.state = { kind: 'idle' };
  }

  hideIcon(): void {
    this.host.style.display = 'none';
  }

  /** 切到加载状态：在选区附近显示 loading 气泡 */
  setLoading(original: string, rect: { x: number; y: number; width: number; height: number }): void {
    this.hideIcon();
    this.state = { kind: 'loading', original };
    this.renderLoadingBubble(original, rect);
  }

  setSuccess(
    original: string,
    translation: string,
    latencyMs: number,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    this.state = { kind: 'success', original, translation, latencyMs };
    this.renderSuccessBubble(original, translation, latencyMs, rect);
  }

  setError(
    original: string,
    code: string,
    message: string,
    retryable: boolean,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    this.state = { kind: 'error', original, code, message, retryable };
    this.renderErrorBubble(original, code, message, retryable, rect);
  }

  destroy(): void {
    if (this.autoCloseTimer !== null) clearTimeout(this.autoCloseTimer);
    this.host.remove();
  }

  /**
   * 返回 shadow root 引用。生产代码不需要（事件 retarget 后 host.contains 足够），
   * 单测要断言 shadow DOM 内的元素就得拿到它，所以这里破例暴露一次。
   */
  getShadowRoot(): ShadowRoot {
    return this.shadow;
  }

  // ---------- 渲染 ----------

  private renderIcon(): void {
    // 清空保留 <style>
    this.clearBody();
    const root = document.createElement('div');
    root.className = 'beelingo-host-inner';
    root.style.display = 'inline-flex';

    const icon = document.createElement('button');
    icon.className = 'beelingo-icon';
    icon.setAttribute('aria-label', '翻译选中文本');
    icon.textContent = '🐝';
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.cb.onIconClick();
    });
    root.appendChild(icon);

    this.shadow.appendChild(root);
  }

  private renderLoadingBubble(
    original: string,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    this.positionBubble(rect);
    this.clearBody();

    const bubble = document.createElement('div');
    bubble.className = 'beelingo-bubble loading';
    const spinner = document.createElement('span');
    spinner.className = 'beelingo-spinner';
    bubble.appendChild(spinner);
    const text = document.createElement('span');
    text.textContent = '翻译中…';
    bubble.appendChild(text);

    this.shadow.appendChild(bubble);
    // loading 不自动关闭（等结果）
    if (this.autoCloseTimer !== null) clearTimeout(this.autoCloseTimer);
    this.autoCloseTimer = null;
    // 记录原文以备点击外部时回调使用
    bubble.dataset['original'] = original.slice(0, 200);
  }

  private renderSuccessBubble(
    original: string,
    translation: string,
    latencyMs: number,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    // 用户偏好：只显示翻译结果，让其自动消失，不要任何按钮。
    this.positionBubble(rect);
    this.clearBody();

    const bubble = document.createElement('div');
    bubble.className = 'beelingo-bubble';

    const tr = document.createElement('div');
    tr.className = 'beelingo-bubble-translation';
    tr.textContent = translation;
    bubble.appendChild(tr);

    this.shadow.appendChild(bubble);
    this.scheduleAutoClose();
    void original;
    void latencyMs;
  }

  private renderErrorBubble(
    original: string,
    code: string,
    message: string,
    _retryable: boolean,
    rect: { x: number; y: number; width: number; height: number },
  ): void {
    this.positionBubble(rect);
    this.clearBody();

    const bubble = document.createElement('div');
    bubble.className = 'beelingo-bubble';

    const header = document.createElement('div');
    header.className = 'beelingo-bubble-header';
    const src = document.createElement('span');
    src.className = 'source';
    src.textContent = code;
    header.appendChild(src);
    const close = document.createElement('button');
    close.className = 'close';
    close.setAttribute('aria-label', '关闭');
    close.textContent = '✕';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    header.appendChild(close);
    bubble.appendChild(header);

    const err = document.createElement('div');
    err.className = 'beelingo-bubble-error';
    err.textContent = friendlyError(code, message);
    bubble.appendChild(err);

    this.shadow.appendChild(bubble);
    this.scheduleAutoClose();
  }

  private positionBubble(rect: { x: number; y: number; width: number; height: number }): void {
    // 默认：选区下方 8px，左对齐
    const left = Math.round(rect.x);
    const top = Math.round(rect.y + rect.height + 8);
    // 防溢出：视口下边界放不下就放到上方
    const ESTIMATED_H = 180;
    const viewportH = window.innerHeight;
    let finalTop = top;
    if (top + ESTIMATED_H > viewportH && rect.y - ESTIMATED_H > 0) {
      finalTop = Math.round(rect.y - ESTIMATED_H - 4);
    }
    this.host.style.display = '';
    this.host.style.left = `${left}px`;
    this.host.style.top = `${finalTop}px`;
  }

  private scheduleAutoClose(): void {
    if (this.autoCloseTimer !== null) clearTimeout(this.autoCloseTimer);
    this.autoCloseTimer = setTimeout(() => this.hide(), this.ttlMs);
  }

  private clearBody(): void {
    // 只清业务节点，保留 <style>
    const style = this.shadow.querySelector('style');
    this.shadow.replaceChildren();
    if (style) this.shadow.appendChild(style);
  }

  private hideBubble(): void {
    // 移除所有业务节点
    this.clearBody();
  }
}

function friendlyError(code: string, message: string): string {
  switch (code) {
    case 'NO_API_KEY':
      return '请先在设置中配置 API Key';
    case 'AUTH_ERROR':
      return `API Key 无效或未授权 (${message})`;
    case 'QUOTA_EXCEEDED':
      return `账户余额/配额不足 (${message})`;
    case 'RATE_LIMIT':
      return '本分钟请求过多，请稍候再试';
    case 'NETWORK':
      return `网络异常：${message}`;
    case 'INVALID_TEXT':
      return message;
    case 'PROVIDER_ERROR':
      return `翻译服务异常：${message}`;
    default:
      return message;
  }
}