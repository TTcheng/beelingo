/**
 * 支持的语种 + 显示名。代码为 ISO 639-1；LANG_DISPLAY_NAME 直接进 prompt，
 * 用语言全称避免模型把 zh 误解成繁体。
 */

export const LangCode = {
  Auto: 'auto',
  ZH: 'zh',
  EN: 'en',
  JA: 'ja',
  FR: 'fr',
  DE: 'de',
  KO: 'ko',
} as const;

export type LangCodeValue = (typeof LangCode)[keyof typeof LangCode];

/** 用户在 Options 中可选的目标语言列表（不含 Auto） */
export const TARGET_LANGS: LangCodeValue[] = [
  LangCode.ZH,
  LangCode.EN,
  LangCode.JA,
  LangCode.FR,
  LangCode.DE,
  LangCode.KO,
];

/** 给大模型用的语言全称，避免模型混淆 zh-CN / zh-TW */
export const LANG_DISPLAY_NAME: Record<LangCodeValue, string> = {
  auto: 'Auto-detect',
  zh: 'Simplified Chinese (简体中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  ko: 'Korean (한국어)',
};

/** 校验 */
export function isLangCode(v: unknown): v is LangCodeValue {
  return typeof v === 'string' && v in LANG_DISPLAY_NAME;
}