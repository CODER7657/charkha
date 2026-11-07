/** Naive in-memory token bucket. Enough to say "we thought about abuse". */
export const tokenBucket = (opts: { capacity: number; refillPerSec: number }) => {
  const buckets = new Map<string, { tokens: number; last: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: opts.capacity, last: now };
    const elapsed = (now - b.last) / 1000;
    b.tokens = Math.min(opts.capacity, b.tokens + elapsed * opts.refillPerSec);
    b.last = now;
    if (b.tokens < 1) {
      buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };
};
