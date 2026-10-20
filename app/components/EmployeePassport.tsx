'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowLeft, ArrowRight, Award, BriefcaseBusiness, Building2, CalendarDays,
  CheckCircle2, ChevronRight, ClipboardCheck, Copy, Download, FileSpreadsheet, GraduationCap,
  HardHat, HeartPulse, IdCard, Lightbulb, Lock, Mail, MapPin, MessageSquare, Phone, Printer,
  Search, ShieldAlert, ShieldCheck, SlidersHorizontal, TriangleAlert, UserRound, UserX, X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { Employee, Site } from '@/lib/types';
import { useI18n } from './I18nProvider';
import './employee-passport.css';

type Category =
  | 'nearMiss' | 'hazard' | 'unsafeAct' | 'unsafeCondition'
  | 'training' | 'rewards' | 'suggestions' | 'feedback' | 'ppe';
type HistoryRow = { date: string; title: string; detail: string; status: string; severity?: string };
export type PassportHistory = Partial<Record<Category, HistoryRow[]>>;

type CardConfig = {
  label: string;
  caption: string;
  badge: string;
  icon: LucideIcon;
  tone: string;
  columns: string[];
  severity?: boolean;
};

/**
 * The eight record cards from the approved Safety Passport design. Keys map onto the
 * report types the database actually stores, so the same card can later be wired to a
 * count without changing the layout.
 */
const CATEGORY: Record<Category, CardConfig> = {
  nearMiss: { label: 'Near Miss', caption: 'Incidents reported', badge: 'Logged', icon: ShieldCheck, tone: 'emerald', columns: ['Date', 'Location', 'Description', 'Severity', 'Status'], severity: true },
  hazard: { label: 'Hazard Reports', caption: 'Identified risks', badge: 'Reported', icon: ShieldAlert, tone: 'rose', columns: ['Date', 'Location', 'Hazard', 'Severity', 'Status'], severity: true },
  unsafeAct: { label: 'Unsafe Acts', caption: 'Unsafe practices', badge: 'Reported', icon: UserX, tone: 'orange', columns: ['Date', 'Location', 'Unsafe act', 'Severity', 'Status'], severity: true },
  unsafeCondition: { label: 'Unsafe Conditions', caption: 'Physical hazards', badge: 'Reported', icon: TriangleAlert, tone: 'red', columns: ['Date', 'Location', 'Condition', 'Severity', 'Status'], severity: true },
  training: { label: 'Training Records', caption: 'Sessions attended', badge: 'Completed', icon: GraduationCap, tone: 'sky', columns: ['Date', 'Training', 'Duration', 'Status'] },
  rewards: { label: 'Rewards Records', caption: 'Recognitions', badge: 'Earned', icon: Award, tone: 'violet', columns: ['Date', 'Title', 'Reason', 'Status'] },
  suggestions: { label: 'Suggestions', caption: 'Safety ideas', badge: 'Submitted', icon: Lightbulb, tone: 'indigo', columns: ['Date', 'Suggestion', 'Details', 'Status'] },
  feedback: { label: 'Feedback', caption: 'Audit responses', badge: 'Shared', icon: MessageSquare, tone: 'teal', columns: ['Date', 'Topic', 'Feedback', 'Status'] },
  ppe: { label: 'PPE Management', caption: 'Issue & renewal', badge: 'Issued', icon: HardHat, tone: 'amber', columns: ['Issued', 'PPE name', 'Next due', 'Status'] }
};

const SUMMARY_CARDS: Category[] = [
  'nearMiss', 'hazard', 'unsafeAct', 'unsafeCondition', 'training', 'rewards', 'suggestions', 'feedback'
];

function exportCsv(rows: HistoryRow[], category: Category, employeeNo: string) {
  const headers = CATEGORY[category].columns;
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  // Prepend an apostrophe to spreadsheet formula prefixes to prevent CSV injection.
  const safe = (value: string) => escape(/^[\s]*[=+@\-\t\r]/.test(value) ? `'${value}` : value);
  const csv = '\uFEFF' + [
    headers.join(','),
    ...rows.map((row) => [row.date, row.title, row.detail, ...(CATEGORY[category].severity ? [row.severity ?? ''] : []), row.status].map(safe).join(','))
  ].join('\r\n');
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

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'SA';
}

