/**
 * Translation between the stored report row and the admin console's case shape.
 *
 * Kept out of the component (and free of React) so the mapping — the part that decides
 * whether a report shows up under the right category, status and severity — can be tested
 * directly. A wrong map here is silent: the console still renders, it just tells the wrong
 * story about someone's safety report.
 */

/** A report as /api/admin/reports returns it. */
export type AdminReport = {
  reportRef: string;
  type: string;
  category: string | null;
  anonymous: boolean;
  area: string | null;
  department: string | null;
  occurredAt: string | null;
  submittedAt: string | null;
  severity: string | null;
  shortDescription: string | null;
  description: string | null;
  immediateAction: string | null;
  status: string;
  reporterName: string | null;
  reporterNumber: string | null;
};

/** The shape the design's Case Management screen expects. */
export type DesignCaseReport = {
  id: string;
  category: string;
  title: string;
  location: string;
  reporter: string;
  department: string;
  /** YYYY-MM-DD — the design filters and sorts on this string. */
  date: string;
  priority: string;
  status: string;
  owner: string;
  anonymous: boolean;
  description: string;
  immediateAction: string;
  followUp: string;
  direct: boolean;
  /** Employee number, so the console can link a report to its employee profile. */
  employeeId?: string;
};

/**
 * Worker-facing report types are stored as keys; the console filters by its own category
 * names. `unsafe_condition` and `unsafe_act` are safety observations from the worker's
 * side, so they land in the same console category.
 */
export const CASE_CATEGORY: Record<string, string> = {
  near_miss: 'Near Miss',
  hazard: 'Hazard',
  safety_observation: 'Safety Observations',
  unsafe_condition: 'Safety Observations',
  unsafe_act: 'Safety Observations',
  feedback: 'Feedback',
  suggestion: 'Suggestions',
  speak_up: 'Speak Up',
  grievance: 'Grievances'
};

export const CASE_STATUS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  closed: 'Closed'
};

export type DbReportStatus = 'open' | 'in_progress' | 'closed';

/**
 * The design offers five statuses, the database three. "In Review" is work in progress and
 * "Resolved" is closed as far as the stored record is concerned, so they map onto the
 * closest real state instead of inventing columns the rest of the app does not read.
 */
export const CASE_STATUS_DB: Record<string, DbReportStatus> = {
  Open: 'open',
  'In Review': 'in_progress',
  'In Progress': 'in_progress',
  Resolved: 'closed',
  Closed: 'closed'
};

export function toCaseReport(report: AdminReport): DesignCaseReport {
  const description = (report.description ?? '').trim();
  const title = (report.shortDescription ?? description).trim().slice(0, 120) || 'Untitled report';
  const submitted = (report.submittedAt ?? report.occurredAt ?? '').slice(0, 10);
  const anonymous = Boolean(report.anonymous);
  const record: DesignCaseReport = {
    id: report.reportRef,
    // An unknown type keeps its raw key so it is visible under "All Reports" instead of
    // being filed under a category that does not describe it.
    category: CASE_CATEGORY[report.type] ?? report.type,
    title,
    location: report.area?.trim() || 'Not recorded',
    reporter: anonymous ? 'Anonymous' : report.reporterName?.trim() || 'Not stated',
    department: anonymous ? 'Confidential' : report.department?.trim() || '—',
    date: submitted || new Date().toISOString().slice(0, 10),
    // Untriaged reports stay visibly untriaged rather than defaulting to a severity nobody
    // chose.
    priority: report.severity?.trim() || 'Not set',
    status: CASE_STATUS[report.status] ?? 'Open',
    owner: 'Unassigned',
    anonymous,
    description,
    immediateAction: report.immediateAction ?? '',
    followUp: '',
    direct: false
  };
  // Employee numbers are the console's profile key. Anonymous rows leave the key off
  // entirely, so nothing downstream can accidentally re-attach an identity.
  if (!anonymous && report.reporterNumber) record.employeeId = report.reporterNumber;
  return record;
}
