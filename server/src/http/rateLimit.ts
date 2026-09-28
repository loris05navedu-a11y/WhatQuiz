import type { RequestHandler } from 'express';
import { HttpError } from './errors';

/** Limiteur en mémoire à fenêtre fixe, suffisant pour une instance unique. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}

export function rateLimit(max: number, windowMs: number): RequestHandler {
  const limiter = new RateLimiter(max, windowMs);
  return (req, _res, next) => {
    if (limiter.consume(req.ip ?? 'unknown')) return next();
    next(new HttpError(429, 'Trop de tentatives, réessayez dans quelques minutes'));
  };
}
