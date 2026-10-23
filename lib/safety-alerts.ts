import { ALERT_CATEGORIES } from './alerts/catalog';

export const SAFETY_ALERT_FILTERS = ['All', ...ALERT_CATEGORIES] as const;

export type SafetyAlertCategory = Exclude<(typeof SAFETY_ALERT_FILTERS)[number], 'All'>;

/** The published incident file, served by `/api/alerts/<id>/file`. */
export type SafetyAlertAttachment = {
  /** Same-origin link; the storage URL is never sent to the browser. */
  url: string;
  name: string;
  mimeType: string;
  kind: 'pdf' | 'image';
};

export type SafetyAlert = {
  id: string;
  category: SafetyAlertCategory;
  title: string;
  date: string;
  site: string;
  area: string;
  description: string;
  rootCause: string;
  immediateActions: string[];
  correctiveActions: string[];
  lessonsLearned: string[];
  /** The report PDF or the photo, when one was published with the alert. */
  attachment?: SafetyAlertAttachment | null;
};

/**
 * Built-in alerts.
 *
 * Deliberately empty: real alerts are published from the console into `public.safety_alerts`
 * and read back through `/api/alerts?site=<slug|uuid>`. This array stays only as the offline
 * fallback, so an unreachable backend shows the empty state rather than invented incidents.
 */
export const SAFETY_ALERTS: SafetyAlert[] = [];
