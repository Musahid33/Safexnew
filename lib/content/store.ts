import 'server-only';
import { getAdminSupabase } from '@/lib/supabase/admin';
import { resolveTenantId } from '@/lib/employee-master/db-source';
import { VAULT_CATEGORIES, vaultCategoryFromDbKey, type DocumentType, type VaultCategoryKey } from './catalog';
import type {
  AdminAnnouncement, AdminDocument, AdminEvent, ContentFeedItem, ContentStatus,
  PublishedDocument
} from './types';

/**
 * Server-side reads and writes for published content: the document vault and the
 * circulars / notices / events feed.
 *
 * Everything goes through the service role with an explicit tenant id — the same rule as the
 * employee directory and the reports feed. The public read paths only ever ask for
 * `status = 'published'`, so drafts cannot leak by forgetting a filter in a component.
 */

export const CONTENT_BUCKET = 'safex-content';
const QUERY_TIMEOUT_MS = 5000;
const MAX_DOCUMENTS = 300;
const MAX_POSTS = 200;
const MAX_EVENTS = 200;

type Admin = NonNullable<ReturnType<typeof getAdminSupabase>>;
export type ContentStore = { admin: Admin; tenantId: string };

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

/** The tenant this deployment serves, or null when Supabase is not configured. */
export async function contentStore(): Promise<ContentStore | null> {
  const admin = getAdminSupabase();
  if (!admin) return null;
  const tenantId = await resolveTenantId(admin);
  return tenantId ? { admin, tenantId } : null;
}

export type ContentSite = { id: string; slug: string; name: string; region: string };
type SiteRow = { id: string; slug: string | null; name: string; region: string | null };

function toSite(row: SiteRow): ContentSite {
  return { id: row.id, slug: row.slug ?? row.id, name: row.name, region: row.region ?? '' };
}

/** Every active site, for the publishing panel's site selector. */
export async function listContentSites(store: ContentStore): Promise<ContentSite[]> {
  const result = await withTimeout(store.admin
    .from('sites')
    .select('id, slug, name, region')
    .eq('tenant_id', store.tenantId)
    .eq('active', true)
    .order('name'));
  if (!result || result.error || !result.data) return [];
  return (result.data as SiteRow[]).map(toSite);
}

/**
 * Resolve the `?site=` value the app sends (slug, or a uuid) to a real site row.
 * An unknown value returns null; callers answer with an empty payload rather than widening.
 */
export async function findContentSite(
  store: ContentStore,
  siteRef: string
): Promise<ContentSite | null> {
  const reference = siteRef.trim();
  if (!reference) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
  const result = await withTimeout(store.admin
    .from('sites')
    .select('id, slug, name, region')
    .eq('tenant_id', store.tenantId)
    .eq(isUuid ? 'id' : 'slug', reference)
    .eq('active', true)
    .maybeSingle());
  if (!result || result.error || !result.data) return null;
  return toSite(result.data as SiteRow);
}

/* --------------------------------------------------------------------------------------------
 * Public shapes
 * ------------------------------------------------------------------------------------------ */

export type DocumentRow = {
  id: string;
  category_id: string;
  title: string;
  summary: string | null;
  document_code: string | null;
  document_type: string;
  revision: string | null;
  department?: string | null;
  section?: string | null;
  effective_date: string | null;
  /** The register's "Valid Upto". */
  review_due_date?: string | null;
  status: string;
  storage_path?: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  external_url?: string | null;
  sort_order?: number | null;
  published_at: string | null;
  updated_at?: string | null;
};

export type AnnouncementRow = {
  id: string;
  post_type: string;
  title: string;
  summary: string | null;
  body: string | null;
  priority: string | null;
  published_on: string | null;
  status: string;
  attachment_path?: string | null;
  external_url?: string | null;
  published_at: string | null;
  expires_at: string | null;
  updated_at?: string | null;
};

export type EventRow = {
  id: string;
  title: string;
  topic: string | null;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  status: string;
  published_at: string | null;
  updated_at?: string | null;
};

