export type Language = 'en' | 'hi' | 'or' | 'bn' | 'pa' | 'mr';
export type ReportType = 'Near Miss' | 'Hazard' | 'Safety Observation' | 'Unsafe Condition' | 'Unsafe Act' | 'Feedback' | 'Grievance' | 'Speak Up' | 'Suggestion';
export type ReportStatus = 'Open' | 'In Progress' | 'Closed';
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
};
