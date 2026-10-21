import type { Site } from './types';
import { SOS_NUMBER } from './emergency';

/**
 * The worker app runs against one site.
 *
 * The row itself comes from the database through `/api/bootstrap`; nothing is invented when
 * that answer is empty. The only value this function supplies is the company emergency
 * number, and only when the site has not been given one of its own.
 */
export function selectableSites(sites: Site[]): Site[] {
  const matches = (value: string) => /^(west bokaro(?: wbd| division)?|wbd)$/.test(
    value.toLowerCase().replace(/[-_()]/g, ' ').replace(/\s+/g, ' ').trim()
  );
  // The named site wins; a tenant with exactly one site uses that row rather than being
  // treated as unconfigured because its name is spelled differently. The name is never
  // rewritten — it is whatever the database says.
  const site = sites.find((entry) => matches(entry.id) || matches(entry.name))
    ?? (sites.length === 1 ? sites[0] : null);
  if (!site) return [];
  return [{
    ...site,
    sosNumber: site.sosNumber?.trim() || SOS_NUMBER
  }];
}