/** Stable same-origin links; the route behind them re-checks that the row is published. */
export function contentFileUrl(kind: 'document' | 'announcement', id: string): string {
  return `/api/content/file/${kind}/${id}`;
}

function hasFile(row: { storage_path?: string | null; attachment_path?: string | null; external_url?: string | null }): boolean {
  return Boolean(row.storage_path || row.attachment_path || row.external_url);
}

/** The bucket stores the uploaded MIME type; older rows only have the file name to go on. */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp'
};

export function documentMimeType(row: { mime_type?: string | null; original_filename?: string | null }): string | null {
  if (row.mime_type) return row.mime_type;
  const name = row.original_filename ?? '';
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] ?? null;
}

export function mapPublishedDocument(row: DocumentRow, category: VaultCategoryKey | null): PublishedDocument | null {
  if (!category) return null;
  return {
    id: row.id,
    category,
    title: row.title,
    summary: row.summary,
    documentCode: row.document_code,
    documentType: (row.document_type ?? 'document') as DocumentType,
    revision: row.revision,
    department: row.department ?? null,
    section: row.section ?? null,
    effectiveDate: row.effective_date,
    validUpto: row.review_due_date ?? null,
    publishedAt: row.published_at,
    fileUrl: hasFile(row) ? contentFileUrl('document', row.id) : null,
    fileName: row.original_filename ?? null,
    mimeType: documentMimeType(row),
    external: Boolean(row.external_url && !row.storage_path)
  };
}

/** Announcement → feed item. `published_on` is a date, so it is read at site-noon IST. */
export function mapAnnouncement(row: AnnouncementRow): ContentFeedItem | null {
  if (row.post_type !== 'circular' && row.post_type !== 'notice') return null;
  const date = row.published_at ?? (row.published_on ? `${row.published_on}T12:00:00+05:30` : null);
  if (!date) return null;
  return {
    id: row.id,
    type: row.post_type === 'circular' ? 'Circular' : 'Notice',
    title: row.title,
    date,
    summary: row.summary ?? '',
    details: row.body ?? '',
    attachmentUrl: hasFile(row) ? contentFileUrl('announcement', row.id) : null
  };
}

export function mapEvent(row: EventRow): ContentFeedItem | null {
  if (!row.starts_at) return null;
  return {
    id: row.id,
    type: 'Event',
    title: row.title,
    date: row.starts_at,
    summary: row.topic ?? (row.description ?? '').slice(0, 160),
    details: row.description ?? '',
    location: row.venue ?? undefined,
    attachmentUrl: null
  };
}

/** Newest-first for circulars/notices, chronological for events (the app re-sorts per view). */
export function sortContentFeed(items: ContentFeedItem[]): ContentFeedItem[] {
  return [...items].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/** A published announcement whose expiry has passed must stop showing on its own. */
export function isLiveAnnouncement(row: AnnouncementRow, now = Date.now()): boolean {
  if (row.status !== 'published') return false;
  if (!row.expires_at) return true;
  const expiry = new Date(row.expires_at).getTime();
  return Number.isNaN(expiry) ? true : expiry > now;
}

/* --------------------------------------------------------------------------------------------
 * Public read
 * ------------------------------------------------------------------------------------------ */

export type PublishedContent = {
  site: ContentSite;
  documents: PublishedDocument[];
  feed: ContentFeedItem[];
};

/**
 * PostgREST rejects a select that names a column the database does not have yet (the
 * `external_url` columns arrive with migration 202610210005). Reading published content must
 * not stop working because a deployment is one migration behind, so the first read retries
 * without the optional columns.
 */
function optionalColumnsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42703' || /column .* does not exist/i.test(error.message ?? '');
}

