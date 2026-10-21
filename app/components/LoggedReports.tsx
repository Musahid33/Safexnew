'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Filter, ImagePlus, Loader2, RefreshCw, Search, X } from 'lucide-react';
import type { ReportStatus, ReportType } from '@/lib/types';
import './logged-reports.css';

/**
 * "Logged reports" — every report the selected site has stored in the database.
 *
 * No Employee ID and no mobile number: the list loads by itself, newest first, and a refresh
 * button re-reads it. Tapping a report opens it in a modal with the full stored record and,
 * when one was attached, the photo (served as a short-lived signed URL).
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
  photoUrl: string | null;
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
  const [selected, setSelected] = useState<LoggedReport | null>(null);
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
    } catch {
      if (seq !== requestSeq.current) return;
      setError('The reports service could not be reached. Check your connection and try again.');
      if (offset === 0) setFeed({ reports: [], total: 0 });
    }
  }, [siteId]);

  useEffect(() => {
    let active = true;
    setFeed({ reports: [], total: 0 });
    setSelected(null);
    setError('');
    if (!siteId) {
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void load(0).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, siteId]);

  // Escape closes the modal, the same way the rest of the app's dialogs behave.
  useEffect(() => {
    if (!selected) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setSelected(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

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
      <h2>Logged reports</h2>
      <button className="mlr-ghost" type="button" onClick={() => void refresh()} disabled={loading}>
        {loading ? <Loader2 size={14} className="mlr-spin" /> : <RefreshCw size={14} />} Refresh
      </button>
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

    {!loading && !error && <div className="mlr-counts">
      <span>{feed.total} logged</span>
      <span className="is-open">{counts.open} open</span>
      <span className="is-progress">{counts.progress} in progress</span>
      <span className="is-closed">{counts.closed} closed</span>
    </div>}

    {error && <div className="mlr-error" role="alert">
      <span>{error}</span>
      <button className="mlr-ghost" type="button" onClick={() => void refresh()}>Try again</button>
    </div>}

    {loading && <div className="mlr-loading"><Loader2 size={18} className="mlr-spin" /> Loading reports…</div>}

    {!siteId && !loading && <div className="mlr-empty">
      <ClipboardList size={26} aria-hidden="true" />
      <b>Choose a site first</b>
      <span>Logged reports are shown per site.</span>
    </div>}

    {siteId && !loading && !error && feed.reports.length === 0 && <div className="mlr-empty">
      <ClipboardList size={26} aria-hidden="true" />
      <b>No reports logged yet</b>
      <span>{siteName ? `${siteName} me` : 'Is site me'} abhi koi report database me nahi hai.</span>
    </div>}

    {!loading && !error && feed.reports.length > 0 && visible.length === 0 && <div className="mlr-empty">
      <Search size={24} aria-hidden="true" />
      <b>No report matches this filter</b>
      <span>Search ya type filter badal kar dobara dekho.</span>
    </div>}

    {visible.length > 0 && <ul className="mlr-list">
      {visible.map((report) => <li key={report.reference} className="mlr-report">
        <button className="mlr-report-head" type="button" onClick={() => setSelected(report)}>
          <span className="mlr-report-line">
            <span className="mlr-report-ref">{report.reference}</span>
            <span className={`mlr-report-type ${STATUS_CLASS[report.status]}`}>
              <i aria-hidden="true" />{report.status}
            </span>
          </span>
          <span className="mlr-report-summary">
            {report.type}{report.category ? ` · ${report.category}` : ''} — {report.summary}
          </span>
          <span className="mlr-report-meta">
            {report.hasPhoto && <ImagePlus size={13} className="mlr-photo-flag" aria-label="Photo attached" />}
            <span>{report.area || 'Area not stated'}</span>
            <span>{report.reporterName || 'Reporter not recorded'}</span>
            <span>{formatDay(report.filedAt)}</span>
          </span>
        </button>
      </li>)}
    </ul>}

    {!loading && !error && feed.reports.length < feed.total && <button
      className="mlr-load-more"
      type="button"
      onClick={() => void loadMore()}
      disabled={loadingMore}
    >
      {loadingMore ? <><Loader2 size={15} className="mlr-spin" /> Loading…</> : `Load ${Math.min(PAGE_SIZE, feed.total - feed.reports.length)} more`}
    </button>}

    {selected && <div
      className="overlay mlr-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="logged-report-title"
      onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }}
    >
      <div className="modal mlr-modal">
        <div className="mlr-modal-head">
          <div>
            <span className="mlr-report-ref mlr-modal-ref" id="logged-report-title">{selected.reference}</span>
            <span className={`mlr-report-type ${STATUS_CLASS[selected.status]}`}>
              <i aria-hidden="true" />{selected.status}
            </span>
          </div>
          <button className="mlr-modal-close" type="button" onClick={() => setSelected(null)} aria-label="Close report">
            <X size={18} />
          </button>
        </div>

        <p className="mlr-modal-summary">{selected.type}{selected.category ? ` · ${selected.category}` : ''} — {selected.summary}</p>

        <dl className="mlr-modal-grid">
          <div><dt>Type</dt><dd>{selected.type}</dd></div>
          <div><dt>Category</dt><dd>{selected.category || 'Not stated'}</dd></div>
          <div><dt>Area / location</dt><dd>{selected.area || 'Not stated'}</dd></div>
          <div><dt>Department</dt><dd>{selected.department || 'Not stated'}</dd></div>
          <div><dt>Severity</dt><dd>{selected.severity || 'Not stated'}</dd></div>
          <div><dt>Incident date</dt><dd>{formatDay(selected.occurredAt)}</dd></div>
          <div><dt>Filed on</dt><dd>{formatDay(selected.filedAt)}</dd></div>
          <div><dt>Reported by</dt><dd>{selected.reporterName || 'Not recorded'}</dd></div>
        </dl>

        <div className="mlr-modal-section">
          <b>Description</b>
          <p>{selected.description || selected.summary}</p>
        </div>

        {selected.immediateAction && <div className="mlr-modal-section">
          <b>Immediate action</b>
          <p>{selected.immediateAction}</p>
        </div>}

        <div className="mlr-modal-section">
          <b>Photo</b>
          {selected.photoUrl
            ? <a href={selected.photoUrl} target="_blank" rel="noreferrer noopener" className="mlr-modal-photo-link">
              <img src={selected.photoUrl} alt={`Photo attached to ${selected.reference}`} className="mlr-modal-photo" loading="lazy" />
            </a>
            : <p className="mlr-modal-nophoto">No photo attached to this report.</p>}
        </div>
      </div>
    </div>}
  </section>;
}
