'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import '@/app/safetyos.css';
import '@/app/safetyos-host.css';
import { DESIGN_MARKUP } from './generated/markup';
import { DESIGN_SCRIPT } from './generated/script';
import type { Site } from '@/lib/types';
import DmWorkspace from './dm/DmWorkspace';
import {
  CASE_STATUS, CASE_STATUS_DB, toCaseReport,
  type AdminReport, type DesignCaseReport
} from '@/lib/case-report-view';

/**
 * The Admin / HSE Manager dashboard — the uploaded SafetyOS console, running as designed.
 *
 * `SafetyOS — Employee Profile Preview (2).html` drives 18 screens from ~106 KB of CSS,
 * ~139 KB of markup and ~252 KB of vanilla JS. It is mounted here rather than hand-rewritten
 * in React, so every screen the design ships is present and nothing drifts when the design
 * changes: edit the HTML, run `npm run design:extract`, reload.
 *
 * How the host stays in charge:
 *  - the design's stylesheet is machine-scoped under `.sos`, and the dashboard renders
 *    outside the worker app's `.safex-app` subtree, so neither side restyles the other;
 *  - the design's script is its own IIFE, and the document/window listeners it registers
 *    while starting are recorded and removed again on unmount;
 *  - the roster arrives through the design's employee seam, and only after the same
 *    server-verified operator session that guards /api/admin/employees;
 *  - Case Management, the dashboard KPIs and the analytics counts read the design's
 *    case-report seam, filled from /api/admin/reports — the reports workers actually
 *    submitted — and a status change is written back through that session;
 *  - "Log out", the location selector and the sidebar status line are wired back to the
 *    host, so the console behaves as a screen of this app rather than a separate page;
 *  - the design's empty DM page hosts the Daily Management workspace (a React portal), so
 *    supervisors fill the real plan and file it as a numbered PDF instead of a placeholder.
 */

type Props = {
  sites: Site[];
  selectedSiteId: string;
  onChangeSite: () => void;
  canChangeSite: boolean;
  onExit: () => void;
  /** Role label shown under the officer avatar in the console topbar. */
  officerName: string;
  /** 'supabase' | 'sheet' | 'unavailable' — reported in the console sidebar. */
  directoryMode: string;
};

/** Shape returned by /api/admin/employees. Personal fields only when PII is enabled. */
type AdminEmployee = {
  empNo: string;
  name: string;
  designation: string;
  department: string | null;
  location?: string | null;
  mobile?: string | null;
  bloodGroup?: string | null;
  email?: string | null;
  gender?: string | null;
  dob?: string | null;
  emergencyName?: string | null;
  emergencyMobile?: string | null;
  address?: string | null;
  notes?: string | null;
  previousNames?: string[];
};

/** Shape the design's own directory code expects. */
type DesignEmployee = {
  id: string;
  name: string;
  designation: string;
  department: string;
  location?: string;
  mobile?: string;
  bloodGroup?: string;
  email?: string;
  gender?: string;
  dob?: string;
  emergencyName?: string;
  emergencyMobile?: string;
  address?: string;
  notes?: string;
  photo?: string;
  previousNames?: string[];
};

/**
 * What the design reports after saving or deleting a profile.
 *
 * `previous` is the record as the roster loaded it, so a refused write can be undone
 * exactly rather than approximately.
 */
type EmployeeChange = {
  action: 'create' | 'update' | 'delete';
  record: DesignEmployee;
  previous: DesignEmployee | null;
};

type SessionState = { configured: boolean; signedIn: boolean; piiEnabled?: boolean };
type RosterResult = { rows: DesignEmployee[] } | { error: 'auth' | 'unavailable' };
type ReportsResult = { rows: DesignCaseReport[]; total: number } | { error: 'auth' | 'unavailable' };
type Phase = 'checking' | 'locked' | 'ready';
type DirectoryState = 'live' | 'empty' | 'unavailable';
/** Short-lived message about a write the console attempted. */
type HostNote = { tone: 'pending' | 'ok' | 'error'; text: string };

type HostContext = {
  siteName: string;
  officerRole: string;
  /** Only set when the host has a person's name; otherwise the design's own name stands. */
  officerName: string | null;
  statusLabel: string;
};

