import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { translate } from '@/shared/translate/client.js';

const baseOpts = {
  text: 'hello world',
  sourceLang: 'en' as const,
  targetLang: 'zh' as const,
  baseUrl: 'https://api.example.com/v1',
  model: 'm',
  apiKey: 'sk-test',
};

// ---------- fetch stub helpers ----------

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchFn {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export type FetchSpy = Mock<Parameters<FetchFn>, ReturnType<FetchFn>>;

/** globalThis 是 Node 20+ 宿主全局；这里只覆盖其上的 fetch 引用，不是对外部数据做 unchecked narrowing。 */
function setGlobalFetch(fn: unknown): void {
  (globalThis as { fetch?: unknown }).fetch = fn;
}

function installFetch(impl: (call: FetchCall) => Promise<Response>): FetchSpy {
  const fn = vi.fn(async (...args: Parameters<FetchFn>) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input.toString();
    return impl({ url, init });
  });
  setGlobalFetch(fn);
  return fn;
}

function jsonResponse(status: number, body: unknown): Response {
  const isOk = status >= 200 && status < 300;
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
    ...(isOk ? {} : { statusText: 'error' }),
  });
}

function readFetchCall(fetchMock: ReturnType<typeof installFetch>): FetchCall {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('fetch not called');
  const [input, init] = call;
  const url = typeof input === 'string' ? input : String(input);
  return { url, init: init as RequestInit | undefined };
}

// ---------- tests ----------

