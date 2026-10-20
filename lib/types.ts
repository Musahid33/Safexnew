export type Language = 'en' | 'hi' | 'or' | 'bn' | 'pa' | 'mr';
export type ReportType = 'Near Miss' | 'Hazard' | 'Safety Observation' | 'Unsafe Condition' | 'Unsafe Act' | 'Feedback' | 'Grievance' | 'Speak Up' | 'Suggestion';
export type ReportStatus = 'Open' | 'In Progress' | 'Closed';
/**
 * Why the employee directory could not answer. Shown to operators instead of the generic
 * "keys are not configured" hint, which was wrong whenever the database was simply down.
 */
export type DirectoryUnavailableReason =
  | 'keys_missing'
  | 'database_unreachable'
  | 'tenant_unresolved'
  | 'no_sites'
  | 'empty_directory'
  | 'snapshot_unreadable';

export type Site = {
  id: string;
  name: string;
  region: string;
  sosNumber: string | null;
};
export type Employee = {
  id: string;
  empNo: string;
  name: string;
  designation: string;
  siteId: string;
  /** Non-sensitive work context released by the server lookup. Absent when unavailable. */
  department?: string | null;
  skillGrade?: string | null;
  /**
   * Safety credential number. Only present when the deployment has explicitly opted in
   * with the server-only SAFEX_PUBLIC_SAFETY_PASS flag; never returned by default.
   */
  safetyPassNo?: string | null;
  /** The public lookup only matches active employees; carried through for the badge. */
  active?: boolean;
};
export type SafetyReport = {
  id: string;
  type: ReportType;
  siteId: string;
  area: string;
  category?: string | null;
  department?: string | null;
  incidentAt?: string | null;
  severity?: 'Low' | 'Medium' | 'High' | null;
  immediateAction?: string | null;
  description?: string;
  shortDescription: string;
  status: ReportStatus;
  reportedAt: string;
  reporterEmpNo: string | null;
  anonymous: boolean;
  hasAttachment: boolean;
  syncState?: 'queued' | 'synced' | 'needs-attention';
  clientSubmissionId?: string;
};
export type ThemeMode = 'system' | 'light' | 'dark';
export type Palette = 'safex' | 'ocean' | 'forest' | 'contrast';
export type TenantFeatures = {
  voiceReporting: boolean;
  trainingManagement: boolean;
  library: boolean;
  circulars: boolean;
  rewardWall: boolean;
  pushNotifications: boolean;
};
export type TenantBranding = {
  companyName: string;
  companyAddress: string | null;
  email: string | null;
  mobile: string | null;
  logoPath: string | null;
  features: TenantFeatures;
  /** Optional admin-managed About Us and support fields; absent in the synthetic demo tenant. */
  companyIntroduction?: string | null;
  services?: string[];
  website?: string | null;
  supportEmail?: string | null;
  supportMobile?: string | null;
  privacyPolicyUrl?: string | null;
  termsAndConditionsUrl?: string | null;
};
