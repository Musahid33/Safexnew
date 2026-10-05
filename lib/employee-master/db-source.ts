import 'server-only';
import { getAdminSupabase, getSupabaseAdminKey } from '@/lib/supabase/admin';
import type { MasterEmployeeRecord } from './parse';
import type { Site } from '@/lib/types';

/**
 * Supabase-backed employee directory.
 *
 * This is the destination for the roster: once the sheet has been imported with
 * `npm run employees:import`, lookups read `public.employees` instead of a CSV.
 *
 * Reads go through the server-only Supabase admin key because the browser has no grant on
 * these tables at all (see supabase/sql/02_rls.sql). That means this module is the security boundary: it
 * must apply tenant and site scoping itself, because RLS is bypassed here.
 */

type AdminClient = NonNullable<ReturnType<typeof getAdminSupabase>>;

type EmployeeRow = {
  id: string;
  employee_no: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  site_id: string;
  active: boolean;
  // Only selected by the admin roster query, and only when PII release is enabled.
  safety_pass_no?: string | null;
  skill_grade?: string | null;
  blood_group?: string | null;
  home_address?: string | null;
  phone_e164?: string | null;
};

const SELECT_COLUMNS = 'id, employee_no, full_name, designation, department, site_id, active';

let tenantCache: { id: string; slug: string; expiresAt: number } | null = null;
const TENANT_TTL_MS = 300_000;

const QUERY_TIMEOUT_MS = 4000;
const CIRCUIT_OPEN_MS = 30_000;
/**
 * When Supabase is misconfigured or unreachable every request would otherwise pay the
 * full network timeout before falling back. Trip a short circuit instead, so the sheet
 * fallback stays fast.
 */
let circuitOpenUntil = 0;

function circuitIsOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function tripCircuit(): void {
  circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
}

async function withTimeout<T>(work: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS);
    });
    const result = await Promise.race([Promise.resolve(work), timeout]);
    if (result === null) tripCircuit();
    return result as T | null;
  } catch {
    tripCircuit();
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Credentials exist and the operator has not forced another source. */
export function isDatabaseDirectoryIntended(): boolean {
  const mode = (process.env.SAFEX_EMPLOYEE_DIRECTORY_SOURCE ?? 'auto').toLowerCase();
  if (mode !== 'auto' && mode !== 'supabase') return false;
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && getSupabaseAdminKey()
  );
}

/** Intended *and* we are not inside a cool-off after a failure. */
export function isDatabaseDirectoryConfigured(): boolean {
  return isDatabaseDirectoryIntended() && !circuitIsOpen();
}

/**
 * Resolve the tenant this deployment serves. Host-based resolution needs verified
 * `tenant_domains` rows; until those exist an explicit slug keeps the scoping honest
 * instead of silently reading across tenants.
 */
async function resolveTenantId(admin: AdminClient): Promise<string | null> {
  const slug = process.env.SAFEX_TENANT_SLUG?.trim();
  const now = Date.now();
  if (tenantCache && tenantCache.expiresAt > now && tenantCache.slug === (slug ?? '')) {
    return tenantCache.id;
  }

  let query = admin.from('tenants').select('id, slug').eq('active', true).limit(2);
  if (slug) query = query.eq('slug', slug);

  const result = await withTimeout(query);
  if (!result) return null;
  const { data, error } = result;
  if (error || !data || data.length === 0) return null;
  // Without a slug this is only safe when the project holds exactly one active tenant.
  if (!slug && data.length > 1) return null;

  tenantCache = { id: data[0].id, slug: slug ?? '', expiresAt: now + TENANT_TTL_MS };
  return data[0].id;
}

function toRecord(row: EmployeeRow): MasterEmployeeRecord {
  return {
    employeeNo: row.employee_no,
    fullName: row.full_name,
    designation: row.designation ?? '',
    department: row.department,
    skillGrade: row.skill_grade ?? null,
    safetyPassNo: row.safety_pass_no ?? null,
    bloodGroup: row.blood_group ?? null,
    mobileE164: row.phone_e164 ?? null,
    active: row.active,
    siteId: row.site_id
  };
}

