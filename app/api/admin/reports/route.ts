import { NextRequest, NextResponse } from 'next/server';
import { isAdminApiConfigured, readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { isReportStatus, listAdminReports, updateAdminReportStatus } from '@/lib/admin-reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Reports for the admin / HSE console's Case Management screen.
 *
 * Workers submit through POST /api/reports, which needs no account. Reading them back is
 * different: these are named safety reports, some with grievance content, so the console
 * only sees them through the verified server session that also guards the roster.
 *
 * GET lists a page (newest first, optionally one site). PATCH changes a status — the only
 * field the console may write, because the report text belongs to the person who filed it.
 */

const MAX_PAGE_SIZE = 100;
const allowRequest = createRateLimiter({ windowMs: 60_000, max: 120 });

function deny(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE });
}

/** Shared gate: origin, configuration, session and rate limit, in that order. */
function gate(request: NextRequest) {
  if (!sameOrigin(request)) return deny(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin requests are not accepted.');
  if (!isAdminApiConfigured()) {
    return deny(503, 'ADMIN_API_NOT_CONFIGURED', 'The admin API is disabled. Set SAFEX_ADMIN_PASSCODE on the server to enable it.');
  }
  if (readSession(request) === null) return deny(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to view reports.');
  if (!allowRequest(clientIp(request))) return deny(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  return null;
}

export async function GET(request: NextRequest) {
  const blocked = gate(request);
  if (blocked) return blocked;

  const params = request.nextUrl.searchParams;
  const siteSlug = (params.get('siteId') ?? '').trim().slice(0, 96);
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit') ?? '100', 10) || 100, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number.parseInt(params.get('offset') ?? '0', 10) || 0, 0);

  const page = await listAdminReports({
    // 'all' is the console's own value for "every site", not a slug to look up.
    siteSlug: siteSlug && siteSlug !== 'all' ? siteSlug : '',
    limit,
    offset
  });

  if (page === null) {
    return deny(503, 'REPORTS_UNAVAILABLE', 'The report database is not reachable from this deployment.');
  }

  return NextResponse.json(
    { ok: true, total: page.total, limit, offset, reports: page.reports },
    { headers: NO_STORE }
  );
}

export async function PATCH(request: NextRequest) {
  const blocked = gate(request);
  if (blocked) return blocked;

  let reportRef = '';
  let status: unknown = '';
  try {
    const body = await request.json();
    reportRef = typeof body?.reportRef === 'string' ? body.reportRef.trim().slice(0, 120) : '';
    status = body?.status;
  } catch {
    return deny(400, 'BAD_REQUEST', 'Send a JSON body.');
  }

  if (!reportRef) return deny(400, 'REPORT_REF_REQUIRED', 'A report reference is required.');
  if (!isReportStatus(status)) {
    return deny(422, 'INVALID_STATUS', 'Status must be open, in_progress or closed.');
  }

  const result = await updateAdminReportStatus(reportRef, status);
  if (result === 'unavailable') {
    return deny(503, 'REPORTS_UNAVAILABLE', 'The report database is not reachable from this deployment.');
  }
  if (result === 'not_found') {
    return deny(404, 'REPORT_NOT_FOUND', 'No report with that reference exists for this tenant.');
  }

  return NextResponse.json({ ok: true, reportRef, status }, { headers: NO_STORE });
}
