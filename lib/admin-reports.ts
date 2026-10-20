import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveSiteId, resolveTenantId } from '@/lib/employee-master/db-source';

/**
 * Server-side reads and writes for the reports workers submit.
 *
 * This is what makes the console's Case Management screen real instead of demo data:
 * `safex_consume_report_limit` and `POST /api/reports` put reports in `public.reports`,
 * and the admin dashboard lists them from here.
 *
 * Scoping is the same as the employee directory — tenant from `SAFEX_TENANT_SLUG`, site
 * from its slug — because the service role bypasses RLS. A bug here would show one
 * tenant's reports to another, so every query takes the tenant id explicitly.
 */

export const REPORT_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

/** A report as the console needs it: work context, no reporter contact details. */
export type AdminReport = {
  reportRef: string;
  type: string;
  category: string | null;
  anonymous: boolean;
  area: string | null;
  department: string | null;
  occurredAt: string | null;
  submittedAt: string | null;
  severity: string | null;
  shortDescription: string | null;
  description: string | null;
  immediateAction: string | null;
  status: string;
  reporterName: string | null;
  reporterNumber: string | null;
};

/** PostgREST returns a to-one embed as an object, but a row can also arrive wrapped. */
type ReporterRow = { full_name: string | null; employee_no: string | null };
type ReporterField = ReporterRow | ReporterRow[] | null;

type ReportRow = {
  report_ref: string;
  report_type: string;
  report_category: string | null;
  anonymous: boolean;
  area: string | null;
  department: string | null;
  occurred_at: string | null;
  created_at: string | null;
  client_submitted_at: string | null;
  severity: string | null;
  short_description: string | null;
  description: string | null;
  immediate_action: string | null;
  status: string;
  // Embedded through reports_reporter_employee_id_fkey. The API projection decides what of
  // this is released; only the name and employee number are selected, never mobile/address.
  reporter: ReporterField;
};

// Written out in full so supabase-js can parse the select string.
const REPORT_COLUMNS =
  'report_ref, report_type, report_category, anonymous, area, department, occurred_at, created_at, client_submitted_at, severity, short_description, description, immediate_action, status, reporter:employees!reports_reporter_employee_id_fkey(full_name, employee_no)';

const QUERY_TIMEOUT_MS = 5000;
const MAX_PAGE = 200;

/**
 * A timeout of its own rather than the directory's shared one: a slow reports query must
 * not trip the employee-directory circuit breaker, and vice versa.
 */
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

function firstReporter(value: ReporterField): ReporterRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function toReport(row: ReportRow): AdminReport {
  const reporter = firstReporter(row.reporter);
  return {
    reportRef: row.report_ref,
    type: row.report_type,
    category: row.report_category,
    anonymous: Boolean(row.anonymous),
    area: row.area,
    department: row.department,
    occurredAt: row.occurred_at,
    submittedAt: row.client_submitted_at ?? row.created_at,
    severity: row.severity,
    shortDescription: row.short_description,
    description: row.description,
    immediateAction: row.immediate_action,
    status: row.status,
    // An anonymous submission is stored without a reporter, and the query must not try to
    // re-attach one: that is the whole point of the Speak Up anonymity rule.
    reporterName: row.anonymous ? null : reporter?.full_name ?? null,
    reporterNumber: row.anonymous ? null : reporter?.employee_no ?? null
  };
}

export type AdminReportPage = { reports: AdminReport[]; total: number };

/**
 * Page through the tenant's reports, newest first.
 *
 * Returns null when the database is not configured or cannot be reached, so the caller can
 * answer 503 instead of pretending the site has no reports.
 */
export async function listAdminReports(options: {
  siteSlug?: string;
  limit: number;
  offset: number;
}): Promise<AdminReportPage | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const limit = Math.min(Math.max(Math.trunc(options.limit) || 25, 1), MAX_PAGE);
  const offset = Math.max(Math.trunc(options.offset) || 0, 0);

  let request = admin
    .from('reports')
    .select(REPORT_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.siteSlug) {
    const siteId = await resolveSiteId(admin, tenantId, options.siteSlug);
    // An unknown site must return nothing rather than every report in the tenant.
    if (!siteId) return { reports: [], total: 0 };
    request = request.eq('site_id', siteId);
  }

  const result = await withTimeout(request);
  if (!result || result.error) return null;
  return {
    reports: ((result.data ?? []) as unknown as ReportRow[]).map(toReport),
    total: Number(result.count ?? 0)
  };
}

export type StatusUpdateResult = 'updated' | 'not_found' | 'unavailable';

/**
 * Change one report's status.
 *
 * Only the status is writable from the console. The report text itself belongs to the
 * worker who submitted it — editing it from a dashboard would quietly rewrite the record
 * that a safety investigation depends on.
 */
export async function updateAdminReportStatus(
  reportRef: string,
  status: ReportStatus
): Promise<StatusUpdateResult> {
  const admin = getAdminSupabase();
  if (!admin) return 'unavailable';
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return 'unavailable';

  const result = await withTimeout(admin
    .from('reports')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('report_ref', reportRef)
    .select('report_ref'));

  if (!result || result.error) return 'unavailable';
  return (result.data ?? []).length > 0 ? 'updated' : 'not_found';
}
