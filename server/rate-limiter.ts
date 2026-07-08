/** Simple in-memory token-bucket limiter keyed by identifier (e.g. userId). Fine for a single instance. */
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

const CAPACITY = 30;
const REFILL_PER_MS = CAPACITY / 60_000; // full refill every minute

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: CAPACITY, lastRefill: now };

  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + elapsed * REFILL_PER_MS);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return true;
  }

  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return false;
}
