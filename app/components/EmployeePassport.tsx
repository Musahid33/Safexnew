'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Award, BriefcaseBusiness, Building2, CalendarDays,
  Download, Eye, FileSpreadsheet, GraduationCap, HardHat,
  HeartPulse, IdCard, Lightbulb, LockKeyhole, Mail, MapPin, Phone, Printer, Search,
  ShieldCheck, SlidersHorizontal, TrafficCone, UserRound, X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Employee, Site } from '@/lib/types';
import { useI18n } from './I18nProvider';
import './employee-passport.css';

type Category = 'nearMiss' | 'observations' | 'training' | 'rewards' | 'suggestions' | 'ppe';
type HistoryRow = { date: string; title: string; detail: string; status: string; severity?: string };
export type PassportHistory = Partial<Record<Category, HistoryRow[]>>;

const CATEGORY: Record<Category, { label: string; icon: LucideIcon; tone: string; columns: string[] }> = {
  nearMiss: { label: 'Near Miss', icon: ShieldCheck, tone: 'mint', columns: ['Date', 'Location', 'Description', 'Severity', 'Status'] },
  observations: { label: 'Safety Observations', icon: TrafficCone, tone: 'amber', columns: ['Date', 'Location', 'Observation', 'Severity', 'Status'] },
  training: { label: 'Training Completed', icon: GraduationCap, tone: 'sky', columns: ['Date', 'Training', 'Duration', 'Status'] },
  rewards: { label: 'Rewards & Recognition', icon: Award, tone: 'violet', columns: ['Date', 'Title', 'Reason', 'Status'] },
  suggestions: { label: 'Suggestions', icon: Lightbulb, tone: 'cyan', columns: ['Date', 'Suggestion', 'Details', 'Status'] },
  ppe: { label: 'PPE Management', icon: HardHat, tone: 'rose', columns: ['Issued', 'PPE Name', 'Next due', 'Status'] }
};
const CATEGORIES = Object.keys(CATEGORY) as Category[];

