import type { TenantBranding } from './types';

/**
 * Which optional areas the worker app shows.
 *
 * These are switches, not sample content: turning one on does not invent a single row. With
 * the demo datasets removed, a section that is enabled but has no published records shows an
 * empty state instead of an example.
 */
export const APP_FEATURES: TenantBranding['features'] = {
  voiceReporting: true,
  trainingManagement: true,
  library: true,
  circulars: true,
  rewardWall: true,
  pushNotifications: true
};

/**
 * Branding for the pages that take a company object.
 *
 * Only the company name is real today (it comes from the tenant row through
 * `/api/bootstrap`). Everything else stays explicitly unset so the screens say "not
 * configured" rather than filling the gap with a demo address or email.
 */
export function brandingFor(companyName: string | null | undefined): TenantBranding {
  return {
    companyName: (companyName ?? '').trim(),
    companyAddress: null,
    email: null,
    mobile: null,
    logoPath: null,
    features: APP_FEATURES
  };
}
