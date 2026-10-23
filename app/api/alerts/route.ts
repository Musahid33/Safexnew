import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { readPublishedAlerts } from '@/lib/alerts/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Published safety alerts for one site — the worker app's alert screen.
 *
 * Read-only and draft-proof: the selection is `status = 'published'` with a publish time in
 * the past, and there is no parameter that widens it. An unknown site answers with an empty
 * list, not an error, so the screen keeps its own empty state.
 */

const allowRead = createRateLimiter({ windowMs: 60_000, max: 90 });

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }
  if (!allowRead(clientIp(request))) {
    return NextResponse.json({ ok: false, code: 'ALERTS_RATE_LIMITED', error: 'Too many refreshes. Wait a minute.' }, { status: 429, headers: NO_STORE });
  }

  const siteRef = (request.nextUrl.searchParams.get('site') ?? '').trim().slice(0, 64);
  if (!siteRef) return NextResponse.json({ ok: true, alerts: [] }, { headers: NO_STORE });

  try {
    return NextResponse.json({ ok: true, alerts: await readPublishedAlerts(siteRef) }, { headers: NO_STORE });
  } catch (error) {
    console.error('Safety alerts unavailable', error);
    return NextResponse.json({ ok: false, alerts: [] }, { status: 503, headers: NO_STORE });
  }
}
