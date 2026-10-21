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
 * The synthetic set that used to live here was removed with the rest of the demo data. No
 * alert feed is connected yet, so this is empty and the screen says so instead of showing
 * invented incidents with invented lessons.
 */
export const SAFETY_ALERTS: SafetyAlert[] = [];
