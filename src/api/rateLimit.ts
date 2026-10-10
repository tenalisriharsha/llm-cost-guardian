export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/** Fixed-window request limiter, keyed by an arbitrary identity (the authenticated apiKeyId). Resets fully at each window boundary rather than sliding, which is enough to blunt accidental retry storms without extra bookkeeping. */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly options: RateLimiterOptions) {}

  tryConsume(identity: string, now: number = Date.now()): RateLimitDecision {
    const entry = this.windows.get(identity);
    if (!entry || now - entry.windowStart >= this.options.windowMs) {
      this.windows.set(identity, { count: 1, windowStart: now });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (entry.count < this.options.maxRequests) {
      entry.count += 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    return { allowed: false, retryAfterMs: entry.windowStart + this.options.windowMs - now };
  }
}
