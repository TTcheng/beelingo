/**
 * Options page TS — 表单与 settings 双向绑定。
 */

import { getSettings, setSettings } from '../shared/storage/keys.js';
import { SettingsSchema, type Settings } from '../shared/storage/schema.js';
import { MessageType } from '../shared/messaging/protocol.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

const fields: Record<keyof Settings, HTMLElement> = {
  apiKey: $<HTMLInputElement>('apiKey'),
  apiBaseUrl: $<HTMLInputElement>('apiBaseUrl'),
  model: $<HTMLInputElement>('model'),
  sourceLang: $<HTMLSelectElement>('sourceLang'),
  targetLang: $<HTMLSelectElement>('targetLang'),
  trigger: $<HTMLSelectElement>('trigger'),
  bubbleTtlMs: $<HTMLSelectElement>('bubbleTtlMs'),
  rateLimitPerMinute: $<HTMLSelectElement>('rateLimitPerMinute'),
  blacklist: $<HTMLTextAreaElement>('blacklist'),
};

async function loadIntoForm(): Promise<void> {
  const s = await getSettings();
  (fields.apiKey as HTMLInputElement).value = s.apiKey;
  (fields.apiBaseUrl as HTMLInputElement).value = s.apiBaseUrl;
  (fields.model as HTMLInputElement).value = s.model;
  (fields.sourceLang as HTMLSelectElement).value = s.sourceLang;
  (fields.targetLang as HTMLSelectElement).value = s.targetLang;
  (fields.trigger as HTMLSelectElement).value = s.trigger;
  (fields.bubbleTtlMs as HTMLSelectElement).value = String(s.bubbleTtlMs);
  (fields.rateLimitPerMinute as HTMLSelectElement).value = String(s.rateLimitPerMinute);
  (fields.blacklist as HTMLTextAreaElement).value = s.blacklist.join('\n');
}

function readFromForm(): Settings {
  const blacklistRaw = (fields.blacklist as HTMLTextAreaElement).value;
  const blacklist = blacklistRaw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return SettingsSchema.parse({
    apiKey: (fields.apiKey as HTMLInputElement).value,
    apiBaseUrl: (fields.apiBaseUrl as HTMLInputElement).value,
    model: (fields.model as HTMLInputElement).value,
    sourceLang: (fields.sourceLang as HTMLSelectElement).value,
    targetLang: (fields.targetLang as HTMLSelectElement).value,
    trigger: (fields.trigger as HTMLSelectElement).value,
    bubbleTtlMs: Number((fields.bubbleTtlMs as HTMLSelectElement).value),
    rateLimitPerMinute: Number((fields.rateLimitPerMinute as HTMLSelectElement).value),
    blacklist,
  });
}

function setStatus(el: HTMLElement, text: string, kind: '' | 'ok' | 'err' = ''): void {
  el.textContent = text;
  el.className = `status${kind ? ' ' + kind : ''}`;
}

$('save').addEventListener('click', async () => {
  try {
    const next = readFromForm();
    await setSettings(next);
    setStatus($('saveStatus'), '✓ 已保存', 'ok');
    setTimeout(() => setStatus($('saveStatus'), ''), 2000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus($('saveStatus'), `保存失败：${msg}`, 'err');
  }
});

$('reset').addEventListener('click', async () => {
  await chrome.storage.local.clear();
  await loadIntoForm();
  setStatus($('saveStatus'), '已恢复默认', 'ok');
});

$('validate').addEventListener('click', async () => {
  // 先保存再校验，保证校验用的是最新 Key
  try {
    await setSettings(readFromForm());
  } catch (e) {
    setStatus($('validateStatus'), '表单有误，请检查', 'err');
    return;
  }
  setStatus($('validateStatus'), '校验中…');
  const res = await chrome.runtime.sendMessage({ type: MessageType.ValidateApiKey });
  if (res && typeof res === 'object' && 'payload' in res) {
    const payload = (res as { payload: { ok: boolean; error?: string } }).payload;
    if (payload.ok) {
      setStatus($('validateStatus'), '✓ Key 有效', 'ok');
    } else {
      setStatus($('validateStatus'), `✗ ${payload.error ?? '无效'}`, 'err');
    }
  } else {
    setStatus($('validateStatus'), '校验失败', 'err');
  }
});

void loadIntoForm();