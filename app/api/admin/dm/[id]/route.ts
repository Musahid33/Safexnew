import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http/request-guard';
import { createAdminGuard, deny } from '@/lib/http/admin-gate';
import { getDmPlan } from '@/lib/dm/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const guard = createAdminGuard({ windowMs: 60_000, max: 120 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One filed plan, with the full form payload — used by the record viewer. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guard(request, 'Sign in to view DM records.');
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!UUID.test(id)) return deny(400, 'INVALID_ID', 'That DM record id is not valid.');

  const found = await getDmPlan(id);
  if (!found.ok) {
    return found.code === 'NOT_FOUND'
      ? deny(404, 'DM_NOT_FOUND', 'No DM record with that id exists for this tenant.')
      : deny(503, 'DM_UNAVAILABLE', 'The DM archive is not reachable from this deployment.');
  }

  return NextResponse.json({ ok: true, record: found.record }, { headers: NO_STORE });
}
