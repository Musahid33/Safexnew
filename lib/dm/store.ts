import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveSiteId, resolveTenantId } from '@/lib/employee-master/db-source';
import { filledModuleCount, normalisePlan, referenceFor, type DmPlan } from './plan';
import { renderDmPdf } from './pdf';

/**
 * Storage for Daily Management Plans.
 *
 * One row per filed plan, the whole form in `payload`, and the generated PDF archived in
 * the private `dm-records` bucket. The PDF is rebuilt from the payload whenever the archive
 * is missing, so a failed upload never costs a record its document.
 */

const QUERY_TIMEOUT_MS = 5000;
const BUCKET = 'dm-records';
const MAX_PAGE = 200;

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

type Row = {
  id: string;
  reference: string;
  plan_date: string;
  shift: string | null;
  supervisor_name: string | null;
  supervisor_employee_no: string | null;
  location: string | null;
  payload: DmPlan;
  modules_filled: number;
  status: string;
  pdf_path: string | null;
  created_at: string;
};

export type DmRecordSummary = {
  id: string;
  reference: string;
  planDate: string;
  shift: string | null;
  supervisor: string | null;
  supervisorNo: string | null;
  location: string | null;
  modulesFilled: number;
  status: string;
  hasPdf: boolean;
  createdAt: string;
};

export type DmRecordDetail = DmRecordSummary & { plan: DmPlan };

const LIST_COLUMNS =
  'id, reference, plan_date, shift, supervisor_name, supervisor_employee_no, location, modules_filled, status, pdf_path, created_at';

function toSummary(row: Omit<Row, 'payload'>): DmRecordSummary {
  return {
    id: row.id,
    reference: row.reference,
    planDate: row.plan_date,
    shift: row.shift,
    supervisor: row.supervisor_name,
    supervisorNo: row.supervisor_employee_no,
    location: row.location,
    modulesFilled: Number(row.modules_filled ?? 0),
    status: row.status,
    hasPdf: Boolean(row.pdf_path),
    createdAt: row.created_at
  };
}

export type DmListPage = { records: DmRecordSummary[]; total: number; siteName: string | null };

