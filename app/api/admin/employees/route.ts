import { NextRequest, NextResponse } from 'next/server';
import { isAdminApiConfigured, isAdminPiiEnabled, readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { listDirectory } from '@/lib/employee-master/directory';
import type { MasterEmployeeRecord } from '@/lib/employee-master/parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Roster listing for the admin / safety-officer console.
 *
 * Unlike /api/employees this endpoint deliberately enumerates the directory, so it is
 * gated on a verified server-side session rather than on origin and query length alone.
 *
 * Personal data is a second, separate decision. Mobile numbers, safety pass numbers and
 * blood groups are only included when the operator has explicitly set
 * SAFEX_ADMIN_PII_ENABLED=true; otherwise every response is projected down to the same
 * fields a worker would see. Blood group in particular is health data — it belongs in an
 * authorised first-aid flow, not in a directory anyone with the console password can browse.
 */

const MAX_PAGE_SIZE = 50;
const allowRequest = createRateLimiter({ windowMs: 60_000, max: 120 });

type AdminEmployee = {
  empNo: string;
  name: string;
  designation: string;
  department: string | null;
  siteId: string;
  skillGrade: string | null;
  safetyPassNo?: string | null;
  bloodGroup?: string | null;
  mobile?: string | null;
};

function project(record: MasterEmployeeRecord, includePii: boolean): AdminEmployee {
  const base: AdminEmployee = {
    empNo: record.employeeNo,
    name: record.fullName,
    designation: record.designation,
    department: record.department,
    siteId: record.siteId,
    // Skill grade is an occupational competency, not personal data. A safety officer
    // needs it to know who may do what, so it is not behind the PII flag.
    skillGrade: record.skillGrade
  };
  if (!includePii) return base;
  return {
    ...base,
    safetyPassNo: record.safetyPassNo,
    bloodGroup: record.bloodGroup,
    mobile: record.mobileE164
  };
}

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }

  if (!isAdminApiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        code: 'ADMIN_API_NOT_CONFIGURED',
        error: 'The admin API is disabled. Set SAFEX_ADMIN_PASSCODE on the server to enable it.'
      },
      { status: 503, headers: NO_STORE }
    );
  }

  if (readSession(request) === null) {
    return NextResponse.json(
      { ok: false, code: 'ADMIN_SESSION_REQUIRED', error: 'Sign in to view the employee master.' },
      { status: 401, headers: NO_STORE }
    );
  }

  if (!allowRequest(clientIp(request))) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', error: 'Too many requests. Slow down.' },
      { status: 429, headers: NO_STORE }
    );
  }

  const params = request.nextUrl.searchParams;
  const siteId = (params.get('siteId') ?? '').trim().slice(0, 96);
  const query = (params.get('q') ?? '').trim().slice(0, 80);
  const limit = Math.min(Math.max(Number.parseInt(params.get('limit') ?? '25', 10) || 25, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number.parseInt(params.get('offset') ?? '0', 10) || 0, 0);
  const includePii = isAdminPiiEnabled();

  const page = await listDirectory(siteId, { query, limit, offset, includePii });

  if (page.mode === 'unavailable') {
    return NextResponse.json({ ok: false, code: 'EMPLOYEE_MASTER_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
  }

  return NextResponse.json(
    {
      ok: true,
      source: page.mode,
      total: page.total,
      limit,
      offset,
      piiIncluded: includePii,
      employees: page.records.map((record) => project(record, includePii))
    },
    { headers: NO_STORE }
  );
}
