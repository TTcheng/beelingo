/**
 * Settings storage schema + zod validator.
 * 单一写入点：background 收到 OPTIONS_UPDATED 消息时调 setSettings()。
 * 读取：background（用于实际翻译）、popup（用于显示状态）、options（用于表单）。
 */

import { z } from 'zod';
import { LangCode } from '../translate/languages.js';

export const TriggerMode = {
  Icon: 'icon',
  Hotkey: 'hotkey',
  Both: 'both',
} as const;
export type TriggerModeValue = (typeof TriggerMode)[keyof typeof TriggerMode];

const SOURCE_LANGS = ['auto', 'zh', 'en', 'ja', 'fr', 'de', 'ko'] as const;
const TARGET_LANGS = ['zh', 'en', 'ja', 'fr', 'de', 'ko'] as const;

export const SettingsSchema = z.object({
  apiKey: z.string().default(''),
  /** OpenAI 兼容协议的 base URL，默认 MiniMax */
  apiBaseUrl: z.string().url().default('https://api.MiniMax.chat/v1'),
  /** 模型名，默认 M3（OpenAI 兼容） */
  model: z.string().default('MiniMax-M3'),
  sourceLang: z.enum(SOURCE_LANGS).default(LangCode.Auto),
  targetLang: z.enum(TARGET_LANGS).default(LangCode.ZH),
  trigger: z.enum(['icon', 'hotkey', 'both'] as const).default(TriggerMode.Both),
  /** 自动消失时长（ms） */
  bubbleTtlMs: z.number().int().min(2000).max(30000).default(5000),
  /** 每分钟最大翻译次数（防滥用） */
  rateLimitPerMinute: z.number().int().min(1).max(60).default(10),
  /** 黑名单域名列表（精确匹配） */
  blacklist: z.array(z.string()).default([]),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** 提取 settings 中真正需要同步给 content 的子集（Key 不外泄） */
export const PublicSettingsSchema = SettingsSchema.omit({ apiKey: true, apiBaseUrl: true });
export type PublicSettings = z.infer<typeof PublicSettingsSchema>;