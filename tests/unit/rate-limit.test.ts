import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeMock } from '../setup.js';
// 注意：rate-limit 模块把 bucket / ratePerMinute 保存在模块顶层；
// 不同测试之间需要重新加载模块才能拿到干净状态，故用动态 import。
// 这是「测试刻意考察模块加载边界」的合法场景（见 ts-no-dynamic-import 豁免）。
async function fresh() {
  vi.resetModules();
  const mod = await import('@/background/rate-limit.js');
  return mod;
}

const KEY = 'beelingo.rateLimit.v1';

beforeEach(() => {
  chromeMock.storage.session.__resetData();
  chromeMock.storage.session.__listeners.length = 0;
});

describe('configureRateLimit', () => {
  it('clamps the rate to [1, 60]', async () => {
    const { configureRateLimit: cfg, peek: pk } = await fresh();
    await cfg(0);
    expect((await pk()).capacity).toBe(1);
    await cfg(999);
    expect((await pk()).capacity).toBe(60);
    await cfg(20);
    expect((await pk()).capacity).toBe(20);
  });

  it('resets bucket to full on configure', async () => {
    const { configureRateLimit: cfg, tryConsume: tc, peek: pk } = await fresh();
    await cfg(3);
    expect((await pk()).tokens).toBe(3);
    await tc();
    expect((await pk()).tokens).toBe(2);
    await cfg(5); // 重置
    expect((await pk()).tokens).toBe(5);
  });
});

describe('tryConsume', () => {
  it('consumes a token when available', async () => {
    const { configureRateLimit: cfg, tryConsume: tc, peek: pk } = await fresh();
    await cfg(2);
    expect(await tc()).toBe(true);
    expect((await pk()).tokens).toBeLessThanOrEqual(1);
  });

  it('returns false once bucket is empty', async () => {
    const { configureRateLimit: cfg, tryConsume: tc } = await fresh();
    await cfg(2);
    expect(await tc()).toBe(true);
    expect(await tc()).toBe(true);
    // 第三次直接拒（ratePerMinute=2，几乎不会自然补充）
    // 把时钟往前推足够久才会 refill，所以我们再连调一次仍应该是 false
    expect(await tc()).toBe(false);
  });

  it('refills gradually based on elapsed time', async () => {
    const { configureRateLimit: cfg, tryConsume: tc, peek: pk } = await fresh();
    await cfg(60); // 1 token / s
    // 耗光
    for (let i = 0; i < 60; i++) await tc();
    expect(await tc()).toBe(false);

    // 模拟 3 秒过去
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 3_000);

    // 应该补到 3 tokens 左右
    const { tokens } = await pk();
    expect(tokens).toBeGreaterThanOrEqual(2);
    expect(tokens).toBeLessThanOrEqual(4);

    vi.restoreAllMocks();
  });

  it('persists state in chrome.storage.session', async () => {
    const { configureRateLimit: cfg, tryConsume: tc } = await fresh();
    await cfg(5);
    await tc();

    const raw = await chromeMock.storage.session.get(KEY);
    expect(raw[KEY]).toBeDefined();
    expect((raw[KEY] as { tokens: number }).tokens).toBeLessThan(5);
  });

  it('restores bucket from session storage on next load (SW cold start)', async () => {
    // 第一轮：写入 session
    {
      const { configureRateLimit: cfg, tryConsume: tc } = await fresh();
      await cfg(10);
      await tc(); // 9 tokens left
      await tc(); // 8 tokens left
    }
    // 第二轮：模拟 service worker 冷启动——模块状态丢失，从 session 恢复
    {
      const { peek: pk } = await fresh();
      const { tokens, capacity } = await pk();
      expect(capacity).toBe(10);
      expect(tokens).toBeLessThanOrEqual(8);
    }
  });

  it('ignores malformed session payloads and rebuilds a fresh bucket', async () => {
    await chromeMock.storage.session.set({
      [KEY]: { tokens: 'oops', lastRefill: null },
    });
    const { configureRateLimit: cfg, peek: pk } = await fresh();
    await cfg(7);
    const r = await pk();
    expect(r.capacity).toBe(7);
    expect(r.tokens).toBe(7);
  });

  it('creates and persists a fresh bucket on first run (empty session)', async () => {
    const { peek: pk } = await fresh();
    const r = await pk();
    expect(r.capacity).toBe(10); // 默认 ratePerMinute = 10
    expect(r.tokens).toBe(10);

    // 第一次使用后会持久化
    const raw = await chromeMock.storage.session.get(KEY);
    expect(raw[KEY]).toBeDefined();
  });
});

describe('peek', () => {
  it('returns integer token count and capacity', async () => {
    const { configureRateLimit: cfg, peek: pk } = await fresh();
    await cfg(10);
    const r = await pk();
    expect(r.capacity).toBe(10);
    expect(Number.isInteger(r.tokens)).toBe(true);
    expect(r.tokens).toBeGreaterThanOrEqual(0);
    expect(r.tokens).toBeLessThanOrEqual(10);
  });
});