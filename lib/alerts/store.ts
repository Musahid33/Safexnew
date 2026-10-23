import 'server-only';
import { contentStore, findContentSite, type ContentStore } from '@/lib/content/store';
import { alertCategoryLabel } from './catalog';
import type { AlertInput } from './validation';

/**
 * Server-side reads and writes for published safety alerts.
 *
 * Same rule as the rest of the publishing surface: the service role with an explicit tenant
 * and site, and the public read only ever asks for `status = 'published'`. The worker app's
 * alert screen is the consumer — before this existed it rendered a hard-coded empty array,
 * so a real incident report had nowhere to go.
 */

export type AlertRow = {
  id: string;
  alert_reference: string | null;
  category_key: string;
  headline: string;
  incident_at: string;
  area_label: string | null;
  department_name: string | null;
  description: string;
  root_cause: string | null;
  immediate_response: unknown;
  corrective_actions: unknown;
  lessons_learned: unknown;
  status: string;
  published_at: string | null;
  updated_at: string | null;
};

/** The app's own alert shape (see `lib/safety-alerts.ts`) plus the admin status. */
export type PublishedAlert = {
  id: string;
  category: ReturnType<typeof alertCategoryLabel>;
  title: string;
  /** ISO timestamp of the incident. */
  date: string;
  site: string;
  area: string;
  department: string;
  reference: string;
  description: string;
  rootCause: string;
  immediateActions: string[];
  correctiveActions: string[];
  lessonsLearned: string[];
};

export type AdminAlert = PublishedAlert & {
  status: 'draft' | 'published' | 'archived';
  updatedAt: string | null;
};

const SELECT = 'id, alert_reference, category_key, headline, incident_at, area_label, department_name, description, root_cause, immediate_response, corrective_actions, lessons_learned, status, published_at, updated_at';

/** A jsonb bullet column is an array of strings; anything else is ignored, never rendered. */
function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

function mapAlert(row: AlertRow, siteName: string): AdminAlert {
  return {
    id: row.id,
    category: alertCategoryLabel(row.category_key),
    title: row.headline,
    date: row.incident_at,
    site: siteName,
    area: row.area_label ?? '',
    department: row.department_name ?? '',
    reference: row.alert_reference ?? '',
    description: row.description,
    rootCause: row.root_cause ?? '',
    immediateActions: list(row.immediate_response),
    correctiveActions: list(row.corrective_actions),
    lessonsLearned: list(row.lessons_learned),
    status: (row.status === 'published' || row.status === 'archived' ? row.status : 'draft'),
    updatedAt: row.updated_at ?? null
  };
}

export type AlertStore = { store: ContentStore; siteId: string; siteName: string };

/** Resolve the site this deployment publishes to, or null when Supabase is not configured. */
export async function alertStore(siteRef: string): Promise<AlertStore | null> {
  const store = await contentStore();
  if (!store) return null;
  const site = await findContentSite(store, siteRef);
  if (!site) return null;
  return { store, siteId: site.id, siteName: site.name };
}

/** Published alerts for one site, newest incident first. Never leaks a draft. */
export async function readPublishedAlerts(siteRef: string, limit = 50): Promise<PublishedAlert[]> {
  const target = await alertStore(siteRef);
  if (!target) return [];
  const { data, error } = await target.store.admin.from('safety_alerts')
    .select(SELECT)
    .eq('company_id', target.store.tenantId)
    .eq('location_id', target.siteId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', new Date().toISOString())
    .order('incident_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as AlertRow[]).map((row) => {
    const mapped = mapAlert(row, target.siteName);
    const { status: _status, updatedAt: _updatedAt, ...published } = mapped;
    return published;
  });
}

/** Every alert for one site, drafts included — the console's editor. */
export async function readAdminAlerts(siteRef: string): Promise<AdminAlert[]> {
  const target = await alertStore(siteRef);
  if (!target) return [];
  const { data, error } = await target.store.admin.from('safety_alerts')
    .select(SELECT)
    .eq('company_id', target.store.tenantId)
    .eq('location_id', target.siteId)
    .order('incident_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as AlertRow[]).map((row) => mapAlert(row, target.siteName));
}

export type AlertWriteResult =
  | { ok: true; id: string }
  | { ok: false; code: 'INVALID' | 'NOT_FOUND' | 'UNAVAILABLE'; error: string };

function failure(code: 'INVALID' | 'NOT_FOUND' | 'UNAVAILABLE', error: string): AlertWriteResult {
  return { ok: false, code, error };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveAlert(siteRef: string, input: AlertInput, id: string | null): Promise<AlertWriteResult> {
  const target = await alertStore(siteRef);
  if (!target) return failure('UNAVAILABLE', 'Supabase and SAFEX_TENANT_SLUG must be configured to publish alerts.');

  if (id) {
    if (!UUID.test(id)) return failure('INVALID', 'That alert id is not valid.');
    const row: Record<string, unknown> = { ...input };
    // Keep the first publish time when an alert is edited after going live.
    if (input.status !== 'published') delete row.published_at;
    const { data, error } = await target.store.admin.from('safety_alerts').update(row)
      .eq('id', id).eq('company_id', target.store.tenantId).eq('location_id', target.siteId)
      .select('id').maybeSingle();
    if (error) {
      console.error('Safety alert update failed', error);
      return failure('UNAVAILABLE', 'The alert could not be saved.');
    }
    return data ? { ok: true, id } : failure('NOT_FOUND', 'That alert no longer exists.');
  }

  const { data, error } = await target.store.admin.from('safety_alerts')
    .insert({ ...input, company_id: target.store.tenantId, location_id: target.siteId })
    .select('id').maybeSingle();
  if (error) {
    console.error('Safety alert insert failed', error);
    return failure('UNAVAILABLE', 'The alert could not be saved.');
  }
  return data?.id ? { ok: true, id: data.id } : failure('UNAVAILABLE', 'The alert could not be saved.');
}

export async function deleteAlert(siteRef: string, id: string): Promise<AlertWriteResult> {
  const target = await alertStore(siteRef);
  if (!target) return failure('UNAVAILABLE', 'Supabase and SAFEX_TENANT_SLUG must be configured to publish alerts.');
  if (!UUID.test(id)) return failure('INVALID', 'That alert id is not valid.');
  const { data, error } = await target.store.admin.from('safety_alerts').delete()
    .eq('id', id).eq('company_id', target.store.tenantId).eq('location_id', target.siteId)
    .select('id').maybeSingle();
  if (error) {
    console.error('Safety alert delete failed', error);
    return failure('UNAVAILABLE', 'The alert could not be deleted.');
  }
  return data ? { ok: true, id } : failure('NOT_FOUND', 'That alert no longer exists.');
}
