import { NextRequest, NextResponse } from 'next/server';
import { findInDirectory, searchDirectory } from '@/lib/employee-master/directory';
import { toPublicEmployee } from '@/lib/employee-master/parse';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Employee lookup for the report form, profile search and training check.
 *
 * The roster is personal data, so this endpoint is deliberately narrow:
 *  - same-origin only, never cached,
 *  - a minimum query length so it cannot be walked with an empty search,
 *  - a hard result cap,
 *  - a per-IP budget so the directory cannot be scraped row by row,
 *  - and a response projected down to Employee ID / name / designation. Registered mobile
 *    numbers, addresses and blood groups never leave the server.
 */

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 8;
const allowLookup = createRateLimiter({ windowMs: 60_000, max: 40 });

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }

  if (!allowLookup(clientIp(request))) {
    return NextResponse.json(
      { ok: false, code: 'LOOKUP_RATE_LIMITED', error: 'Too many lookups. Wait a minute and try again.' },
      { status: 429, headers: NO_STORE }
    );
  }

  const params = request.nextUrl.searchParams;
  const siteId = (params.get('siteId') ?? '').trim().slice(0, 96);
  const employeeNo = (params.get('empNo') ?? '').trim().slice(0, 80);
  const query = (params.get('q') ?? '').trim().slice(0, 80);

  if (employeeNo) {
    const { mode, record } = await findInDirectory(siteId, employeeNo);
    return NextResponse.json(
      { ok: true, source: mode, employees: record ? [toPublicEmployee(record)] : [] },
      { headers: NO_STORE }
    );
  }

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { ok: true, source: 'unknown', employees: [], code: 'QUERY_TOO_SHORT' },
      { headers: NO_STORE }
    );
  }

  const { mode, records } = await searchDirectory(siteId, query, MAX_RESULTS);
  return NextResponse.json(
    { ok: true, source: mode, employees: records.map(toPublicEmployee) },
    { headers: NO_STORE }
  );
}