/** PostgREST `or=` takes a comma-separated filter list, so the needle must be inert. */
function sanitizeNeedle(query: string): string {
  return query.replace(/[^a-zA-Z0-9 ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export async function listSitesFromDatabase(): Promise<Site[] | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const result = await withTimeout(admin
    .from('sites')
    .select('id, slug, name, region, sos_phone_e164')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('name'));

  if (!result) return null;
  const { data, error } = result;
  if (error || !data) return null;
  return data.map((row) => ({
    id: row.slug || row.id,
    name: row.name,
    region: row.region ?? '',
    sosNumber: row.sos_phone_e164 ?? null
  }));
}

export async function countEmployeesInDatabase(): Promise<number | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const result = await withTimeout(admin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('active', true));

  if (!result) return null;
  return result.error ? null : result.count ?? 0;
}

/** Translate the app's site slug into the UUID the employees table stores. */
async function resolveSiteId(admin: AdminClient, tenantId: string, siteRef: string): Promise<string | null> {
  if (!siteRef) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(siteRef);
  const result = await withTimeout(admin
    .from('sites')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq(isUuid ? 'id' : 'slug', siteRef)
    .eq('active', true)
    .maybeSingle());
  if (!result) return null;
  return result.error || !result.data ? null : result.data.id;
}

export async function searchEmployeesInDatabase(
  siteRef: string,
  query: string,
  limit = 8
): Promise<MasterEmployeeRecord[] | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const needle = sanitizeNeedle(query);
  if (needle.length < 2) return [];

  let request = admin
    .from('employees')
    .select(SELECT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .or(`employee_no.ilike.%${needle}%,full_name.ilike.%${needle}%`)
    .order('employee_no')
    .limit(Math.min(Math.max(limit, 1), 25));

  if (siteRef) {
    const siteId = await resolveSiteId(admin, tenantId, siteRef);
    // An unknown site must return nothing rather than every employee in the tenant.
    if (!siteId) return [];
    request = request.eq('site_id', siteId);
  }

  const result = await withTimeout(request);
  if (!result || result.error) return null;
  return (result.data as EmployeeRow[]).map(toRecord);
}

export async function findEmployeeInDatabase(
  siteRef: string,
  employeeNo: string
): Promise<MasterEmployeeRecord | null | undefined> {
  const admin = getAdminSupabase();
  if (!admin) return undefined;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return undefined;

  let request = admin
    .from('employees')
    .select(SELECT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .ilike('employee_no', employeeNo.trim())
    .limit(1);

  if (siteRef) {
    const siteId = await resolveSiteId(admin, tenantId, siteRef);
    if (!siteId) return null;
    request = request.eq('site_id', siteId);
  }

  const result = await withTimeout(request);
  if (!result || result.error) return undefined;
  const row = (result.data as EmployeeRow[])[0];
  return row ? toRecord(row) : null;
}

/** Test/ops helper. */
export function clearTenantCache(): void {
  tenantCache = null;
  circuitOpenUntil = 0;
}

// Written out in full rather than built from SELECT_COLUMNS: supabase-js parses the
// select string at the type level, and a template literal defeats that.
// home_address is intentionally absent — nothing renders it yet, and the cheapest way to
// not leak a field is to never select it.
const PII_COLUMNS =
  'id, employee_no, full_name, designation, department, site_id, active, safety_pass_no, skill_grade, blood_group, phone_e164';

export type DbRosterPage = { records: MasterEmployeeRecord[]; total: number };

/**
 * Paginated roster for the admin console.
 *
 * Separate from `searchEmployeesInDatabase` because the intent is different: that one is
 * a narrow lookup for a worker filling in a form, this one deliberately enumerates the
 * directory. Only the admin API may call it, and only behind a verified session.
 */
export async function listEmployeesFromDatabase(
  siteRef: string,
  options: { query?: string; limit: number; offset: number; includePii?: boolean }
): Promise<DbRosterPage | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  let request = admin
    .from('employees')
    .select(options.includePii ? PII_COLUMNS : SELECT_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('employee_no')
    .range(options.offset, options.offset + options.limit - 1);

  const needle = sanitizeNeedle(options.query ?? '');
  if (needle.length >= 2) {
    request = request.or(`employee_no.ilike.%${needle}%,full_name.ilike.%${needle}%,designation.ilike.%${needle}%`);
  }

  if (siteRef) {
    const siteId = await resolveSiteId(admin, tenantId, siteRef);
    if (!siteId) return { records: [], total: 0 };
    request = request.eq('site_id', siteId);
  }

  const result = await withTimeout(request);
  if (!result || result.error) return null;
  // supabase-js resolves the row type from the select string at compile time, which it
  // cannot do when that string is chosen at runtime. Both branches are literals listing a
  // subset of EmployeeRow, so the shape is sound; the cast just restates that.
  const rows = result.data as unknown as EmployeeRow[];
  return { records: rows.map(toRecord), total: result.count ?? 0 };
}
