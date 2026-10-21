import { APP_TIME_ZONE } from '@/lib/home-content';

/**
 * The document register's shared rules.
 *
 * A shelf shows a document's department, section, number, revision and the date it stays valid
 * up to. "Valid up to" is `documents.review_due_date`; the status chip is derived from it here
 * so the app and the tests agree on where the boundary sits.
 */

export type RegisterValidityKey = 'valid' | 'due' | 'expired';
export type RegisterValidity = { key: RegisterValidityKey; label: string };

/** A document inside 30 days of its review date is flagged before it expires. */
export const REVIEW_SOON_DAYS = 30;

/** Today as `yyyy-mm-dd` in the site's time zone — never the browser's. */
export function registerToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

/** `yyyy-mm-dd` (or an ISO timestamp) → `dd-mm-yyyy`, the register's format. */
export function registerDate(value: string | null): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

export function registerValidity(validUpto: string | null, today: string = registerToday()): RegisterValidity {
  // A published document with no review date has not expired — publishing is the approval.
  // Only a date that is actually set can make it due or expired, so the register reads
  // "Valid" rather than an empty-looking status.
  if (!validUpto) return { key: 'valid', label: 'Valid' };
  const value = validUpto.slice(0, 10);
  if (value < today) return { key: 'expired', label: 'Expired' };
  const boundary = new Date(`${today}T00:00:00Z`);
  boundary.setUTCDate(boundary.getUTCDate() + REVIEW_SOON_DAYS);
  if (value <= boundary.toISOString().slice(0, 10)) return { key: 'due', label: 'Due soon' };
  return { key: 'valid', label: 'Valid' };
}
