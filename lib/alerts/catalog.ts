/**
 * The safety-alert vocabulary, shared by the console, the API and the worker app.
 *
 * `category_key` in the database is a slug (`first_aid`), while the app shows the label
 * (`First Aid`). Both spellings live here so the two can never drift apart, and converting an
 * unknown key is a compile error rather than a silently unstyled chip.
 */

export const ALERT_CATEGORIES = [
  'Fatal',
  'LTI',
  'Medical Case',
  'Burn Injury',
  'First Aid',
  'Red Risk',
  'Property Damage',
  'Other'
] as const;

export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

/** Severity ordering used by the app's filters; the most serious first. */
export const ALERT_CATEGORY_KEYS: Record<AlertCategory, string> = {
  Fatal: 'fatal',
  LTI: 'lti',
  'Medical Case': 'medical_case',
  'Burn Injury': 'burn_injury',
  'First Aid': 'first_aid',
  'Red Risk': 'red_risk',
  'Property Damage': 'property_damage',
  Other: 'other'
};

/** The database key for a label, or null when the label is not one of ours. */
export function alertCategoryKey(label: unknown): string | null {
  if (typeof label !== 'string') return null;
  const match = (Object.entries(ALERT_CATEGORY_KEYS) as Array<[AlertCategory, string]>)
    .find(([name]) => name.toLowerCase() === label.trim().toLowerCase());
  return match ? match[1] : null;
}

/** The label for a stored key. An unknown key reads as `Other`, never as a raw slug. */
export function alertCategoryLabel(key: unknown): AlertCategory {
  if (typeof key !== 'string') return 'Other';
  const match = (Object.entries(ALERT_CATEGORY_KEYS) as Array<[AlertCategory, string]>)
    .find(([, stored]) => stored === key.trim().toLowerCase());
  return match ? match[0] : 'Other';
}
