import { NextRequest, NextResponse } from 'next/server';
import { createAdminGuard, deny } from '@/lib/http/admin-gate';
import { NO_STORE } from '@/lib/http/request-guard';
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
const guard = createAdminGuard({ windowMs: 60_000, max: 120 });

export async function GET(request: NextRequest) {
  const blocked = guard(request, 'Sign in to view reports.');
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
  const blocked = guard(request, 'Sign in to view reports.');
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