async function copyToClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.focus();
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('copy failed');
}

type DetailRow = {
  label: string;
  value: string;
  icon: LucideIcon;
  /** `restricted` = withheld by policy, `missing` = no source column yet. */
  state?: 'restricted' | 'missing' | 'accent' | 'danger';
};

/**
 * Employee Safety Passport.
 *
 * Public lookup returns only directory-safe fields, so this renders exactly those and
 * labels the rest honestly: "Verified staff access required" for PII (mobile, blood group,
 * address, date of birth) and "Not on record" for fields the master does not hold yet
 * (photo, email, joining date, pass validity). No sample employee, photo or record count
 * is ever invented, and no fabricated history is drawn when a source is empty.
 */
export default function EmployeePassport({ employee, site, companyName, onBack, onClose, history = {} }: {
  employee: Employee;
  site: Site | null;
  companyName?: string | null;
  onBack: () => void;
  onClose: () => void;
  history?: PassportHistory;
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
  const [toast, setToast] = useState('');
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
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // `undefined` means the server withheld the credential; `null` means it is not recorded.
  const passRevealed = employee.safetyPassNo !== undefined;
  const passNumber = typeof employee.safetyPassNo === 'string' && employee.safetyPassNo.trim()
    ? employee.safetyPassNo.trim()
    : null;
  const isActive = employee.active !== false;
  const employer = companyName?.trim() || 'Company not on record';
  const siteLabel = site ? `${site.name}${site.region ? ` · ${site.region}` : ''}` : 'Site not selected';

  const detailRows: DetailRow[] = ([
    { label: 'Full Name', value: employee.name, icon: UserRound },
    { label: 'Employee ID', value: employee.empNo, icon: IdCard },
    { label: 'Safety Pass Validity', value: 'Not on record', icon: CalendarDays, state: 'missing' },
    { label: 'Designation', value: employee.designation || 'Not on record', icon: BriefcaseBusiness },
    { label: 'Department', value: employee.department || 'Not on record', icon: BriefcaseBusiness, state: employee.department ? undefined : 'missing' },
    { label: 'Blood Group', value: 'Verified staff access required', icon: HeartPulse, state: 'restricted' },
    { label: 'Skill Grade', value: employee.skillGrade || 'Not on record', icon: Award, state: employee.skillGrade ? 'accent' : 'missing' },
    { label: 'Mobile No.', value: 'Verified staff access required', icon: Phone, state: 'restricted' },
    { label: 'Email ID', value: 'Not on record', icon: Mail, state: 'missing' },
    { label: 'Company', value: employer, icon: Building2 },
    { label: 'Site / Location', value: siteLabel, icon: MapPin },
    { label: 'Address', value: 'Verified staff access required', icon: MapPin, state: 'restricted' },
    { label: 'Joining Date', value: 'Not on record', icon: CalendarDays, state: 'missing' }
  ] as (Omit<DetailRow, 'icon'> & { icon?: LucideIcon })[]).map((row) => ({
    ...row,
    // Identity rows carry no icon in the design, so give them the same footprint.
    icon: row.icon ?? UserRound
  }));

  const allRows = activeCategory ? history[activeCategory] ?? [] : [];
  const statuses = [...new Set(allRows.map((row) => row.status))];
  const filtered = allRows
    .filter((row) => (filter === 'All statuses' || row.status === filter)
      && `${row.date} ${row.title} ${row.detail} ${row.status}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const compare = (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      return sort === 'Oldest first' ? compare : -compare;
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8));
  const visible = filtered.slice(page * 8, page * 8 + 8);
  const active = activeCategory ? CATEGORY[activeCategory] : null;

  const trainingRows = useMemo(() => (history.training ?? []).slice(0, 3), [history.training]);
  const ppeRows = useMemo(() => (history.ppe ?? []).slice(0, 2), [history.ppe]);

  function openHistory(category: Category) {
    setSearch(''); setFilter('All statuses'); setSort('Newest first'); setPage(0);
    setActiveCategory(category);
  }

  async function copyPassNumber() {
    if (!passNumber) return;
    try {
      await copyToClipboard(passNumber);
      setToast('Safety Pass Number copied');
    } catch {
      setToast('Could not copy the pass number');
    }
  }

  async function downloadPassport() {
    if (!sheetRef.current || downloading) return;
    setDownloadError(''); setDownloading(true);
    try {
      const { toPng } = await import('html-to-image');
      const data = await toPng(sheetRef.current, {
        backgroundColor: '#eef3f9', pixelRatio: 2, cacheBust: true,
        // Match the sheet's actual on-screen width and height; don't export the overlay/toolbar.
        width: sheetRef.current.scrollWidth, height: sheetRef.current.scrollHeight
      });
      const name = employee.name.trim().replace(/[^a-z\d]+/gi, '_').replace(/^_|_$/g, '').slice(0, 72) || 'Employee';
      const code = employee.empNo.replace(/[^a-z\d]/gi, '') || 'Employee';
      const link = document.createElement('a');
      link.download = `${code}_${name}_Safety_Passport.png`;
      link.href = data;
      document.body.append(link); link.click(); link.remove();
    } catch {
      setDownloadError('Could not capture the passport image. Please try again in this browser.');
    } finally { setDownloading(false); }
  }

  return <div className="passport-overlay" role="dialog" aria-modal="true" aria-label="Employee Safety Passport">
    <div className="passport-scroll">
      <div className="passport-toolbar">
        <button type="button" onClick={onBack}><ArrowLeft size={16} /> {T('Search another employee')}</button>
        <span>EMPLOYEE DIRECTORY <span aria-hidden="true">/</span> SAFETY PASSPORT</span>
        <button type="button" className="passport-close" onClick={onClose} aria-label={T('Close employee profile')}><X size={19} /></button>
      </div>

      {downloadError && <p className="passport-download-error" role="alert">{downloadError}</p>}
      {toast && <p className="passport-toast" role="status"><CheckCircle2 size={16} /> {toast}</p>}

      <div className="passport-frame">
        <div className="passport-sheet" ref={sheetRef} aria-hidden={Boolean(activeCategory)}>
          <header className="pp-hero">
            <div className="pp-hero-main">
              <span className="pp-hero-icon"><IdCard size={24} /></span>
              <div>
                <h1>Employee Safety Passport</h1>
                <p>Digital safety credential &amp; records portal</p>
              </div>
            </div>
            <div className={`pp-hero-status ${isActive ? '' : 'is-inactive'}`}>
              <span className="pp-dot" aria-hidden="true" />
              {isActive ? 'Active employee record' : 'Inactive employee record'}
            </div>
          </header>

          <div className="pp-ribbon">
            <ShieldCheck size={14} /> Directory-only preview <span>·</span> Not a verified ID or safety clearance
          </div>

          <div className="pp-body">
            <div className="pp-columns">
              <div className="pp-col-main">

                <section className="pp-card pp-profile" aria-label="Employee profile">
                  <div className={`pp-avatar ${isActive ? '' : 'is-inactive'}`} aria-label="Employee photograph not on record">
                    <span>{initials(employee.name)}</span>
                  </div>
                  <div className="pp-profile-copy">
                    <span className={`pp-chip ${isActive ? 'active' : 'inactive'}`}>
                      {isActive ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}
                      {isActive ? 'Active' : 'Inactive'}
                    </span>
                    <h2>{employee.name}</h2>
                    <p className="pp-empno">EMP ID : <strong>{employee.empNo}</strong></p>
                    {passNumber
                      ? <div className="pp-pass">
                          <span>Safety Pass No:</span>
                          <strong>{passNumber}</strong>
                          <button type="button" onClick={() => void copyPassNumber()} title="Copy pass number" aria-label="Copy Safety Pass Number"><Copy size={13} /></button>
                        </div>
                      : <div className="pp-pass is-locked">
                          <Lock size={12} />
                          <span>{passRevealed ? 'Safety pass number not on record' : 'Safety pass number · verified staff access'}</span>
                        </div>}
                    <p className="pp-photo-note">Photograph not on record · initials shown instead</p>
                  </div>
                </section>

                <section className="pp-card" aria-labelledby="pp-details-title">
                  <div className="pp-card-head">
                    <span className="pp-head-icon blue"><UserRound size={17} /></span>
                    <div className="pp-head-copy">
                      <h3 id="pp-details-title">Personal Details</h3>
                      <p>Directory-approved employee information</p>
                    </div>
                    <span className="pp-head-note"><Lock size={12} /> Privacy protected</span>
                  </div>
                  <dl className="pp-details">
                    {detailRows.map(({ label, value, icon: Icon, state }) => <div key={label} className={state === 'accent' ? 'is-accent' : ''}>
                      <dt><Icon size={14} aria-hidden="true" />{label}</dt>
                      <dd className={`${state ? `is-${state}` : ''}`}>{state === 'restricted' && <Lock size={11} aria-hidden="true" />}{value}</dd>
                    </div>)}
                  </dl>
                  <p className="pp-note"><ShieldCheck size={14} /> Mobile number, blood group, address and date of birth are withheld from public search. Ask a verified safety officer for an authorised record.</p>
                </section>

                <section className="pp-card" aria-labelledby="pp-summary-title">
                  <div className="pp-card-head">
                    <span className="pp-head-icon blue"><ClipboardCheck size={17} /></span>
                    <div className="pp-head-copy">
                      <h3 id="pp-summary-title">Safety Record Summary</h3>
                      <p>Overview of logged safety metrics &amp; activities</p>
                    </div>
                    <span className="pp-head-note">Not connected</span>
                  </div>
                  <div className="pp-kpi-grid">
                    {SUMMARY_CARDS.map((category) => {
                      const config = CATEGORY[category];
                      const Icon = config.icon;
                      const rows = history[category];
                      return <button key={category} type="button" className={`pp-kpi ${config.tone}`} onClick={() => openHistory(category)} aria-label={`Open ${config.label} records`}>
                        <span className="pp-kpi-top">
                          <span className="pp-kpi-icon"><Icon size={15} /></span>
                          <span className="pp-kpi-badge">{rows ? config.badge : 'Private'}</span>
                        </span>
                        <span className="pp-kpi-value">{rows ? String(rows.length).padStart(2, '0') : '—'}</span>
                        <span className="pp-kpi-label">{config.label}</span>
                        <span className="pp-kpi-caption">{rows ? config.caption : 'Requires staff access'}</span>
                      </button>;
                    })}
                  </div>
                  <p className="pp-note"><Lock size={14} /> Record counts are personal performance data, so public search shows none. Officers see them after sign-in.</p>
                </section>
              </div>

              <div className="pp-col-side">
                <section className="pp-card" aria-labelledby="pp-training-title">
                  <div className="pp-card-head">
                    <span className="pp-head-icon blue"><GraduationCap size={17} /></span>
                    <div className="pp-head-copy">
                      <h3 id="pp-training-title">Latest Training Records</h3>
                      <p>Completed safety sessions</p>
                    </div>
                    <button type="button" className="pp-link" onClick={() => openHistory('training')}>View all <ChevronRight size={12} /></button>
                  </div>
                  <div className="pp-training-list">
                    {trainingRows.length ? trainingRows.map((row, index) => <div className="pp-training-row" key={`${row.date}-${index}`}>
                      <span className="pp-training-icon"><GraduationCap size={16} /></span>
                      <div><b>{row.title}</b><small>{row.date}</small></div>
                      <span className="pp-status">{row.status}</span>
                    </div>) : <div className="pp-empty"><GraduationCap size={22} /><b>No training records connected</b><span>Training history is not linked to public lookup yet. Nothing is inferred from an Employee ID.</span></div>}
                  </div>
                </section>

                <section className="pp-card" aria-labelledby="pp-ppe-title">
                  <div className="pp-card-head">
                    <span className="pp-head-icon blue"><HardHat size={17} /></span>
                    <div className="pp-head-copy">
                      <h3 id="pp-ppe-title">PPE Management</h3>
                      <p>Issue and renewal tracking</p>
                    </div>
                    <button type="button" className="pp-link" onClick={() => openHistory('ppe')}>View all <ChevronRight size={12} /></button>
                  </div>
                  {ppeRows.length ? <div className="pp-training-list">{ppeRows.map((row, index) => <div className="pp-training-row" key={`${row.date}-${index}`}>
                    <span className="pp-training-icon"><HardHat size={16} /></span>
                    <div><b>{row.title}</b><small>{row.date} · next {row.detail}</small></div>
                    <span className="pp-status">{row.status}</span>
                  </div>)}</div> : <div className="pp-empty"><HardHat size={22} /><b>No PPE records connected</b><span>PPE issue and renewal tracking is not linked to this profile yet.</span></div>}
                </section>

                <div className="pp-actions">
                  <button type="button" className="pp-action primary" onClick={() => void downloadPassport()} disabled={downloading}>
                    <Download size={17} /> {downloading ? 'Generating…' : 'Download PNG'}
                  </button>
                  <button type="button" className="pp-action print" onClick={() => window.print()}>
                    <Printer size={17} /> Download PDF
                  </button>
                </div>
              </div>
            </div>
          </div>

          <footer className="pp-footer">
            <div className="pp-qr">{qrUrl ? <QRCodeSVG value={qrUrl} size={64} marginSize={0} title="Scan to open Safex" /> : <ShieldCheck size={44} />}<small>Scan to open Safex</small></div>
            <div className="pp-footer-person">
              <b>{employee.empNo}</b>
              <strong>{employee.name}</strong>
              <span>{employee.designation || 'Designation not on record'} · {site?.name ?? 'Site not selected'}</span>
              <small>{employer}</small>
            </div>
            <div className="pp-footer-meta">
              <span><CalendarDays size={13} /> Generated on</span>
              <time dateTime={generatedAt.toISOString()}>{formatPassportDate(generatedAt)}</time>
              <b>Powered by <em>Safex</em></b>
            </div>
          </footer>
          <p className="pp-footline">{employer} · Employee Safety Management System · Generated from the Safex employee directory</p>
        </div>
      </div>
    </div>

    {activeCategory && active && <div className="passport-record-overlay" role="dialog" aria-modal="true" aria-labelledby="passport-record-title">
      <div className="passport-record-dialog">
        <header>
          <span className={`passport-record-icon ${active.tone}`}><active.icon size={21} /></span>
          <div><span>EMPLOYEE PASSPORT / RECORDS</span><h2 id="passport-record-title">{active.label}</h2></div>
          <button type="button" aria-label="Close records" onClick={() => setActiveCategory(null)}><X size={20} /></button>
        </header>
        <div className="passport-record-tools">
          <label><Search size={16} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search records…" aria-label="Search records" /></label>
          <label><SlidersHorizontal size={15} /><select aria-label="Filter by status" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0); }}><option>All statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label><ArrowDown size={15} /><select aria-label="Sort records" value={sort} onChange={(event) => setSort(event.target.value)}><option>Newest first</option><option>Oldest first</option></select></label>
        </div>
        <div className="passport-table-scroll">
          <table>
            <thead><tr>{active.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>{visible.length ? visible.map((row, index) => <tr key={`${row.date}-${index}`}>
              <td>{row.date}</td><td>{row.title}</td><td>{row.detail}</td>
              {active.severity && <td>{row.severity || '—'}</td>}
              <td><span className="passport-status">{row.status}</span></td>
            </tr>) : <tr><td colSpan={active.columns.length} className="passport-table-empty"><Lock size={20} /> {allRows.length ? 'No matching records.' : 'Records for this category are not connected yet. No sample history is shown.'}</td></tr>}</tbody>
          </table>
        </div>
        <footer>
          <span>{filtered.length ? `${filtered.length} records · Page ${page + 1} of ${pageCount}` : 'No records available'}</span>
          <div className="passport-record-pages">
            <button type="button" disabled={!page} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ArrowLeft size={16} /></button>
            <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ArrowRight size={16} /></button>
          </div>
          <button type="button" disabled={!filtered.length} title={!filtered.length ? 'No records to export' : 'Export Excel-compatible CSV'} onClick={() => exportCsv(filtered, activeCategory, employee.empNo)}><FileSpreadsheet size={16} /> Export Excel (CSV)</button>
          <button type="button" disabled={!filtered.length} title={!filtered.length ? 'No records to print' : 'Print records'} onClick={() => window.print()}><Printer size={16} /> Print</button>
        </footer>
      </div>
    </div>}
  </div>;
}