/** Newest first, optionally one site. Null means the database is not reachable. */
export async function listDmPlans(options: { siteSlug?: string; limit: number; offset: number }): Promise<DmListPage | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;

  const limit = Math.min(Math.max(Math.trunc(options.limit) || 25, 1), MAX_PAGE);
  const offset = Math.max(Math.trunc(options.offset) || 0, 0);

  let query = admin
    .from('daily_management_plans')
    .select(LIST_COLUMNS, { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('plan_date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.siteSlug && options.siteSlug !== 'all') {
    const siteId = await resolveSiteId(admin, tenantId, options.siteSlug);
    if (!siteId) return { records: [], total: 0, siteName: null };
    query = query.eq('site_id', siteId);
  }

  const result = await withTimeout(query);
  if (!result || result.error) return null;
  const rows = (result.data ?? []) as unknown as Omit<Row, 'payload'>[];
  return { records: rows.map(toSummary), total: Number(result.count ?? 0), siteName: null };
}

export type DmFetch = { ok: true; record: DmRecordDetail } | { ok: false; code: 'NOT_FOUND' | 'UNAVAILABLE' };

export async function getDmPlan(id: string): Promise<DmFetch> {
  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE' };

  const result = await withTimeout(admin
    .from('daily_management_plans')
    .select(`${LIST_COLUMNS}, payload`)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .limit(1));

  if (!result || result.error) return { ok: false, code: 'UNAVAILABLE' };
  const row = (result.data ?? [])[0] as unknown as Row | undefined;
  if (!row) return { ok: false, code: 'NOT_FOUND' };
  // Plans filed before a field existed are brought up to the current shape on read, so an
  // archived document can always be reprinted. A payload that no longer validates is shown
  // as stored rather than refused.
  const current = normalisePlan(row.payload);
  return { ok: true, record: { ...toSummary(row), plan: current.ok ? current.plan : row.payload } };
}

export type DmSaveResult =
  | { ok: true; record: DmRecordSummary; duplicateOf?: string }
  | { ok: false; code: 'VALIDATION' | 'UNAVAILABLE' | 'NO_SITE' | 'DUPLICATE'; error: string };

/**
 * File a plan and archive its PDF.
 *
 * The reference is DM-DD-MM-YY. A second plan on the same date gets -2, -3 … rather than
 * being rejected: a site may genuinely run two shifts of daily management, and losing the
 * second one because the first exists would be worse than a suffix.
 */
export async function saveDmPlan(options: {
  siteSlug: string;
  input: unknown;
  companyName?: string | null;
  siteName?: string | null;
}): Promise<DmSaveResult> {
  // Filing needs the sign-off; reading the archive does not, so a plan filed before the
  // declaration existed still opens and reprints.
  const normalised = normalisePlan(options.input, { requireSignOff: true });
  if (!normalised.ok) {
    return { ok: false, code: 'VALIDATION', error: normalised.errors.join(' ') };
  }
  const plan = normalised.plan;

  const admin = getAdminSupabase();
  if (!admin) return { ok: false, code: 'UNAVAILABLE', error: 'The plan database is not configured.' };
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return { ok: false, code: 'UNAVAILABLE', error: 'The plan database is not reachable.' };

  const siteId = options.siteSlug ? await resolveSiteId(admin, tenantId, options.siteSlug) : null;
  if (!siteId) return { ok: false, code: 'NO_SITE', error: 'Choose a site before filing the plan.' };

  const base = referenceFor(plan.date);
  const modulesFilled = filledModuleCount(plan);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const reference = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const inserted = await withTimeout(admin
      .from('daily_management_plans')
      .insert({
        tenant_id: tenantId,
        site_id: siteId,
        plan_date: plan.date,
        reference,
        shift: plan.shift,
        supervisor_name: plan.supervisor,
        supervisor_employee_no: plan.supervisorNo || null,
        location: plan.location || null,
        payload: plan,
        modules_filled: modulesFilled,
        status: 'submitted',
        updated_at: new Date().toISOString()
      })
      .select(LIST_COLUMNS));

    if (!inserted) return { ok: false, code: 'UNAVAILABLE', error: 'The plan database did not answer in time.' };
    if (inserted.error) {
      // 23505 = the reference already exists for this tenant; try the next suffix.
      if (inserted.error.code === '23505') continue;
      return { ok: false, code: 'UNAVAILABLE', error: 'The plan could not be saved.' };
    }

    const row = (inserted.data ?? [])[0] as unknown as Omit<Row, 'payload'>;
    const record = toSummary(row);

    // Best effort: the record is already safe, and the PDF can always be rebuilt from it.
    try {
      const bytes = await renderDmPdf(plan, {
        reference,
        siteName: options.siteName || plan.location || 'Site',
        companyName: options.companyName ?? null
      });
      const path = `${tenantId}/${reference}.pdf`;
      const upload = await admin.storage.from(BUCKET).upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: true
      });
      if (!upload.error) {
        const updated = await admin
          .from('daily_management_plans')
          .update({ pdf_path: path })
          .eq('tenant_id', tenantId)
          .eq('id', record.id);
        if (!updated.error) record.hasPdf = true;
      }
    } catch (error) {
      console.error('DM PDF archive failed', error);
    }

    return { ok: true, record };
  }

  return { ok: false, code: 'DUPLICATE', error: 'Too many plans filed for this date. Use a different date.' };
}

export type DmPdfResult =
  | { ok: true; bytes: Uint8Array; filename: string }
  | { ok: false; code: 'NOT_FOUND' | 'UNAVAILABLE' };

/** The archived PDF, or the same document rebuilt from the stored plan. */
export async function readDmPdf(id: string, options: { siteName?: string | null; companyName?: string | null } = {}): Promise<DmPdfResult> {
  const found = await getDmPlan(id);
  if (!found.ok) return { ok: false, code: found.code };
  const { record } = found;
  const filename = `${record.reference}.pdf`;

  const admin = getAdminSupabase();
  if (admin) {
    const path = `${(await resolveTenantId(admin)) ?? ''}/${record.reference}.pdf`;
    const stored = await admin.storage.from(BUCKET).download(path).catch(() => null);
    if (stored && !stored.error && stored.data) {
      return { ok: true, bytes: new Uint8Array(await stored.data.arrayBuffer()), filename };
    }
  }

  try {
    const bytes = await renderDmPdf(record.plan, {
      reference: record.reference,
      siteName: options.siteName || record.location || 'Site',
      companyName: options.companyName ?? null
    });
    return { ok: true, bytes, filename };
  } catch (error) {
    console.error('DM PDF render failed', error);
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

/** Human site name for the PDF letterhead. Null when the site is unknown. */
export async function siteLabel(siteSlug: string): Promise<string | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  if (!tenantId) return null;
  const siteId = await resolveSiteId(admin, tenantId, siteSlug);
  if (!siteId) return null;
  const result = await withTimeout(admin.from('sites').select('name').eq('id', siteId).limit(1));
  const row = (result?.data ?? [])[0] as { name?: string } | undefined;
  return row?.name?.trim() || null;
}
