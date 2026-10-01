import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PublicSettingsSchema,
  SettingsSchema,
  TriggerMode,
} from '@/shared/storage/schema.js';

describe('SettingsSchema', () => {
  it('parses an empty object into defaults', () => {
    const s = SettingsSchema.parse({});
    expect(s.apiKey).toBe('');
    expect(s.apiBaseUrl).toBe('https://api.MiniMax.chat/v1');
    expect(s.model).toBe('MiniMax-M3');
    expect(s.thinking).toBe('disabled');
    expect(s.sourceLang).toBe('auto');
    expect(s.targetLang).toBe('zh');
    expect(s.trigger).toBe(TriggerMode.Both);
    expect(s.bubbleTtlMs).toBe(5000);
    expect(s.rateLimitPerMinute).toBe(10);
    expect(s.blacklist).toEqual([]);
  });

  it('round-trips a full settings object', () => {
    const input = {
      apiKey: 'sk-abc',
      apiBaseUrl: 'https://api.example.com/v1',
      model: 'gpt-4o-mini',
      thinking: 'adaptive' as const,
      sourceLang: 'en' as const,
      targetLang: 'ja' as const,
      trigger: 'icon' as const,
      bubbleTtlMs: 8000,
      rateLimitPerMinute: 20,
      blacklist: ['example.com', 'foo.bar'],
    };
    const parsed = SettingsSchema.parse(input);
    expect(parsed).toEqual(input);
  });

  it('rejects out-of-range bubbleTtlMs', () => {
    expect(() => SettingsSchema.parse({ bubbleTtlMs: 1000 })).toThrow();
    expect(() => SettingsSchema.parse({ bubbleTtlMs: 60000 })).toThrow();
    expect(() => SettingsSchema.parse({ bubbleTtlMs: 5000 })).not.toThrow();
  });

  it('rejects out-of-range rateLimitPerMinute', () => {
    expect(() => SettingsSchema.parse({ rateLimitPerMinute: 0 })).toThrow();
    expect(() => SettingsSchema.parse({ rateLimitPerMinute: 100 })).toThrow();
    expect(() => SettingsSchema.parse({ rateLimitPerMinute: 30 })).not.toThrow();
  });

  it('rejects invalid apiBaseUrl', () => {
    expect(() => SettingsSchema.parse({ apiBaseUrl: 'not-a-url' })).toThrow();
    expect(() => SettingsSchema.parse({ apiBaseUrl: 'https://valid.example/v1' })).not.toThrow();
  });

  it('rejects unknown language codes', () => {
    expect(() => SettingsSchema.parse({ sourceLang: 'klingon' })).toThrow();
    expect(() => SettingsSchema.parse({ targetLang: 'auto' })).toThrow();
  });

  it('rejects unknown trigger values', () => {
    expect(() => SettingsSchema.parse({ trigger: 'voice' })).toThrow();
  });

  it('rejects unknown thinking values', () => {
    expect(() => SettingsSchema.parse({ thinking: 'always' })).toThrow();
  });

  it('normalises non-integer bubbleTtlMs via zod', () => {
    expect(() => SettingsSchema.parse({ bubbleTtlMs: 5000.5 })).toThrow();
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('equals parsing empty input', () => {
    expect(DEFAULT_SETTINGS).toEqual(SettingsSchema.parse({}));
  });
});

describe('PublicSettingsSchema', () => {
  it('omits apiKey and apiBaseUrl', () => {
    const pub = PublicSettingsSchema.parse(DEFAULT_SETTINGS);
    expect(pub).not.toHaveProperty('apiKey');
    expect(pub).not.toHaveProperty('apiBaseUrl');
    expect(pub.model).toBe(DEFAULT_SETTINGS.model);
    expect(pub.targetLang).toBe(DEFAULT_SETTINGS.targetLang);
  });
});