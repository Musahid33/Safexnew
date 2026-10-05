'use client';

import { useEffect, useRef, useState } from 'react';
import '@/app/safetyos.css';
import SafetyOsIcons from './SafetyOsIcons';
import EmployeeProfilePage from './EmployeeProfilePage';
import ComingSoonPage from './ComingSoonPage';
import type { Site } from '@/lib/types';

/**
 * The SafetyOS admin / safety-officer console.
 *
 * Ported from the design file. The shell — sidebar, topbar, page routing — is faithful
 * to the original; pages are being brought over one at a time, starting with Employee
 * Profile because that is the one that has to stop showing invented people.
 */

export type PageKey =
  | 'dashboard' | 'analytics' | 'cases' | 'training' | 'employees'
  | 'comms' | 'documents' | 'audit' | 'dm' | 'access';

type NavItem = {
  key: PageKey;
  icon: string;
  label: string;
  /** Present in the design but not yet built — rendered disabled, as designed. */
  comingSoon?: boolean;
};

const NAV: NavItem[] = [
  { key: 'dashboard', icon: 'i-dashboard', label: 'Dashboard', comingSoon: true },
  { key: 'analytics', icon: 'i-chart', label: 'View & Analytics', comingSoon: true },
  { key: 'cases', icon: 'i-briefcase', label: 'Case Management' },
  { key: 'training', icon: 'i-cap', label: 'Training Management' },
  { key: 'employees', icon: 'i-users', label: 'Employee Profile' },
  { key: 'comms', icon: 'i-message', label: 'Communications' },
  { key: 'documents', icon: 'i-book', label: 'Documents & Library' },
  { key: 'audit', icon: 'i-clipboard', label: 'Audit & Inspection' },
  { key: 'dm', icon: 'i-folder', label: 'DM' },
  { key: 'access', icon: 'i-users', label: 'User Access Management', comingSoon: true }
];

const PAGE_TITLES: Record<PageKey, { title: string; subtitle: string; icon: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'Site-wide safety overview', icon: 'i-dashboard' },
  analytics: { title: 'View & Analytics', subtitle: 'Trends across every module', icon: 'i-chart' },
  cases: { title: 'Case Management', subtitle: 'Incident and investigation records', icon: 'i-briefcase' },
  training: { title: 'Training Management', subtitle: 'Courses, attendance and competency', icon: 'i-cap' },
  employees: { title: 'Employee Profile', subtitle: 'Master employee details and linked records', icon: 'i-users' },
  comms: { title: 'Communications', subtitle: 'Incident communications and circulars', icon: 'i-message' },
  documents: { title: 'Documents & Library', subtitle: 'SOPs, policies and reference material', icon: 'i-book' },
  audit: { title: 'Audit & Inspection', subtitle: 'Checklists, findings and actions', icon: 'i-clipboard' },
  dm: { title: 'Daily Management', subtitle: 'Shift logs and daily safety records', icon: 'i-folder' },
  access: { title: 'User Access Management', subtitle: 'Roles and permissions', icon: 'i-users' }
};

type Props = {
  sites: Site[];
  selectedSiteId: string;
  onChangeSite: () => void;
  canChangeSite: boolean;
  onExit: () => void;
  officerName: string;
  directoryMode: string;
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'SO';
}

export default function SafetyOsConsole({
  sites, selectedSiteId, onChangeSite, canChangeSite, onExit, officerName, directoryMode
}: Props) {
  const [page, setPage] = useState<PageKey>('employees');
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrap = useRef<HTMLDivElement>(null);

  const currentSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;

  useEffect(() => {
    if (!profileOpen) return;
    function onDocumentClick(event: MouseEvent) {
      if (!profileWrap.current?.contains(event.target as Node)) setProfileOpen(false);
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [profileOpen]);

  const heading = PAGE_TITLES[page];

  return (
    <div className="sos">
      <SafetyOsIcons />
      <div className={`app ${navOpen ? 'nav-open' : ''}`} id="app">
        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-mark"><svg className="icon"><use href="#i-shield" /></svg></div>
            <div className="brand-name">Safety<span>OS</span></div>
          </div>
          <nav className="nav-list" aria-label="Main navigation">
            <div className="nav-label">WORKSPACE</div>
            {NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`nav-link ${item.comingSoon ? 'coming-soon' : ''} ${page === item.key ? 'active' : ''}`}
                disabled={item.comingSoon}
                aria-disabled={item.comingSoon || undefined}
                title={item.comingSoon ? `${item.label} — Coming soon` : item.label}
                onClick={() => { setPage(item.key); setNavOpen(false); }}
              >
                <svg className="icon"><use href={`#${item.icon}`} /></svg>
                <span>{item.label}</span>
                {item.comingSoon && <span className="nav-status">Coming Soon</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="system-state">
              <i />
              <span>
                {directoryMode === 'supabase' && 'Supabase · live directory'}
                {directoryMode === 'sheet' && 'Sheet directory · import pending'}
                {directoryMode === 'demo' && 'Demo mode · no master connected'}
                {!['supabase', 'sheet', 'demo'].includes(directoryMode) && 'Directory status unknown'}
              </span>
            </div>
            <div className="side-version">SafetyOS · Safex</div>
          </div>
        </aside>

        <div className="main-shell">
          <header className="topbar">
            <div className="top-left">
              <button type="button" className="mobile-menu" aria-label="Toggle navigation" onClick={() => setNavOpen((open) => !open)}>
                <svg className="icon"><use href="#i-menu" /></svg>
              </button>
              <span className="location-label">Location:</span>
              <button
                type="button"
                className="location-select"
                onClick={onChangeSite}
                disabled={!canChangeSite}
                title={canChangeSite ? 'Change site' : 'Site switching is locked'}
              >
                <svg className="icon"><use href="#i-pin" /></svg>
                <span>{currentSite?.name ?? 'No site'}</span>
                <svg className="icon"><use href="#i-chevron-down" /></svg>
              </button>
            </div>
            <div className="top-tools">
              <div className="top-divider" />
              <div className="profile-menu-wrap" ref={profileWrap}>
                <button
                  type="button"
                  className="profile"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  onClick={() => setProfileOpen((open) => !open)}
                >
                  <span className="avatar">{initials(officerName)}</span>
                  <span className="profile-copy">
                    <strong>{officerName}</strong>
                    <small>Safety Officer</small>
                  </span>
                  <svg className="icon"><use href="#i-chevron-down" /></svg>
                </button>
                {profileOpen && (
                  <div className="profile-menu open" role="menu" aria-label="Officer profile menu">
                    <div className="profile-menu-head">
                      <strong>{officerName}</strong>
                      <small>Safety Officer · {currentSite?.name ?? 'No site'}</small>
                    </div>
                    <button type="button" className="profile-menu-action danger" role="menuitem" onClick={onExit}>
                      <svg className="icon"><use href="#i-logout" /></svg>
                      <span>Exit console</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {page === 'employees' ? (
            <EmployeeProfilePage sites={sites} selectedSiteId={selectedSiteId} />
          ) : (
            <ComingSoonPage
              title={heading.title}
              subtitle={heading.subtitle}
              icon={heading.icon}
              designed={!NAV.find((item) => item.key === page)?.comingSoon}
            />
          )}
        </div>
      </div>
    </div>
  );
}