async function selectDocuments(store: ContentStore, siteId: string, publishedOnly: boolean) {
  const base = 'id, category_id, title, summary, document_code, document_type, revision, effective_date, review_due_date, mime_type, status, storage_path, original_filename, sort_order, published_at, updated_at';
  const run = async (columns: string) => {
    let request = store.admin.from('documents').select(columns)
      .eq('company_id', store.tenantId).eq('location_id', siteId);
    if (publishedOnly) request = request.eq('status', 'published');
    return withTimeout(request
      .order('sort_order', { ascending: true })
      .order('published_at', { ascending: false })
      .limit(MAX_DOCUMENTS));
  };
  // Newest register columns first; each step drops a layer so a deployment one migration
  // behind still lists its documents instead of answering with an empty shelf.
  const tiers = [
    `${base}, external_url, department, section`,
    `${base}, external_url`,
    base
  ];
  let result = await run(tiers[0]);
  for (const columns of tiers.slice(1)) {
    if (!result || !optionalColumnsError(result.error)) break;
    result = await run(columns);
  }
  return result;
}

async function selectAnnouncements(store: ContentStore, siteId: string, publishedOnly: boolean) {
  const base = 'id, post_type, title, summary, body, priority, published_on, status, attachment_path, published_at, expires_at, updated_at';
  const run = async (columns: string) => {
    let request = store.admin.from('site_announcements').select(columns)
      .eq('company_id', store.tenantId).eq('location_id', siteId);
    if (publishedOnly) request = request.eq('status', 'published');
    return withTimeout(request
      .order('published_on', { ascending: false })
      .limit(MAX_POSTS));
  };
  const first = await run(`${base}, external_url`);
  if (first && optionalColumnsError(first.error)) return run(base);
  return first;
}

async function selectEvents(store: ContentStore, siteId: string, publishedOnly: boolean) {
  let request = store.admin.from('site_events')
    .select('id, title, topic, description, starts_at, ends_at, venue, status, published_at, updated_at')
    .eq('company_id', store.tenantId).eq('location_id', siteId);
  if (publishedOnly) request = request.eq('status', 'published');
  return withTimeout(request.order('starts_at', { ascending: true }).limit(MAX_EVENTS));
}

async function categoryIndex(store: ContentStore, siteId: string): Promise<Map<string, VaultCategoryKey>> {
  const result = await withTimeout(store.admin.from('document_categories')
    .select('id, category_key')
    .eq('company_id', store.tenantId).eq('location_id', siteId).limit(50));
  const index = new Map<string, VaultCategoryKey>();
  if (!result || result.error || !result.data) return index;
  for (const row of result.data as Array<{ id: string; category_key: string }>) {
    const key = vaultCategoryFromDbKey(row.category_key);
    if (key) index.set(row.id, key);
  }
  return index;
}

/**
 * Everything the worker app shows for one site.
 *
 * An unknown or missing site answers with empty lists — never with another site's content and
 * never with an error that hides a configuration problem behind "no documents".
 */
export async function readPublishedContent(siteRef: string): Promise<PublishedContent | null> {
  const store = await contentStore();
  if (!store) return null;
  const site = await findContentSite(store, siteRef);
  if (!site) return null;

  const [documentsResult, categories, announcementsResult, eventsResult] = await Promise.all([
    selectDocuments(store, site.id, true),
    categoryIndex(store, site.id),
    selectAnnouncements(store, site.id, true),
    selectEvents(store, site.id, true)
  ]);

  const documents = documentsResult && !documentsResult.error
    ? (documentsResult.data as unknown as DocumentRow[])
      .map((row) => mapPublishedDocument(row, categories.get(row.category_id) ?? null))
      .filter((row): row is PublishedDocument => row !== null)
    : [];

  const feed: ContentFeedItem[] = [];
  if (announcementsResult && !announcementsResult.error) {
    for (const row of announcementsResult.data as unknown as AnnouncementRow[]) {
      if (!isLiveAnnouncement(row)) continue;
      const item = mapAnnouncement(row);
      if (item) feed.push(item);
    }
  }
  if (eventsResult && !eventsResult.error) {
    for (const row of eventsResult.data as unknown as EventRow[]) {
      const item = mapEvent(row);
      if (item) feed.push(item);
    }
  }

  return { site, documents, feed: sortContentFeed(feed) };
}

