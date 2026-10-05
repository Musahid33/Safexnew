'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Site } from '@/lib/types';

/**
 * Employee Profile — ported from the design file and wired to the live employee master.
 *
 * The design showed a dozen invented people held in a module-scoped array. This reads the
 * real roster through /api/admin/employees, which refuses to answer without a
 * server-verified operator session, and which withholds mobile, safety pass and blood
 * group unless the server has explicitly released them.
 *
 * Writes are not connected yet: the roster is populated by `npm run employees:import`,
 * and mutating real people from a browser form needs its own endpoint, validation and
 * audit trail. The form below therefore stays read-only and says so, rather than
 * pretending to save.
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
type Props = {
  sites: Site[];
  selectedSiteId: string;
  /** 'directory' | 'profile' | 'entry' — which panel of the design to show. */
  subSection: string;
  breadcrumb: string;
  onNavigate: (subSection: string) => void;
};

const PAGE_SIZE = 25;

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || 'EP';
}

function Avatar({ name, large }: { name: string; large?: boolean }) {
  // The design nests the initials in a <span>; .ep-avatar styles that child directly.
  return <div className={`ep-avatar ${large ? 'large' : ''}`} aria-hidden="true"><span>{initials(name)}</span></div>;
}

export default function EmployeeProfilePage({ sites, selectedSiteId, subSection, breadcrumb, onNavigate }: Props) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [passcode, setPasscode] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<AdminEmployee[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<AdminEmployee | null>(null);

  const requestId = useRef(0);

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
      if (search.trim()) params.set('q', search.trim());
      if (selectedSiteId && selectedSiteId !== 'all') params.set('siteId', selectedSiteId);
      const response = await fetch(`/api/admin/employees?${params}`, { credentials: 'same-origin' });
      const data = await response.json();
      if (ticket !== requestId.current) return;
      if (!response.ok || !data.ok) {
        if (response.status === 401) setSession((prev) => (prev ? { ...prev, signedIn: false } : prev));
        setLoadError(data.error ?? 'The employee master could not be loaded.');
        setRows([]); setTotal(0);
        return;
      }
      setRows(data.employees);
      setTotal(data.total);
      setSource(data.source);
    } catch {
      if (ticket === requestId.current) setLoadError('The employee master could not be loaded.');
    } finally {
      if (ticket === requestId.current) setLoading(false);
    }
  }, [offset, search, selectedSiteId, session?.signedIn]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => { setOffset(0); }, [search, selectedSiteId]);

  // Department options come from the rows actually on screen: the API paginates, so there
  // is no complete department list to filter against client-side without another request.
  const departments = useMemo(
    () => [...new Set(rows.map((row) => row.department).filter((value): value is string => Boolean(value)))].sort(),
    [rows]
  );
  const visible = useMemo(
    () => (department ? rows.filter((row) => row.department === department) : rows),
    [department, rows]
  );

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true); setAuthError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) { setAuthError(data.error ?? 'That passcode was not accepted.'); return; }
      setPasscode('');
      setSession({ configured: true, signedIn: true, piiEnabled: Boolean(data.piiEnabled) });
    } catch {
      setAuthError('Sign-in failed. Check your connection and try again.');
    } finally {
      setSigningIn(false);
    }
  }

  const crumb = breadcrumb.includes('·') ? (
    <div className="sos-breadcrumb">
      <span>{breadcrumb.split('·')[0].trim()}</span>
      <svg className="icon"><use href="#i-chevron-right" /></svg>
      <strong>{breadcrumb.split('·').slice(1).join('·').trim()}</strong>
    </div>
  ) : null;

  const heading = (
    <section className="page-heading">
      <div className="heading-left">
        <div className="heading-icon"><svg className="icon"><use href="#i-users" /></svg></div>
        <div>
          <h1>Employee Profile</h1>
          <p className="page-subtitle">Master employee details, contact information and searchable employee-linked records</p>
        </div>
      </div>
      <div className="heading-actions">
        <span className="case-demo-badge">
          {source === 'supabase' ? 'Master Directory · Supabase'
            : source === 'sheet' ? 'Master Directory · Sheet'
              : 'Master Directory'}
        </span>
      </div>
    </section>
  );

  if (!session) {
    return <main className="page">{crumb}{heading}<div className="ep-empty">Checking access…</div></main>;
  }

  if (!session.configured) {
    return (
      <main className="page">
        {crumb}
        {heading}
        <div className="ep-source-note">
          <svg className="icon"><use href="#i-shield-alert" /></svg>
          <div>
            <strong>The admin API is not enabled on this server</strong>
            <small>
              The employee master holds real personal data, so it is never served from a password
              checked in the browser. Set SAFEX_ADMIN_PASSCODE (12+ characters) in the server
              environment to turn this console on.
            </small>
          </div>
          <span className="case-demo-badge">Locked</span>
        </div>
      </main>
    );
  }

  if (!session.signedIn) {
    return (
      <main className="page">
        {crumb}
        {heading}
        <section className="panel ep-panel" style={{ maxWidth: 440 }}>
          <div className="ep-panel-heading">
            <div>
              <span className="eyebrow">VERIFY</span>
              <h2>Unlock the employee master</h2>
              <p>This directory contains real people. Access is checked on the server and the session lasts 8 hours.</p>
            </div>
          </div>
          <form onSubmit={signIn}>
            <div className="ep-field">
              <label htmlFor="sos-passcode">Operator passcode</label>
              <input
                id="sos-passcode"
                type="password"
                value={passcode}
                onChange={(event) => setPasscode(event.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="ep-form-actions">
              <button className="btn btn-primary" type="submit" disabled={signingIn || !passcode}>
                {signingIn ? 'Verifying…' : 'Unlock directory'}
              </button>
            </div>
            {authError && <div className="ep-empty" role="alert">{authError}</div>}
          </form>
        </section>
      </main>
    );
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <main className="page">
      {crumb}
      {heading}

      <div className="ep-source-note">
        <svg className="icon"><use href="#i-shield-alert" /></svg>
        <div>
          <strong>Live employee master</strong>
          <small>
            {source === 'supabase' && 'Read from Supabase through a server-verified session. '}
            {source === 'sheet' && 'Read from the published sheet. Run npm run employees:import to finish moving this into Supabase. '}
            {source === 'demo' && 'No master is connected, so there is nothing to show. '}
            {session.piiEnabled
              ? 'Mobile, safety pass and blood group are released to verified officers on this server.'
              : 'Mobile, safety pass and blood group are withheld — set SAFEX_ADMIN_PII_ENABLED=true to release them.'}
          </small>
        </div>
        <span className="case-demo-badge">{session.piiEnabled ? 'PII released' : 'PII hidden'}</span>
      </div>

      {subSection === 'directory' && <>
      <section className="ep-summary-grid" aria-label="Employee profile summary">
        <article className="stat-card">
          <div className="stat-icon stat-blue"><svg className="icon"><use href="#i-users" /></svg></div>
          <div className="stat-copy">
            <div className="stat-label">Employees</div>
            <div className="stat-value">{total.toLocaleString('en-IN')}</div>
            <div className="stat-period">In the master directory</div>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-icon stat-green"><svg className="icon"><use href="#i-checkcircle" /></svg></div>
          <div className="stat-copy">
            <div className="stat-label">Graded</div>
            <div className="stat-value">{rows.filter((row) => row.skillGrade).length}</div>
            <div className="stat-period">Skill grade on this page</div>
          </div>
        </article>
        <article className="stat-card">
          <div className="stat-icon stat-purple"><svg className="icon"><use href="#i-clipboard" /></svg></div>
          <div className="stat-copy">
            <div className="stat-label">Linked Records</div>
            <div className="stat-value">0</div>
            <div className="stat-period">Reports and training not linked yet</div>
          </div>
        </article>
      </section>

      <section className="panel ep-panel ep-directory-panel">
          <div className="ep-panel-heading">
            <div>
              <span className="eyebrow">EMPLOYEE DIRECTORY</span>
              <h2>Master Records</h2>
              <p>Search by employee number, name, role or department.</p>
            </div>
            <span className="case-report-count">{total.toLocaleString('en-IN')} employees</span>
          </div>
          <div className="ep-directory-toolbar">
            <label className="ep-search">
              <svg className="icon"><use href="#i-search" /></svg>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employee no, name, designation..."
                autoComplete="off"
              />
            </label>
            <select value={department} onChange={(event) => setDepartment(event.target.value)} aria-label="Filter employees by department">
              <option value="">All departments</option>
              {departments.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <span className="case-result-count">
              {total > 0 ? `${pageStart}–${pageEnd} of ${total}` : '0 shown'}
            </span>
          </div>
          <div className="table-wrap" style={{ opacity: loading ? 0.55 : 1 }}>
            <table className="ep-table">
              <thead>
                <tr>
                  <th>Employee No</th>
                  <th>Employee</th>
                  <th>Department / Role</th>
                  <th>{session.piiEnabled ? 'Mobile' : 'Grade'}</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((employee) => (
                  <tr key={employee.empNo}>
                    <td><strong className="ep-id-badge">{employee.empNo}</strong></td>
                    <td>
                      <div className="ep-employee-cell">
                        <Avatar name={employee.name} />
                        <div>
                          <strong>{employee.name}</strong>
                          <small>{sites.find((site) => site.id === employee.siteId)?.name ?? employee.siteId}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="ep-role-cell">
                        <strong>{employee.department ?? 'Department not added'}</strong>
                        <small>{employee.designation || 'Designation not added'}</small>
                      </div>
                    </td>
                    <td>{session.piiEnabled ? (employee.mobile ?? 'Not added') : (employee.skillGrade ?? '—')}</td>
                    <td>
                      <div className="ep-row-actions">
                        <button type="button" className="btn btn-light" onClick={() => { setSelected(employee); onNavigate('profile'); }}>View</button>
                        <button type="button" className="btn btn-light" onClick={() => { setSelected(employee); onNavigate('entry'); }}>Open</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && visible.length === 0 && (
              <div className="ep-empty">{loadError || 'No employee profiles match this search.'}</div>
            )}
          </div>
          {total > PAGE_SIZE && (
            <div className="ep-form-actions">
              <button className="btn btn-light" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}>Previous</button>
              <button className="btn btn-light" type="button" disabled={pageEnd >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          )}
      </section>
      </>}

      {subSection === 'profile' && (
      <section className="panel ep-panel ep-detail-panel">
        {!selected ? (
          <div className="ep-detail-empty">
            <div className="ep-empty-icon"><svg className="icon"><use href="#i-search" /></svg></div>
            <strong>Select an employee profile</strong>
            <span>Open Master Records and choose View on an employee to see their personal details and linked records here.</span>
          </div>
        ) : (
          <div>
            <div className="ep-profile-banner">
              <div className="ep-profile-person">
                <Avatar name={selected.name} large />
                <div className="ep-profile-identity">
                  <div className="ep-profile-title-row">
                    <h2>{selected.name}</h2>
                    <span className="ep-id-badge">EMP NO · {selected.empNo}</span>
                  </div>
                  <p>{selected.designation || 'Designation not added'} · {selected.department ?? 'Department not added'}</p>
                  <div className="ep-profile-contact">
                    <span>{session.piiEnabled ? (selected.mobile ?? 'Mobile not added') : 'Mobile hidden'}</span>
                    <span>{sites.find((site) => site.id === selected.siteId)?.name ?? selected.siteId}</span>
                    {selected.skillGrade && <span>{selected.skillGrade} grade</span>}
                  </div>
                </div>
              </div>
            </div>

            <div className="ep-profile-stats">
              {[['Training', 0], ['Case Reports', 0], ['Certificates', 0], ['Audit / Inspection', 0], ['Other Logs', 0]].map(([label, value]) => (
                <div className="ep-profile-stat" key={String(label)}>
                  <strong>{String(value)}</strong>
                  <small>{String(label)}</small>
                </div>
              ))}
            </div>

            <section className="ep-personal-section">
              <div className="ep-subhead">
                <div>
                  <span className="eyebrow">MASTER DETAILS</span>
                  <h2>Personal &amp; Contact Details</h2>
                </div>
              </div>
              <div className="ep-personal-grid">
                {([
                  ['Employee No', selected.empNo],
                  ['Designation', selected.designation],
                  ['Department', selected.department],
                  ['Skill Grade', selected.skillGrade],
                  ['Site / Location', sites.find((site) => site.id === selected.siteId)?.name ?? selected.siteId],
                  ['Mobile Number', session.piiEnabled ? selected.mobile : null],
                  ['Safety Pass No', session.piiEnabled ? selected.safetyPassNo : null],
                  ['Blood Group', session.piiEnabled ? selected.bloodGroup : null]
                ] as [string, string | null | undefined][]).map(([label, value]) => (
                  <div className="ep-personal-item" key={label}>
                    <span>{label}</span>
                    <strong>{value || (session.piiEnabled ? 'Not added' : 'Hidden')}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="ep-log-section">
              <div className="ep-subhead">
                <div>
                  <span className="eyebrow">EMPLOYEE ACTIVITY</span>
                  <h2>Linked Logs &amp; Records</h2>
                  <p>Reports, training and certificates are not linked to the employee master yet.</p>
                </div>
                <span className="case-report-count">0 records</span>
              </div>
              <div className="ep-empty">
                Linking needs reports to carry a verified employee number. That lands with the
                reports data layer, not here.
              </div>
            </section>
          </div>
        )}
      </section>
      )}

      {subSection === 'entry' && (
        <section className="panel ep-panel ep-master-panel">
          <div className="ep-panel-heading">
            <div>
              <span className="eyebrow">MASTER EMPLOYEE</span>
              <h2>Employee record</h2>
              <p>Editing is not connected yet — the roster is loaded by the importer.</p>
            </div>
          </div>
          <div className="ep-source-note" style={{ margin: 0 }}>
            <svg className="icon"><use href="#i-shield-alert" /></svg>
            <div>
              <strong>Read-only for now</strong>
              <small>
                These are real people. Creating or editing them from a browser form needs its own
                write endpoint with validation and an audit trail, so the form is not wired up
                rather than pretending to save. Use npm run employees:import to load the roster.
              </small>
            </div>
          </div>
          <div className="ep-form-grid" style={{ marginTop: 12 }}>
            <div className="ep-field"><label>Employee No</label><input value={selected?.empNo ?? ''} readOnly placeholder="Select an employee" /></div>
            <div className="ep-field"><label>Full name</label><input value={selected?.name ?? ''} readOnly placeholder="—" /></div>
            <div className="ep-field"><label>Designation</label><input value={selected?.designation ?? ''} readOnly placeholder="—" /></div>
            <div className="ep-field"><label>Department</label><input value={selected?.department ?? ''} readOnly placeholder="—" /></div>
            <div className="ep-field"><label>Skill grade</label><input value={selected?.skillGrade ?? ''} readOnly placeholder="—" /></div>
            <div className="ep-field">
              <label>Mobile number</label>
              <input value={session.piiEnabled ? (selected?.mobile ?? '') : ''} readOnly placeholder={session.piiEnabled ? '—' : 'Hidden'} />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
