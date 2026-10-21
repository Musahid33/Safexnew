/**
 * Human-readable report references.
 *
 * Reports used to be stored as `OFFLINE-<submission uuid>`, which is what the worker saw in the
 * app: a 40-character id that said nothing about the report. A reference now carries what it
 * is — `NM-72138A64` for a Near Miss — and stays short enough to say out loud in a meeting.
 *
 * The suffix is derived from the submission id, not from a counter, on purpose: the client
 * retries a queued report with the same submission id, so the same reference is computed every
 * time and the existing `unique (tenant_id, report_ref)` row is found instead of duplicated.
 */

const PREFIXES: Record<string, string> = {
  near_miss: 'NM',
  hazard: 'HZ',
  safety_observation: 'SO',
  unsafe_condition: 'UC',
  unsafe_act: 'UA',
  speak_up: 'SU',
  grievance: 'GR',
  feedback: 'FB',
  suggestion: 'SG'
};

/** Legacy references produced before this module existed. */
export const LEGACY_REF_PREFIX = 'OFFLINE-';

const SUFFIX_LENGTH = 8;

export function reportRefPrefix(dbType: string): string {
  return PREFIXES[dbType] ?? 'RP';
}

/**
 * The stable part of a reference: the first eight alphanumerics of the submission id, upper
 * case, padded so a short id still yields a readable reference.
 */
export function reportRefCode(submissionId: string): string {
  const cleaned = submissionId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (cleaned.slice(0, SUFFIX_LENGTH) || '00000000').padEnd(SUFFIX_LENGTH, '0');
}

export function buildReportRef(dbType: string, submissionId: string): string {
  return `${reportRefPrefix(dbType)}-${reportRefCode(submissionId)}`;
}

/** The app's own report type names, mapped to the database vocabulary. */
const UI_TYPE_TO_DB: Record<string, string> = {
  'Near Miss': 'near_miss',
  Hazard: 'hazard',
  'Safety Observation': 'safety_observation',
  'Unsafe Condition': 'unsafe_condition',
  'Unsafe Act': 'unsafe_act',
  'Speak Up': 'speak_up',
  Grievance: 'grievance',
  Feedback: 'feedback',
  Suggestion: 'suggestion'
};

/**
 * The reference a queued report will receive once it reaches the database.
 *
 * The submission id is already fixed on this device, so the reference can be shown before the
 * sync happens — and it is the same string afterwards. No `LOCAL-…` placeholder that changes
 * the moment the report is saved.
 */
export function reportRefForType(type: string, submissionId: string): string {
  return buildReportRef(UI_TYPE_TO_DB[type] ?? type, submissionId);
}

/**
 * What the app should show for a stored reference.
 *
 * Rows written before this change are still stored as `OFFLINE-<uuid>`. They are not rewritten
 * in place (a migration does that separately), so the display is derived here. Both routes use
 * this so a reference never changes just because it was read from a different screen.
 */
export function displayReportRef(storedRef: string, dbType: string): string {
  const stored = (storedRef ?? '').trim();
  if (!stored) return buildReportRef(dbType, '');
  if (!stored.startsWith(LEGACY_REF_PREFIX)) return stored;
  return buildReportRef(dbType, stored.slice(LEGACY_REF_PREFIX.length));
}
