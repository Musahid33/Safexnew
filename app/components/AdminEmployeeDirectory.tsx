'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BadgeCheck, ChevronLeft, ChevronRight, Droplet, IdCard, LockKeyhole, MapPin,
  Phone, Search, ShieldCheck, UserRound, X
} from 'lucide-react';
import type { Site } from '@/lib/types';
import { useI18n } from './I18nProvider';

/**
 * The real employee master, inside the admin console.
 *
 * Everything here is driven by /api/admin/employees, which refuses to answer without a
 * server-verified session. The component therefore has three honest states — "not
 * configured", "locked", and "signed in" — instead of pretending to show data it is not
 * allowed to fetch.
 */

type AdminEmployee = {
  empNo: string;
  name: string;
  designation: string;
  department: string | null;
  siteId: string;
  skillGrade: string | null;
  safetyPassNo?: string | null;
  bloodGroup?: string | null;
  mobile?: string | null;
};

type SessionState = { configured: boolean; signedIn: boolean; piiEnabled: boolean };
type Props = { sites: Site[]; scopeSiteId: string };

const PAGE_SIZE = 25;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function gradeTone(grade: string | null): string {
  const value = (grade ?? '').toLowerCase();
  if (value === 'platinum') return 'platinum';
  if (value === 'gold') return 'gold';
  if (value === 'silver') return 'silver';
  return 'none';
}

