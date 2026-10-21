import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveTenantId } from '@/lib/employee-master/db-source';
import type { ReportStatus, ReportType } from '@/lib/types';

/**
 * The reports a worker may read back from the app.
 *
 * Two rules shape everything here:
 *
 *  1. **A worker sees their own submissions only** — matched on the employee record through
 *     `reporter_employee_id`, after the employee number and the mobile number registered in
 *     the master agree. Knowing someone's Employee ID is not enough to read their reports.
 *  2. **Four types never leave the database through this path**: Speak Up, Grievance,
 *     Feedback and Suggestion are confidential handling cases and belong to the safety
 *     console. The filter is a whitelist in the query itself, not a filter on the response,
 *     so a new report type added later is hidden until somebody decides otherwise.
 *
 * Anonymous rows are excluded as well: an anonymous Speak Up report is stored without a
 * reporter, and nothing here should ever try to re-attach one.
 */

export const WORKER_VISIBLE_REPORT_TYPES: readonly ReportType[] = [
  'Near Miss', 'Hazard', 'Safety Observation', 'Unsafe Condition', 'Unsafe Act'
];

/** The same five types in the database's own vocabulary (`reports.report_type`). */
export const WORKER_VISIBLE_DB_TYPES = [
  'near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act'
] as const;

/** Types a worker must never see through this path, kept here so the intent is greppable. */
export const CONSOLE_ONLY_DB_TYPES = ['speak_up', 'grievance', 'feedback', 'suggestion'] as const;

const DB_TO_TYPE: Record<string, ReportType> = {
  near_miss: 'Near Miss',
  hazard: 'Hazard',
  safety_observation: 'Safety Observation',
  unsafe_condition: 'Unsafe Condition',
  unsafe_act: 'Unsafe Act'
};

const DB_TO_STATUS: Record<string, ReportStatus> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed'
};

export type WorkerReport = {
  reference: string;
  type: ReportType;
  category: string | null;
  area: string | null;
  department: string | null;
  severity: string | null;
  occurredAt: string | null;
  filedAt: string;
  status: ReportStatus;
  summary: string;
  description: string;
  immediateAction: string | null;
};

export type MyReportsResult =
  | { ok: true; employeeName: string; employeeNo: string; reports: WorkerReport[] }
  | { ok: false; code: 'INVALID_INPUT' | 'NOT_FOUND' | 'UNAVAILABLE'; error: string };

/**
 * The last ten digits of a phone number, or null.
 *
 * The master stores `+91…` in E.164, while a worker types whatever their phone keyboard
 * offers — spaces, dashes, a leading zero, or the country code. Comparing the national
 * number keeps those spellings equal without loosening the check.
 */
export function mobileDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return null;
  const national = digits.slice(-10);
  // A number that is still all zeros is a placeholder, not a phone.
  return /^0{10}$/.test(national) ? null : national;
}

export function mobileMatches(stored: string | null | undefined, typed: string): boolean {
  const known = mobileDigits(stored);
  const given = mobileDigits(typed);
  return Boolean(known) && known === given;
}

type EmployeeRow = { id: string; full_name: string; employee_no: string; mobile_e164: string | null };
type ReportRow = {
  report_ref: string;
  report_type: string;
  report_category: string | null;
  area: string | null;
  department: string | null;
  occurred_at: string | null;
  created_at: string | null;
  client_submitted_at: string | null;
  severity: string | null;
  short_description: string;
  description: string;
  immediate_action: string | null;
  status: string;
};

const EMPLOYEE_COLUMNS = 'id, full_name, employee_no, mobile_e164';
const REPORT_COLUMNS =
  'report_ref, report_type, report_category, area, department, occurred_at, created_at, '
  + 'client_submitted_at, severity, short_description, description, immediate_action, status';
const MAX_REPORTS = 50;
const QUERY_TIMEOUT_MS = 5000;

async function withTimeout<T>(work: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), QUERY_TIMEOUT_MS); });
    return await Promise.race([Promise.resolve(work), timeout]) as T | null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toWorkerReport(row: ReportRow): WorkerReport | null {
  const type = DB_TO_TYPE[row.report_type];
  const status = DB_TO_STATUS[row.status];
  // Belt and braces: the query already restricts the type and the table has a check
  // constraint, but an unknown value must be dropped rather than shown as its raw slug.
  if (!type || !status || !WORKER_VISIBLE_DB_TYPES.includes(row.report_type as never)) return null;
  return {
    reference: row.report_ref,
    type,
    category: row.report_category,
    area: row.area,
    department: row.department,
    severity: row.severity,
    occurredAt: row.occurred_at,
    filedAt: row.client_submitted_at ?? row.created_at ?? '',
    status,
    summary: row.short_description,
    description: row.description,
    immediateAction: row.immediate_action
  };
}

/**
 * Read back one worker's own reports, after checking the number and the registered mobile.
 *
 * A mismatch answers `NOT_FOUND` for both "no such employee" and "wrong mobile" — telling
 * them apart would turn this into a way to test which Employee IDs exist.
 */
export async function listReportsForEmployee(options: {
  employeeNo: string;
  mobile: string;
}): Promise<MyReportsResult> {
  const employeeNo = options.employeeNo.trim();
  const mobile = options.mobile.trim();
  if (!/^[A-Za-z0-9._/-]{1,32}$/.test(employeeNo) || mobileDigits(mobile) === null) {
    return { ok: false, code: 'INVALID_INPUT', error: 'Enter your Employee ID and the mobile number registered with it.' };
  }

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable from this deployment yet.' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable from this deployment yet.' };

  const employeeResult = await withTimeout(admin
    .from('employees')
    .select(EMPLOYEE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('employee_no', employeeNo)
    .eq('active', true)
    .maybeSingle());
  if (!employeeResult) return { ok: false, code: 'UNAVAILABLE', error: 'The employee directory is not reachable right now.' };
  if (employeeResult.error) return { ok: false, code: 'UNAVAILABLE', error: 'The employee directory is not reachable right now.' };

  const employee = employeeResult.data as unknown as EmployeeRow | null;
  if (!employee?.id) return { ok: false, code: 'NOT_FOUND', error: 'No active employee matches that Employee ID.' };
  if (!mobileMatches(employee.mobile_e164, mobile)) {
    return { ok: false, code: 'NOT_FOUND', error: 'That mobile number does not match the one registered for this Employee ID.' };
  }

  const reportsResult = await withTimeout(admin
    .from('reports')
    .select(REPORT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('reporter_employee_id', employee.id)
    .eq('anonymous', false)
    // Whitelist, not a list of exclusions: a type added later stays hidden by default.
    .in('report_type', [...WORKER_VISIBLE_DB_TYPES])
    .order('created_at', { ascending: false })
    .limit(MAX_REPORTS));
  if (!reportsResult) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable right now.' };
  if (reportsResult.error) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable right now.' };

  const reports = ((reportsResult.data ?? []) as unknown as ReportRow[])
    .map(toWorkerReport)
    .filter((report): report is WorkerReport => report !== null);

  return {
    ok: true,
    employeeName: employee.full_name,
    employeeNo: employee.employee_no,
    reports
  };
}
