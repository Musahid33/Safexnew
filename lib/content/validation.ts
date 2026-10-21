import { DOCUMENT_TYPES, isVaultCategoryKey, VAULT_CATEGORIES, type DocumentType } from './catalog';
import type { ContentStatus } from './types';

/**
 * Input validation for the publishing panel.
 *
 * Each function returns the exact column object the store writes, or null. Keeping the mapping
 * here (rather than in the route) means the panel, the API and the tests all agree on what a
 * valid publish looks like, and a field can never reach the database unchecked.
 */

const MAX = {
  title: 160,
  summary: 500,
  shortSummary: 300,
  body: 5000,
  code: 40,
  revision: 40,
  fileName: 200,
  path: 400,
  url: 600,
  venue: 160,
  topic: 120
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const PATH_SAFE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > limit) return null;
  return trimmed;
}

function optionalText(value: unknown, limit: number): string | null | undefined {
  if (value == null || value === '') return null;
  const parsed = text(value, limit);
  return parsed === null ? undefined : parsed;
}

function isoDate(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

function isoDateTime(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * A link the vault may open: https only, no credentials, no javascript:/data: tricks. A
 * relative path is rejected too — a public post must not point at an internal route.
 */
export function validExternalUrl(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX.url) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function storagePath(value: unknown): string | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX.path || !PATH_SAFE.test(value) || value.includes('..')) return undefined;
  return value;
}

function statusOf(value: unknown, allowed: readonly string[], fallback: string): string | null {
  const raw = typeof value === 'string' ? value.trim() : fallback;
  return allowed.includes(raw) ? raw : null;
}

export type DocumentInput = {
  category: string;
  title: string;
  summary: string | null;
  document_code: string | null;
  document_type: DocumentType;
  revision: string | null;
  effective_date: string | null;
  status: ContentStatus;
  /** `undefined` means "leave whatever is stored" — used by a status-only edit. */
  storage_path?: string | null;
  original_filename?: string | null;
  external_url?: string | null;
  sort_order: number;
  published_at: string | null;
  updated_at: string;
};

/**
 * A vault document. `status` decides visibility on its own: the public feed only reads
 * `published`, so a draft can be saved as many times as the author likes.
 */
export function validDocumentInput(body: Record<string, unknown>): DocumentInput | null {
  if (!isVaultCategoryKey(body.category)) return null;
  const title = text(body.title, MAX.title);
  if (!title) return null;

  const summary = optionalText(body.summary, MAX.summary);
  const documentCode = optionalText(body.documentCode, MAX.code);
  const revision = optionalText(body.revision, MAX.revision);
  // A field that is absent must not be erased by a status change; only an explicit empty
  // value clears it. The panel always sends every field, so this only matters for the quick
  // publish/unpublish action.
  const fileName = 'fileName' in body ? optionalText(body.fileName, MAX.fileName) : undefined;
  const path = 'filePath' in body ? storagePath(body.filePath) : undefined;
  const external = 'externalUrl' in body ? validExternalUrl(body.externalUrl) : undefined;
  const effectiveDate = isoDate(body.effectiveDate);
  if (summary === undefined || documentCode === undefined || revision === undefined) return null;
  if ([fileName, path, external, effectiveDate].includes(undefined) && ('fileName' in body || 'filePath' in body || 'externalUrl' in body)) {
    // Only reject when a field that *was* sent could not be parsed.
    if (fileName === undefined && 'fileName' in body) return null;
    if (path === undefined && 'filePath' in body) return null;
    if (external === undefined && 'externalUrl' in body) return null;
  }
  if (effectiveDate === undefined) return null;

  const requestedType = typeof body.documentType === 'string' ? body.documentType : '';
  const fallbackType = VAULT_CATEGORIES[body.category].docType as DocumentType;
  const documentType = (DOCUMENT_TYPES as readonly string[]).includes(requestedType)
    ? requestedType as DocumentType
    : fallbackType;

  const status = statusOf(body.status, ['draft', 'published', 'archived'], 'draft') as ContentStatus | null;
  if (!status) return null;

  const order = body.sortOrder ?? 0;
  if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > 9999) return null;

  const now = new Date().toISOString();

  const row: DocumentInput = {
    category: body.category,
    title,
    summary,
    document_code: documentCode,
    document_type: documentType,
    revision,
    effective_date: effectiveDate,
    status,
    storage_path: path,
    original_filename: fileName,
    external_url: external,
    sort_order: order as number,
    published_at: status === 'published' ? now : null,
    updated_at: now
  };
  // Absent keys are removed, not set to undefined, so a status-only edit writes no file column.
  for (const key of ['storage_path', 'original_filename', 'external_url'] as const) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}