declare global {
  interface Window {
    __SAFEX_EMPLOYEES__?: DesignEmployee[];
    __SAFEX_CASE_REPORTS__?: DesignCaseReport[];
    /** Called by the design after its status dropdown mutates a record. */
    __SAFEX_CASE_CHANGED__?: (record: DesignCaseReport, previousStatus: string) => unknown;
    /** Called by the design after a profile is saved or removed; returns a promise. */
    __SAFEX_EMPLOYEE_CHANGED__?: (change: EmployeeChange) => unknown;
  }
}

const PAGE_SIZE = 50;
const MAX_ROSTER = 2000;
const REPORT_PAGE_SIZE = 100;
const MAX_REPORTS = 500;
/** How long a write message stays on screen before it clears itself. */
const NOTE_TTL_MS = 7000;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'SO';
}

/** A role label is not a name — the design ships the officer name it was drawn for. */
function personName(officerName: string): string | null {
  const value = officerName?.trim() ?? '';
  return value.length > 2 && value.includes(' ') && !/^(safety|hse|site|admin)\b/i.test(value) ? value : null;
}

export default function SafetyOsApp({
  sites, selectedSiteId, onChangeSite, canChangeSite, onExit, officerName, directoryMode
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('checking');
  const [roster, setRoster] = useState<DesignEmployee[] | null>(null);
  /**
   * The array the design mounts with. A ref, because the console must not remount every
   * time the roster is updated after a save — that would throw the operator back to the
   * dashboard from the profile they just edited.
   */
  const rosterRef = useRef<DesignEmployee[] | null>(null);
  /** Latest employee writer, so the seam the design holds stays stable across renders. */
  const employeeWriter = useRef<(change: EmployeeChange) => unknown>(() => null);
  const [state, setState] = useState<DirectoryState>('unavailable');
  const [reports, setReports] = useState<DesignCaseReport[] | null>(null);
  const [reportState, setReportState] = useState<DirectoryState>('unavailable');
  const [note, setNote] = useState<HostNote | null>(null);
  /** Kept from /api/admin/session: decides which profile fields may be written. */
  const [piiEnabled, setPiiEnabled] = useState(false);
  /** The design's DM page container, which the React workspace is portalled into. */
  const [dmHost, setDmHost] = useState<HTMLElement | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [gateUsername, setGateUsername] = useState('');
  const [gatePassword, setGatePassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  /**
   * True only when the console must not be shown at all: the server reported that admin
   * auth is not configured. Every other problem (signed out, master source down) keeps
   * a usable screen available.
   */
  const [failClosed, setFailClosed] = useState(false);

  const site = sites.find((entry) => entry.id === selectedSiteId) ?? sites[0] ?? null;
  const context = useRef<HostContext>({ siteName: '', officerRole: '', officerName: null, statusLabel: '' });
  context.current = {
    siteName: site?.name ?? 'No site',
    officerRole: officerName?.trim() || 'Safety Officer',
    officerName: personName(officerName),
    statusLabel: describeDirectory(state, roster?.length ?? 0, directoryMode)
  };

  // A write message is small feedback, not a permanent status line.
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), NOTE_TTL_MS);
    return () => clearTimeout(timer);
  }, [note]);

  // Handlers are read at click time, so a new inline callback from the parent never
  // remounts the console (which would throw away the design's in-memory workspace).
  const handlers = useRef({ canChangeSite, onChangeSite, onExit });
  useEffect(() => {
    handlers.current = { canChangeSite, onChangeSite, onExit };
  }, [canChangeSite, onChangeSite, onExit]);

  const retry = useCallback(() => {
    setPhase('checking');
    setReloadToken((token) => token + 1);
  }, []);

  /**
   * Persist a status change the operator made in the design's dropdown.
   *
   * Returns a promise so the console re-renders once the write settles: on failure the
   * record is put back and the table redrawn, rather than a row that claims a status the
   * database never accepted.
   */
  const applyCaseStatus = useCallback((record: DesignCaseReport, previousStatus: string) => {
    const nextStatus = CASE_STATUS_DB[record.status];
    if (!nextStatus) {
      record.status = previousStatus;
      setNote({ tone: 'error', text: `“${record.status}” is not a status this dashboard stores.` });
      return null;
    }

    setNote({ tone: 'pending', text: `Saving ${record.id}…` });
    return fetch('/api/admin/reports', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportRef: record.id, status: nextStatus })
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setNote({ tone: 'ok', text: `${record.id} saved · ${CASE_STATUS[nextStatus]}` });
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : 'network error';
      record.status = previousStatus;
      setNote({ tone: 'error', text: `${record.id} was not saved — ${reason}. Status kept as ${previousStatus}.` });
    });
  }, []);

  /**
   * Write a profile change the console just made.
   *
   * The design mutates its own record first so the screen responds immediately; this puts
   * the same change in the database and, if the server refuses it, restores the record the
   * roster loaded. Resolving (rather than throwing) lets the design redraw either way.
   */
  const applyEmployeeChange = useCallback((change: EmployeeChange) => {
    const { action, record } = change;
    const label = (record.name ?? '').trim() || record.id;

    const failure = (code: string, message: string) => {
      restoreEmployeeChange(change);
      setNote({ tone: 'error', text: `${label}: ${message} (${code})` });
    };

    setNote({ tone: 'pending', text: action === 'delete' ? `Removing ${label}…` : `Saving ${label}…` });

    const request: Promise<Response> = action === 'delete'
      ? fetch(`/api/admin/employees/${encodeURIComponent(record.id)}`, {
        method: 'DELETE', credentials: 'same-origin'
      })
      : action === 'create'
        ? fetch('/api/admin/employees', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: selectedSiteId, fields: employeeFields(record, true, piiEnabled) })
        })
        : fetch(`/api/admin/employees/${encodeURIComponent(change.previous?.id ?? record.id)}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: employeeFields(record, change.previous?.id !== record.id, piiEnabled) })
        });

    return request.then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        failure(data?.code ?? `HTTP_${response.status}`, data?.error ?? 'the save was refused');
        return;
      }
      // Keep both copies in step with what the database now holds, so a later remount of
      // the console does not hand the design the roster as it was before this edit.
      const key = change.previous?.id ?? record.id;
      const applyTo = (current: DesignEmployee[] | null) => {
        if (!current) return current;
        if (action === 'delete') return current.filter((employee) => employee.id !== key);
        if (action === 'create') return [...current, { ...record }];
        return current.map((employee) => (employee.id === key ? { ...record } : employee));
      };
      setRoster(applyTo);
      rosterRef.current = applyTo(rosterRef.current);
      setNote({
        tone: 'ok',
        text: action === 'delete'
          ? `${label} removed from the roster (history kept).`
          : `${label} saved.${piiEnabled ? '' : ' Personal fields were not changed — PII release is off.'}`
      });
    }).catch((error: unknown) => {
      failure('NETWORK', error instanceof Error ? error.message : 'the server could not be reached');
    });
  }, [piiEnabled, selectedSiteId]);

  useEffect(() => {
    employeeWriter.current = applyEmployeeChange;
  }, [applyEmployeeChange]);

  /* 1. Decide whether the real employee master may be read, then fetch it. */
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');

    async function boot() {
      const session = await readSession();
      if (cancelled) return;

      setPiiEnabled(Boolean(session?.piiEnabled));

      if (session?.configured && !session.signedIn) {
        // Auth exists but this browser has no session — ask for the admin credentials.
        setRoster(null);
        setState('unavailable');
        setFailClosed(false);
        setPhase('locked');
        return;
      }

      if (!session?.configured) {
        // Fail closed: missing auth may not reveal a console at all.
        setRoster(null);
        setState('unavailable');
        setFailClosed(true);
        setPhase('ready');
        return;
      }

      // Both screens the console backs with real data are loaded together: a console that
      // shows the live roster but demo reports would be worse than one that says so.
      const [rosterResult, reportsResult] = await Promise.all([
        readRoster(selectedSiteId),
        readReports(selectedSiteId)
      ]);
      if (cancelled) return;

      if (('error' in rosterResult && rosterResult.error === 'auth')
        || ('error' in reportsResult && reportsResult.error === 'auth')) {
        // Session cookie rejected (expired or cleared) — back to the gate.
        rosterRef.current = null;
        setRoster(null);
        setState('unavailable');
        setReports(null);
        setReportState('unavailable');
        setFailClosed(false);
        setPhase('locked');
        return;
      }

      setReports('error' in reportsResult ? [] : reportsResult.rows);
      setReportState('error' in reportsResult ? 'unavailable' : reportsResult.rows.length ? 'live' : 'empty');

      if ('error' in rosterResult) {
        // Signed in, but the employee master source is not configured or reachable right
        // now. Open the console with an empty directory instead of a wall — the design's
        // own in-memory records still render, and the status line says the master is
        // unavailable. No synthetic employees are invented.
        rosterRef.current = [];
        setRoster([]);
        setState('unavailable');
        setFailClosed(false);
        setPhase('ready');
        return;
      }
      rosterRef.current = rosterResult.rows;
      setRoster(rosterResult.rows);
      setState(rosterResult.rows.length ? 'live' : 'empty');
      setFailClosed(false);
      setPhase('ready');
    }

    void boot();
    return () => { cancelled = true; };
  }, [selectedSiteId, reloadToken]);

  /* 2. Mount the design — markup first, then its script, then the host wiring. */
  useEffect(() => {
    if (phase !== 'ready' || failClosed) return;
    const container = host.current;
    if (!container) return;

    // Copies, not the state objects: the design edits these in place, and a rejected save
    // has to be undone in the array the design renders from.
    window.__SAFEX_EMPLOYEES__ = (rosterRef.current ?? []).map((employee) => ({ ...employee }));
    window.__SAFEX_EMPLOYEE_CHANGED__ = (change: EmployeeChange) => employeeWriter.current(change);
    // Case Management, the dashboard counters and analytics all read this array. Copies,
    // not the state objects: the design mutates a record when a status changes, and React
    // state is not the place for that mutation to happen behind our back.
    window.__SAFEX_CASE_REPORTS__ = (reports ?? []).map((report) => ({ ...report }));
    window.__SAFEX_CASE_CHANGED__ = applyCaseStatus;
    container.innerHTML = DESIGN_MARKUP;
    applyContext(container, context.current);

    const recorder = recordGlobalListeners();
    try {
      const script = document.createElement('script');
      script.textContent = DESIGN_SCRIPT;
      container.appendChild(script);
    } catch (error) {
      console.error('SafetyOS console failed to start', error);
    } finally {
      recorder.restore();
    }

    // The design leaves DM as an empty placeholder. The form is real React state, so it is
    // portalled into that page: the design keeps owning every other screen, and the DM form
    // keeps owning its own inputs.
    const dmPage = container.querySelector<HTMLElement>('#dmPage');
    if (dmPage) {
      const host = document.createElement('div');
      host.className = 'dm-host';
      dmPage.replaceChildren(host);
      setDmHost(host);
    }

    // The design's sidebar is a 224 px column (66 px below 1250 px) and it hides its own
    // menu button, so every screen pays for navigation it may not be using. Here it becomes
    // a drawer: closed by default, opened from the topbar, dismissed by the scrim, Escape or
    // picking a destination. `mobile-nav-open` is the design's own class, so its script and
    // styles keep working.
    const app = container.querySelector<HTMLElement>('#app');
    const scrim = document.createElement('div');
    scrim.className = 'sos-nav-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    app?.appendChild(scrim);

    const closeNav = () => app?.classList.remove('mobile-nav-open');
    const onScrimClick = () => closeNav();
    const onNavPick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('.nav-link')) closeNav();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNav();
    };
    if (app) {
      scrim.addEventListener('click', onScrimClick);
      app.addEventListener('click', onNavPick);
    }
    window.addEventListener('keydown', onEscape);

    // The button keeps its `aria-expanded` honest whichever way the drawer was closed.
    const menuButton = container.querySelector<HTMLElement>('#mobileMenu');
    menuButton?.setAttribute('aria-controls', 'sidebar');
    const syncMenu = () => menuButton?.setAttribute(
      'aria-expanded',
      String(Boolean(app?.classList.contains('mobile-nav-open')))
    );
    syncMenu();
    const drawerObserver = app ? new MutationObserver(syncMenu) : null;
    drawerObserver?.observe(app as HTMLElement, { attributes: true, attributeFilter: ['class'] });

    const onCaptureClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('#logoutAction')) {
        event.preventDefault();
        event.stopPropagation();
        // End the server session, then leave: the next visit must sign in again.
        // Fire-and-forget — the app should not wait on a network round trip to close.
        void fetch('/api/admin/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
        handlers.current.onExit();
        return;
      }
      // A worker's report is the record of what they saw. The console may move its status
      // (that is persisted), but editing or deleting the report text here would quietly
      // rewrite that record, and a report created in the console would never reach the
      // database. Block both and say why instead of letting the screen lie.
      const blocked = target.closest<HTMLElement>('[data-case-action="edit"], [data-case-action="delete"], #caseNewReport');
      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
        const action = blocked.getAttribute('data-case-action');
        setNote({
          tone: 'error',
          text: action === 'delete'
            ? 'Reports are kept for the audit trail once submitted — close the report instead of deleting it.'
            : action === 'edit'
              ? 'Only the status can be changed here. The report text stays exactly as the worker submitted it.'
              : 'New reports are filed from the worker app so they carry the reporting employee and site. Status changes here are saved.'
        });
        return;
      }
      if (target.closest('#locationButton')) {
        event.preventDefault();
        event.stopPropagation();
        // Single-site tenants cannot switch: keep the real site name in place instead of
        // letting the design cycle through its invented demo locations.
        if (handlers.current.canChangeSite) handlers.current.onChangeSite();
        else applyContext(container, context.current);
      }
    };
    container.addEventListener('click', onCaptureClick, true);

    return () => {
      container.removeEventListener('click', onCaptureClick, true);
      scrim.removeEventListener('click', onScrimClick);
      app?.removeEventListener('click', onNavPick);
      window.removeEventListener('keydown', onEscape);
      drawerObserver?.disconnect();
      for (const entry of recorder.attached) {
        entry.target.removeEventListener(entry.type, entry.listener, entry.options as never);
      }
      container.innerHTML = '';
      setDmHost(null);
      delete window.__SAFEX_EMPLOYEES__;
      delete window.__SAFEX_EMPLOYEE_CHANGED__;
      delete window.__SAFEX_CASE_REPORTS__;
      delete window.__SAFEX_CASE_CHANGED__;
    };
    // `reports` is a seam payload — fresh reports mean a fresh console. `state` and `phase`
    // are dependencies because the gate/fail-closed screens unmount the container, and a
    // refetch always passes through `phase: 'checking'`, so the roster is never stale here.
    // The roster itself is read from the ref, so saving a profile does not remount.
  }, [phase, state, reports, failClosed, applyCaseStatus]);

  /* 3. Keep the host context (site, officer, directory status) in the design's chrome. */
  useEffect(() => {
    const container = host.current;
    if (!container || phase !== 'ready') return;
    if (!container.querySelector('#app')) return;
    applyContext(container, context.current);
  }, [phase, roster, site?.name, officerName, directoryMode, state]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setAuthError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: gateUsername, password: gatePassword })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setAuthError(data.error ?? 'That username and password were not accepted.');
        return;
      }
      setGatePassword('');
      retry();
    } catch {
      setAuthError('Sign-in failed. Check your connection and try again.');
    } finally {
      setSigningIn(false);
    }
  }


  if (phase === 'checking') {
    return (
      <div className="sos sos-gate" id="safetyos-gate" role="status">
        <p>Opening the admin / HSE workspace…</p>
      </div>
    );
  }

  if (phase === 'locked') {
    return (
      <div className="sos sos-gate" id="safetyos-gate">
        <form onSubmit={unlock}>
          <h2>Admin / HSE Manager sign-in</h2>
          <p>
            The console can read the live employee master, so the server verifies access
            rather than the browser. Use the admin credentials from the app&apos;s login
            screen to open it.
          </p>
          <label htmlFor="sos-username">Admin User ID</label>
          <input
            id="sos-username"
            value={gateUsername}
            onChange={(event) => setGateUsername(event.target.value)}
            autoComplete="username"
            minLength={3}
            required
          />
          <label htmlFor="sos-password">Password</label>
          <input
            id="sos-password"
            type="password"
            value={gatePassword}
            onChange={(event) => setGatePassword(event.target.value)}
            autoComplete="current-password"
            minLength={6}
            required
          />
          <button type="submit" disabled={signingIn || gateUsername.trim().length === 0 || gatePassword.length === 0}>
            {signingIn ? 'Verifying…' : 'Open the console'}
          </button>
          {authError && <p className="sos-gate-error" role="alert">{authError}</p>}
          <button type="button" className="sos-gate-link" onClick={onExit}>
            Back to the app
          </button>
        </form>
      </div>
    );
  }

  if (failClosed) {
    return (
      <div className="sos sos-gate" id="safetyos-gate">
        <form onSubmit={(event) => { event.preventDefault(); retry(); }}>
          <h2>The employee master could not be read</h2>
          <p>
            Admin access is not configured on the server. Check the server
            employee-master and admin-access configuration, then try again. No sample records are shown.
          </p>
          <button type="submit">Try again</button>
          <button type="button" className="sos-gate-link" onClick={onExit}>
            Back to the app
          </button>
        </form>
      </div>
    );
  }

  return <><div className="sos" id="safetyos-console" ref={host} data-site={selectedSiteId} />
    {dmHost && createPortal(
      <DmWorkspace
        siteId={selectedSiteId}
        siteName={site?.name ?? 'Site'}
        officerName={personName(officerName) ?? ''}
      />,
      dmHost
    )}
    {(note || reportState === 'unavailable') && <div
      className={`sos-sync-note ${note ? `is-${note.tone}` : 'is-error'}`}
      role="status"
      aria-live="polite"
    >
      <span>{note ? note.text : 'Reports could not be loaded from the database, so Case Management is empty. Status changes are unavailable until it is reachable.'}</span>
      {!note && <button type="button" onClick={retry}>Try again</button>}
    </div>}
    {state === 'unavailable' && <div className="sos-master-note" role="status">
      <span>Employee master not connected — the directory is showing 0 employees. Sign-in is active; configure the employee source to load real records.</span>
      <button type="button" onClick={retry}>Try again</button>
    </div>}
  </>;
}

/** Write the host's own values into the design's chrome (site, officer, status line). */
function applyContext(container: HTMLElement, context: HostContext) {
  const set = (selector: string, text: string) => {
    const element = container.querySelector<HTMLElement>(selector);
    if (element && element.textContent !== text) element.textContent = text;
  };

  set('#locationText', context.siteName);
  set('#profileRole', context.officerRole);
  set('#profileMenuDetail', `${context.officerRole} · ${context.siteName}`);
  set('#authStatusText', context.statusLabel);
  if (context.officerName) {
    set('#profileDisplayName', context.officerName);
    set('#profileMenuName', context.officerName);
    set('#profileAvatarInitials', initials(context.officerName));
  }
}

function describeDirectory(state: DirectoryState, count: number, directoryMode: string): string {
  if (state === 'live') {
    const via = directoryMode === 'supabase' ? 'Supabase' : directoryMode === 'sheet' ? 'sheet' : directoryMode;
    return `Live employee master · ${count} on file${via ? ` · ${via}` : ''}`;
  }
  if (state === 'empty') return 'Employee master connected · 0 employees imported';
  if (state === 'unavailable') return 'Employee master unavailable';
  return 'Employee master not connected';
}

async function readSession(): Promise<SessionState | null> {
  try {
    const response = await fetch('/api/admin/session', { credentials: 'same-origin' });
    const data = await response.json();
    return {
      configured: Boolean(data?.configured),
      signedIn: Boolean(data?.signedIn),
      piiEnabled: Boolean(data?.piiEnabled)
    };
  } catch {
    return null;
  }
}

/** Walk /api/admin/employees (50 per page) and flatten it into the design's shape. */
async function readRoster(siteId: string): Promise<RosterResult> {
  const collected: DesignEmployee[] = [];
  try {
    for (let offset = 0; offset < MAX_ROSTER; offset += PAGE_SIZE) {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (siteId && siteId !== 'all') params.set('siteId', siteId);
      const response = await fetch(`/api/admin/employees?${params}`, { credentials: 'same-origin' });
      if (response.status === 401) return { error: 'auth' };
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.employees)) {
        return { error: 'unavailable' };
      }
      for (const row of data.employees as AdminEmployee[]) {
        collected.push({
          id: row.empNo,
          name: row.name,
          designation: row.designation ?? '',
          department: row.department ?? '',
          location: row.location ?? '',
          // Absent when PII release is off — the design fills its own blanks, and the write
          // path leaves those fields alone rather than sending an empty string back.
          mobile: row.mobile ?? '',
          bloodGroup: row.bloodGroup ?? '',
          email: row.email ?? '',
          gender: row.gender ?? '',
          dob: row.dob ?? '',
          emergencyName: row.emergencyName ?? '',
          emergencyMobile: row.emergencyMobile ?? '',
          address: row.address ?? '',
          notes: row.notes ?? '',
          previousNames: row.previousNames ?? []
        });
      }
      if (collected.length >= Number(data.total ?? 0) || data.employees.length < PAGE_SIZE) break;
    }
    return { rows: collected };
  } catch {
    return { error: 'unavailable' };
  }
}

/**
 * The writable part of a profile record.
 *
 * Only fields the operator could actually see are sent. With PII release off the roster
 * never delivered the personal fields, so the form is empty — sending those empties back
 * would erase the mobile number and blood group stored in the database.
 */
function employeeFields(record: DesignEmployee, includeEmployeeNo: boolean, includePii: boolean) {
  const fields: Record<string, unknown> = {
    name: record.name,
    designation: record.designation,
    department: record.department || null,
    location: record.location || null
  };
  if (includeEmployeeNo) fields.employeeNo = record.id;
  if (!includePii) return fields;
  return {
    ...fields,
    mobile: record.mobile || null,
    bloodGroup: record.bloodGroup || null,
    email: record.email || null,
    gender: record.gender || null,
    dob: record.dob || null,
    emergencyName: record.emergencyName || null,
    emergencyMobile: record.emergencyMobile || null,
    address: record.address || null,
    notes: record.notes || null,
    previousNames: record.previousNames ?? []
  };
}

/** Undo the design's optimistic edit after the server refused it. */
function restoreEmployeeChange({ action, record, previous }: EmployeeChange) {
  const roster = typeof window === 'undefined' ? undefined : window.__SAFEX_EMPLOYEES__;
  if (action === 'update' && previous) {
    // Copy back over the same object so every reference the design holds stays valid.
    for (const key of Object.keys(record) as (keyof DesignEmployee)[]) {
      if (!(key in previous)) delete record[key];
    }
    Object.assign(record, previous);
    return;
  }
  if (!Array.isArray(roster)) return;
  if (action === 'create') {
    const index = roster.indexOf(record);
    if (index >= 0) roster.splice(index, 1);
    return;
  }
  if (action === 'delete' && !roster.includes(record)) roster.unshift(record);
}

/**
 * Walk /api/admin/reports and translate each row into the design's case shape.
 *
 * The console's own fields and the database's do not line up one-to-one, so the mapping is
 * explicit rather than a spread: a new database column should be a deliberate decision here.
 * Fields the design shows but the database does not store (owner, follow-up) stay empty
 * instead of being filled with invented values.
 */
async function readReports(siteId: string): Promise<ReportsResult> {
  const collected: DesignCaseReport[] = [];
  try {
    for (let offset = 0; offset < MAX_REPORTS; offset += REPORT_PAGE_SIZE) {
      const params = new URLSearchParams({ limit: String(REPORT_PAGE_SIZE), offset: String(offset) });
      if (siteId && siteId !== 'all') params.set('siteId', siteId);
      const response = await fetch(`/api/admin/reports?${params}`, { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) return { error: 'auth' };
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !Array.isArray(data.reports)) return { error: 'unavailable' };
      for (const report of data.reports as AdminReport[]) collected.push(toCaseReport(report));
      const total = Number(data.total ?? 0);
      if (collected.length >= total || data.reports.length < REPORT_PAGE_SIZE) break;
    }
    return { rows: collected, total: collected.length };
  } catch {
    return { error: 'unavailable' };
  }
}

/**
 * Record the document/window listeners the design registers while it starts.
 *
 * The design attaches a handful of top-level handlers (an outside click closes the profile
 * menu, Escape closes it too). They are bound to names that live as long as the tab, so
 * without this they would keep firing against a console the user has already left.
 */
function recordGlobalListeners() {
  const attached: {
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: unknown;
  }[] = [];

  const documentAdd = document.addEventListener.bind(document);
  const windowAdd = window.addEventListener.bind(window);

  document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    attached.push({ target: document, type, listener, options });
    documentAdd(type, listener, options as never);
  }) as typeof document.addEventListener;

  window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: unknown) => {
    attached.push({ target: window, type, listener, options });
    windowAdd(type, listener, options as never);
  }) as typeof window.addEventListener;

  return {
    attached,
    restore() {
      document.addEventListener = documentAdd as typeof document.addEventListener;
      window.addEventListener = windowAdd as typeof window.addEventListener;
    }
  };
}
