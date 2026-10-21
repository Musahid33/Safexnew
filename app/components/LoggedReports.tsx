'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ClipboardList, Filter, ImagePlus, Loader2, LockKeyhole, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import type { ReportStatus, ReportType } from '@/lib/types';
import './logged-reports.css';

/**
 * "Logged reports" — every report the selected site has stored in the database.
 *
 * No Employee ID and no mobile number: the list loads by itself, newest first, and a refresh
 * button re-reads it. The screen only ever renders what the server sends; the server decides
 * the scope (this site, five safety types, never anonymous) in `lib/reports/site-feed.ts`.
 *
 * What the payload deliberately does not contain: employee number, mobile number, address —
 * anything that would turn a public feed into a contact list. The reporter's name is shown,
 * because a site feed with no name on it is not actionable.
 */

type LoggedReport = {
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
  reporterName: string | null;
  hasPhoto: boolean;
};

type Feed = { reports: LoggedReport[]; total: number };

const PAGE_SIZE = 100;
const TYPE_FILTERS: Array<'All' | ReportType> = [
  'All', 'Near Miss', 'Hazard', 'Unsafe Condition', 'Unsafe Act', 'Safety Observation'
];

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

export default function LoggedReports({ siteId, siteName }: { siteId?: string; siteName?: string }) {
  const [feed, setFeed] = useState<Feed>({ reports: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | ReportType>('All');
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  // A faster site switch must not be overwritten by the answer to the previous request.
  const requestSeq = useRef(0);

  const load = useCallback(async (offset = 0) => {
    if (!siteId) {
      setFeed({ reports: [], total: 0 });
      return;
    }
    const seq = ++requestSeq.current;
    const params = new URLSearchParams({ site: siteId, limit: String(PAGE_SIZE), offset: String(offset) });
    try {
      const response = await fetch(`/api/reports/site?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (seq !== requestSeq.current) return;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'Reports could not be loaded right now.');
        if (offset === 0) setFeed({ reports: [], total: 0 });
        return;
      }
      const incoming = (data.reports ?? []) as LoggedReport[];
      setFeed((current) => ({
        reports: offset === 0 ? incoming : [...current.reports, ...incoming],
        total: Number(data.total ?? incoming.length)
      }));
      setError('');
      setUpdatedAt(new Date());
    } catch {
      if (seq !== requestSeq.current) return;
      setError('The reports service could not be reached. Check your connection and try again.');
      if (offset === 0) setFeed({ reports: [], total: 0 });
    }
  }, [siteId]);

  useEffect(() => {
    let active = true;
    setFeed({ reports: [], total: 0 });
    setOpenRef(null);
    setError('');
    if (!siteId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void load(0).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, siteId]);

  async function refresh() {
    if (loading) return;
    setLoading(true);
    await load(0);
    setLoading(false);
  }

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    await load(feed.reports.length);
    setLoadingMore(false);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return feed.reports.filter((report) => {
      if (typeFilter !== 'All' && report.type !== typeFilter) return false;
      if (!needle) return true;
      return [report.reference, report.summary, report.description, report.area, report.department, report.reporterName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle);
    });
  }, [feed.reports, typeFilter, query]);

  const counts = useMemo(() => ({
    open: feed.reports.filter((report) => report.status === 'Open').length,
    progress: feed.reports.filter((report) => report.status === 'In Progress').length,
    closed: feed.reports.filter((report) => report.status === 'Closed').length
  }), [feed.reports]);

  return <section className="mlr-card">
    <div className="mlr-head">
      <span className="mlr-head-icon"><ClipboardList size={22} aria-hidden="true" /></span>
      <div className="mlr-head-copy">
        <h2>Logged reports</h2>
        <p>
          {siteName ? `${siteName}` : 'This site'} ke saare reports seedha database se — jo bhi log
          hua hai, sab yahan dikhta hai. Employee ID ya mobile number daalne ki zaroorat nahi.
        </p>
      </div>
      <span className="mlr-head-badge"><ShieldCheck size={12} aria-hidden="true" /> Live from database</span>
    </div>

    <div className="mlr-toolbar">
      <div className="mlr-search">
        <Search size={16} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reference, area or text…"
          aria-label="Search logged reports"
          maxLength={80}
        />
      </div>
      <button className="mlr-ghost" type="button" onClick={() => void refresh()} disabled={loading}>
        {loading ? <Loader2 size={14} className="mlr-spin" /> : <RefreshCw size={14} />} Refresh
      </button>
    </div>

    <div className="mlr-filters" role="group" aria-label="Filter by report type">
      <Filter size={14} aria-hidden="true" />
      {TYPE_FILTERS.map((type) => <button
        key={type}
        type="button"
        className={`mlr-filter${typeFilter === type ? ' is-active' : ''}`}
        aria-pressed={typeFilter === type}
        onClick={() => setTypeFilter(type)}
      >{type}</button>)}
    </div>

    {!loading && !error && <div className="mlr-counts mlr-counts-wide">
      <span>{feed.total} logged</span>
      <span className="is-open">{counts.open} open</span>
      <span className="is-progress">{counts.progress} in progress</span>
      <span className="is-closed">{counts.closed} closed</span>
      {updatedAt && <span className="mlr-updated">updated {updatedAt.toLocaleTimeString()}</span>}
    </div>}

    {error && <div className="mlr-error" role="alert">
      <span>{error}</span>
      <button className="mlr-ghost" type="button" onClick={() => void refresh()}>Try again</button>
    </div>}

    {loading && <div className="mlr-loading"><Loader2 size={18} className="mlr-spin" /> Loading reports from the database…</div>}

    {!siteId && !loading && <div className="mlr-empty">
      <ClipboardList size={26} aria-hidden="true" />
      <b>Choose a site first</b>
      <span>Logged reports are shown per site. Site select karo, phir yahan us site ke saare reports dikhenge.</span>
    </div>}

    {siteId && !loading && !error && feed.reports.length === 0 && <div className="mlr-empty">
      <ClipboardList size={26} aria-hidden="true" />
      <b>No reports logged yet</b>
      <span>
        {siteName ? `${siteName}` : 'Is site'} ke liye database me abhi ek bhi report nahi hai. Report
        submit hote hi woh yahan apne aap dikhegi.
      </span>
    </div>}

    {!loading && !error && feed.reports.length > 0 && visible.length === 0 && <div className="mlr-empty">
      <Search size={24} aria-hidden="true" />
      <b>No report matches this filter</b>
      <span>Search ya type filter badal kar dobara dekho.</span>
    </div>}

    {visible.length > 0 && <ul className="mlr-list">
      {visible.map((report) => {
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
            <span className="mlr-report-summary">
              {report.type}{report.category ? ` · ${report.category}` : ''} — {report.summary}
              {report.hasPhoto && <ImagePlus size={13} className="mlr-photo-flag" aria-label="Photo attached" />}
            </span>
            <span className="mlr-report-meta">
              <span>{report.area || 'Area not stated'}</span>
              <span>{report.reporterName || 'Reporter not recorded'}</span>
              <span>{formatDay(report.filedAt)}</span>
            </span>
          </button>

          {open && <div className="mlr-report-body">
            <dl>
              <div><dt>Report type</dt><dd>{report.type}</dd></div>
              <div><dt>Category</dt><dd>{report.category || 'Not stated'}</dd></div>
              <div><dt>Status</dt><dd>{report.status}</dd></div>
              <div><dt>Area / location</dt><dd>{report.area || 'Not stated'}</dd></div>
              <div><dt>Department</dt><dd>{report.department || 'Not stated'}</dd></div>
              <div><dt>Severity</dt><dd>{report.severity || 'Not stated'}</dd></div>
              <div><dt>Incident date</dt><dd>{formatDay(report.occurredAt)}</dd></div>
              <div><dt>Filed on</dt><dd>{formatDay(report.filedAt)}</dd></div>
              <div><dt>Reported by</dt><dd>{report.reporterName || 'Not recorded'}</dd></div>
              <div><dt>Photo</dt><dd>{report.hasPhoto ? 'Attached' : 'None'}</dd></div>
            </dl>
            <p className="mlr-report-text">{report.description || report.summary}</p>
            {report.immediateAction && <p className="mlr-report-action">
              <b>Immediate action:</b> {report.immediateAction}
            </p>}
          </div>}
        </li>;
      })}
    </ul>}

    {!loading && !error && feed.reports.length < feed.total && <button
      className="mlr-load-more"
      type="button"
      onClick={() => void loadMore()}
      disabled={loadingMore}
    >
      {loadingMore ? <><Loader2 size={15} className="mlr-spin" /> Loading…</> : `Load ${Math.min(PAGE_SIZE, feed.total - feed.reports.length)} more`}
    </button>}

    <p className="mlr-note">
      <LockKeyhole size={13} aria-hidden="true" />
      Employee ID aur mobile number yahan kabhi nahi dikhte. Speak Up, Grievance, Feedback aur
      Suggestion is list me nahi aate — woh safety console me confidential process se handle hote
      hain. Anonymous report bhi yahan nahi aati.
    </p>
  </section>;
}
