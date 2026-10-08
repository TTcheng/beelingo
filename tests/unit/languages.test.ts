import { describe, expect, it } from 'vitest';
import {
  LANG_DISPLAY_NAME,
  LangCode,
  TARGET_LANGS,
  isLangCode,
} from '@/shared/translate/languages.js';

describe('LangCode', () => {
  it('contains expected codes', () => {
    expect(LangCode.Auto).toBe('auto');
    expect(LangCode.ZH).toBe('zh');
    expect(LangCode.EN).toBe('en');
    expect(LangCode.JA).toBe('ja');
    expect(LangCode.FR).toBe('fr');
    expect(LangCode.DE).toBe('de');
    expect(LangCode.KO).toBe('ko');
  });
});

describe('TARGET_LANGS', () => {
  it('excludes auto-detect', () => {
    expect(TARGET_LANGS).not.toContain('auto');
  });

  it('contains all non-auto LangCodes', () => {
    expect(TARGET_LANGS).toEqual(['zh', 'en', 'ja', 'fr', 'de', 'ko']);
  });
});

describe('LANG_DISPLAY_NAME', () => {
  it('has a display name for every LangCode', () => {
    for (const code of Object.values(LangCode)) {
      expect(LANG_DISPLAY_NAME[code]).toBeTypeOf('string');
      expect(LANG_DISPLAY_NAME[code].length).toBeGreaterThan(0);
    }
  });
});

describe('isLangCode', () => {
  it('accepts valid codes', () => {
    for (const code of Object.values(LangCode)) {
      expect(isLangCode(code)).toBe(true);
    }
  });

  it('rejects unknown strings', () => {
    expect(isLangCode('xx')).toBe(false);
    expect(isLangCode('')).toBe(false);
    expect(isLangCode('zh-CN')).toBe(false);
  });

  it('rejects non-string types', () => {
    expect(isLangCode(123)).toBe(false);
    expect(isLangCode(null)).toBe(false);
    expect(isLangCode(undefined)).toBe(false);
    expect(isLangCode({})).toBe(false);
  });
});