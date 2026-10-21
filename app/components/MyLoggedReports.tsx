'use client';

import { useState } from 'react';
import { ChevronDown, ClipboardList, Loader2, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ReportStatus, ReportType } from '@/lib/types';
import './my-reports.css';

/**
 * "My logged reports".
 *
 * Reads the reports this employee submitted from the app, straight from the database, after
 * their Employee ID and the mobile number registered in the master agree. The server decides
 * what may be returned: own reports only, never anonymous, and never Speak Up, Grievance,
 * Feedback or Suggestion. This screen only renders what it is given.
 */

type WorkerReport = {
  reference: string;
  type: ReportType;
  category: string | null;
  area: string | null;
  department: string | null;
  severity: string | null;
  occurredAt: string | null;
  filedAt: string;
  status: ReportStatus;
  summary: string;
  description: string;
  immediateAction: string | null;
};

type Verified = { employeeName: string; employeeNo: string; reports: WorkerReport[] };

const STATUS_CLASS: Record<ReportStatus, string> = {
  Open: 'is-open',
  'In Progress': 'is-progress',
  Closed: 'is-closed'
};

function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export default function MyLoggedReports({ siteName }: { siteName?: string }) {
  const [employeeNo, setEmployeeNo] = useState('');
  const [mobile, setMobile] = useState('');
  const [verified, setVerified] = useState<Verified | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [checkedFor, setCheckedFor] = useState<string>('');

  async function lookup(event?: React.FormEvent) {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/reports/mine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeNo, mobile })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setVerified(null);
        setCheckedFor('');
        setError(data?.error ?? 'Your reports could not be loaded right now.');
        return;
      }
      setVerified({
        employeeName: String(data.employeeName ?? ''),
        employeeNo: String(data.employeeNo ?? ''),
        reports: (data.reports ?? []) as WorkerReport[]
      });
      setCheckedFor(employeeNo.trim().toUpperCase());
      setOpenRef(null);
    } catch {
      setVerified(null);
      setError('The reports service could not be reached. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const reports = verified?.reports ?? [];
  const counts = {
    open: reports.filter((report) => report.status === 'Open').length,
    progress: reports.filter((report) => report.status === 'In Progress').length,
    closed: reports.filter((report) => report.status === 'Closed').length
  };

  return <section className="mlr-card">
    <div className="mlr-head">
      <span className="mlr-head-icon"><ClipboardList size={22} aria-hidden="true" /></span>
      <div className="mlr-head-copy">
        <h2>My logged reports</h2>
        <p>
          Apne bheje hue reports yahan dikhte hain{siteName ? ` · ${siteName}` : ''}. Employee ID aur
          registered mobile dono match hone par hi list khulti hai — mobile employee master me
          registered hona chahiye.
        </p>
      </div>
      <span className="mlr-head-badge"><LockKeyhole size={12} aria-hidden="true" /> Verified lookup</span>
    </div>

    {!verified && <form className="mlr-form" onSubmit={lookup}>
      <label className="mlr-field">
        <span>Employee ID</span>
        <input
          value={employeeNo}
          onChange={(event) => setEmployeeNo(event.target.value.toUpperCase())}
          placeholder="e.g. EIPL-1042"
          autoComplete="off"
          maxLength={32}
          required
        />
      </label>
      <label className="mlr-field">
        <span>Registered mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          value={mobile}
          onChange={(event) => setMobile(event.target.value)}
          placeholder="+91 98765 43210"
          autoComplete="tel"
          maxLength={20}
          required
        />
      </label>
      <button className="mlr-primary" type="submit" disabled={loading}>
        {loading
          ? <><Loader2 size={16} className="mlr-spin" /> Checking…</>
          : <><ShieldCheck size={16} /> View my reports</>}
      </button>
    </form>}

    {error && <p className="mlr-error" role="alert">{error}</p>}

    {verified && <>
      <div className="mlr-verified">
        <span className="mlr-verified-name"><ShieldCheck size={15} aria-hidden="true" /> {verified.employeeName}</span>
        <span className="mlr-verified-id">{verified.employeeNo}</span>
        <div className="mlr-counts">
          <span>{reports.length} total</span>
          <span className="is-open">{counts.open} open</span>
          <span className="is-progress">{counts.progress} in progress</span>
          <span className="is-closed">{counts.closed} closed</span>
        </div>
        <button className="mlr-ghost" type="button" onClick={() => void lookup()} disabled={loading}>
          {loading ? <Loader2 size={14} className="mlr-spin" /> : <RefreshCw size={14} />} Refresh
        </button>
        <button className="mlr-ghost" type="button" onClick={() => { setVerified(null); setError(''); setOpenRef(null); }}>
          Not me
        </button>
      </div>

      {reports.length === 0
        ? <div className="mlr-empty">
          <ClipboardList size={26} aria-hidden="true" />
          <b>No reports on record yet</b>
          <span>
            {checkedFor} se abhi tak koi report database me nahi hai. Report bhejne ke baad yahan
            dikhegi — status Open se In Progress aur Closed tak update hota rahega.
          </span>
        </div>
        : <ul className="mlr-list">
          {reports.map((report) => {
            const open = openRef === report.reference;
            return <li key={report.reference} className={`mlr-report${open ? ' is-open' : ''}`}>
              <button
                className="mlr-report-head"
                type="button"
                onClick={() => setOpenRef(open ? null : report.reference)}
                aria-expanded={open}
              >
                <span className="mlr-report-ref">{report.reference}</span>
                <span className={`mlr-report-type ${STATUS_CLASS[report.status]}`}>
                  <i aria-hidden="true" />{report.status}
                </span>
                <ChevronDown size={16} className="mlr-caret" aria-hidden="true" />
                <span className="mlr-report-summary">{report.type}{report.category ? ` · ${report.category}` : ''} — {report.summary}</span>
                <span className="mlr-report-meta">
                  <span>{report.area || 'Area not stated'}</span>
                  <span>{formatDay(report.filedAt)}</span>
                </span>
              </button>

              {open && <div className="mlr-report-body">
                <dl>
                  <div><dt>Report type</dt><dd>{report.type}</dd></div>
                  <div><dt>Status</dt><dd>{report.status}</dd></div>
                  <div><dt>Area / location</dt><dd>{report.area || 'Not stated'}</dd></div>
                  <div><dt>Department</dt><dd>{report.department || 'Not stated'}</dd></div>
                  <div><dt>Severity</dt><dd>{report.severity || 'Not stated'}</dd></div>
                  <div><dt>Incident date</dt><dd>{formatDay(report.occurredAt)}</dd></div>
                  <div><dt>Filed on</dt><dd>{formatDay(report.filedAt)}</dd></div>
                </dl>
                <p className="mlr-report-text">{report.description || report.summary}</p>
                {report.immediateAction && <p className="mlr-report-action">
                  <b>Immediate action:</b> {report.immediateAction}
                </p>}
              </div>}
            </li>;
          })}
        </ul>}

    </>}

    <p className="mlr-note">
      <LockKeyhole size={13} aria-hidden="true" />
      Speak Up, Grievance, Feedback aur Suggestion yahan kabhi nahi aate — woh safety console
      me confidential process se handled hote hain. Anonymous report bhi is list me nahi aati.
    </p>
  </section>;
}
