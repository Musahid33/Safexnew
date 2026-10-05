import { NextResponse } from 'next/server';
import { getDirectoryStatus } from '@/lib/employee-master/directory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Startup payload for the client shell: which site list to show and whether the employee
 * directory is backed by Supabase, the published sheet, or synthetic demo records.
 *
 * No employee rows are returned here — the directory is only reachable through the
 * query-scoped /api/employees endpoint.
 */
export async function GET() {
  const status = await getDirectoryStatus();
  return NextResponse.json(
    {
      directory: status.mode,
      sites: status.sites,
      employeeCount: status.employeeCount,
      dataIssueCount: status.dataIssueCount,
      degraded: status.degraded
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