function exportCsv(rows: HistoryRow[], category: Category, employeeNo: string) {
  const headers = CATEGORY[category].columns;
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  // Prepend an apostrophe to spreadsheet formula prefixes to prevent CSV injection.
  const safe = (value: string) => escape(/^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value);
  const csv = '\uFEFF' + [headers.join(','), ...rows.map((row) => [row.date, row.title, row.detail, ...(headers.length === 5 ? [row.severity ?? ''] : []), row.status].map(safe).join(','))].join('\r\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = `${employeeNo.replace(/[^\w-]/g, '')}_${category}_records.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function formatPassportDate(date: Date) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

/** Public lookup exposes only code, name and designation. No synthetic PII or history. */
export default function EmployeePassport({ employee, site, onBack, onClose, history = {} }: {
  employee: Employee; site: Site | null; onBack: () => void; onClose: () => void; history?: PassportHistory;
}) {
  const { T } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [sort, setSort] = useState('Newest first');
  const [page, setPage] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [generatedAt] = useState(() => new Date());
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => { setQrUrl(window.location.origin); }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeCategory) setActiveCategory(null);
      else onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [activeCategory, onClose]);

  function openHistory(category: Category) {
    setSearch(''); setFilter('All statuses'); setSort('Newest first'); setPage(0);
    setActiveCategory(category);
  }

  async function downloadPassport() {
    if (!sheetRef.current || downloading) return;
    setDownloadError(''); setDownloading(true);
    try {
      const { toPng } = await import('html-to-image');
      const data = await toPng(sheetRef.current, {
        backgroundColor: '#f7f9fe', pixelRatio: 2, cacheBust: true,
        // Match the sheet's actual on-screen width and height; don't export the overlay/toolbar.
        width: sheetRef.current.scrollWidth, height: sheetRef.current.scrollHeight
      });
      const name = employee.name.trim().replace(/[^a-z\d]+/gi, '_').replace(/^_|_$/g, '').slice(0, 72) || 'Employee';
      const code = employee.empNo.replace(/[^a-z\d]/gi, '') || 'Employee';
      const link = document.createElement('a');
      link.download = `${code}_${name}_Passport.png`;
      link.href = data;
      document.body.append(link); link.click(); link.remove();
    } catch {
      setDownloadError('Could not capture the passport image. Please try again in this browser.');
    } finally { setDownloading(false); }
  }

  const detailRows: { label: string; value: string; icon: LucideIcon }[] = [
    { label: 'Company Name', value: 'Not on record', icon: Building2 },
    { label: 'Safety Pass No.', value: 'Not available in public profile', icon: IdCard },
    { label: 'Blood Group', value: 'Private · verified access required', icon: HeartPulse },
    { label: 'Mobile No.', value: 'Private · verified access required', icon: Phone },
    { label: 'Email ID', value: 'Not on record', icon: Mail },
    { label: 'Address', value: 'Private · verified access required', icon: MapPin }
  ];

  const allRows = activeCategory ? history[activeCategory] ?? [] : [];
  const statuses = [...new Set(allRows.map((row) => row.status))];
  const filtered = allRows.filter((row) => (filter === 'All statuses' || row.status === filter) &&
    `${row.date} ${row.title} ${row.detail} ${row.status}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const compare = (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      return sort === 'Oldest first' ? compare : -compare;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8));
  const visible = filtered.slice(page * 8, page * 8 + 8);
  const active = activeCategory ? CATEGORY[activeCategory] : null;

  return <div className="passport-overlay" role="dialog" aria-modal="true" aria-label="Employee Passport">
    <div className="passport-scroll">
      <div className="passport-toolbar">
        <button type="button" onClick={onBack}><ArrowLeft size={16} /> {T('Search another employee')}</button>
        <span>EMPLOYEE DIRECTORY <span aria-hidden="true">/</span> PASSPORT</span>
        <button type="button" className="passport-close" onClick={onClose} aria-label={T('Close employee profile')}><X size={19} /></button>
      </div>
      {downloadError && <p className="passport-download-error" role="alert">{downloadError}</p>}
      <div className="passport-frame">
        <div className="passport-sheet" ref={sheetRef} aria-hidden={Boolean(activeCategory)}>
          <header className="passport-header">
            <div className="passport-logo"><img src="/icon.svg" alt="Safex" /></div>
            <div className="passport-header-copy"><span>SAFEX  /  EMPLOYEE RECORD</span><h1>EMPLOYEE PASSPORT</h1><p>Employee Safety Profile</p></div>
            <div className="passport-header-mark" aria-hidden="true"><ShieldCheck size={56} strokeWidth={1.15} /></div>
          </header>
          <div className="passport-preview-ribbon"><ShieldCheck size={15} /> Directory-only preview <span>·</span> Not a verified ID or safety clearance</div>
          <section className="passport-intro" aria-label="Employee profile">
            <div className="passport-person">
              <div className="passport-photo" aria-label="Employee photo not available"><UserRound size={56} strokeWidth={1.4} /></div>
              <span className="passport-id">{employee.empNo}</span>
              <h2>{employee.name}</h2>
              <p>{employee.designation || 'Designation not on record'}</p>
              <div className="passport-person-site"><MapPin size={13} /> {site?.name ?? 'Selected site'}</div>
            </div>
            <div className="passport-details">
              <div className="passport-section-title"><span className="passport-title-icon blue"><UserRound size={20} /></span><div><h2>Personal Details</h2><p>Available employee directory information</p></div><span className="passport-details-lock"><LockKeyhole size={14} /> Privacy protected</span></div>
              <dl>{detailRows.map(({ label, value, icon: Icon }) => <div key={label}><dt><Icon size={16} aria-hidden="true" />{label}</dt><dd className={value.startsWith('Private') ? 'passport-private' : ''}>{value}</dd></div>)}</dl>
              <div className="passport-privacy-note"><ShieldCheck size={16} /> Sensitive details are intentionally hidden in public search. Real photo and record history require an authenticated, consent-based data source.</div>
            </div>
          </section>
          <section className="passport-performance" aria-label="Safety performance">
            <div className="passport-section-title"><span className="passport-title-icon blue"><BriefcaseBusiness size={20} /></span><div><h2>Safety Performance</h2><p>Tap a category to explore employee records</p></div><span className="passport-availability">HISTORY NOT CONNECTED</span></div>
            <div className="passport-kpi-grid">{CATEGORIES.map((category) => {
              const config = CATEGORY[category]; const Icon = config.icon;
              return <button className={`passport-kpi ${config.tone}`} key={category} type="button" onClick={() => openHistory(category)} aria-label={`Open ${config.label} records`}>
                <span className="passport-kpi-top"><Icon size={23} strokeWidth={2.1} /><ArrowRight size={17} /></span>
                <strong>{history[category] ? history[category].length.toString().padStart(2, '0') : '—'}</strong>
                <span>{config.label}</span>
                <small>{history[category] ? 'View records' : 'Not connected yet'}</small>
              </button>;
            })}</div>
          </section>
          <section className="passport-ppe" aria-label="PPE management">
            <div className="passport-section-title"><span className="passport-title-icon blue"><HardHat size={20} /></span><div><h2>PPE Management</h2><p>Issue and renewal tracking</p></div><button className="passport-view-all" type="button" onClick={() => openHistory('ppe')}>View all <ArrowRight size={15} /></button></div>
            <div className="passport-table-scroll"><table><thead><tr><th>PPE Name</th><th>Issue Date</th><th>Next Due Date</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>{(history.ppe ?? []).length ? history.ppe?.slice(0, 5).map((row, index) => <tr key={`${row.date}-${index}`}><td>{row.title}</td><td>{row.date}</td><td>{row.detail}</td><td><span className="passport-status">{row.status}</span></td><td><button type="button" aria-label={`View ${row.title} history`} onClick={() => openHistory('ppe')}><Eye size={17} /></button></td></tr>) : <tr><td colSpan={5} className="passport-table-empty"><HardHat size={22} /> No PPE records connected for this profile.</td></tr>}</tbody></table></div>
          </section>
          <footer className="passport-footer">
            <div className="passport-qr">{qrUrl ? <QRCodeSVG value={qrUrl} size={72} marginSize={0} title="Scan to open Safex" /> : <ShieldCheck size={55} />}<small>Scan to open Safex</small></div>
            <div className="passport-footer-person"><b>{employee.empNo}</b><strong>{employee.name}</strong><span>{employee.designation || 'Designation not on record'}</span><small>Company not on record · {site?.name ?? 'Selected site'}</small></div>
            <div className="passport-footer-meta"><span><CalendarDays size={15} /> Generated on</span><time dateTime={generatedAt.toISOString()}>{formatPassportDate(generatedAt)}</time><b>Powered by <em>Safex</em></b></div>
          </footer>
        </div>
        <button type="button" className="passport-download" onClick={() => void downloadPassport()} disabled={downloading} title="Download Employee Passport" aria-label={downloading ? 'Creating passport PNG' : 'Download Employee Passport as PNG'}><Download size={22} /></button>
      </div>
    </div>
    {activeCategory && active && <div className="passport-record-overlay" role="dialog" aria-modal="true" aria-labelledby="passport-record-title">
      <div className="passport-record-dialog">
        <header><span className={`passport-record-icon ${active.tone}`}><active.icon size={21} /></span><div><span>EMPLOYEE PASSPORT / RECORDS</span><h2 id="passport-record-title">{active.label}</h2></div><button type="button" aria-label="Close records" onClick={() => setActiveCategory(null)}><X size={20} /></button></header>
        <div className="passport-record-tools"><label><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search records…" aria-label="Search records" /></label><label><SlidersHorizontal size={15} /><select aria-label="Filter by status" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option>All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label><label><ArrowDown size={15} /><select aria-label="Sort records" value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest first</option><option>Oldest first</option></select></label></div>
        <div className="passport-table-scroll"><table><thead><tr>{active.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{visible.length ? visible.map((row, index) => <tr key={`${row.date}-${index}`}><td>{row.date}</td><td>{row.title}</td><td>{row.detail}</td>{active.columns.length === 5 && <td>{row.severity || '—'}</td>}<td><span className="passport-status">{row.status}</span></td></tr>) : <tr><td colSpan={active.columns.length} className="passport-table-empty"><LockKeyhole size={20} /> {allRows.length ? 'No matching records.' : 'Records for this category are not connected yet. No sample history is shown.'}</td></tr>}</tbody></table></div>
        <footer><span>{filtered.length ? `${filtered.length} records · Page ${page + 1} of ${pageCount}` : 'No records available'}</span><div className="passport-record-pages"><button type="button" disabled={!page} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ArrowLeft size={16} /></button><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ArrowRight size={16} /></button></div><button type="button" disabled={!filtered.length} title={!filtered.length ? 'No records to export' : 'Export Excel-compatible CSV'} onClick={() => exportCsv(filtered, activeCategory, employee.empNo)}><FileSpreadsheet size={16} /> Export Excel (CSV)</button><button type="button" disabled={!filtered.length} title={!filtered.length ? 'No records to print' : 'Print records'} onClick={() => window.print()}><Printer size={16} /> Print</button></footer>
      </div>
    </div>}
  </div>;
}
