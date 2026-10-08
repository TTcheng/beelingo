/**
 * OpenAI 兼容协议的翻译客户端。
 * 仅由 background 调用：从 storage 读 API Key，绝不接收 Key 作为参数。
 */

import { z } from 'zod';
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
    | 'AUTH_ERROR'
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
/** 单次翻译请求的最长等待（ms）。超过即按 NETWORK 失败返回，避免气泡永久转圈。 */
const FETCH_TIMEOUT_MS = 15_000;
/**
 * 思维链预留 token。推理型模型（如 DeepSeek）即使收到 MiniMax 专有的
 * `thinking:disabled` 也照常思考，且 reasoning token 同样计入 max_tokens。
 * 若 max_tokens 只按译文长度算，思考会吃光预算 → finish_reason=length、
 * content 为空。这里固定预留一段，保证思考结束后仍有额度输出译文。
 */
const REASONING_HEADROOM_TOKENS = 1024;

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
  // 401/403 = Key 无效/未授权；402 = 余额不足；二者语义不同，不能混为一谈。
  if (status === 401 || status === 403) return 'AUTH_ERROR';
  if (status === 402) return 'QUOTA_EXCEEDED';
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
    // 译文预算（≈2× 输入）+ 思维链预留，避免 reasoning 占满额度导致空 content。
    max_tokens: Math.ceil(text.length * 2) + REASONING_HEADROOM_TOKENS,
    // 关闭思维链要同时下两种“方言”，因为各 provider 只认各自的字段：
    //   - MiniMax 用 `thinking` + `reasoning_split`（把思考留在 reasoning_content）
    //   - OpenRouter / OpenAI 系用标准 `reasoning:{enabled:false}`（真正停止推理）
    // 互相忽略未知字段，因此两个都发，才能在任何一家上真正关掉思考链，
    // 既避免 reasoning 占满 max_tokens 导致空 content，也省掉这笔 token 开销。
    ...(thinking === 'disabled'
      ? {
          thinking: { type: 'disabled' },
          reasoning_split: false,
          reasoning: { enabled: false },
        }
      : { thinking: { type: 'adaptive' } }),
    messages: [
      { role: 'system', content: buildSystemPrompt(opts.sourceLang, opts.targetLang) },
      { role: 'user', content: text },
    ],
  };

const t0 = Date.now();
  // 内部超时：Firefox 115-126 若 host_permissions 未授权，fetch 会被 CORS 拒，
  // 但在部分网络环境下也可能长时间挂起。叠加外部 signal 一起控制总时长。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('FETCH_TIMEOUT')), FETCH_TIMEOUT_MS);
  const signal = opts.signal
    ? composeAbortSignals(opts.signal, ctrl.signal)
    : ctrl.signal;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    const isFetchTimeout = msg.startsWith('FETCH_TIMEOUT');
    const isExternalAbort =
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError');
    return {
      ok: false,
      // 外部 AbortError 视为取消（UNKNOWN / 不重试）；
      // 内部 FETCH_TIMEOUT 视为网络故障（NETWORK / 可重试）。
      code: isExternalAbort ? 'UNKNOWN' : 'NETWORK',
      message: isFetchTimeout
        ? `请求超时（${FETCH_TIMEOUT_MS / 1000}s），可能是网络或 API 不可达`
        : isExternalAbort
        ? '请求已取消'
        : `网络错误: ${msg}`,
      retryable: !isExternalAbort,
    };
  }
  clearTimeout(timer);

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

  const { content: translated, finishReason } = parseCompletion(data);
  if (!translated) {
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message:
        finishReason === 'length'
          ? '输出被截断，max_tokens 不足（可能被思维链占满）'
          : '响应缺少 choices[0].message.content',
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

/** OpenAI 兼容的 chat.completion 响应，只取我们需要校验的字段。 */
const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().optional(),
        message: z.object({ content: z.string().nullable().optional() }).optional(),
      }),
    )
    .optional(),
});

/** 提取译文与结束原因；非预期结构一律按「无译文」处理。 */
function parseCompletion(data: unknown): { content: string | null; finishReason?: string } {
  const parsed = ChatCompletionSchema.safeParse(data);
  if (!parsed.success) return { content: null };
  const first = parsed.data.choices?.[0];
  const raw = first?.message?.content;
  const content = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  return { content, finishReason: first?.finish_reason };
}

/**
 * 把外部 signal 与内部超时 signal 合并成一个。任一被 abort 都会触发新 signal。
 * AbortSignal.any() 浏览器支持参差，手写一个最简版本避免依赖。
 */
function composeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ctrl = new AbortController();
  const onAbort = (): void => ctrl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctrl.signal;
}