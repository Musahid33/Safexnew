'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import '@/app/safetyos.css';
import '@/app/safetyos-host.css';
import { DESIGN_MARKUP } from './generated/markup';
import { DESIGN_SCRIPT } from './generated/script';
import type { Site } from '@/lib/types';

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
 *  - "Log out", the location selector and the sidebar status line are wired back to the
 *    host, so the console behaves as a screen of this app rather than a separate page.
 */

type Props = {
  sites: Site[];
  selectedSiteId: string;
  onChangeSite: () => void;
  canChangeSite: boolean;
  onExit: () => void;
  /** Role label shown under the officer avatar in the console topbar. */
  officerName: string;
  /** 'supabase' | 'sheet' | 'demo' — reported in the console sidebar. */
  directoryMode: string;
};

/** Shape returned by /api/admin/employees. */
type AdminEmployee = {
  empNo: string;
  name: string;
  designation: string;
  department: string | null;
};

/** Shape the design's own directory code expects. */
type DesignEmployee = {
  id: string;
  name: string;
  designation: string;
  department: string;
};

type SessionState = { configured: boolean; signedIn: boolean; piiEnabled?: boolean };
type RosterResult = { rows: DesignEmployee[] } | { error: 'auth' | 'unavailable' };
type Phase = 'checking' | 'locked' | 'ready';
type DirectoryState = 'live' | 'empty' | 'demo' | 'unavailable';

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
  }
}

const PAGE_SIZE = 50;
const MAX_ROSTER = 2000;

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
  const [state, setState] = useState<DirectoryState>('demo');
  const [reloadToken, setReloadToken] = useState(0);
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const site = sites.find((entry) => entry.id === selectedSiteId) ?? sites[0] ?? null;
  const context = useRef<HostContext>({ siteName: '', officerRole: '', officerName: null, statusLabel: '' });
  context.current = {
    siteName: site?.name ?? 'No site',
    officerRole: officerName?.trim() || 'Safety Officer',
    officerName: personName(officerName),
    statusLabel: describeDirectory(state, roster?.length ?? 0, directoryMode)
  };

  // Handlers are read at click time, so a new inline callback from the parent never
  // remounts the console (which would throw away the design's in-memory workspace).
  const handlers = useRef({ canChangeSite, onChangeSite, onExit });
  useEffect(() => {
    handlers.current = { canChangeSite, onChangeSite, onExit };
  }, [canChangeSite, onChangeSite, onExit]);

  /* 1. Decide whether the real employee master may be read, then fetch it. */
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');

    async function boot() {
      const session = await readSession();
      if (cancelled) return;

      if (session?.configured && !session.signedIn) {
        setRoster(null);
        setState('demo');
        setPhase('locked');
        return;
      }

      if (!session?.configured) {
        // No server passcode configured: run the console on the design's own records,
        // exactly as the uploaded file behaves when opened directly.
        setRoster(null);
        setState('demo');
        setPhase('ready');
        return;
      }

      const result = await readRoster(selectedSiteId);
      if (cancelled) return;
      if ('error' in result) {
        if (result.error === 'auth') {
          setRoster(null);
          setState('demo');
          setPhase('locked');
          return;
        }
        setRoster(null);
        setState('unavailable');
        setPhase('ready');
        return;
      }
      setRoster(result.rows);
      setState(result.rows.length ? 'live' : 'empty');
      setPhase('ready');
    }

    void boot();
    return () => { cancelled = true; };
  }, [selectedSiteId, reloadToken]);

  /* 2. Mount the design — markup first, then its script, then the host wiring. */
  useEffect(() => {
    if (phase !== 'ready') return;
    const container = host.current;
    if (!container) return;

    window.__SAFEX_EMPLOYEES__ = roster ?? undefined;
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

    const onCaptureClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('#logoutAction')) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onExit();
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
      for (const entry of recorder.attached) {
        entry.target.removeEventListener(entry.type, entry.listener, entry.options as never);
      }
      container.innerHTML = '';
      delete window.__SAFEX_EMPLOYEES__;
    };
    // `roster` is the seam payload — a new roster means a fresh console. `state` is a
    // dependency because the "try again"/"use demo records" screens unmount the container:
    // leaving them has to mount the design again.
  }, [phase, state, roster]);

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
        body: JSON.stringify({ passcode })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setAuthError(data.error ?? 'That passcode was not accepted.');
        return;
      }
      setPasscode('');
      retry();
    } catch {
      setAuthError('Sign-in failed. Check your connection and try again.');
    } finally {
      setSigningIn(false);
    }
  }

  const retry = useCallback(() => {
    setPhase('checking');
    setReloadToken((token) => token + 1);
  }, []);

  const useDemoRecords = useCallback(() => {
    setRoster(null);
    setState('demo');
    setPhase('ready');
  }, []);

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
            rather than the browser. Enter the workspace passcode to open it with real
            records, or continue on the console&rsquo;s own demo records.
          </p>
          <label htmlFor="sos-passcode">Workspace passcode</label>
          <input
            id="sos-passcode"
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            autoComplete="current-password"
            minLength={12}
            required
          />
          <button type="submit" disabled={signingIn || passcode.length === 0}>
            {signingIn ? 'Verifying…' : 'Open the console'}
          </button>
          {authError && <p className="sos-gate-error" role="alert">{authError}</p>}
          <button type="button" className="sos-gate-link" onClick={useDemoRecords}>
            Continue with demo records
          </button>
          <button type="button" className="sos-gate-link" onClick={onExit}>
            Back to the app
          </button>
        </form>
      </div>
    );
  }

  if (state === 'unavailable') {
    return (
      <div className="sos sos-gate" id="safetyos-gate">
        <form onSubmit={(event) => { event.preventDefault(); retry(); }}>
          <h2>The employee master could not be read</h2>
          <p>
            The session is valid but the roster request failed. Try the master again, or run
            the console on the design&rsquo;s demo records.
          </p>
          <button type="submit">Try again</button>
          <button type="button" className="sos-gate-link" onClick={useDemoRecords}>
            Continue with demo records
          </button>
          <button type="button" className="sos-gate-link" onClick={onExit}>
            Back to the app
          </button>
        </form>
      </div>
    );
  }

  return <div className="sos" id="safetyos-console" ref={host} data-site={selectedSiteId} />;
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
  if (state === 'unavailable') return 'Employee master unavailable · demo records';
  return 'Demo records · employee master not connected';
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
        return collected.length ? { rows: collected } : { error: 'unavailable' };
      }
      for (const row of data.employees as AdminEmployee[]) {
        collected.push({
          id: row.empNo,
          name: row.name,
          designation: row.designation ?? '',
          department: row.department ?? ''
        });
      }
      if (collected.length >= Number(data.total ?? 0) || data.employees.length < PAGE_SIZE) break;
    }
    return { rows: collected };
  } catch {
    return collected.length ? { rows: collected } : { error: 'unavailable' };
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
