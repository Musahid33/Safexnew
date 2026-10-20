import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http/request-guard';
import { createAdminGuard, deny, statusForCode } from '@/lib/http/admin-gate';
import { getCompanyNameFromDatabase } from '@/lib/employee-master/db-source';
import { listDmPlans, saveDmPlan, siteLabel } from '@/lib/dm/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily Management Plans for the admin console.
 *
 * GET lists the archive (DM Records). POST files one plan, which also produces and
 * archives its PDF — the reference is DM-DD-MM-YY and that is the filename the operator
 * downloads. Both need the verified operator session; a filed plan is a safety record, not
 * a public page.
 */

const guard = createAdminGuard({ windowMs: 60_000, max: 120 });

export async function GET(request: NextRequest) {
  const blocked = guard(request, 'Sign in to view DM records.');
  if (blocked) return blocked;

  const params = request.nextUrl.searchParams;
  const siteSlug = (params.get('siteId') ?? '').trim().slice(0, 96);
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit') ?? '50', 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(params.get('offset') ?? '0', 10) || 0, 0);

  const page = await listDmPlans({ siteSlug, limit, offset });
  if (!page) {
    return deny(503, 'DM_UNAVAILABLE', 'The DM archive is not reachable from this deployment.');
  }

  return NextResponse.json(
    { ok: true, total: page.total, limit, offset, records: page.records },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const blocked = guard(request, 'Sign in to file a DM plan.');
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return deny(400, 'BAD_REQUEST', 'Send a JSON body.');
  }

  const siteSlug = typeof body.siteId === 'string' ? body.siteId.trim().slice(0, 96) : '';
  const plan = body.plan;

  const [companyName, siteName] = await Promise.all([
    getCompanyNameFromDatabase(),
    siteSlug ? siteLabel(siteSlug) : Promise.resolve(null)
  ]);

  const result = await saveDmPlan({ siteSlug, input: plan, companyName, siteName });
  if (!result.ok) {
    return deny(statusForCode(result.code), result.code, result.error);
  }

  return NextResponse.json({ ok: true, record: result.record }, { status: 201, headers: NO_STORE });
}
