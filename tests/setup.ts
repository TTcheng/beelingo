/**
 * Vitest 全局 setup：装一个最小的 chrome.* shim，
 * 单元测试按需在 beforeEach 里覆盖具体行为。
 */

import { afterEach, vi, type Mock } from 'vitest';

// ---------- 类型边界 ----------

interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

type ChangeListener = (changes: Record<string, StorageChange>, area: string) => void;

export interface ChromeStorageArea {
  get: Mock;
  set: Mock;
  remove: Mock;
  clear: Mock;
  onChanged: {
    addListener: Mock;
    removeListener: Mock;
  };
  __listeners: ChangeListener[];
  __resetData: () => void;
}

function createStorageArea(): ChromeStorageArea {
  const data: Record<string, unknown> = {};
  const listeners: ChangeListener[] = [];
  const area: ChromeStorageArea = {
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown>) => {
      if (keys == null) return { ...data };
      if (typeof keys === 'string') return keys in data ? { [keys]: data[keys] } : {};
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        for (const k of keys) if (k in data) out[k] = data[k];
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(keys)) if (k in data) out[k] = data[k];
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, StorageChange> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: v };
        data[k] = v;
      }
      for (const l of listeners) l(changes, 'local');
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, StorageChange> = {};
      for (const k of list) {
        if (k in data) {
          changes[k] = { oldValue: data[k], newValue: undefined };
          delete data[k];
        }
      }
      for (const l of listeners) l(changes, 'local');
    }),
    clear: vi.fn(async () => {
      const changes: Record<string, StorageChange> = {};
      for (const k of Object.keys(data)) changes[k] = { oldValue: data[k], newValue: undefined };
      for (const k of Object.keys(data)) delete data[k];
      for (const l of listeners) l(changes, 'local');
    }),
    onChanged: {
      addListener: vi.fn((l: ChangeListener) => listeners.push(l)),
      removeListener: vi.fn((l: ChangeListener) => {
        const i = listeners.indexOf(l);
        if (i >= 0) listeners.splice(i, 1);
      }),
    },
    __listeners: listeners,
    __resetData: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
  return area;
}

export interface ChromeShim {
  storage: {
    local: ChromeStorageArea;
    session: ChromeStorageArea;
    onChanged: ChromeStorageArea['onChanged'];
  };
  runtime: {
    sendMessage: Mock;
    onMessage: { addListener: Mock; removeListener: Mock };
    onInstalled: { addListener: Mock };
    onStartup: { addListener: Mock };
    openOptionsPage: Mock;
  };
  contextMenus: {
    create: Mock;
    removeAll: Mock;
    onClicked: { addListener: Mock };
  };
  scripting: {
    executeScript: Mock;
  };
  tabs: {
    query: Mock;
    sendMessage: Mock;
    onRemoved: { addListener: Mock };
  };
  commands: {
    onCommand: { addListener: Mock };
  };
  i18n: {
    getMessage: Mock;
    getUILanguage: Mock;
  };
}

const localArea = createStorageArea();
const sessionArea = createStorageArea();

// 全局 chrome.storage.onChanged：本地与 session 都触发。测试代码可以独立订阅，
// 共享同一个 listener 注册表（生产环境亦如此）。
const aggregateOnChanged: ChromeStorageArea['onChanged'] = {
  addListener: vi.fn((l: ChangeListener) => {
    localArea.onChanged.addListener(l);
    sessionArea.onChanged.addListener(l);
  }),
  removeListener: vi.fn((l: ChangeListener) => {
    localArea.onChanged.removeListener(l);
    sessionArea.onChanged.removeListener(l);
  }),
};

const chromeShim: ChromeShim = {
  storage: {
    local: localArea,
    session: sessionArea,
    onChanged: aggregateOnChanged,
  },
  runtime: {
    sendMessage: vi.fn(async () => undefined),
    onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    openOptionsPage: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn(async () => undefined),
    onClicked: { addListener: vi.fn() },
  },
  scripting: {
    executeScript: vi.fn(async () => []),
  },
  tabs: {
    query: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
    onRemoved: { addListener: vi.fn() },
  },
  commands: {
    onCommand: { addListener: vi.fn() },
  },
  i18n: {
    getMessage: vi.fn((key: string) => key),
    getUILanguage: vi.fn(() => 'en'),
  },
};

(globalThis as unknown as { chrome: ChromeShim }).chrome = chromeShim;

// Vitest doesn't run through esbuild's `define` plugin, so the source's
// `declare const __TARGET__` is uninitialised at runtime. Provide a default
// so code paths that consult it don't crash on ReferenceError when a
// catch-handler runs (e.g. simulated executeScript rejection).
(globalThis as unknown as { __TARGET__: 'chrome' | 'firefox' }).__TARGET__ = 'firefox';

export const chromeMock = chromeShim;

afterEach(() => {
  vi.clearAllMocks();
  // localArea/sessionArea 共享 listener 列表，分别清掉
  localArea.__listeners.length = 0;
  sessionArea.__listeners.length = 0;
  localArea.__resetData();
  sessionArea.__resetData();
  // content script 幂等守卫标记存在 host.dataset 上。
  // 每次测试 import 前清掉 host（beforeEach 里也会 document.body.innerHTML = ''），
  // 这里再保险地主动删 dataset。
  if (typeof document !== 'undefined') {
    document.querySelectorAll<HTMLElement>('#beelingo-host').forEach((el) => {
      delete el.dataset['__beelingo'];
    });
  }
});