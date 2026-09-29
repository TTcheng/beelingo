/**
 * 令牌桶限流器：限制每分钟翻译请求数。
 *
 * - 桶容量 = ratePerMinute
 * - 启动时桶满
 * - 每次请求消耗 1 个 token；不足则返回 RATE_LIMIT 错误
 * - 后台按 ratePerMinute/60 tokens-per-second 持续补充
 *
 * 模块顶层变量在 service worker 30s 冷启动后会丢失；
 * 所以计数也镜像到 chrome.storage.session 持久化。
 */

const STORAGE_KEY = 'beelingo.rateLimit.v1';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

let bucket: Bucket | null = null;
let ratePerMinute = 10;

async function load(): Promise<Bucket> {
  if (bucket) return bucket;
  const got = await chrome.storage.session.get(STORAGE_KEY);
  const v = got[STORAGE_KEY] as Bucket | undefined;
  if (v && typeof v.tokens === 'number' && typeof v.lastRefill === 'number') {
    bucket = v;
    return bucket;
  }
  bucket = { tokens: ratePerMinute, lastRefill: Date.now() };
  await save();
  return bucket;
}

async function save(): Promise<void> {
  if (bucket) await chrome.storage.session.set({ [STORAGE_KEY]: bucket });
}

function refill(b: Bucket, capacity: number, now: number): void {
  const elapsed = (now - b.lastRefill) / 1000;
  const refillRate = capacity / 60; // tokens per second
  const added = elapsed * refillRate;
  if (added <= 0) return;
  b.tokens = Math.min(capacity, b.tokens + added);
  b.lastRefill = now;
}

export async function configureRateLimit(perMinute: number): Promise<void> {
  ratePerMinute = Math.max(1, Math.min(60, perMinute));
  // 重置桶到满
  bucket = { tokens: ratePerMinute, lastRefill: Date.now() };
  await save();
}

/** 检查并消耗 1 个 token，返回是否允许 */
export async function tryConsume(): Promise<boolean> {
  const b = await load();
  const now = Date.now();
  refill(b, ratePerMinute, now);
  if (b.tokens < 1) {
    await save();
    return false;
  }
  b.tokens -= 1;
  await save();
  return true;
}

/** 读当前剩余（用于 OPTIONS UI 显示） */
export async function peek(): Promise<{ tokens: number; capacity: number }> {
  const b = await load();
  refill(b, ratePerMinute, Date.now());
  await save();
  return { tokens: Math.floor(b.tokens), capacity: ratePerMinute };
}