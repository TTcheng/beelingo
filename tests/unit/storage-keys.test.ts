import { beforeEach, describe, expect, it } from 'vitest';
import { chromeMock } from '../setup.js';
import { STORAGE_KEY, getSettings, onSettingsChanged, setSettings } from '@/shared/storage/keys.js';
import { DEFAULT_SETTINGS } from '@/shared/storage/schema.js';

describe('STORAGE_KEY', () => {
  it('is namespaced and versioned', () => {
    expect(STORAGE_KEY.Settings).toBe('beelingo.settings.v1');
  });
});

describe('getSettings', () => {
  beforeEach(() => {
    chromeMock.storage.local.__resetData();
  });

  it('returns defaults when nothing stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('returns stored settings when valid', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: 'sk-test', model: 'gpt-4o' });
    const s = await getSettings();
    expect(s.apiKey).toBe('sk-test');
    expect(s.model).toBe('gpt-4o');
  });

  it('falls back to defaults when stored payload is malformed', async () => {
    await chromeMock.storage.local.set({ [STORAGE_KEY.Settings]: { bogus: true } });
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when stored payload has wrong field types', async () => {
    await chromeMock.storage.local.set({
      [STORAGE_KEY.Settings]: { apiKey: 'k', apiBaseUrl: 'not-a-url' },
    });
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults when stored payload is null', async () => {
    await chromeMock.storage.local.set({ [STORAGE_KEY.Settings]: null });
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });
});

describe('setSettings', () => {
  beforeEach(() => {
    chromeMock.storage.local.__resetData();
  });

  it('persists the payload under the namespaced key', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: 'sk-123' });
    const got = await chromeMock.storage.local.get(STORAGE_KEY.Settings);
    expect((got[STORAGE_KEY.Settings] as { apiKey: string }).apiKey).toBe('sk-123');
  });
});

describe('onSettingsChanged', () => {
  beforeEach(() => {
    chromeMock.storage.local.__resetData();
    chromeMock.storage.local.__listeners.length = 0;
  });

  it('fires handler when storage key updates with a valid value', async () => {
    const handler = vi.fn();
    onSettingsChanged(handler);

    await setSettings({ ...DEFAULT_SETTINGS, targetLang: 'ja' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].targetLang).toBe('ja');
  });

  it('skips updates with invalid payloads', async () => {
    const handler = vi.fn();
    onSettingsChanged(handler);

    // 直接塞无效值，触发 storage change
    await chromeMock.storage.local.set({ [STORAGE_KEY.Settings]: { foo: 'bar' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('skips changes from other areas', async () => {
    const handler = vi.fn();
    onSettingsChanged(handler);

    // 手动派发一个 area=session 的事件
    const listeners = chromeMock.storage.local.__listeners.slice();
    for (const l of listeners) l({}, 'session');

    expect(handler).not.toHaveBeenCalled();
  });

  it('skips changes to unrelated keys', async () => {
    const handler = vi.fn();
    onSettingsChanged(handler);

    // 改动与 settings 无关的 key
    await chromeMock.storage.local.set({ 'some.other.key': { foo: 'bar' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe that removes the listener', async () => {
    const handler = vi.fn();
    const off = onSettingsChanged(handler);
    expect(chromeMock.storage.local.__listeners.length).toBe(1);

    off();
    expect(chromeMock.storage.local.__listeners.length).toBe(0);

    await setSettings({ ...DEFAULT_SETTINGS, targetLang: 'en' });
    expect(handler).not.toHaveBeenCalled();
  });
});

import { vi } from 'vitest';