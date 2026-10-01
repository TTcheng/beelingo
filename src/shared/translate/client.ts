/**
 * OpenAI 兼容协议的翻译客户端。
 * 仅由 background 调用：从 storage 读 API Key，绝不接收 Key 作为参数。
 */

import { LANG_DISPLAY_NAME, type LangCodeValue } from './languages.js';

/** 思维链控制：关闭 = 直接出译文；adaptive = 让模型自己决定。 */
export type ThinkingMode = 'disabled' | 'adaptive';

export interface TranslateOptions {
  text: string;
  sourceLang: LangCodeValue;
  targetLang: LangCodeValue;
  /** API base URL（含 /v1） */
  baseUrl: string;
  /** 模型 ID */
  model: string;
  /** API Key */
  apiKey: string;
  /**
   * 是否启用思维链。默认 'disabled' —— 翻译场景下 reasoning_content
   * 会污染气泡，且 token 成本翻倍。
   */
  thinking?: ThinkingMode;
  signal?: AbortSignal;
}

export interface TranslateSuccess {
  ok: true;
  translated: string;
  detectedSource?: LangCodeValue;
  latencyMs: number;
}

export interface TranslateFailure {
  ok: false;
  code:
    | 'NO_API_KEY'
    | 'NETWORK'
    | 'QUOTA_EXCEEDED'
    | 'RATE_LIMIT'
    | 'PROVIDER_ERROR'
    | 'INVALID_TEXT'
    | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

export type TranslateOutcome = TranslateSuccess | TranslateFailure;

const MAX_TEXT_LEN = 500;

function buildSystemPrompt(src: LangCodeValue, tgt: LangCodeValue): string {
  const srcName = src === 'auto' ? 'the source language' : LANG_DISPLAY_NAME[src];
  const tgtName = LANG_DISPLAY_NAME[tgt];
  return [
    'You are BeeLingo, a translation engine for a browser extension.',
    `Translate the user's text from ${srcName} to ${tgtName}.`,
    'Rules:',
    '- Return ONLY the translation, no quotes, no explanations.',
    '- Preserve original line breaks and punctuation.',
    '- For code/identifiers/URLs, keep them verbatim.',
    '- If the source already matches the target language, return it unchanged.',
  ].join('\n');
}

/** 把 OpenAI 错误码映射到我们内部的 TranslateErrorCode */
function classifyHttp(status: number): TranslateFailure['code'] {
  if (status === 401 || status === 403) return 'QUOTA_EXCEEDED';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'PROVIDER_ERROR';
  return 'UNKNOWN';
}

export async function translate(opts: TranslateOptions): Promise<TranslateOutcome> {
  const text = opts.text.trim();
  if (text.length === 0) {
    return { ok: false, code: 'INVALID_TEXT', message: '选中文本为空', retryable: false };
  }
  if (text.length > MAX_TEXT_LEN) {
    return {
      ok: false,
      code: 'INVALID_TEXT',
      message: `选中文本超过 ${MAX_TEXT_LEN} 字符`,
      retryable: false,
    };
  }
  if (!opts.apiKey) {
    return { ok: false, code: 'NO_API_KEY', message: '未配置 API Key', retryable: false };
  }

  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const thinking: ThinkingMode = opts.thinking ?? 'disabled';
  const body = {
    model: opts.model,
    temperature: 0.2,
    max_tokens: Math.max(64, Math.ceil(text.length * 2)),
    // 关闭思维链时同时强制把 reasoning 留在 reasoning_content，
    // 避免 M3 把 <think>...</think> 写进 content 污染译文。
    ...(thinking === 'disabled'
      ? { thinking: { type: 'disabled' }, reasoning_split: false }
      : { thinking: { type: 'adaptive' } }),
    messages: [
      { role: 'system', content: buildSystemPrompt(opts.sourceLang, opts.targetLang) },
      { role: 'user', content: text },
    ],
  };

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    return {
      ok: false,
      code: isAbort ? 'UNKNOWN' : 'NETWORK',
      message: isAbort ? '请求已取消' : `网络错误: ${msg}`,
      retryable: !isAbort,
    };
  }

  if (!res.ok) {
    let detail = '';
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j.error?.message ?? '';
    } catch {
      /* non-JSON error body */
    }
    return {
      ok: false,
      code: classifyHttp(res.status),
      message: `${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`,
      retryable: res.status >= 500 || res.status === 429,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: '响应不是合法 JSON',
      retryable: true,
    };
  }

  const translated = extractContent(data);
  if (!translated) {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: '响应缺少 choices[0].message.content',
      retryable: true,
    };
  }

  return {
    ok: true,
    translated,
    detectedSource: opts.sourceLang === 'auto' ? undefined : opts.sourceLang,
    latencyMs: Date.now() - t0,
  };
}

function extractContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { choices?: Array<{ message?: { content?: unknown } }> };
  const first = d.choices?.[0];
  const content = first?.message?.content;
  if (typeof content === 'string') return content.trim();
  return null;
}