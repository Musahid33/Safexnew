export const SAFETY_ALERT_FILTERS = [
  'All',
  'Fatal',
  'LTI',
  'Medical Case',
  'Burn Injury',
  'First Aid',
  'Red Risk',
  'Property Damage',
  'Other'
] as const;

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
 * Published incident alerts.
 *
 * No alert feed is connected yet, so this stays empty and the screen says so instead of
 * showing invented incidents.
 */
export const SAFETY_ALERTS: SafetyAlert[] = [];
