import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveSiteId, resolveTenantId } from './db-source';
import { isEmployeeNo, normaliseEmployeePatch, type EmployeeProfileInput } from './profile-fields';

/**
 * Writes for the admin console's employee profile screen.
 *
 * Until now the screen only edited the browser's copy of the roster: it showed "Employee
 * profile updated." and the change was gone on reload. The one thing that must never
 * happen here is a *partial* write that looks successful, so every function either reports
 * the row it changed or says why it did not.
 *
 * Deletes are deactivations. A worker's reports, training records and recognitions point at
 * this row; removing it would orphan safety history that is kept for the audit trail.
 */

const QUERY_TIMEOUT_MS = 5000;

async function withTimeout<T>(work: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS);
    });
    return await Promise.race([Promise.resolve(work), timeout]) as T | null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type EmployeeWriteResult =
  | { ok: true; employeeNo: string }
  | {
    ok: false;
    code: 'UNAVAILABLE' | 'NOT_FOUND' | 'DUPLICATE' | 'VALIDATION' | 'PII_DISABLED' | 'NO_SITE';
    error: string;
  };

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/**
 * Update one employee, matched inside the tenant.
 *
 * `currentNo` is the employee number as it was loaded; `patch.employeeNo` may rename it.
 * Matching on the old number means a rename cannot collide silently with a different row.
 */
export async function updateEmployeeProfile(options: {
  currentNo: string;
  patch: EmployeeProfileInput;
  includePii: boolean;
}): Promise<EmployeeWriteResult> {
  // Validate before touching the database: a bad field should be a clear 422 whether or
  // not the database happens to be reachable.
  const normalised = normaliseEmployeePatch(options.patch, { includePii: options.includePii });
  if (!normalised.ok) {
    return {
      ok: false,
      code: normalised.code === 'PII_DISABLED' ? 'PII_DISABLED' : 'VALIDATION',
      error: normalised.error
    };
  }

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not configured.' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not reachable.' };

  const result = await withTimeout(admin
    .from('employees')
    .update({ ...normalised.columns, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('employee_no', options.currentNo)
    .select('employee_no'));

  if (!result) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database did not answer in time.' };
  if (result.error) {
    if (isUniqueViolation(result.error)) {
      return { ok: false, code: 'DUPLICATE', error: 'That employee number is already in the master directory.' };
    }
    return { ok: false, code: 'UNAVAILABLE', error: 'The employee record could not be saved.' };
  }
  const rows = (result.data ?? []) as { employee_no: string }[];
  if (rows.length === 0) return { ok: false, code: 'NOT_FOUND', error: 'No employee with that number exists.' };
  return { ok: true, employeeNo: rows[0].employee_no };
}

/** Add one employee to the site's roster, as a manual entry rather than a sync. */
export async function createEmployeeProfile(options: {
  siteSlug: string;
  patch: EmployeeProfileInput;
  includePii: boolean;
}): Promise<EmployeeWriteResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not configured.' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not reachable.' };

  const siteId = options.siteSlug ? await resolveSiteId(admin, tenantId, options.siteSlug) : null;
  if (!siteId) return { ok: false, code: 'NO_SITE', error: 'Sign in with a site selected, then try again.' };

  const normalised = normaliseEmployeePatch(options.patch, { includePii: options.includePii });
  if (!normalised.ok) {
    return {
      ok: false,
      code: normalised.code === 'PII_DISABLED' ? 'PII_DISABLED' : 'VALIDATION',
      error: normalised.error
    };
  }
  const { employee_no: employeeNo, full_name: fullName, ...rest } = normalised.columns;
  if (typeof employeeNo !== 'string' || !isEmployeeNo(employeeNo)) {
    return { ok: false, code: 'VALIDATION', error: 'An employee number is required.' };
  }
  if (typeof fullName !== 'string' || !fullName) {
    return { ok: false, code: 'VALIDATION', error: 'An employee name is required.' };
  }

  const result = await withTimeout(admin
    .from('employees')
    .insert({
      tenant_id: tenantId,
      site_id: siteId,
      employee_no: employeeNo,
      full_name: fullName,
      ...rest,
      // 'manual' is the table's own word for a row a person created; the sync job owns the
      // other value and must not treat this row as one of its own.
      source: 'manual',
      active: true,
      updated_at: new Date().toISOString()
    })
    .select('employee_no'));

  if (!result) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database did not answer in time.' };
  if (result.error) {
    if (isUniqueViolation(result.error)) {
      return { ok: false, code: 'DUPLICATE', error: 'That employee number is already in the master directory.' };
    }
    return { ok: false, code: 'UNAVAILABLE', error: 'The employee record could not be created.' };
  }
  const rows = (result.data ?? []) as { employee_no: string }[];
  return { ok: true, employeeNo: rows[0]?.employee_no ?? employeeNo };
}

/**
 * Take an employee out of the roster without erasing them.
 *
 * The console hides them exactly as it did before (the roster query only lists active
 * rows), but reports and training history that point at the row stay intact.
 */
export async function deactivateEmployeeProfile(employeeNo: string): Promise<EmployeeWriteResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not configured.' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database is not reachable.' };

  const result = await withTimeout(admin
    .from('employees')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('employee_no', employeeNo)
    .select('employee_no'));

  if (!result) return { ok: false, code: 'UNAVAILABLE', error: 'The employee database did not answer in time.' };
  if (result.error) return { ok: false, code: 'UNAVAILABLE', error: 'The employee could not be removed.' };
  const rows = (result.data ?? []) as { employee_no: string }[];
  if (rows.length === 0) return { ok: false, code: 'NOT_FOUND', error: 'No employee with that number exists.' };
  return { ok: true, employeeNo: rows[0].employee_no };
}
