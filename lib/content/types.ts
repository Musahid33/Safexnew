import type { DocumentType, VaultCategoryKey } from './catalog';

/**
 * The shapes exchanged between the publishing panel, the API and the worker app.
 *
 * The public shapes (`PublishedDocument`, `ContentFeedItem`) are deliberately small: a title, a
 * date, a summary and a link. Drafts, author ids and storage paths never leave the server, so a
 * client cannot tell what has not been published yet.
 */

export type PublishedDocument = {
  id: string;
  category: VaultCategoryKey;
  title: string;
  summary: string | null;
  documentCode: string | null;
  documentType: DocumentType;
  revision: string | null;
  /** Register columns: the department and section the procedure belongs to. */
  department: string | null;
  section: string | null;
  /** ISO date (yyyy-mm-dd) the document takes effect, when one was given. */
  effectiveDate: string | null;
  /** ISO date the document is valid up to (the register's "Valid Upto"). */
  validUpto: string | null;
  /** ISO timestamp the admin published it. */
  publishedAt: string | null;
  /** Stable, same-origin link served by /api/content/file/document/[id]. */
  fileUrl: string | null;
  fileName: string | null;
  /** `application/pdf` / `image/*` when the file was uploaded; null for a link-only row. */
  mimeType: string | null;
  /** True when the row points at an external https link instead of an uploaded file. */
  external: boolean;
};

export type ContentFeedItem = {
  id: string;
  type: 'Event' | 'Circular' | 'Notice';
  title: string;
  /** ISO timestamp. */
  date: string;
  summary: string;
  details: string;
  location?: string;
  /** Present when the post carries a file or a link. */
  attachmentUrl: string | null;
};

export type ContentPayload = {
  documents: PublishedDocument[];
  feed: ContentFeedItem[];
};

export type ContentStatus = 'draft' | 'published' | 'archived';

/** A row as the publishing panel sees it — every field, including the drafts. */
export type AdminDocument = {
  id: string;
  category: VaultCategoryKey;
  title: string;
  summary: string | null;
  documentCode: string | null;
  documentType: DocumentType;
  revision: string | null;
  department: string | null;
  section: string | null;
  effectiveDate: string | null;
  validUpto: string | null;
  status: ContentStatus;
  publishedAt: string | null;
  fileName: string | null;
  fileUrl: string | null;
  sortOrder: number;
  updatedAt: string | null;
};

export type AdminAnnouncement = {
  id: string;
  kind: 'circular' | 'notice';
  title: string;
  summary: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  publishedOn: string | null;
  expiresAt: string | null;
  status: ContentStatus;
  attachmentUrl: string | null;
  attachmentName: string | null;
  updatedAt: string | null;
};

export type AdminEvent = {
  id: string;
  title: string;
  topic: string | null;
  description: string;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  status: 'draft' | 'published' | 'cancelled' | 'completed';
  publishedAt: string | null;
  updatedAt: string | null;
};

export type AdminContentKind = 'document' | 'announcement' | 'event';
