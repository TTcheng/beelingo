/**
 * storage key 常量 + 读写封装。
 * 仅 background / popup / options 使用；content 永远不直接读 storage，
 * 由 background 在收到 TranslateRequest 时把需要的字段（targetLang 等）放进消息。
 */

import { DEFAULT_SETTINGS, type Settings, SettingsSchema } from './schema.js';

export const STORAGE_KEY = {
  /** 单 key 存储整份 settings，避免跨 key 写入竞态 */
  Settings: 'beelingo.settings.v1',
} as const;

/**
 * 把存储里的值收窄为「看起来像 settings 的对象」，避免 zod 的 .default()
 * 在 `{foo:'bar'}` 上"宽容"补齐字段、误当成有效配置。
 * 真实 settings 必须至少含 apiKey 字段。
 */
function isPlausibleSettings(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'apiKey' in value;
}

/** 读 settings，读不到或解析失败回退到默认值 */
export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get(STORAGE_KEY.Settings);
  const value = raw[STORAGE_KEY.Settings];
  if (!isPlausibleSettings(value)) return DEFAULT_SETTINGS;
  const parsed = SettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** 写 settings；调用前最好用 SettingsSchema 校验过 */
export async function setSettings(next: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY.Settings]: next });
}

/** 监听 settings 变更（background 据此重建令牌桶） */
export function onSettingsChanged(handler: (next: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: chrome.storage.AreaName,
  ) => {
    if (area !== 'local') return;
    const change = changes[STORAGE_KEY.Settings];
    if (!change) return;
    if (!isPlausibleSettings(change.newValue)) return;
    const parsed = SettingsSchema.safeParse(change.newValue);
    if (parsed.success) handler(parsed.data);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}