import type { NextRequest } from 'next/server';

/**
 * Shared request hardening for the API routes that touch personal data.
 *
 * These checks live in one place on purpose: /api/employees and the admin endpoints must
 * agree on what "same origin" and "one caller" mean, otherwise a fix applied to one route
 * silently leaves the other exposed.
 */

export const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function validIp(value: string): boolean {
  return /^[0-9a-fA-F.:]{3,45}$/.test(value);
}

/** Best-effort caller identity for rate limiting. Never used for authorisation. */
export function clientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && validIp(realIp)) return realIp;
  // X-Forwarded-For is client-appendable, so walk it right-to-left: the closest hop wins.
  const chain = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]?.trim();
    if (candidate && validIp(candidate)) return candidate;
  }
  return 'unknown';
}

/**
 * Rejects cross-site callers. This is defence in depth, not authentication: a browser
 * sends Origin on state-changing requests and Sec-Fetch-Site on modern engines, but a
 * non-browser client can send anything. Real authorisation is the session cookie.
 */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const trusted = new Set<string>([request.nextUrl.host.toLowerCase()]);
  for (const value of [request.headers.get('host'), request.headers.get('x-forwarded-host')]) {
    const candidate = value?.split(',')[0]?.trim().toLowerCase();
    if (candidate) trusted.add(candidate);
  }
  return trusted.has(originHost);
}

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window limiter held in process memory.
 *
 * Good enough for a single instance; it does NOT survive a restart and is not shared
 * across replicas. Anything that needs a real budget in production has to move to the
 * database table the report endpoint already uses.
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return function allow(key: string): boolean {
    const now = Date.now();
    if (buckets.size > 5000) {
      for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
    }
    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return true;
    }
    existing.count += 1;
    return existing.count <= options.max;
  };
}
