import { dbQueryOne, dbRun } from './db.ts';
import type { RouteHandler } from './webRouter.ts';

interface RateLimitOptions {
  prefix: string;
  windowMs: number;
  max: number;
  skipSuccessfulRequests?: boolean;
  message: Record<string, any>;
}

const memoryWindows = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: any): string {
  const cfIp = req.get?.('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const xff = req.get?.('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.ip || 'unknown';
}

export function createRateLimiter(options: RateLimitOptions): RouteHandler {
  return async (req, res, next) => {
    const clientIp = getClientIp(req);
    const key = `${options.prefix}:${clientIp}`;
    const now = Date.now();

    let count = 0;
    let resetAt = now + options.windowMs;
    let usedDb = false;

    try {
      const row = await dbQueryOne<{ count: number; reset_at: number }>(
        'SELECT count, reset_at FROM rate_limits WHERE key = ?',
        [key]
      );
      usedDb = true;
      if (row && Number(row.reset_at) > now) {
        count = Number(row.count) || 0;
        resetAt = Number(row.reset_at);
      } else {
        count = 0;
        resetAt = now + options.windowMs;
      }
    } catch {
      const mem = memoryWindows.get(key);
      if (mem && mem.resetAt > now) {
        count = mem.count;
        resetAt = mem.resetAt;
      }
    }

    if (count >= options.max) {
      const retrySec = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retrySec));
      res.status(429).json(options.message);
      return;
    }

    // Track status when response completes
    let capturedStatus = 200;
    const origStatus = res.status.bind(res);
    (res as any).status = (code: number) => {
      capturedStatus = code;
      return origStatus(code);
    };

    await next();

    const shouldSkip = Boolean(options.skipSuccessfulRequests && capturedStatus < 400);
    if (!shouldSkip) {
      const nextCount = count + 1;
      if (usedDb) {
        try {
          await dbRun(
            'INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, ?, ?)',
            [key, nextCount, resetAt]
          );
          return;
        } catch {}
      }
      memoryWindows.set(key, { count: nextCount, resetAt });
    }
  };
}
