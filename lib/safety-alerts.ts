import { ALERT_CATEGORIES } from './alerts/catalog';

export const SAFETY_ALERT_FILTERS = ['All', ...ALERT_CATEGORIES] as const;

export type SafetyAlertCategory = Exclude<(typeof SAFETY_ALERT_FILTERS)[number], 'All'>;

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
};

/**
 * Built-in alerts.
 *
 * Deliberately empty: real alerts are published from the console into `public.safety_alerts`
 * and read back through `/api/alerts?site=<slug|uuid>`. This array stays only as the offline
 * fallback, so an unreachable backend shows the empty state rather than invented incidents.
 */
export const SAFETY_ALERTS: SafetyAlert[] = [];
