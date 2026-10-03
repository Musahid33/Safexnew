import type { Employee, SafetyReport, Site, TenantBranding } from './types';

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
export const DEMO_SITES: Site[] = [
  { id: 'jamshedpur', name: 'Jamshedpur', region: 'Jharkhand', sosNumber: null },
  { id: 'kalinganagar', name: 'Kalinganagar', region: 'Odisha', sosNumber: null },
  { id: 'ludhiana', name: 'Ludhiana', region: 'Punjab', sosNumber: null }
];

/** Synthetic employees only—never use real personal records in demo mode. */
export const DEMO_EMPLOYEES: Employee[] = [
  { id: 'demo-e1', empNo: 'EMP-DEMO-01', name: 'Aman Kumar', designation: 'Safety Helper', siteId: 'kalinganagar' },
  { id: 'demo-e2', empNo: 'EMP-DEMO-02', name: 'Ravi Singh', designation: 'Rigger', siteId: 'kalinganagar' },
  { id: 'demo-e3', empNo: 'EMP-DEMO-03', name: 'Priya Das', designation: 'Technician', siteId: 'jamshedpur' },
  { id: 'demo-e4', empNo: 'EMP-DEMO-04', name: 'S. Pradhan', designation: 'Operator', siteId: 'ludhiana' }
];

export const DEMO_REPORTS: SafetyReport[] = [
  { id: 'RPT-2026-0184', type: 'Near Miss', siteId: 'kalinganagar', area: 'Blast Furnace · Bay 04', shortDescription: 'Crane load nearly swung over a marked work zone.', status: 'In Progress', reportedAt: '2026-10-02T10:42:00+05:30', reporterEmpNo: 'EMP-DEMO-01', anonymous: false, hasAttachment: true },
  { id: 'RPT-2026-0181', type: 'Hazard', siteId: 'kalinganagar', area: 'Raw Material Yard', shortDescription: 'Loose cable crossing the pedestrian route.', status: 'Open', reportedAt: '2026-10-02T09:18:00+05:30', reporterEmpNo: 'EMP-DEMO-02', anonymous: false, hasAttachment: false },
  { id: 'RPT-2026-0176', type: 'Unsafe Condition', siteId: 'kalinganagar', area: 'Conveyor C-2', shortDescription: 'Missing guard rail reported near an access platform.', status: 'Closed', reportedAt: '2026-10-01T16:05:00+05:30', reporterEmpNo: null, anonymous: true, hasAttachment: true },
  { id: 'RPT-2026-0210', type: 'Near Miss', siteId: 'jamshedpur', area: 'Blast Furnace · Bay 2', shortDescription: 'Suspended load moved outside the marked lifting zone.', status: 'In Progress', reportedAt: '2026-10-02T11:20:00+05:30', reporterEmpNo: 'EMP-DEMO-03', anonymous: false, hasAttachment: true },
  { id: 'RPT-2026-0208', type: 'Hazard', siteId: 'ludhiana', area: 'Raw Material Yard', shortDescription: 'A loose cable was found across the pedestrian route.', status: 'Open', reportedAt: '2026-10-02T09:18:00+05:30', reporterEmpNo: 'EMP-DEMO-04', anonymous: false, hasAttachment: false }
];
