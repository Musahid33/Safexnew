import { alertCategoryKey } from './catalog';

/**
 * Input validation for a published safety alert.
 *
 * Returns the exact column object the store writes, or null — the same discipline as the
 * document and announcement validators, so the console, the API and the tests cannot disagree
 * about what a valid alert looks like. Nothing reaches the database unchecked.
 */

const MAX = {
  title: 160,
  reference: 40,
  area: 120,
  department: 120,
  description: 5000,
  rootCause: 2000,
  bullet: 300,
  bullets: 12
};

export type AlertInput = {
  alert_reference: string | null;
  category_key: string;
  headline: string;
  incident_at: string;
  area_label: string | null;
  department_name: string | null;
  description: string;
  root_cause: string | null;
  immediate_response: string[];
  corrective_actions: string[];
  lessons_learned: string[];
  status: 'draft' | 'published' | 'archived';
  published_at: string | null;
  updated_at: string;
};

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

function timestamp(value: unknown): string | null | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * A bullet list. The console sends one line per bullet; an array is accepted too so the API
 * can be called directly. Blank lines are dropped, not stored as empty bullets.
 */
function bullets(value: unknown): string[] | null {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : null;
  if (!raw) return null;
  const cleaned: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return null;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX.bullet) return null;
    cleaned.push(trimmed);
    if (cleaned.length > MAX.bullets) return null;
  }
  return cleaned;
}

export function validAlertInput(body: Record<string, unknown>): AlertInput | null {
  const category = alertCategoryKey(body.category ?? body.categoryKey);
  if (!category) return null;

  const headline = text(body.title ?? body.headline, MAX.title);
  if (!headline) return null;

  const description = text(body.description, MAX.description);
  if (!description) return null;

  const incidentAt = timestamp(body.incidentAt ?? body.incident_at);
  if (!incidentAt) return null;

  const reference = optionalText(body.reference ?? body.alertReference ?? body.alert_reference, MAX.reference);
  const area = optionalText(body.area ?? body.areaLabel ?? body.area_label, MAX.area);
  const department = optionalText(body.department ?? body.departmentName ?? body.department_name, MAX.department);
  const rootCause = optionalText(body.rootCause ?? body.root_cause, MAX.rootCause);
  // `undefined` means "sent but unparseable" — reject rather than silently drop the field.
  if (reference === undefined || area === undefined || department === undefined || rootCause === undefined) return null;

  const immediate = bullets(body.immediateResponse ?? body.immediate_response ?? '');
  const corrective = bullets(body.correctiveActions ?? body.corrective_actions ?? '');
  const lessons = bullets(body.lessonsLearned ?? body.lessons_learned ?? '');
  if (!immediate || !corrective || !lessons) return null;

  const status = body.status === 'published' || body.status === 'archived' ? body.status : 'draft';
  const now = new Date().toISOString();

  return {
    alert_reference: reference,
    category_key: category,
    headline,
    incident_at: incidentAt,
    area_label: area,
    department_name: department,
    description,
    root_cause: rootCause,
    immediate_response: immediate,
    corrective_actions: corrective,
    lessons_learned: lessons,
    status,
    // Re-publishing refreshes the timestamp; anything else keeps the stored one.
    published_at: status === 'published' ? now : null,
    updated_at: now
  };
}
