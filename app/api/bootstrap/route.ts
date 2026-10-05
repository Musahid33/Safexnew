import { NextResponse } from 'next/server';
import { getEmployeeMasterConfig } from '@/lib/employee-master/config';
import { getEmployeeMaster } from '@/lib/employee-master/source';
import { DEMO_SITES } from '@/lib/demo-data';
import type { Site } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Startup payload for the client shell: which site list to show and whether the employee
 * directory is backed by the real master or by synthetic demo records.
 *
 * No employee rows are returned here — the directory is only reachable through the
 * query-scoped /api/employees endpoint.
 */
export async function GET() {
  const config = getEmployeeMasterConfig();

  if (!config.enabled) {
    return NextResponse.json(
      {
        directory: 'demo' as const,
        sites: DEMO_SITES,
        employeeCount: 0,
        dataIssueCount: 0
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const snapshot = await getEmployeeMaster();
  if (!snapshot) {
    // Configured but unreachable (no egress, sheet unpublished, bad URL). Stay in demo
    // mode rather than presenting an empty directory as if the site had no workers.
    return NextResponse.json(
      {
        directory: 'demo' as const,
        sites: DEMO_SITES,
        employeeCount: 0,
        dataIssueCount: 0,
        degraded: true
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const siteIds = [...new Set(snapshot.records.map((record) => record.siteId))];
  const sites: Site[] = siteIds.map((id) => ({
    id,
    name: id === config.site.id ? config.site.name : id,
    region: id === config.site.id ? config.site.region : '',
    // Real emergency numbers are still not configured; null keeps the SOS screen honest.
    sosNumber: null
  }));

  return NextResponse.json(
    {
      directory: 'master' as const,
      sites: sites.length ? sites : DEMO_SITES,
      employeeCount: snapshot.records.length,
      dataIssueCount: snapshot.issues.length,
      origin: snapshot.origin
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
