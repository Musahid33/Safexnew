/**
 * Navigation tree for the SafetyOS console.
 *
 * The design file puts every panel of a module on one long scrolling page — Training
 * Management alone stacks summary, two charts, single entry, bulk entry, directory,
 * employee details, materials and the incident tracker. That is a lot to hunt through,
 * so each of those panels becomes an addressable sub-section here and the sidebar expands
 * to show them.
 *
 * `id` values are stable and used as the route key, so they are safe to deep-link to
 * later. Labels and grouping follow the design's own headings rather than inventing new
 * vocabulary.
 */

export type SubSection = {
  id: string;
  label: string;
  /** Specified in the design but not ported yet. */
  pending?: boolean;
};

export type NavSection = {
  id: string;
  icon: string;
  label: string;
  /** The design itself marks these "Coming Soon" — they have no content to port. */
  comingSoon?: boolean;
  group: 'WORKSPACE' | 'OPERATIONS' | 'ADMIN';
  children: SubSection[];
};

export const NAV: NavSection[] = [
  {
    id: 'dashboard', icon: 'i-dashboard', label: 'Dashboard', comingSoon: true, group: 'WORKSPACE',
    children: []
  },
  {
    id: 'analytics', icon: 'i-chart', label: 'View & Analytics', comingSoon: true, group: 'WORKSPACE',
    children: []
  },
  {
    id: 'cases', icon: 'i-briefcase', label: 'Case Management', group: 'WORKSPACE',
    children: [
      { id: 'overview', label: 'Case Summary', pending: true },
      { id: 'entry', label: 'New Case Report', pending: true },
      { id: 'all', label: 'All Reports', pending: true },
      { id: 'charts', label: 'Trends & Charts', pending: true }
    ]
  },
  {
    id: 'training', icon: 'i-cap', label: 'Training Management', group: 'WORKSPACE',
    children: [
      { id: 'overview', label: 'Training Summary', pending: true },
      { id: 'entry', label: 'Training Entry', pending: true },
      { id: 'bulk', label: 'Bulk Entry', pending: true },
      { id: 'directory', label: 'Training Directory', pending: true },
      { id: 'employee', label: 'Employee Training Details', pending: true },
      { id: 'materials', label: 'Training Materials', pending: true },
      { id: 'certificates', label: 'Certificates', pending: true },
      { id: 'tracker', label: 'Incident Learning Tracker', pending: true }
    ]
  },
  {
    id: 'employees', icon: 'i-users', label: 'Employee Profile', group: 'WORKSPACE',
    children: [
      { id: 'directory', label: 'Master Records' },
      { id: 'profile', label: 'Profile Details' },
      { id: 'entry', label: 'Create / Edit Profile' }
    ]
  },
  {
    id: 'comms', icon: 'i-message', label: 'Communications', group: 'OPERATIONS',
    children: [
      { id: 'overview', label: 'Published So Far', pending: true },
      { id: 'entry', label: 'Create Communication', pending: true },
      { id: 'preview', label: 'Front Page Preview', pending: true },
      { id: 'all', label: 'All Communications', pending: true }
    ]
  },
  {
    id: 'documents', icon: 'i-book', label: 'Documents & Library', group: 'OPERATIONS',
    children: [
      { id: 'overview', label: 'Document Summary', pending: true },
      { id: 'entry', label: 'Add a Document', pending: true },
      { id: 'all', label: 'All Documents', pending: true }
    ]
  },
  {
    id: 'audit', icon: 'i-clipboard', label: 'Audit & Inspection', group: 'OPERATIONS',
    children: [
      { id: 'overview', label: 'Audit Overview', pending: true },
      { id: 'audit-form', label: 'Audit Form', pending: true },
      { id: 'inspection-form', label: 'Inspection Form', pending: true },
      { id: 'builder', label: 'Form Builder', pending: true },
      { id: 'records', label: 'Latest Records', pending: true }
    ]
  },
  {
    id: 'dm', icon: 'i-folder', label: 'Daily Management', group: 'OPERATIONS',
    children: [
      { id: 'focus', label: 'Shift Safety Focus', pending: true },
      { id: 'huddles', label: 'Huddles & Actions', pending: true }
    ]
  },
  {
    id: 'access', icon: 'i-users', label: 'User Access Management', comingSoon: true, group: 'ADMIN',
    children: []
  },
  {
    id: 'exports', icon: 'i-download', label: 'Export Reports', group: 'ADMIN',
    children: [
      { id: 'directory', label: 'Directory CSV', pending: true },
      { id: 'history', label: 'Employee History CSV', pending: true },
      { id: 'cases', label: 'Case Reports CSV', pending: true },
      { id: 'snapshot', label: 'Full Snapshot', pending: true }
    ]
  },
  {
    id: 'settings', icon: 'i-settings', label: 'System Settings', group: 'ADMIN',
    children: [
      { id: 'defaults', label: 'Workspace Defaults', pending: true }
    ]
  }
];

export const GROUP_ORDER: NavSection['group'][] = ['WORKSPACE', 'OPERATIONS', 'ADMIN'];

export function findSection(id: string): NavSection | undefined {
  return NAV.find((section) => section.id === id);
}

export function defaultSubSection(section: NavSection): string {
  return section.children[0]?.id ?? '';
}

export function findSubSection(sectionId: string, subId: string): SubSection | undefined {
  return findSection(sectionId)?.children.find((child) => child.id === subId);
}
