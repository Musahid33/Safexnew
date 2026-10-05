import { NextRequest, NextResponse } from 'next/server';
import { findInDirectory, searchDirectory } from '@/lib/employee-master/directory';
import { toPublicEmployee } from '@/lib/employee-master/parse';

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
const WINDOW_MS = 60_000;
const MAX_LOOKUPS_PER_WINDOW = 40;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimit(key: string): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
  }
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  existing.count += 1;
  return existing.count <= MAX_LOOKUPS_PER_WINDOW;
}

function validIp(value: string): boolean {
  return /^[0-9a-fA-F.:]{3,45}$/.test(value);
}

function clientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && validIp(realIp)) return realIp;
  // X-Forwarded-For is client-appendable, so walk it right-to-left: the closest hop wins.
  const chain = request.headers.get('x-forwarded-for')?.split(',') ?? [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]?.trim();
    if (candidate && validIp(candidate)) return candidate;
  }
  return 'unknown';
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const trusted = new Set<string>([request.nextUrl.host.toLowerCase()]);
  for (const value of [request.headers.get('host'), request.headers.get('x-forwarded-host')]) {
    const candidate = value?.split(',')[0]?.trim().toLowerCase();
    if (candidate) trusted.add(candidate);
  }
  return trusted.has(originHost);
}

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }

  if (!rateLimit(clientIp(request))) {
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