describe('translate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty text with INVALID_TEXT', async () => {
    const r = await translate({ ...baseOpts, text: '   ' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_TEXT');
    expect(r.retryable).toBe(false);
  });

  it('rejects too-long text with INVALID_TEXT', async () => {
    const r = await translate({ ...baseOpts, text: 'a'.repeat(501) });
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('INVALID_TEXT');
    expect(r.retryable).toBe(false);
  });

  it('rejects missing apiKey with NO_API_KEY', async () => {
    const r = await translate({ ...baseOpts, apiKey: '' });
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('NO_API_KEY');
    expect(r.retryable).toBe(false);
  });

  it('returns translated text on success', async () => {
    installFetch(async () => jsonResponse(200, { choices: [{ message: { content: '你好世界' } }] }));
    const r = await translate(baseOpts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.translated).toBe('你好世界');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.detectedSource).toBe('en');
  });

  it('omits detectedSource when source is auto', async () => {
    installFetch(async () => jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }));
    const r = await translate({ ...baseOpts, sourceLang: 'auto' });
    if (!r.ok) throw new Error('expected success');
    expect(r.detectedSource).toBeUndefined();
  });

  it('trims trailing whitespace from content', async () => {
    installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: '  你好  \n' } }] }),
    );
    const r = await translate(baseOpts);
    if (!r.ok) throw new Error('expected success');
    expect(r.translated).toBe('你好');
  });

  it('classifies 401 as AUTH_ERROR (not retryable)', async () => {
    installFetch(async () => jsonResponse(401, { error: { message: 'invalid key' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('AUTH_ERROR');
    expect(r.retryable).toBe(false);
    expect(r.message).toContain('invalid key');
  });

  it('classifies 403 as AUTH_ERROR', async () => {
    installFetch(async () => jsonResponse(403, { error: { message: 'forbidden' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('AUTH_ERROR');
  });

  it('classifies 402 as QUOTA_EXCEEDED (not retryable)', async () => {
    installFetch(async () => jsonResponse(402, { error: { message: 'insufficient credits' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('QUOTA_EXCEEDED');
    expect(r.retryable).toBe(false);
  });

  it('classifies 429 as RATE_LIMIT (retryable)', async () => {
    installFetch(async () => jsonResponse(429, { error: { message: 'slow down' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('RATE_LIMIT');
    expect(r.retryable).toBe(true);
  });

  it('classifies 500 as PROVIDER_ERROR (retryable)', async () => {
    installFetch(async () => jsonResponse(500, { error: { message: 'oops' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
    expect(r.retryable).toBe(true);
  });

  it('classifies 400 as UNKNOWN (not retryable)', async () => {
    installFetch(async () => jsonResponse(400, { error: { message: 'bad' } }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('UNKNOWN');
    expect(r.retryable).toBe(false);
  });

  it('budgets reasoning headroom into max_tokens', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: '你好' } }] }),
    );
    await translate({ ...baseOpts, text: 'hi' });
    const { init } = readFetchCall(fetchMock);
    const body: unknown = JSON.parse(String(init?.body));
    if (!body || typeof body !== 'object' || !('max_tokens' in body)) {
      throw new Error('request body has no max_tokens');
    }
    // 短文本也必须远大于译文长度，否则推理型模型的 reasoning token 会占满额度、content 为空。
    expect(Number(body.max_tokens)).toBeGreaterThanOrEqual(1024);
  });

  it('reports truncation when finish_reason is length', async () => {
    installFetch(async () =>
      jsonResponse(200, { choices: [{ finish_reason: 'length', message: { content: null } }] }),
    );
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
    expect(r.message).toContain('截断');
  });

  it('treats non-JSON error body as plain HTTP error', async () => {
    installFetch(
      async () =>
        new Response('plain text error', { status: 500, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
    expect(r.retryable).toBe(true);
  });

  it('classifies fetch rejection as NETWORK (retryable)', async () => {
    installFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('NETWORK');
    expect(r.retryable).toBe(true);
  });

  it('treats AbortError as UNKNOWN and not retryable', async () => {
    installFetch(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('UNKNOWN');
    expect(r.retryable).toBe(false);
  });

  it('handles non-Error fetch rejection via String() coercion', async () => {
    installFetch(async () => {
      // 抛非 Error 对象（罕见但可能）
      throw 'plain string failure';
    });
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('NETWORK');
    expect(r.message).toContain('plain string failure');
  });

  it('omits detail suffix when error JSON lacks message field', async () => {
    installFetch(async () => jsonResponse(401, { error: {} }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    // 末尾没有 ": <detail>"
    expect(r.message).not.toMatch(/:\s*$/);
  });

  it('flags malformed JSON as PROVIDER_ERROR (retryable)', async () => {
    installFetch(
      async () =>
        new Response('not-json{', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
    expect(r.retryable).toBe(true);
  });

  it('flags missing content as PROVIDER_ERROR', async () => {
    installFetch(async () => jsonResponse(200, { choices: [{ message: {} }] }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
  });

  it('flags non-object response as PROVIDER_ERROR', async () => {
    installFetch(async () => jsonResponse(200, null));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
  });

  it('flags non-string content as PROVIDER_ERROR', async () => {
    installFetch(async () => jsonResponse(200, { choices: [{ message: { content: 42 } }] }));
    const r = await translate(baseOpts);
    if (r.ok) throw new Error('expected failure');
    expect(r.code).toBe('PROVIDER_ERROR');
  });

  it('strips trailing slash from baseUrl before appending path', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate({ ...baseOpts, baseUrl: 'https://api.example.com/v1/' });
    expect(readFetchCall(fetchMock).url).toBe('https://api.example.com/v1/chat/completions');
  });

  it('sends Authorization header with the apiKey', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate({ ...baseOpts, apiKey: 'sk-xyz' });
    const headers = readFetchCall(fetchMock).init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-xyz');
  });

  it('sends system + user messages with the configured language names', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate({ ...baseOpts, sourceLang: 'en', targetLang: 'ja' });
    const body = JSON.parse(readFetchCall(fetchMock).init?.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toMatch(/English/);
    expect(body.messages[0]?.content).toMatch(/Japanese/);
    expect(body.messages[1]?.content).toBe(baseOpts.text);
  });

  it('defaults thinking=disabled: thinking/reasoning_split/reasoning all off', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate(baseOpts);
    // 解析的是我们自己构造的请求体，形状已知；用命名 const 承载一次 unchecked cast。
    const body = JSON.parse(readFetchCall(fetchMock).init?.body as string) as {
      thinking?: { type?: string };
      reasoning_split?: boolean;
      reasoning?: { enabled?: boolean };
    };
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_split).toBe(false);
    // 标准字段：OpenRouter 等 provider 据此真正停止推理
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it('sends thinking=disabled (+ reasoning) when explicitly requested', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate({ ...baseOpts, thinking: 'disabled' });
    const body = JSON.parse(readFetchCall(fetchMock).init?.body as string) as {
      thinking?: { type?: string };
      reasoning_split?: boolean;
      reasoning?: { enabled?: boolean };
    };
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_split).toBe(false);
    expect(body.reasoning).toEqual({ enabled: false });
  });

  it('sends thinking=adaptive without reasoning_split or reasoning', async () => {
    const fetchMock = installFetch(async () =>
      jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }),
    );
    await translate({ ...baseOpts, thinking: 'adaptive' });
    const body = JSON.parse(readFetchCall(fetchMock).init?.body as string) as {
      thinking?: { type?: string };
      reasoning_split?: boolean;
      reasoning?: { enabled?: boolean };
    };
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.reasoning_split).toBeUndefined();
    expect(body.reasoning).toBeUndefined();
  });
});