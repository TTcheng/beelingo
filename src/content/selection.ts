/**
 * 划词监听 + 选区矩形捕获。
 *
 * 输出：仅在选中文本变化时回调（防抖 150ms）。
 * 不在这里创建任何 UI — UI 由 index.ts 拿到事件后挂载。
 */

export interface SelectionInfo {
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

const MIN_LEN = 1;
const MAX_LEN = 500;
const DEBOUNCE_MS = 150;

export function watchSelection(cb: (info: SelectionInfo | null) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastText = '';

  function check(): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      cb(null);
      return;
    }
    const text = sel.toString().trim();
    if (text === lastText) return; // 完全相同跳过
    lastText = text;

    if (text.length < MIN_LEN || text.length > MAX_LEN) {
      cb(null);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    // 选区可能完全离屏（开发工具、隐藏 iframe 等）
    if (rect.width === 0 && rect.height === 0) {
      cb(null);
      return;
    }
    cb({
      text,
      rect: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  function schedule(): void {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(check, DEBOUNCE_MS);
  }

  // mouseup 是划词结束；selectionchange 是中间过程
  document.addEventListener('mouseup', schedule, { passive: true });
  document.addEventListener('keyup', schedule, { passive: true });
  document.addEventListener('selectionchange', schedule, { passive: true });

  return () => {
    if (timer !== null) clearTimeout(timer);
    document.removeEventListener('mouseup', schedule);
    document.removeEventListener('keyup', schedule);
    document.removeEventListener('selectionchange', schedule);
  };
}