export type AnnouncementInput = {
  post_type: 'circular' | 'notice';
  title: string;
  summary: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  published_on: string | null;
  status: ContentStatus;
  attachment_path?: string | null;
  external_url?: string | null;
  expires_at: string | null;
  published_at: string | null;
  updated_at: string;
};

export function validAnnouncementInput(body: Record<string, unknown>): AnnouncementInput | null {
  // The panel sends `kind: 'announcement'` as the API discriminator and `type` for the post,
  // so accept either spelling of circular/notice here.
  const requested = body.type ?? body.kind;
  const kind = requested === 'circular' || requested === 'notice' ? requested : null;
  if (!kind) return null;
  const title = text(body.title, MAX.title);
  if (!title) return null;

  const summary = optionalText(body.summary, MAX.shortSummary);
  const bodyText = optionalText(body.body, MAX.body);
  const path = 'filePath' in body ? storagePath(body.filePath) : undefined;
  const external = 'externalUrl' in body ? validExternalUrl(body.externalUrl) : undefined;
  const publishedOn = isoDate(body.publishedOn);
  const expiresAt = isoDateTime(body.expiresAt);
  if (summary === undefined || bodyText === undefined) return null;
  if (path === undefined && 'filePath' in body) return null;
  if (external === undefined && 'externalUrl' in body) return null;
  if (publishedOn === undefined || expiresAt === undefined) return null;

  const priority: AnnouncementInput['priority'] = body.priority === 'important' || body.priority === 'urgent' ? body.priority : 'normal';
  const status = statusOf(body.status, ['draft', 'published', 'archived'], 'draft') as ContentStatus | null;
  if (!status) return null;

  const now = new Date().toISOString();
  const row: AnnouncementInput = {
    post_type: kind,
    title,
    summary: summary ?? '',
    body: bodyText ?? '',
    priority,
    published_on: publishedOn ?? now.slice(0, 10),
    status,
    attachment_path: path,
    external_url: external,
    expires_at: expiresAt,
    published_at: status === 'published' ? now : null,
    updated_at: now
  };
  for (const key of ['attachment_path', 'external_url'] as const) {
    if (row[key] === undefined) delete row[key];
  }
  return row;
}

export type EventInput = {
  title: string;
  topic: string | null;
  description: string;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  published_at: string | null;
  updated_at: string;
};

export function validEventInput(body: Record<string, unknown>): EventInput | null {
  const title = text(body.title, MAX.title);
  if (!title) return null;
  const topic = optionalText(body.topic, MAX.topic);
  const description = optionalText(body.description, MAX.body);
  const venue = optionalText(body.venue, MAX.venue);
  const startsAt = isoDateTime(body.startsAt);
  const endsAt = isoDateTime(body.endsAt);
  if (topic === undefined || description === undefined || venue === undefined) return null;
  if (startsAt === undefined || endsAt === undefined) return null;
  if (!startsAt) return null;
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) return null;

  const status = statusOf(body.status, ['draft', 'published', 'cancelled', 'completed'], 'draft');
  if (!status) return null;

  const now = new Date().toISOString();
  return {
    title,
    topic,
    description: description ?? '',
    starts_at: startsAt,
    ends_at: endsAt,
    venue,
    status: status as EventInput['status'],
    published_at: status === 'published' ? now : null,
    updated_at: now
  };
}