/* --------------------------------------------------------------------------------------------
 * Storage
 * ------------------------------------------------------------------------------------------ */

/** A freshly signed private URL, or null when the object cannot be reached. */
export async function signContentPath(
  store: ContentStore,
  path: string,
  download?: string | boolean
): Promise<string | null> {
  const result = await withTimeout(store.admin.storage.from(CONTENT_BUCKET)
    .createSignedUrl(path, 120, download ? { download } : undefined));
  if (!result || result.error || !result.data?.signedUrl) return null;
  return result.data.signedUrl;
}

/**
 * What a published file row resolves to.
 *
 * `url` is a two-minute signed storage URL or the row's external https link. `storagePath` is
 * only set for an uploaded file — the route uses it to decide whether it can stream the bytes
 * for the in-app viewer instead of redirecting.
 */
export type PublishedFileAsset = {
  url: string;
  storagePath: string | null;
  mimeType: string | null;
  fileName: string | null;
  external: boolean;
};

export async function resolvePublishedFileAsset(
  kind: 'document' | 'announcement',
  id: string,
  options: { download?: boolean } = {}
): Promise<PublishedFileAsset | null> {
  const store = await contentStore();
  if (!store) return null;

  if (kind === 'document') {
    const result = await withTimeout(store.admin.from('documents')
      .select('status, storage_path, external_url, original_filename, mime_type')
      .eq('id', id).eq('company_id', store.tenantId).maybeSingle());
    if (!result || result.error || !result.data) return null;
    const row = result.data as {
      status: string; storage_path: string | null; external_url?: string | null;
      original_filename?: string | null; mime_type?: string | null;
    };
    if (row.status !== 'published') return null;
    if (row.storage_path) {
      const url = await signContentPath(store, row.storage_path, options.download ? row.original_filename ?? true : undefined);
      if (!url) return null;
      return {
        url,
        storagePath: row.storage_path,
        mimeType: documentMimeType(row),
        fileName: row.original_filename ?? null,
        external: false
      };
    }
    return row.external_url
      ? { url: row.external_url, storagePath: null, mimeType: null, fileName: null, external: true }
      : null;
  }

  const result = await withTimeout(store.admin.from('site_announcements')
    .select('status, attachment_path, external_url, expires_at')
    .eq('id', id).eq('company_id', store.tenantId).maybeSingle());
  if (!result || result.error || !result.data) return null;
  const row = result.data as { status: string; attachment_path: string | null; external_url?: string | null; expires_at: string | null };
  if (!isLiveAnnouncement({ status: row.status, expires_at: row.expires_at } as AnnouncementRow)) return null;
  if (row.attachment_path) {
    const url = await signContentPath(store, row.attachment_path, options.download ? true : undefined);
    if (!url) return null;
    return { url, storagePath: row.attachment_path, mimeType: null, fileName: null, external: false };
  }
  return row.external_url
    ? { url: row.external_url, storagePath: null, mimeType: null, fileName: null, external: true }
    : null;
}

/**
 * Where a published file should send the browser.
 *
 * Only rows that are published are ever resolved here: the download route is public, so this
 * function is the gate. It returns a redirect target (signed storage URL or the external link)
 * or null, and never the storage path itself.
 */
export async function resolvePublishedFile(
  kind: 'document' | 'announcement',
  id: string
): Promise<string | null> {
  const asset = await resolvePublishedFileAsset(kind, id);
  return asset?.url ?? null;
}

/* --------------------------------------------------------------------------------------------
 * Admin read + write
 * ------------------------------------------------------------------------------------------ */

