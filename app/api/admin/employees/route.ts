import { NextRequest, NextResponse } from 'next/server';
import { isAdminApiConfigured, isAdminPiiEnabled, readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { listDirectory } from '@/lib/employee-master/directory';
import type { MasterEmployeeRecord } from '@/lib/employee-master/parse';
import { createEmployeeProfile } from '@/lib/employee-master/writes';

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
  /** Work area — operational context, so it is not behind the PII flag. */
  location?: string | null;
  safetyPassNo?: string | null;
  bloodGroup?: string | null;
  mobile?: string | null;
  email?: string | null;
  gender?: string | null;
  dob?: string | null;
  emergencyName?: string | null;
  emergencyMobile?: string | null;
  address?: string | null;
  notes?: string | null;
  previousNames?: string[];
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
    skillGrade: record.skillGrade,
    location: record.workLocation ?? null
  };
  if (!includePii) return base;
  // Everything below is personal data. The console can edit these fields only while the
  // flag is on — that is what stops a save from blanking a value it was not allowed to read.
  return {
    ...base,
    safetyPassNo: record.safetyPassNo,
    bloodGroup: record.bloodGroup,
    mobile: record.mobileE164,
    email: record.email ?? null,
    gender: record.gender ?? null,
    dob: record.dob ?? null,
    emergencyName: record.emergencyContactName ?? null,
    emergencyMobile: record.emergencyContactMobile ?? null,
    address: record.homeAddress ?? null,
    notes: record.notes ?? null,
    previousNames: record.previousNames ?? []
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

/**
 * Add an employee to the roster from the console's profile form.
 *
 * The console used to push the new person into its own array only, so the row existed until
 * the page was reloaded. The row is created against the site the operator is signed in to:
 * an employee number is unique per tenant, and a number without a site is not a roster row.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }
  if (!isAdminApiConfigured()) {
    return NextResponse.json(
      { ok: false, code: 'ADMIN_API_NOT_CONFIGURED', error: 'The admin API is disabled.' },
      { status: 503, headers: NO_STORE }
    );
  }
  if (readSession(request) === null) {
    return NextResponse.json(
      { ok: false, code: 'ADMIN_SESSION_REQUIRED', error: 'Sign in to change the employee master.' },
      { status: 401, headers: NO_STORE }
    );
  }
  if (!allowRequest(clientIp(request))) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMITED', error: 'Too many requests. Slow down.' }, { status: 429, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST', error: 'Send a JSON body.' }, { status: 400, headers: NO_STORE });
  }

  const siteSlug = typeof body.siteId === 'string' ? body.siteId.trim().slice(0, 96) : '';
  const fields = typeof body.fields === 'object' && body.fields !== null
    ? body.fields as Parameters<typeof createEmployeeProfile>[0]['patch']
    : {};

  const result = await createEmployeeProfile({ siteSlug, patch: fields, includePii: isAdminPiiEnabled() });
  if (!result.ok) {
    const status = result.code === 'VALIDATION' ? 422
      : result.code === 'DUPLICATE' ? 409
        : result.code === 'PII_DISABLED' ? 403
          : result.code === 'NO_SITE' ? 400
            : 503;
    return NextResponse.json({ ok: false, code: result.code, error: result.error }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, employeeNo: result.employeeNo }, { status: 201, headers: NO_STORE });
}
