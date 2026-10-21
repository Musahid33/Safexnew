import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { listReportsForEmployee } from '@/lib/reports/mine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "My logged reports" for the worker app.
 *
 * POST rather than GET on purpose: the request carries a registered mobile number, and a
 * query string ends up in proxy logs, browser history and any `Referer` the page sends.
 * The body is small and never cached.
 *
 * This endpoint is the only path by which a worker can read a report back, so the
 * confidentiality rules live in `lib/reports/mine.ts`: own reports only, matched on the
 * registered mobile, and a whitelist that excludes Speak Up, Grievance, Feedback and
 * Suggestion along with every anonymous row.
 */

const MAX_BODY_BYTES = 2048;
const allowLookup = createRateLimiter({ windowMs: 60_000, max: 12 });

function deny(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return deny(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin report lookups are not allowed.');

  if (!allowLookup(clientIp(request))) {
    return deny(429, 'LOOKUP_RATE_LIMITED', 'Too many lookups. Wait a minute and try again.');
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BODY_BYTES) {
    return deny(411, 'LENGTH_REQUIRED', 'Send the Employee ID and registered mobile number.');
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return deny(400, 'BAD_REQUEST', 'Send a JSON body.');
  }

  const employeeNo = typeof body.employeeNo === 'string' ? body.employeeNo.trim().slice(0, 64) : '';
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim().slice(0, 24) : '';

  const result = await listReportsForEmployee({ employeeNo, mobile });
  if (!result.ok) {
    const status = result.code === 'INVALID_INPUT' ? 422 : result.code === 'NOT_FOUND' ? 404 : 503;
    return deny(status, result.code, result.error);
  }

  return NextResponse.json(result, { headers: NO_STORE });
}
