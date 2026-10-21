import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveSiteId, resolveTenantId } from '@/lib/employee-master/db-source';
import { ATTACHMENT_BUCKET, PHOTO_URL_TTL_SECONDS } from '@/lib/reports/attachments';
import { displayReportRef } from '@/lib/reports/report-ref';
import type { ReportStatus, ReportType } from '@/lib/types';

/**
 * The logged reports a worker can browse in the app.
 *
 * This is a site feed, not a personal history: it reads every report the site has actually
 * stored in `public.reports`, newest first, with no Employee ID and no mobile number asked
 * for. That is what "logged data" means here — whatever reached the database, whether it was
 * filed from this phone, another phone or the safety desk.
 *
 * What it still never returns, and why:
 *
 *  - **Speak Up, Grievance, Feedback and Suggestion** are confidential handling cases. The
 *    filter is a whitelist inside the query, so a type added to the database later is hidden
 *    by default instead of leaking on day one.
 *  - **Anonymous rows** are excluded; an anonymous report must never be re-attached to a list
 *    someone can browse.
 *  - **The reporter's Employee ID, mobile number and any other contact field** are never
 *    selected. Only the display name is joined, because a site feed is useless if nobody can
 *    tell who raised it — and that name is already public through the employee lookup.
 */

export const LOGGED_REPORT_DB_TYPES = [
  'near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act'
] as const;

/** Kept here so the intent is greppable: these never travel through this feed. */
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

export type LoggedReport = {
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
  /** Display name only. The employee number and mobile are not part of this payload. */
  reporterName: string | null;
  hasPhoto: boolean;
  /** Short-lived signed URL for the attached photo, or null. Never a public bucket path. */
  photoUrl: string | null;
};

export type LoggedReportsResult =
  | {
    ok: true;
    /** Total rows matching the filters, which may be more than `reports.length`. */
    total: number;
    offset: number;
    limit: number;
    siteRef: string | null;
    reports: LoggedReport[];
  }
  | { ok: false; code: 'UNAVAILABLE'; error: string };

type ReporterRow = { full_name: string | null };
type ReporterField = ReporterRow | ReporterRow[] | null;

type ReportRow = {
  id: string;
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
  reporter: ReporterField;
};

// Written out in full for supabase-js. Note what is absent: mobile_e164, employee_no, address,
// blood group. The join is limited to the display name on purpose.
const REPORT_COLUMNS =
  'id, report_ref, report_type, report_category, area, department, occurred_at, created_at, '
  + 'client_submitted_at, severity, short_description, description, immediate_action, status, '
  + 'reporter:employees!reports_reporter_employee_id_fkey(full_name)';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
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

function reporterName(value: ReporterField): string | null {
  const row = Array.isArray(value) ? value[0] ?? null : value;
  const name = row?.full_name?.trim();
  return name ? name : null;
}

function toLoggedReport(row: ReportRow, photos: Map<string, string>): LoggedReport | null {
  const type = DB_TO_TYPE[row.report_type];
  const status = DB_TO_STATUS[row.status];
  // Defence in depth: the query already whitelists these, and the table has a check
  // constraint. An unknown value is dropped rather than shown as its raw slug.
  if (!type || !status || !LOGGED_REPORT_DB_TYPES.includes(row.report_type as never)) return null;
  const photoUrl = photos.get(row.id) ?? null;
  return {
    // Old rows are stored as OFFLINE-<uuid>; the app shows `NM-<code>` instead.
    reference: displayReportRef(row.report_ref, row.report_type),
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
    immediateAction: row.immediate_action,
    reporterName: reporterName(row.reporter),
    hasPhoto: Boolean(photoUrl),
    photoUrl
  };
}

export function clampLimit(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Read the site's logged reports, newest first.
 *
 * `siteRef` is the site id the worker app already holds (the slug from `/api/bootstrap`). An
 * unknown slug returns an empty page rather than falling back to every report in the tenant:
 * a typo must never widen the result set.
 */
export async function listLoggedReports(options: {
  siteRef?: string;
  limit?: number;
  offset?: number;
}): Promise<LoggedReportsResult> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable from this deployment yet.' };

  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable from this deployment yet.' };

  const limit = clampLimit(options.limit ?? DEFAULT_LIMIT);
  const offset = Math.max(Math.trunc(Number(options.offset)) || 0, 0);
  const siteRef = (options.siteRef ?? '').trim() || null;

  let siteId: string | null = null;
  if (siteRef) {
    siteId = await resolveSiteId(admin, tenantId, siteRef);
    if (!siteId) return { ok: true, total: 0, offset, limit, siteRef, reports: [] };
  }

  let query = admin
    .from('reports')
    .select(REPORT_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .eq('anonymous', false)
    // Whitelist, not a list of exclusions: a type added later stays hidden until somebody
    // decides otherwise.
    .in('report_type', [...LOGGED_REPORT_DB_TYPES])
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (siteId) query = query.eq('site_id', siteId);

  const result = await withTimeout(query);
  if (!result) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable right now.' };
  if (result.error) return { ok: false, code: 'UNAVAILABLE', error: 'Reports are not reachable right now.' };

  const rows = (result.data ?? []) as unknown as ReportRow[];
  const photos = await findReportPhotos(admin, rows.map((row) => row.id));

  return {
    ok: true,
    total: Number(result.count ?? rows.length),
    offset,
    limit,
    siteRef,
    reports: rows
      .map((row) => toLoggedReport(row, photos))
      .filter((report): report is LoggedReport => report !== null)
  };
}

/**
 * Sign a short-lived URL for each report photo.
 *
 * The bucket is private, so this is the only way the browser can see the evidence that was
 * attached to a report. `reviewed_preview_path` wins when a safety officer has produced a
 * redacted preview; otherwise the original is signed. A failure here just means no photo in
 * the modal — it must never take the whole feed down.
 */
async function findReportPhotos(
  admin: NonNullable<ReturnType<typeof getAdminSupabase>>,
  ids: string[]
): Promise<Map<string, string>> {
  const photos = new Map<string, string>();
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return photos;

  const result = await withTimeout(admin
    .from('report_attachments')
    .select('report_id, original_storage_path, reviewed_preview_path')
    .in('report_id', wanted));
  if (!result || result.error || !result.data) return photos;

  const rows = result.data as unknown as Array<{
    report_id: string;
    original_storage_path: string | null;
    reviewed_preview_path: string | null;
  }>;
  const paths = rows
    .map((row) => ({ reportId: row.report_id, path: row.reviewed_preview_path || row.original_storage_path }))
    .filter((entry): entry is { reportId: string; path: string } => Boolean(entry.path));
  if (paths.length === 0) return photos;

  const signed = await withTimeout(admin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(paths.map((entry) => entry.path), PHOTO_URL_TTL_SECONDS));
  if (!signed || signed.error || !signed.data) return photos;

  const byPath = new Map<string, string>();
  for (const item of signed.data as Array<{ path: string | null; signedUrl: string | null }>) {
    if (item.path && item.signedUrl) byPath.set(item.path, item.signedUrl);
  }
  for (const entry of paths) {
    const url = byPath.get(entry.path);
    if (url) photos.set(entry.reportId, url);
  }
  return photos;
}
