import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { listLoggedReports } from '@/lib/reports/site-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Every report the selected site has actually logged, straight from the database.
 *
 * This used to require an Employee ID and the registered mobile number. It no longer does —
 * the worker app opens the site's logged reports directly, which is what was asked for. The
 * request carries no personal data at all now, so a `GET` is safe: nothing secret can end up
 * in a URL, a proxy log or a `Referer`.
 *
 * The confidentiality rules did not move: they live in `lib/reports/site-feed.ts`, where the
 * query whitelists the five safety types and excludes anonymous rows. Speak Up, Grievance,
 * Feedback and Suggestion never leave the database through this route.
 *
 * Guards that remain: same-origin, a per-IP budget (a feed is cheap to read and expensive to
 * scrape), and `Cache-Control: no-store` so a shared phone never serves the previous worker's
 * view from a cache.
 */

const MAX_PAGE = 200;
const allowRead = createRateLimiter({ windowMs: 60_000, max: 40 });

function deny(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) return deny(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin report reads are not allowed.');

  if (!allowRead(clientIp(request))) {
    return deny(429, 'FEED_RATE_LIMITED', 'Too many refreshes. Wait a minute and try again.');
  }

  const params = request.nextUrl.searchParams;
  const siteRef = (params.get('site') ?? '').trim().slice(0, 64);
  const limit = (params.get('limit') ?? '').trim();
  const offset = (params.get('offset') ?? '').trim();

  const parsedLimit = Math.trunc(Number(limit));
  const parsedOffset = Math.trunc(Number(offset));

  const result = await listLoggedReports({
    siteRef,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_PAGE) : undefined,
    offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0
  });

  if (!result.ok) return deny(503, result.code, result.error);
  return NextResponse.json(result, { headers: NO_STORE });
}
