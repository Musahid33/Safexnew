'use client';

import { useCallback, useEffect, useState } from 'react';
import { MODULE_TITLES, filledModuleCount, type DmPlan } from '@/lib/dm/plan';

/**
 * DM Records — the archive.
 *
 * Every filed plan is a numbered PDF (DM-DD-MM-YY). This screen is the index: what was
 * filed, when, by whom, how much of the eleven modules it covers, and the document itself.
 */

export type DmRecordSummary = {
  id: string;
  reference: string;
  planDate: string;
  shift: string | null;
  supervisor: string | null;
  supervisorNo: string | null;
  location: string | null;
  modulesFilled: number;
  status: string;
  hasPdf: boolean;
  createdAt: string;
};

type Props = {
  siteId: string;
  /** Bumped after a successful filing so the list reloads without a remount. */
  refreshKey: number;
  justFiled?: string | null;
};

const formatDate = (iso: string) => {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatFiled = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function DmRecords({ siteId, refreshKey, justFiled }: Props) {
  const [records, setRecords] = useState<DmRecordSummary[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<DmPlan | null>(null);
  const [detailError, setDetailError] = useState('');
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (siteId && siteId !== 'all') params.set('siteId', siteId);
      const response = await fetch(`/api/admin/dm?${params}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'DM records could not be loaded.');
      setRecords(data.records as DmRecordSummary[]);
    } catch (cause) {
      setRecords([]);
      setError(cause instanceof Error ? cause.message : 'DM records could not be loaded.');
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  async function openRecord(record: DmRecordSummary) {
    if (expanded === record.id) { setExpanded(null); setDetail(null); return; }
    setExpanded(record.id);
    setDetail(null);
    setDetailError('');
    setLoadingDetail(true);
    try {
      const response = await fetch(`/api/admin/dm/${record.id}`, { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'That record could not be opened.');
      setDetail(data.record.plan as DmPlan);
    } catch (cause) {
      setDetailError(cause instanceof Error ? cause.message : 'That record could not be opened.');
    } finally {
      setLoadingDetail(false);
    }
  }

  const visible = (records ?? []).filter((record) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [record.reference, record.supervisor, record.supervisorNo, record.location, record.planDate]
      .filter(Boolean).join(' ').toLowerCase().includes(needle);
  });

  const pdfHref = (record: DmRecordSummary, inline = false) => {
    const params = new URLSearchParams();
    if (siteId && siteId !== 'all') params.set('siteId', siteId);
    if (inline) params.set('inline', '1');
    const query = params.toString();
    return `/api/admin/dm/${record.id}/pdf${query ? `?${query}` : ''}`;
  };

  return <div className="dm-records">
    <section className="dm-card">
      <header className="dm-card-head">
        <div>
          <span className="dm-eyebrow">DM RECORDS</span>
          <h2>Filed daily management plans</h2>
          <p>Every plan is stored with its PDF. The file name is the document number: DM-DD-MM-YY.</p>
        </div>
        <span className="dm-site-chip">{records ? `${records.length} record${records.length === 1 ? '' : 's'}` : 'Loading…'}</span>
      </header>

      {justFiled && <p className="dm-success" role="status">
        <strong>{justFiled}</strong> filed. The PDF is in the list below and in the DM archive bucket.
      </p>}

      <div className="dm-records-toolbar">
        <input
          type="search"
          value={search}
          placeholder="Search reference, supervisor or area…"
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search DM records"
        />
        <button type="button" className="dm-ghost" onClick={() => void load()}>Refresh</button>
      </div>

      {error && <p className="dm-error" role="alert">{error}</p>}

      {records === null && <p className="dm-muted">Loading records…</p>}

      {records !== null && records.length === 0 && !error && <p className="dm-empty-state">
        No DM records yet. Fill the first plan in <strong>Conduct DM</strong> — it will appear here with its PDF.
      </p>}

      {visible.length > 0 && <div className="dm-rows-scroll">
        <table className="dm-table dm-records-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Plan date</th>
              <th>Shift</th>
              <th>Supervisor</th>
              <th>Modules</th>
              <th>Filed</th>
              <th className="dm-records-actions">Document</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((record) => <RecordRow
              key={record.id}
              record={record}
              expanded={expanded === record.id}
              detail={expanded === record.id ? detail : null}
              detailError={expanded === record.id ? detailError : ''}
              loading={expanded === record.id && loadingDetail}
              onToggle={() => void openRecord(record)}
              pdfHref={pdfHref(record)}
              openHref={pdfHref(record, true)}
            />)}
          </tbody>
        </table>
      </div>}

      {records !== null && records.length > 0 && visible.length === 0 && <p className="dm-muted">
        No record matches “{search}”.
      </p>}
    </section>
  </div>;
}

function RecordRow({ record, expanded, detail, detailError, loading, onToggle, pdfHref, openHref }: {
  record: DmRecordSummary;
  expanded: boolean;
  detail: DmPlan | null;
  detailError: string;
  loading: boolean;
  onToggle: () => void;
  pdfHref: string;
  openHref: string;
}) {
  return <>
    <tr className={expanded ? 'is-open' : undefined}>
      <td data-label="Reference">
        <button type="button" className="dm-ref" onClick={onToggle} aria-expanded={expanded}>
          {record.reference}
        </button>
      </td>
      <td data-label="Plan date">{formatDate(record.planDate)}</td>
      <td data-label="Shift">{record.shift || '—'}</td>
      <td data-label="Supervisor">
        {record.supervisor || '—'}
        {record.supervisorNo && <small className="dm-sub">{record.supervisorNo}</small>}
      </td>
      <td data-label="Modules">
        <span className="dm-progress" aria-label={`${record.modulesFilled} of 11 modules`}>
          <span style={{ width: `${Math.min(100, (record.modulesFilled / 11) * 100)}%` }} />
        </span>
        <small className="dm-sub">{record.modulesFilled}/11</small>
      </td>
      <td data-label="Filed">{formatFiled(record.createdAt)}</td>
      <td className="dm-records-actions" data-label="Document">
        <a className="dm-doc" href={pdfHref}>PDF ↓</a>
        {/* Opens in the browser's PDF viewer instead of downloading. */}
        <a className="dm-doc is-light" href={openHref} target="_blank" rel="noopener noreferrer">Open</a>
      </td>
    </tr>
    {expanded && <tr className="dm-record-detail">
      <td colSpan={7} className="dm-detail-cell">
        {loading && <p className="dm-muted">Loading the plan…</p>}
        {detailError && <p className="dm-error" role="alert">{detailError}</p>}
        {detail && <PlanSummary plan={detail} />}
      </td>
    </tr>}
  </>;
}

function PlanSummary({ plan }: { plan: DmPlan }) {
  const m = plan.modules;
  const lines: [string, string][] = [
    [MODULE_TITLES[0], [m.permits.permitNo && `Permit ${m.permits.permitNo}`, m.permits.observations].filter(Boolean).join(' · ')],
    [MODULE_TITLES[1], [m.tbt.attendees && `${m.tbt.attendees} attendees`, m.tbt.theme].filter(Boolean).join(' · ')],
    [MODULE_TITLES[2], m.ppe.filter((row) => row.employee || (row.items ?? []).length)
      .map((row) => `${row.scope === 'all' ? 'All employees' : (row.employee || row.employeeNo)}: ${row.issue}${(row.items ?? []).length ? ` (${(row.items ?? []).join(', ')})` : ''}`)
      .join('; ')],
    [MODULE_TITLES[3], m.walkthrough.filter((row) => row.area || row.details || row.action)
      .map((row) => [
        row.type,
        row.severity && `severity ${row.severity}/5`,
        row.area,
        row.details,
        row.action && `action: ${row.action}`
      ].filter(Boolean).join(' · '))
      .join('; ')],
    [MODULE_TITLES[4], m.equipment.filter((row) => row.name).map((row) => `${row.name} — ${row.status}`).join('; ')],
    [MODULE_TITLES[5], m.tools.filter((row) => row.name).map((row) => `${row.name} — ${row.safe}`).join('; ')],
    [MODULE_TITLES[6], `${Object.keys(m.housekeeping.checks).length} checks answered · ${m.housekeeping.observations}`],
    [MODULE_TITLES[7], [m.interaction.team.filter((row) => row.name).map((row) => row.name).join(', '), m.interaction.feedback].filter(Boolean).join(' · ')],
    [MODULE_TITLES[8], [m.incident.categories.join(', '), m.incident.description].filter(Boolean).join(' · ')],
    [MODULE_TITLES[9], [
      m.training.employee && `${m.training.employee}${m.training.employeeNo ? ` (${m.training.employeeNo})` : ''}`,
      m.training.observation
    ].filter(Boolean).join(' · ')],
    [MODULE_TITLES[10], m.admin.filter((row) => row.sopNo).map((row) => `${row.sopNo} — ${row.compliance}`).join('; ')]
  ];

  return <div className="dm-summary">
    <div className="dm-summary-meta">
      <span>{plan.date}</span>
      <span>Shift {plan.shift}</span>
      <span>{plan.supervisor}{plan.supervisorNo ? ` · ${plan.supervisorNo}` : ''}</span>
      {plan.location && <span>{plan.location}</span>}
      <span>{filledModuleCount(plan)}/11 modules</span>
    </div>
    <ul>
      {lines.map(([title, value], index) => <li key={title} className={value ? undefined : 'is-empty'}>
        <strong>{index + 1}. {title}</strong>
        <span>{value || 'No entry recorded.'}</span>
      </li>)}
    </ul>
  </div>;
}
