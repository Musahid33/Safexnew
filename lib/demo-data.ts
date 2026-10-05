import { WEST_BOKARO_SITE } from './site-config';
import type { SafetyReport, Site, TenantBranding } from './types';

/** DEMO ONLY. Production values are created by Safex Super Admin during tenant onboarding. */
export const DEMO_TENANT: TenantBranding & { slug: string; demoMode: boolean } = {
  companyName: 'EMVEESS Safety',
  companyAddress: null,
  email: null,
  mobile: null,
  logoPath: null,
  slug: 'emveess',
  demoMode: true,
  features: {
    voiceReporting: true,
    trainingManagement: true,
    library: true,
    circulars: true,
    rewardWall: true,
    pushNotifications: true
  }
};

/** Real emergency contacts were not provided; null is intentionally safe. */
export const DEMO_SITES: Site[] = [WEST_BOKARO_SITE];

/** No sample reports tied to invented employees. */
export const DEMO_REPORTS: SafetyReport[] = [];
