import type { Site } from './types';

export const WEST_BOKARO_SITE: Site = {
  id: 'west-bokaro', name: 'West Bokaro (WBD)', region: 'Jharkhand', sosNumber: null
};

/** Preserve the configured directory key and emergency contact; never relabel another site. */
export function selectableSites(sites: Site[]): Site[] {
  const matches = (value: string) => /^(west bokaro(?: wbd| division)?|wbd)$/.test(
    value.toLowerCase().replace(/[-_()]/g, ' ').replace(/\s+/g, ' ').trim()
  );
  const site = sites.find((entry) => matches(entry.id) || matches(entry.name));
  return [{ ...(site ?? WEST_BOKARO_SITE), name: WEST_BOKARO_SITE.name }];
}
