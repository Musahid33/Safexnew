/**
 * Life Saving Rules shown in the worker app's Life Saving Rule popup.
 *
 * These are the site-level, non-negotiable rules the Safety team expects everyone on site
 * to follow, listed on the Life Saving Rules poster for West Bokaro (WBD).
 *
 * ⚠️ Confirm the wording against the site's approved poster before launch. The text below
 * follows the standard Life Saving Rules set used across Indian heavy industry; if the
 * poster words a rule differently, edit it here — this module is the single source of
 * truth for the popup and nothing else needs to change.
 */

export type LifeSavingRule = {
  /** Stable key, also used for the numbered badge. */
  id: string;
  title: string;
  /** What the rule means in practice on site. */
  detail: string;
};

export const LIFE_SAVING_RULES: LifeSavingRule[] = [
  {
    id: 'permit',
    title: 'Work only with a valid permit',
    detail: 'Check the permit covers the job, the area and the time. Stop if the conditions on it do not match the work.'
  },
  {
    id: 'isolation',
    title: 'Verify isolation before starting work',
    detail: 'Confirm energy sources are isolated, locked and tagged (LOTO), and that stored energy has been released.'
  },
  {
    id: 'gas-test',
    title: 'Take a gas test before hot work or confined space entry',
    detail: 'No gas test, no work. Keep monitoring the atmosphere while the job is running.'
  },
  {
    id: 'height',
    title: 'Use fall protection when working at height',
    detail: 'Full body harness with a double lanyard, anchored above the work position. Guard rails and scaffolds must be certified.'
  },
  {
    id: 'line-of-fire',
    title: 'Stay clear of suspended and moving loads',
    detail: 'Never walk or stand under a suspended load. Keep out of the line of fire and respect barricaded zones.'
  },
  {
    id: 'confined-space',
    title: 'Enter confined space only with authorisation and a standby person',
    detail: 'Approved entry permit, tested atmosphere, rescue arrangement in place and an attendant at the entry throughout.'
  },
  {
    id: 'driving',
    title: 'Follow safe driving rules',
    detail: 'Seat belt on, no mobile phone, no speeding, no overtaking on blind stretches, and follow the site traffic plan.'
  },
  {
    id: 'alcohol',
    title: 'No alcohol or drugs on duty',
    detail: 'Reporting to work under the influence is not acceptable, and entry to site will be refused.'
  },
  {
    id: 'ppe',
    title: 'Wear the correct PPE and use the right tools',
    detail: 'Use the PPE and tools specified for the task. Never bypass, remove or defeat a safety device or guard.'
  },
  {
    id: 'stop-work',
    title: 'Stop work when it is unsafe — and report it',
    detail: 'Anyone can stop an unsafe job without fear of consequence. Report every incident, near miss and unsafe condition.'
  }
];

/** Rules for one site. Currently one site is live, so every site shows the same list. */
export function lifeSavingRulesForSite(siteId: string): LifeSavingRule[] {
  void siteId;
  return LIFE_SAVING_RULES;
}
