import 'server-only';
import {
  contentStore, ensureDocumentCategory, findContentSite, type ContentStore
} from './store';
import type { AnnouncementInput, DocumentInput, EventInput } from './validation';

/**
 * Writing published content from the admin panel.
 *
 * Every statement is scoped by `company_id` (the tenant) and `location_id` (the site) as well
 * as the row id, so an id guessed from another site cannot be edited or deleted. The publish
 * panel is the only caller; the route checks the admin session before reaching this module.
 */

export type WriteResult =
  | { ok: true; id: string }
  | { ok: false; code: 'UNAVAILABLE' | 'INVALID' | 'NOT_FOUND'; error: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowId(value: unknown): string | null {
  return typeof value === 'string' && uuid.test(value) ? value : null;
}

function tableFor(kind: 'document' | 'announcement' | 'event') {
  return kind === 'document' ? 'documents' : kind === 'announcement' ? 'site_announcements' : 'site_events';
}

function failure(code: 'UNAVAILABLE' | 'INVALID' | 'NOT_FOUND', error: string): WriteResult {
  return { ok: false, code, error };
}

function databaseFailure(kind: string, error: unknown): WriteResult {
  console.error(`Publishing ${kind} failed`, error);
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : '';
  if (/column .* does not exist/i.test(message)) {
    return failure('UNAVAILABLE', 'Apply migration 202610210005_content_publishing.sql in Supabase, then try again.');
  }
  return failure('UNAVAILABLE', 'The content database is unavailable. Check the Supabase configuration and try again.');
}

type StoreAndSite = { store: ContentStore; siteId: string };
async function target(siteRef: string): Promise<StoreAndSite | WriteResult> {
  const store = await contentStore();
  if (!store) return failure('UNAVAILABLE', 'Supabase is not configured for this deployment.');
  const site = await findContentSite(store, siteRef);
  if (!site) return failure('INVALID', 'Choose an active site before publishing.');
  return { store, siteId: site.id };
}

function scoped(store: ContentStore, siteId: string) {
  return { company_id: store.tenantId, location_id: siteId };
}

/** Save a vault document (create when no id, update when one is given). */
export async function saveDocument(
  siteRef: string,
  input: DocumentInput,
  id: string | null
): Promise<WriteResult> {
  const resolved = await target(siteRef);
  if ('ok' in resolved) return resolved;
  const { store, siteId } = resolved;
  const documentId = id ? rowId(id) : null;
  if (id && !documentId) return failure('INVALID', 'That document id is not valid.');

  const categoryId = await ensureDocumentCategory(store, siteId, input.category as never);
  if (!categoryId) return failure('UNAVAILABLE', 'The document category could not be prepared for this site.');

  const { category: _category, ...rest } = input;
  const row: Record<string, unknown> = { ...rest, category_id: categoryId, ...scoped(store, siteId) };

  if (documentId) {
    // `undefined` means the panel did not touch the file: keep what is stored.
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    if (input.status === 'published') row.published_at = new Date().toISOString();
    const result = await store.admin.from('documents').update(row)
      .eq('id', documentId).eq('company_id', store.tenantId).eq('location_id', siteId)
      .select('id').maybeSingle();
    if (result.error) return databaseFailure('document', result.error);
    return result.data ? { ok: true, id: documentId } : failure('NOT_FOUND', 'That document no longer exists.');
  }

  const result = await store.admin.from('documents').insert(row).select('id').maybeSingle();
  if (result.error) return databaseFailure('document', result.error);
  return result.data?.id ? { ok: true, id: result.data.id } : failure('UNAVAILABLE', 'The document could not be saved.');
}

export async function deleteContent(kind: 'document' | 'announcement' | 'event', siteRef: string, id: string): Promise<WriteResult> {
  const resolved = await target(siteRef);
  if ('ok' in resolved) return resolved;
  const { store, siteId } = resolved;
  const row = rowId(id);
  if (!row) return failure('INVALID', 'That id is not valid.');

  const result = await store.admin.from(tableFor(kind))
    .delete()
    .eq('id', row).eq('company_id', store.tenantId).eq('location_id', siteId)
    .select('id').maybeSingle();
  if (result.error) return databaseFailure(kind, result.error);
  return result.data ? { ok: true, id: row } : failure('NOT_FOUND', 'That entry no longer exists.');
}

export async function saveAnnouncement(
  siteRef: string,
  input: AnnouncementInput,
  id: string | null
): Promise<WriteResult> {
  const resolved = await target(siteRef);
  if ('ok' in resolved) return resolved;
  const { store, siteId } = resolved;
  const announcementId = id ? rowId(id) : null;
  if (id && !announcementId) return failure('INVALID', 'That circular id is not valid.');

  const row: Record<string, unknown> = { ...input, ...scoped(store, siteId) };
  if (announcementId) {
    for (const key of Object.keys(row)) if (row[key] === undefined) delete row[key];
    if (input.status === 'published') row.published_at = new Date().toISOString();
    const result = await store.admin.from('site_announcements').update(row)
      .eq('id', announcementId).eq('company_id', store.tenantId).eq('location_id', siteId)
      .select('id').maybeSingle();
    if (result.error) return databaseFailure('announcement', result.error);
    return result.data ? { ok: true, id: announcementId } : failure('NOT_FOUND', 'That circular no longer exists.');
  }

  const result = await store.admin.from('site_announcements').insert(row).select('id').maybeSingle();
  if (result.error) return databaseFailure('announcement', result.error);
  return result.data?.id ? { ok: true, id: result.data.id } : failure('UNAVAILABLE', 'The circular could not be saved.');
}

export async function saveEvent(
  siteRef: string,
  input: EventInput,
  id: string | null
): Promise<WriteResult> {
  const resolved = await target(siteRef);
  if ('ok' in resolved) return resolved;
  const { store, siteId } = resolved;
  const eventId = id ? rowId(id) : null;
  if (id && !eventId) return failure('INVALID', 'That event id is not valid.');

  const row = { ...input, ...scoped(store, siteId) };
  if (eventId) {
    if (input.status === 'published') row.published_at = row.published_at ?? new Date().toISOString();
    const result = await store.admin.from('site_events').update(row)
      .eq('id', eventId).eq('company_id', store.tenantId).eq('location_id', siteId)
      .select('id').maybeSingle();
    if (result.error) return databaseFailure('event', result.error);
    return result.data ? { ok: true, id: eventId } : failure('NOT_FOUND', 'That event no longer exists.');
  }

  const result = await store.admin.from('site_events').insert(row).select('id').maybeSingle();
  if (result.error) return databaseFailure('event', result.error);
  return result.data?.id ? { ok: true, id: result.data.id } : failure('UNAVAILABLE', 'The event could not be saved.');
}
