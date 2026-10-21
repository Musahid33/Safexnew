import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { isPhotoColumnSupported, resolveSiteId, resolveTenantId } from './db-source';
import { isEmployeeNo, normaliseEmployeePatch, type EmployeeProfileInput } from './profile-fields';
import { withTimeout } from '@/lib/with-timeout';

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

export type EmployeeWriteResult =
  | { ok: true; employeeNo: string; photoSkipped?: boolean }
  | {
    ok: false;
    code: 'UNAVAILABLE' | 'NOT_FOUND' | 'DUPLICATE' | 'VALIDATION' | 'PII_DISABLED' | 'NO_SITE';
    error: string;
  };

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

/**
 * Drop the photo when this database has not had the photo migration applied.
 *
 * The alternative — sending the column and letting the whole update fail — would make a
 * missing migration look like "your changes were not saved". Everything else still saves,
 * and the caller is told the photo did not.
 */
async function withoutUnsupportedPhoto(
  columns: Record<string, string | string[] | null>
): Promise<{ columns: Record<string, string | string[] | null>; photoSkipped: boolean }> {
  if (!('photo' in columns)) return { columns, photoSkipped: false };
  if (await isPhotoColumnSupported()) return { columns, photoSkipped: false };
  const { photo: _photo, ...rest } = columns;
  return { columns: rest, photoSkipped: true };
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

  const { columns, photoSkipped } = await withoutUnsupportedPhoto(normalised.columns);
  if (Object.keys(columns).length === 0) {
    return {
      ok: false,
      code: 'VALIDATION',
      error: 'The photo needs the employee photo migration before it can be saved.'
    };
  }

  const result = await withTimeout(admin
    .from('employees')
    .update({ ...columns, updated_at: new Date().toISOString() })
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
  return { ok: true, employeeNo: rows[0].employee_no, photoSkipped };
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
  const stripped = await withoutUnsupportedPhoto(normalised.columns);
  const { employee_no: employeeNo, full_name: fullName, ...rest } = stripped.columns;
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
  return { ok: true, employeeNo: rows[0]?.employee_no ?? employeeNo, photoSkipped: stripped.photoSkipped };
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