export async function ensureDocumentCategory(
  store: ContentStore,
  siteId: string,
  category: VaultCategoryKey
): Promise<string | null> {
  const definition = VAULT_CATEGORIES[category];
  const lookup = await withTimeout(store.admin.from('document_categories')
    .select('id')
    .eq('company_id', store.tenantId).eq('location_id', siteId).eq('category_key', definition.dbKey)
    .maybeSingle());
  if (!lookup || lookup.error) return null;
  if (lookup.data?.id) return lookup.data.id as string;

  const keys = Object.keys(VAULT_CATEGORIES) as VaultCategoryKey[];
  const inserted = await withTimeout(store.admin.from('document_categories').insert({
    company_id: store.tenantId,
    location_id: siteId,
    category_key: definition.dbKey,
    display_name: definition.title,
    description: definition.description,
    sort_order: keys.indexOf(category) + 1,
    is_active: true
  }).select('id').maybeSingle());
  if (inserted && !inserted.error && inserted.data?.id) return inserted.data.id as string;

  // A concurrent insert can win the unique key; read it back instead of failing the publish.
  const raced = await withTimeout(store.admin.from('document_categories')
    .select('id')
    .eq('company_id', store.tenantId).eq('location_id', siteId).eq('category_key', definition.dbKey)
    .maybeSingle());
  return raced && !raced.error && raced.data?.id ? raced.data.id as string : null;
}

export type AdminContent = {
  documents: AdminDocument[];
  announcements: AdminAnnouncement[];
  events: AdminEvent[];
};

export async function readAdminContent(siteId: string): Promise<{ store: ContentStore; site: ContentSite; content: AdminContent } | null> {
  const store = await contentStore();
  if (!store) return null;
  const site = await findContentSite(store, siteId);
  if (!site) return null;

  const [documentsResult, categories, announcementsResult, eventsResult] = await Promise.all([
    selectDocuments(store, site.id, false),
    categoryIndex(store, site.id),
    selectAnnouncements(store, site.id, false),
    selectEvents(store, site.id, false)
  ]);

  const documents: AdminDocument[] = documentsResult && !documentsResult.error
    ? (documentsResult.data as unknown as DocumentRow[]).flatMap((row) => {
      const category = categories.get(row.category_id);
      if (!category) return [];
      return [{
        id: row.id,
        category,
        title: row.title,
        summary: row.summary,
        documentCode: row.document_code,
        documentType: (row.document_type ?? 'document') as DocumentType,
        revision: row.revision,
        department: row.department ?? null,
        section: row.section ?? null,
        effectiveDate: row.effective_date,
        validUpto: row.review_due_date ?? null,
        status: (row.status ?? 'draft') as ContentStatus,
        publishedAt: row.published_at,
        fileName: row.original_filename ?? null,
        fileUrl: hasFile(row) ? contentFileUrl('document', row.id) : null,
        sortOrder: row.sort_order ?? 0,
        updatedAt: row.updated_at ?? null
      }];
    })
    : [];

  const announcements: AdminAnnouncement[] = announcementsResult && !announcementsResult.error
    ? (announcementsResult.data as unknown as AnnouncementRow[]).map((row) => ({
      id: row.id,
      kind: row.post_type === 'notice' ? 'notice' : 'circular',
      title: row.title,
      summary: row.summary ?? '',
      body: row.body ?? '',
      priority: row.priority === 'important' || row.priority === 'urgent' ? row.priority : 'normal',
      publishedOn: row.published_on,
      expiresAt: row.expires_at,
      status: (row.status ?? 'draft') as ContentStatus,
      attachmentUrl: hasFile(row) ? contentFileUrl('announcement', row.id) : null,
      attachmentName: null,
      updatedAt: row.updated_at ?? null
    }))
    : [];

  const events: AdminEvent[] = eventsResult && !eventsResult.error
    ? (eventsResult.data as unknown as EventRow[]).map((row) => ({
      id: row.id,
      title: row.title,
      topic: row.topic,
      description: row.description ?? '',
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      venue: row.venue,
      status: (row.status ?? 'draft') as AdminEvent['status'],
      publishedAt: row.published_at,
      updatedAt: row.updated_at ?? null
    }))
    : [];

  return { store, site, content: { documents, announcements, events } };
}