export default function AdminEmployeeDirectory({ sites, scopeSiteId }: Props) {
  const { T } = useI18n();
  const [session, setSession] = useState<SessionState | null>(null);
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AdminEmployee[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<AdminEmployee | null>(null);

  const requestId = useRef(0);
  const siteFilter = scopeSiteId === 'all' ? '' : scopeSiteId;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/session', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((data: SessionState) => { if (!cancelled) setSession(data); })
      .catch(() => { if (!cancelled) setSession({ configured: false, signedIn: false, piiEnabled: false }); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!session?.signedIn) return;
    const ticket = ++requestId.current;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (query.trim()) params.set('q', query.trim());
      if (siteFilter) params.set('siteId', siteFilter);
      const response = await fetch(`/api/admin/employees?${params}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (ticket !== requestId.current) return;
      if (!response.ok || !data.ok) {
        if (response.status === 401) setSession((prev) => (prev ? { ...prev, signedIn: false } : prev));
        setLoadError(data.error ?? T('The employee master could not be loaded.'));
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(data.employees);
      setTotal(data.total);
      setSource(data.source);
    } catch {
      if (ticket === requestId.current) setLoadError(T('The employee master could not be loaded.'));
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, [T, offset, query, session?.signedIn, siteFilter]);

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => { setOffset(0); }, [query, siteFilter]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
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
        setAuthError(data.error ?? T('That passcode was not accepted.'));
        return;
      }
      setPasscode('');
      setSession({ configured: true, signedIn: true, piiEnabled: Boolean(data.piiEnabled) });
    } catch {
      setAuthError(T('Sign-in failed. Check your connection and try again.'));
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await fetch('/api/admin/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    setRows([]);
    setTotal(0);
    setSelected(null);
    setSession((prev) => (prev ? { ...prev, signedIn: false } : prev));
  }

  if (!session) {
    return <div className="admin-directory-state"><span className="admin-directory-spinner" aria-hidden="true" />{T('Checking access…')}</div>;
  }

  if (!session.configured) {
    return (
      <div className="admin-directory-state locked">
        <LockKeyhole size={26} />
        <b>{T('The admin API is not enabled on this server')}</b>
        <p>{T('The employee master holds real personal data, so it is never served from a password checked in the browser. Set SAFEX_ADMIN_PASSCODE (12+ characters) in the server environment to turn this console on.')}</p>
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <form className="admin-directory-state locked" onSubmit={signIn}>
        <ShieldCheck size={26} />
        <b>{T('Verify to view the employee master')}</b>
        <p>{T('This directory contains real people. Access is checked on the server and the session lasts 8 hours.')}</p>
        <label className="field-label" htmlFor="admin-passcode">{T('Operator passcode')}</label>
        <input
          id="admin-passcode"
          className="form-control"
          type="password"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          autoComplete="current-password"
          required
        />
        <button className="primary-button full-button" type="submit" disabled={signingIn || passcode.length === 0}>
          {signingIn ? T('Verifying…') : T('Unlock directory')}
        </button>
        {authError && <div className="inline-notice warning" role="alert">{authError}</div>}
      </form>
    );
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <>
      <div className="admin-directory-toolbar">
        <label className="admin-search admin-employee-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={T('Search Employee ID, name or designation')}
          />
        </label>
        <button className="text-button" type="button" onClick={signOut}>
          <LockKeyhole size={14} /> {T('Lock')}
        </button>
      </div>

      <div className="admin-results-meta">
        <b>{total > 0
          ? T('Showing {from}–{to} of {count}', { from: pageStart, to: pageEnd, count: total })
          : T('No employees found')}</b>
        <span>
          {source === 'supabase' && T('Live from Supabase')}
          {source === 'sheet' && T('From the published sheet · import to Supabase to finish the migration')}
          {source === 'demo' && T('No master connected')}
          {!session.piiEnabled && ` · ${T('contact details hidden')}`}
        </span>
      </div>

      {loadError && <div className="inline-notice warning" role="alert">{loadError}</div>}

      <div className={`admin-employee-grid ${loading ? 'is-loading' : ''}`}>
        {rows.map((employee) => (
          <article className="admin-employee-card" key={employee.empNo}>
            <span className="admin-employee-avatar" aria-hidden="true">{initials(employee.name)}</span>
            <div className="admin-employee-info">
              <b>{employee.name}</b>
              <span>{employee.designation || T('Designation not recorded')}</span>
              <small>{employee.empNo}</small>
            </div>
            {employee.skillGrade && (
              <span className={`admin-grade-chip ${gradeTone(employee.skillGrade)}`}>
                <BadgeCheck size={12} />{employee.skillGrade}
              </span>
            )}
            <span className="admin-employee-site">
              <MapPin size={13} />{sites.find((site) => site.id === employee.siteId)?.name ?? T('Site')}
            </span>
            <button className="admin-employee-open" type="button" onClick={() => setSelected(employee)}>
              {T('View profile')} <ChevronRight size={15} />
            </button>
          </article>
        ))}
        {!loading && rows.length === 0 && !loadError && (
          <div className="admin-directory-state">
            <UserRound size={24} />
            <b>{T('No matching employees')}</b>
            <p>{T('Try a different search or change the site scope.')}</p>
          </div>
        )}
      </div>

      {total > PAGE_SIZE && (
        <div className="admin-pager">
          <button className="secondary-button" type="button" disabled={offset === 0}
            onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>
            <ChevronLeft size={15} /> {T('Previous')}
          </button>
          <button className="secondary-button" type="button" disabled={pageEnd >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>
            {T('Next')} <ChevronRight size={15} />
          </button>
        </div>
      )}

      {selected && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="admin-profile-title">
          <div className="modal admin-profile-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">{T('EMPLOYEE PROFILE')}</span>
                <h2 id="admin-profile-title">{selected.name}</h2>
              </div>
              <button className="close-button" type="button" onClick={() => setSelected(null)} aria-label={T('Close')}>
                <X />
              </button>
            </div>

            <div className="admin-profile-hero">
              <span className="admin-profile-avatar" aria-hidden="true">{initials(selected.name)}</span>
              <div>
                <b>{selected.designation || T('Designation not recorded')}</b>
                <small>{selected.empNo} · {sites.find((site) => site.id === selected.siteId)?.name ?? selected.siteId}</small>
              </div>
              {selected.skillGrade && (
                <span className={`admin-grade-chip ${gradeTone(selected.skillGrade)}`}>
                  <BadgeCheck size={13} />{selected.skillGrade}
                </span>
              )}
            </div>

            <dl className="detail-grid">
              <div><dt>{T('Employee ID')}</dt><dd>{selected.empNo}</dd></div>
              <div><dt>{T('Designation')}</dt><dd>{selected.designation || T('N/A')}</dd></div>
              <div><dt>{T('Department')}</dt><dd>{selected.department ?? T('N/A')}</dd></div>
              <div><dt>{T('Skill grade')}</dt><dd>{selected.skillGrade ?? T('Not recorded')}</dd></div>
              {session.piiEnabled ? (
                <>
                  <div><dt><IdCard size={13} /> {T('Safety pass no')}</dt><dd>{selected.safetyPassNo ?? T('Not recorded')}</dd></div>
                  <div><dt><Phone size={13} /> {T('Registered mobile')}</dt><dd>{selected.mobile ?? T('Not recorded')}</dd></div>
                  <div><dt><Droplet size={13} /> {T('Blood group')}</dt><dd>{selected.bloodGroup ?? T('Not recorded')}</dd></div>
                </>
              ) : (
                <div className="detail-locked">
                  <dt><LockKeyhole size={13} /> {T('Contact & medical details')}</dt>
                  <dd>{T('Hidden. Set SAFEX_ADMIN_PII_ENABLED=true on the server to release safety pass, mobile and blood group to verified officers.')}</dd>
                </div>
              )}
            </dl>

            <div className="modal-footnote">
              <LockKeyhole size={14} /> {T('Blood group is health data. Release it only to an authorised first-aid or SOS responder, and log every access.')}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
