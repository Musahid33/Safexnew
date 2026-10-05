'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import '@/app/safetyos.css';
import '@/app/safetyos-nav.css';
import SafetyOsIcons from './SafetyOsIcons';
import EmployeeProfilePage from './EmployeeProfilePage';
import ComingSoonPage from './ComingSoonPage';
import { GROUP_ORDER, NAV, defaultSubSection, findSection, findSubSection } from './nav';
import type { Site } from '@/lib/types';

/**
 * The SafetyOS admin / safety-officer console.
 *
 * Ported from the design file. The design puts every panel of a module on one scrolling
 * page; here each panel is an addressable sub-section reached from an expanding sidebar,
 * so Training Management is eight destinations rather than one long scroll.
 */

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
  const [sectionId, setSectionId] = useState('employees');
  const [subId, setSubId] = useState('directory');
  const [expanded, setExpanded] = useState<string[]>(['employees']);
  const [navOpen, setNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileWrap = useRef<HTMLDivElement>(null);

  const currentSite = sites.find((site) => site.id === selectedSiteId) ?? sites[0] ?? null;
  const section = findSection(sectionId);
  const sub = findSubSection(sectionId, subId);

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

  function openSection(id: string) {
    const target = findSection(id);
    if (!target || target.comingSoon) return;
    setSectionId(id);
    setSubId(defaultSubSection(target));
    setExpanded((open) => (open.includes(id) ? open : [...open, id]));
    setNavOpen(false);
  }

  function toggleExpanded(id: string) {
    setExpanded((open) => (open.includes(id) ? open.filter((value) => value !== id) : [...open, id]));
  }

  const grouped = useMemo(
    () => GROUP_ORDER.map((group) => ({ group, items: NAV.filter((item) => item.group === group) })),
    []
  );

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
            {grouped.map(({ group, items }) => (
              <div key={group}>
                <div className="nav-group-label">{group}</div>
                {items.map((item) => {
                  const isOpen = expanded.includes(item.id);
                  const isCurrent = sectionId === item.id;
                  const hasChildren = item.children.length > 0;
                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        className={`nav-link ${item.comingSoon ? 'coming-soon' : ''} ${isCurrent ? 'active' : ''}`}
                        disabled={item.comingSoon}
                        aria-disabled={item.comingSoon || undefined}
                        aria-expanded={hasChildren ? isOpen : undefined}
                        title={item.comingSoon ? `${item.label} — Coming soon` : item.label}
                        onClick={() => {
                          if (item.comingSoon) return;
                          if (isCurrent && hasChildren) toggleExpanded(item.id);
                          else openSection(item.id);
                        }}
                      >
                        <svg className="icon"><use href={`#${item.icon}`} /></svg>
                        <span>{item.label}</span>
                        {item.comingSoon && <span className="nav-status">Coming Soon</span>}
                        {hasChildren && !item.comingSoon && (
                          <svg className="icon caret"><use href="#i-chevron-right" /></svg>
                        )}
                      </button>

                      {hasChildren && isOpen && (
                        <div className="nav-sub">
                          {item.children.map((child) => (
                            <button
                              key={child.id}
                              type="button"
                              className={`nav-sub-link ${isCurrent && subId === child.id ? 'active' : ''}`}
                              onClick={() => { setSectionId(item.id); setSubId(child.id); setNavOpen(false); }}
                            >
                              <span className="dot" aria-hidden="true" />
                              <span>{child.label}</span>
                              {child.pending && <span className="sub-pending">Soon</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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

          {sectionId === 'employees' && !sub?.pending ? (
            <EmployeeProfilePage
              sites={sites}
              selectedSiteId={selectedSiteId}
              subSection={subId}
              breadcrumb={`${section?.label ?? ''} · ${sub?.label ?? ''}`}
              onNavigate={setSubId}
            />
          ) : (
            <ComingSoonPage
              title={sub?.label ?? section?.label ?? 'SafetyOS'}
              parent={section?.label ?? ''}
              icon={section?.icon ?? 'i-layout'}
              designed={!section?.comingSoon}
            />
          )}
        </div>
      </div>
    </div>
  );
}
