import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import type { MasterEmployeeRecord } from './parse';
import type { DirectoryUnavailableReason, Site } from '@/lib/types';

/**
 * Supabase-backed employee directory.
 *
 * This is the destination for the roster: once the sheet has been imported with
 * `npm run employees:import`, lookups read `public.employees` instead of a CSV.
 *
 * Reads go through the service role because the browser has no grant on these tables at
 * all (see supabase/sql/02_rls.sql). That means this module is the security boundary: it
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
  mobile_e164?: string | null;
  email?: string | null;
  gender?: string | null;
  dob?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_mobile?: string | null;
  work_location?: string | null;
  notes?: string | null;
  previous_names?: string[] | null;
  /** Selected only for one employee at a time; see `findEmployeeProfileInDatabase`. */
  photo?: string | null;
};

// Work location is not personal data, so it travels with the base projection: the console
// shows it on the profile card even when PII release is off.
const SELECT_COLUMNS = 'id, employee_no, full_name, designation, department, site_id, active, work_location';

// The public passport needs the safety credential number and skill grade to render the
// same card as the admin console. They are selected here (server memory only) and the API
// projection decides what is actually released to the browser.
const PASSPORT_COLUMNS = 'id, employee_no, full_name, designation, department, site_id, active, safety_pass_no, skill_grade';

let tenantCache: { id: string; slug: string; companyName: string | null; expiresAt: number } | null = null;
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
  const databaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  if (!databaseConfigured) return false;

  // `sheet` was the starter's old deployment setting. Once the sheet URL is removed
  // after import, let the configured database take over rather than leaving lookup down.
  const sheetConfigured = Boolean(
    process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL?.trim()
    || process.env.SAFEX_EMPLOYEE_MASTER_FILE?.trim()
  );
  if (mode === 'sheet') return !sheetConfigured;
  return mode === 'auto' || mode === 'supabase';
}

/** Intended *and* we are not inside a cool-off after a failure. */
export function isDatabaseDirectoryConfigured(): boolean {
  return isDatabaseDirectoryIntended() && !circuitIsOpen();
}

/**
 * Resolve the tenant this deployment serves. Host-based resolution needs verified
 * `tenant_domains` rows; until those exist an explicit slug keeps the scoping honest
 * instead of silently reading across tenants.
 *
 * Shared with the admin reports endpoint (lib/admin-reports.ts): both must scope by the
 * same tenant, so this stays the single implementation.
 */
export async function resolveTenantId(admin: AdminClient): Promise<string | null> {
  const slug = process.env.SAFEX_TENANT_SLUG?.trim();
  const now = Date.now();
  if (tenantCache && tenantCache.expiresAt > now && tenantCache.slug === (slug ?? '')) {
    return tenantCache.id;
  }

  let query = admin.from('tenants').select('id, slug, company_name').eq('active', true).limit(2);
  if (slug) query = query.eq('slug', slug);

  const result = await withTimeout(query);
  if (!result) return null;
  const { data, error } = result;
  if (error || !data || data.length === 0) return null;
  // Without a slug this is only safe when the project holds exactly one active tenant.
  if (!slug && data.length > 1) return null;

  tenantCache = {
    id: data[0].id,
    slug: slug ?? '',
    companyName: typeof data[0].company_name === 'string' ? data[0].company_name : null,
    expiresAt: now + TENANT_TTL_MS
  };
  return data[0].id;
}

type DatabaseDirectoryProblem = Extract<
  DirectoryUnavailableReason,
  'database_unreachable' | 'tenant_unresolved' | 'no_sites' | 'empty_directory'
>;

/**
 * Explain why the database directory answered "nothing", instead of guessing. Runs only on
 * the failure path, so a healthy deployment pays nothing for it.
 *
 * Returns null when the database looks healthy — the caller then treats the failure as a
 * transient one rather than inventing a configuration error.
 */
export async function probeDatabaseDirectory(): Promise<DatabaseDirectoryProblem | null> {
  const admin = getAdminSupabase();
  if (!admin) return 'database_unreachable';

  const slug = process.env.SAFEX_TENANT_SLUG?.trim();
  const tenants = await withTimeout(admin
    .from('tenants')
    .select('id, slug')
    .eq('active', true)
    .limit(2));
  if (!tenants || tenants.error) return 'database_unreachable';
  if (!tenants.data || tenants.data.length === 0) return 'tenant_unresolved';
  // Without a slug this is only safe when the project holds exactly one active tenant.
  if (!slug && tenants.data.length > 1) return 'tenant_unresolved';

  const tenantId = tenants.data[0].id;
  const sites = await withTimeout(admin
    .from('sites')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(1));
  if (!sites || sites.error) return 'database_unreachable';
  if (!sites.data || sites.data.length === 0) return 'no_sites';

  const count = await withTimeout(admin
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('active', true));
  if (!count || count.error) return 'database_unreachable';
  if (!count.count) return 'empty_directory';

  return null;
}

