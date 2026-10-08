/**
 * Settings storage schema + zod validator。
 * 写入：options 页保存时调 setSettings()。
 * 读取：background（实际翻译）、popup（显示 Key 状态）、options（表单回填）。
 */

import { z } from 'zod';
import { LangCode } from '../translate/languages.js';

const SOURCE_LANGS = ['auto', 'zh', 'en', 'ja', 'fr', 'de', 'ko'] as const;
const TARGET_LANGS = ['zh', 'en', 'ja', 'fr', 'de', 'ko'] as const;

export const SettingsSchema = z.object({
  apiKey: z.string().default(''),
  /** OpenAI 兼容协议的 base URL，默认 MiniMax */
  apiBaseUrl: z.string().url().default('https://api.MiniMax.chat/v1'),
  /** 模型名，默认 M3（OpenAI 兼容） */
  model: z.string().default('MiniMax-M3'),
  /**
   * 是否启用模型思维链。默认 'disabled' —— 翻译是确定性任务，
   * 启用思考只会拖慢响应、消耗 token、且 reasoning_content 会污染译文。
   */
  thinking: z.enum(['disabled', 'adaptive']).default('disabled'),
  sourceLang: z.enum(SOURCE_LANGS).default(LangCode.Auto),
  targetLang: z.enum(TARGET_LANGS).default(LangCode.ZH),
  /** 每分钟最大翻译次数（防滥用） */
  rateLimitPerMinute: z.number().int().min(1).max(60).default(10),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});