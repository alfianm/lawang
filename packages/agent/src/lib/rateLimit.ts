interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private windowMs: number, private max: number) {}

  hit(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || b.resetAt < now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (b.count >= this.max) return false;
    b.count += 1;
    return true;
  }
}
