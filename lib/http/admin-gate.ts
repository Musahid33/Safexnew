import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { isAdminApiConfigured, readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';

/**
 * The gate every admin route shares: origin, configuration, session, rate limit — in that
 * order. It lives in one place because four separate copies of this list would eventually
 * disagree, and the one that disagreed would be the one missing a check.
 */

export function deny(status: number, code: string, error: string): NextResponse {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE });
}

export type AdminGuard = (request: NextRequest, message?: string) => NextResponse | null;

export function createAdminGuard(options: { windowMs?: number; max?: number } = {}): AdminGuard {
  const allowRequest = createRateLimiter({
    windowMs: options.windowMs ?? 60_000,
    max: options.max ?? 120
  });

  return function guard(request, message = 'Sign in to continue.') {
    if (!sameOrigin(request)) return deny(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin requests are not accepted.');
    if (!isAdminApiConfigured()) {
      return deny(503, 'ADMIN_API_NOT_CONFIGURED', 'The admin API is disabled. Set SAFEX_ADMIN_PASSCODE or ADMIN_USERNAME + ADMIN_PASSWORD on the server to enable it.');
    }
    if (readSession(request) === null) return deny(401, 'ADMIN_SESSION_REQUIRED', message);
    if (!allowRequest(clientIp(request))) return deny(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
    return null;
  };
}

/** One place to translate a store error code into an HTTP status. */
export function statusForCode(code: string): number {
  switch (code) {
    case 'VALIDATION': return 422;
    case 'DUPLICATE': return 409;
    case 'NOT_FOUND': return 404;
    case 'PII_DISABLED': return 403;
    case 'NO_SITE': return 400;
    default: return 503;
  }
}