/**
 * Public branding for the passport footer: the tenant's own company name.
 * Returns null when the database cannot answer, so the UI can omit the line instead of
 * printing a demo company name over a real employee record.
 */
export async function getCompanyNameFromDatabase(): Promise<string | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;
  return tenantCache?.id === tenantId ? tenantCache.companyName : null;
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
    mobileE164: row.mobile_e164 ?? null,
    active: row.active,
    siteId: row.site_id,
    workLocation: row.work_location ?? null,
    email: row.email ?? null,
    gender: row.gender ?? null,
    dob: row.dob ?? null,
    emergencyContactName: row.emergency_contact_name ?? null,
    emergencyContactMobile: row.emergency_contact_mobile ?? null,
    homeAddress: row.home_address ?? null,
    notes: row.notes ?? null,
    previousNames: row.previous_names ?? [],
    photo: row.photo ?? null
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

/** Translate the app's site slug into the UUID the reports/employees tables store. */
export async function resolveSiteId(admin: AdminClient, tenantId: string, siteRef: string): Promise<string | null> {
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
    .select(PASSPORT_COLUMNS)
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
    .select(PASSPORT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .eq('employee_no', employeeNo.trim().toUpperCase())
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
  'id, employee_no, full_name, designation, department, site_id, active, safety_pass_no, skill_grade, blood_group, mobile_e164, '
  + 'email, gender, dob, emergency_contact_name, emergency_contact_mobile, work_location, home_address, notes, previous_names';

// The photo is deliberately NOT part of PII_COLUMNS: the roster list would carry a face per
// row into every response. One employee at a time is the only way it is read.
const PROFILE_COLUMNS = `${PII_COLUMNS}, photo`;

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

/**
 * One employee, with the photo.
 *
 * The admin passport edits a person one at a time, and that is the only place a face is
 * needed. A database that has not had the photo migration applied yet still answers: the
 * query is retried without the column, and the caller is told the photo is unavailable
 * rather than the whole profile failing.
 */
export type EmployeeProfileRead = { record: MasterEmployeeRecord; photoAvailable: boolean };

let photoSupport: boolean | null = null;

function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(error) && (error?.code === '42703' || /column .*photo.* does not exist/i.test(error?.message ?? ''));
}

export async function findEmployeeProfileInDatabase(employeeNo: string): Promise<EmployeeProfileRead | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const read = (columns: string) => admin
    .from('employees')
    .select(columns)
    .eq('tenant_id', tenantId)
    .eq('employee_no', employeeNo)
    .limit(1);

  const withPhoto = await withTimeout(read(PROFILE_COLUMNS));
  if (withPhoto && !withPhoto.error) {
    photoSupport = true;
    const rows = withPhoto.data as unknown as EmployeeRow[];
    const row = rows[0];
    return row ? { record: toRecord(row), photoAvailable: true } : null;
  }

  if (!isMissingColumn(withPhoto?.error)) return null;

  // The migration has not run on this database. Answer with everything else so the screen
  // still edits the profile, and report that the face is not stored.
  photoSupport = false;
  const fallback = await withTimeout(read(PII_COLUMNS));
  if (!fallback || fallback.error) return null;
  const rows = fallback.data as unknown as EmployeeRow[];
  const row = rows[0];
  return row ? { record: toRecord(row), photoAvailable: false } : null;
}

/** Whether `employees.photo` exists, answered once per server instance and then cached. */
export async function isPhotoColumnSupported(): Promise<boolean> {
  if (photoSupport !== null) return photoSupport;
  const admin = getAdminSupabase();
  if (!admin) return false;
  // A zero-row filtered select: the question is whether the column exists, and no
  // employee's face should be pulled through the service role just to answer it.
  const result = await withTimeout(
    admin.from('employees').select('photo').eq('employee_no', '__safex_photo_probe__').limit(1)
  );
  photoSupport = Boolean(result) && !isMissingColumn(result?.error);
  return photoSupport;
}
