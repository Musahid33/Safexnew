'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, BookOpen, Building2, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardCheck, ClipboardList,
  Clock3, Eye, FileText, FolderOpen, Globe2, HardHat, Home, Images, LayoutDashboard,
  Lightbulb, LockKeyhole, MapPin, Megaphone, Plus, Search, Settings2, ShieldCheck, Truck,
  Trophy, UserCog, UsersRound, Wrench, X
} from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import type { Employee, Language, ReportType, SafetyReport, Site } from '@/lib/types';
import { DEMO_TENANT } from '@/lib/demo-data';
import { useI18n } from './I18nProvider';

type Section = 'overview' | 'reports' | 'employees' | 'sites' | 'content' | 'settings';
type AdminDialogKey = 'injection' | 'employee' | 'audit' | 'reward' | 'consequence' | null;
type Props = {
  companyName: string;
  selectedSiteId: string;
  sites: Site[];
  reports: SafetyReport[];
  employees: Employee[];
  onChangeSite: () => void;
  canChangeSite: boolean;
  onExit: () => void;
};

const NAV_ITEMS: { id: Section; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'reports', label: 'Reports', icon: ClipboardList },
  { id: 'employees', label: 'Employees', icon: UsersRound },
  { id: 'sites', label: 'Sites & access', icon: Building2 },
  { id: 'content', label: 'Content & learning', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings2 }
];

const CONTENT_MODULES = [
  { label: 'Circulars & Notices', detail: 'Site notices and published communications', icon: FileText },
  { label: 'Safety Alerts', detail: 'Approved incident learnings and controls', icon: Bell },
  { label: 'Document Vault / Library', detail: 'SOP/SWP, risk assessments and policies', icon: FolderOpen },
  { label: 'Training Management', detail: 'Courses, assignments and completion records', icon: BookOpen }
];

const REVIEW_DESKS: { type: ReportType; icon: typeof AlertTriangle; detail: string }[] = [
  { type: 'Near Miss', icon: AlertTriangle, detail: 'Review synthetic near miss submissions' },
  { type: 'Hazard', icon: CircleAlert, detail: 'Risk review · sample records' },
  { type: 'Safety Observation', icon: ShieldCheck, detail: 'Safe practices and observations' },
  { type: 'Unsafe Condition', icon: CircleAlert, detail: 'Unsafe condition sample queue' },
  { type: 'Unsafe Act', icon: UserCog, detail: 'Unsafe act sample queue' },
  { type: 'Feedback', icon: Megaphone, detail: 'PPE and equipment feedback' },
  { type: 'Grievance', icon: UsersRound, detail: 'Workplace concern samples' },
  { type: 'Speak Up', icon: LockKeyhole, detail: 'Anonymous samples · no identity link' },
  { type: 'Suggestion', icon: Lightbulb, detail: 'Safety improvement ideas' }
];

const GOVERNANCE_MODULES = [
  { label: 'Audits & checklists', detail: 'Plant checklists and audit reviews', icon: ClipboardCheck },
  { label: 'Employee profile editor', detail: 'Employee master and profile updates', icon: UserCog },
  { label: 'Inspection rounds', detail: 'On-field inspection records', icon: Search },
  { label: 'Training logs', detail: 'Class schedules and completion records', icon: BookOpen },
  { label: 'Library control', detail: 'SOP, JHA and MSDS publishing controls', icon: FolderOpen },
  { label: 'Safety events', detail: 'Drills and event scheduling', icon: CalendarDays },
  { label: 'Gallery loop', detail: 'Recognition and media publishing', icon: Images }
];

const DISPATCH_MODULES = [
  { label: 'Safety alert dispatch', detail: 'Drafting and delivery are unavailable', icon: Bell },
  { label: 'Circulars & shift rules', detail: 'Publishing and acknowledgement are unavailable', icon: FileText }
];

const LANGUAGE_NAMES: Record<string, string> = { en: 'English', hi: 'हिन्दी', or: 'ଓଡ଼ିଆ', bn: 'বাংলা', pa: 'ਪੰਜਾਬੀ', mr: 'मराठी' };
const AUDIT_TYPES: { label: string; detail: string; icon: typeof HardHat }[] = [
  { label: 'PPE Audit', detail: 'Personal Protective Equipment Check', icon: HardHat },
  { label: 'Tool & Tackles Audit', detail: 'Tools, Lifting Tackles & Equipment', icon: Wrench },
  { label: 'Vehicle Audit', detail: 'Fleet & Mobile Equipment Inspection', icon: Truck },
  { label: 'Housekeeping Audit', detail: 'Workplace Cleanliness & Order', icon: ClipboardCheck }
];

const FEATURE_FLAGS = [
  ['voiceReporting', 'Voice reporting'],
  ['trainingManagement', 'Training management'],
  ['library', 'Document Vault / Library'],
  ['circulars', 'Circulars & Notices'],
  ['rewardWall', 'Rewards & Recognition'],
  ['pushNotifications', 'Push notifications']
] as const;

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date(value));
}

function formatRelativeTime(value: string, locale: string) {
  const ageMs = Math.max(0, Date.now() - new Date(value).getTime());
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (ageMs < 60_000) return relative.format(0, 'minute');
  if (ageMs < 3_600_000) return relative.format(-Math.floor(ageMs / 60_000), 'minute');
  if (ageMs < 86_400_000) return relative.format(-Math.floor(ageMs / 3_600_000), 'hour');
  return relative.format(-Math.floor(ageMs / 86_400_000), 'day');
}

function statusTone(status: SafetyReport['status']) {
  if (status === 'Closed') return 'closed';
  if (status === 'In Progress') return 'progress';
  return 'open';
}

export default function AdminDashboard({
  companyName, selectedSiteId, sites, reports, employees, onChangeSite, canChangeSite, onExit
}: Props) {
  const { language, setLanguage, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const [section, setSection] = useState<Section>('overview');
  const [scopeSiteId, setScopeSiteId] = useState(selectedSiteId || 'all');
  const [sampleReports, setSampleReports] = useState(reports);
  const [statusFilter, setStatusFilter] = useState<'All' | SafetyReport['status']>('All');
  const [reportTypeFilter, setReportTypeFilter] = useState<'All' | ReportType>('All');
  const [reportQuery, setReportQuery] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [activeDialog, setActiveDialog] = useState<AdminDialogKey>(null);
  const [employeeEditorTab, setEmployeeEditorTab] = useState<'existing' | 'new'>('existing');
  const [employeeEditorSearch, setEmployeeEditorSearch] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedAudit, setSelectedAudit] = useState('');
  const [dialogNotice, setDialogNotice] = useState('');

  useEffect(() => {
    setScopeSiteId(selectedSiteId || 'all');
  }, [selectedSiteId]);

  useEffect(() => {
    setSampleReports(reports);
  }, [reports]);

  const currentSite = sites.find((site) => site.id === selectedSiteId) ?? null;
  const scopedReports = useMemo(() => sampleReports.filter((report) => scopeSiteId === 'all' || report.siteId === scopeSiteId), [sampleReports, scopeSiteId]);
  const filteredReports = useMemo(() => scopedReports.filter((report) => {
    const matchesStatus = statusFilter === 'All' || report.status === statusFilter;
    const matchesType = reportTypeFilter === 'All' || report.type === reportTypeFilter;
    const searchable = `${report.id} ${report.type} ${report.area} ${report.shortDescription} ${sites.find((site) => site.id === report.siteId)?.name ?? ''}`.toLowerCase();
    return matchesStatus && matchesType && searchable.includes(reportQuery.trim().toLowerCase());
  }), [reportQuery, reportTypeFilter, scopedReports, sites, statusFilter]);
  const scopedEmployees = useMemo(() => employees.filter((employee) => {
    const matchesSite = scopeSiteId === 'all' || employee.siteId === scopeSiteId;
    const searchable = `${employee.empNo} ${employee.name} ${employee.designation} ${sites.find((site) => site.id === employee.siteId)?.name ?? ''}`.toLowerCase();
    return matchesSite && searchable.includes(employeeQuery.trim().toLowerCase());
  }), [employeeQuery, employees, scopeSiteId, sites]);
  const employeeEditorMatches = useMemo(() => employees.filter((employee) => {
    const searchable = `${employee.empNo} ${employee.name} ${employee.designation}`.toLowerCase();
    return searchable.includes(employeeEditorSearch.trim().toLowerCase());
  }), [employeeEditorSearch, employees]);
  const selectedEditorEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;

  const counts = {
    total: scopedReports.length,
    open: scopedReports.filter((report) => report.status === 'Open').length,
    progress: scopedReports.filter((report) => report.status === 'In Progress').length,
    closed: scopedReports.filter((report) => report.status === 'Closed').length
  };
  const activityReports = [...scopedReports].sort((a, b) => new Date(b.reportedAt).getTime() - new Date(a.reportedAt).getTime()).slice(0, 8);
  const typeCounts = REVIEW_DESKS.map(({ type }) => ({ type, count: scopedReports.filter((report) => report.type === type).length }));
  const severityCounts = [
    ...(['High', 'Medium', 'Low'] as const).map((severity) => ({ severity, tone: severity.toLowerCase(), count: scopedReports.filter((report) => report.severity === severity).length })),
    { severity: 'N/A', tone: 'na', count: scopedReports.filter((report) => !report.severity).length }
  ];
  const now = new Date();
  const trendMonths = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return {
      date: month,
      label: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'Asia/Kolkata' }).format(month),
      count: scopedReports.filter((report) => {
        const reportedAt = new Date(report.reportedAt);
        return reportedAt.getFullYear() === month.getFullYear() && reportedAt.getMonth() === month.getMonth();
      }).length
    };
  });
  const today = new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
  const scopeLabel = scopeSiteId === 'all' ? T('All demo sites') : (sites.find((site) => site.id === scopeSiteId)?.name ?? T('Selected site'));
  const maxTypeCount = Math.max(1, ...typeCounts.map(({ count }) => count));
  const maxSeverityCount = Math.max(1, ...severityCounts.map(({ count }) => count));
  const maxTrendCount = Math.max(1, ...trendMonths.map(({ count }) => count));
  const trendChartPoints = trendMonths.map((month, index) => ({
    ...month,
    x: 24 + index * 62,
    y: 108 - (month.count / maxTrendCount) * 78
  }));
  const trendLinePath = trendChartPoints.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const trendAreaPath = `${trendLinePath} L ${trendChartPoints.at(-1)?.x ?? 334} 110 L ${trendChartPoints[0]?.x ?? 24} 110 Z`;
  const closureRate = counts.total ? Math.round((counts.closed / counts.total) * 100) : 0;

  function openDemoDialog(dialog: Exclude<AdminDialogKey, null>) {
    setDialogNotice('');
    setActiveDialog(dialog);
    if (dialog === 'employee') {
      setEmployeeEditorTab('existing');
      setEmployeeEditorSearch('');
      setSelectedEmployeeId('');
    }
    if (dialog === 'audit') setSelectedAudit('');
  }

  function updateDemoReportStatus(id: string, status: SafetyReport['status']) {
    setSampleReports((items) => items.map((item) => item.id === id ? { ...item, status } : item));
  }

  function switchSection(next: Section) {
    setSection(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return <div className="admin-console">
    <header className="admin-topbar">
      <div className="admin-topbar-main">
        <div className="admin-brand-lockup">
          <span className="admin-brand-mark" aria-hidden="true">{companyName.trim().charAt(0) || 'S'}</span>
          <span className="admin-brand-copy"><b>{companyName}</b><small>{T('Safety Officer Dashboard')}</small></span>
        </div>
        <span className="admin-preview-pill"><span />{T('DEMO USER')}</span>
        <span className="admin-role-pill"><ShieldCheck size={15} />{T('SAFETY OFFICER')}</span>
      </div>
      <div className="admin-utility-bar">
        <button type="button" className="admin-home-link" onClick={onExit}><Home size={15} />{T('Back to Safety Portal')}</button>
        <span className="admin-connection-state"><i />{T('DEMO DATA · NOT LIVE')}</span>
        <button type="button" className="admin-notice-button" disabled aria-label={T('Notifications are unavailable in demo')} title={T('Notifications are unavailable in demo')}><Bell size={18} /></button>
        <label className="admin-language-select"><Globe2 size={15} /><span className="sr-only">{T('Language')}</span><select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>{Object.entries(LANGUAGE_NAMES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
        <div className={`admin-current-site ${canChangeSite ? 'changeable' : ''}`}>
          <MapPin size={16} aria-hidden="true" />
          <span>{currentSite?.name ?? T('Site not selected')}</span>
          {canChangeSite && <button type="button" onClick={onChangeSite}>{T('Change site')}</button>}
        </div>
        <button type="button" className="admin-exit-button" onClick={onExit}><ArrowRight size={15} />{T('Exit demo')}</button>
      </div>
    </header>

      <div className="admin-demo-banner" role="status">
      <CircleAlert size={19} aria-hidden="true" />
      <div><b>{T('DEMO SESSION')}</b><span>{T('Local-only demo login succeeded. No Supabase authentication, role verification, or company records are connected.')}</span><small>{T('Sample status changes reset when you leave this demo.')}</small></div>
      <span className="admin-sample-label">{T('Synthetic sample data')}</span>
    </div>

    <div className="admin-layout">
      <aside className="admin-sidebar" aria-label={T('Admin dashboard navigation')}>
        <div className="admin-sidebar-label">{T('SAFETY MANAGEMENT')}</div>
        <nav className="admin-side-nav">
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button
            key={id}
            type="button"
            className={`admin-nav-item ${section === id ? 'active' : ''}`}
            aria-current={section === id ? 'page' : undefined}
            onClick={() => switchSection(id)}
          ><Icon size={19} aria-hidden="true" /><span>{T(label)}</span>{section === id && <ChevronRight size={16} aria-hidden="true" />}</button>)}
        </nav>
        <div className="admin-sidebar-foot"><span className="admin-sidebar-foot-icon"><ShieldCheck size={19} /></span><span><b>{T('Role access')}</b><small>{T('Not verified in demo')}</small></span></div>
      </aside>

      <main className={`admin-workspace ${section === 'overview' ? 'overview' : 'subsection'}`}>
        {section === 'overview' && <>
          <div className="admin-page-heading">
            <div><span className="admin-eyebrow">{T('SAFETY MANAGEMENT')}</span><h1>{T('Safety overview')}</h1><p>{T('Review sample reporting activity and site setup for {company}.', { company: companyName })}</p></div>
            <div className="admin-date-stamp"><CalendarDays size={16} />{today}</div>
          </div>
          <div className="admin-toolbar-row">
            <div className="admin-scope-label"><span>{T('Dashboard scope')}</span><b><MapPin size={15} />{scopeLabel}</b></div>
            {sites.length > 1 && <label className="admin-scope-select"><span className="sr-only">{T('Filter dashboard by site')}</span><select value={scopeSiteId} onChange={(event) => setScopeSiteId(event.target.value)}><option value="all">{T('All demo sites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
          </div>

          <div className="admin-kpi-grid">
            <KpiCard icon={FileText} label="Total reports" value={counts.total} tone="blue" onClick={() => { setReportQuery(''); setStatusFilter('All'); setReportTypeFilter('All'); switchSection('reports'); }} />
            <KpiCard icon={Activity} label="In Progress" value={counts.progress} tone="purple" onClick={() => { setReportQuery(''); setStatusFilter('In Progress'); setReportTypeFilter('All'); switchSection('reports'); }} />
            <KpiCard icon={CheckCircle2} label="Resolved" value={counts.closed} tone="green" onClick={() => { setReportQuery(''); setStatusFilter('Closed'); setReportTypeFilter('All'); switchSection('reports'); }} />
          </div>

          <section className={`admin-fold-panel admin-analytics-panel ${analyticsExpanded ? 'expanded' : ''}`}>
            <button type="button" className="admin-fold-heading" onClick={() => setAnalyticsExpanded((value) => !value)} aria-expanded={analyticsExpanded} aria-controls="admin-analytics-content">
              <span className="admin-fold-icon analytics"><BarChart3 size={19} /></span>
              <span className="admin-fold-title"><small>{T('SAMPLE METRICS')}</small><b>{T('Safety Analytics')}</b></span>
              <span className="admin-demo-chip">{T('DEMO ONLY')}</span>
              <ChevronDown size={19} className={`admin-fold-chevron ${analyticsExpanded ? 'expanded' : ''}`} />
            </button>
            {analyticsExpanded && <div className="admin-analytics-content" id="admin-analytics-content">
              <div className="admin-analytics-stats">
                <AnalyticsStat label="Open" value={counts.open} tone="amber" />
                <AnalyticsStat label="In Progress" value={counts.progress} tone="purple" />
                <AnalyticsStat label="Resolved" value={counts.closed} tone="green" />
                <AnalyticsStat label="Closure rate" value={`${closureRate}%`} tone="blue" />
              </div>
              <div className="admin-analytics-chart-grid">
                <section className="admin-chart-card">
                  <div className="admin-chart-heading"><b>{T('Report type mix')}</b><small>{T('Sample records by report type')}</small></div>
                  <div className="admin-chart-bars">{typeCounts.map(({ type, count }) => <div className="admin-chart-row" key={type}>
                    <span>{T(type)}</span><div className="admin-chart-track"><i style={{ width: `${count ? Math.max(7, (count / maxTypeCount) * 100) : 0}%` }} /></div><b>{count}</b>
                  </div>)}</div>
                </section>
                <section className="admin-chart-card">
                  <div className="admin-chart-heading"><b>{T('Severity mix')}</b><small>{T('Severity values on synthetic reports')}</small></div>
                  <div className="admin-chart-bars">{severityCounts.map(({ severity, tone, count }) => <div className="admin-chart-row" key={severity}>
                    <span>{T(severity)}</span><div className="admin-chart-track"><i className={`severity-${tone}`} style={{ width: `${count ? Math.max(7, (count / maxSeverityCount) * 100) : 0}%` }} /></div><b>{count}</b>
                  </div>)}</div>
                  <small className="admin-chart-note">{T('N/A represents sample records without a severity value.')}</small>
                </section>
                <section className="admin-chart-card admin-trend-card">
                  <div className="admin-chart-heading"><b>{T('Six-month sample trend')}</b><small>{T('Report count by month · demo dataset')}</small></div>
                  <svg className="admin-trend-svg" viewBox="0 0 360 145" role="img" aria-label={T('Six-month sample trend')}>
                    <path d={trendAreaPath} className="admin-trend-area" />
                    <path d={trendLinePath} className="admin-trend-line" />
                    {trendChartPoints.map(({ date, label, count, x, y }) => <g key={`${date.getFullYear()}-${date.getMonth()}`}>
                      <circle cx={x} cy={y} r="4" className="admin-trend-point" />
                      <text x={x} y={Math.max(y - 10, 12)} className="admin-trend-value">{count}</text>
                      <text x={x} y="137" className="admin-trend-label">{label}</text>
                    </g>)}
                  </svg>
                </section>
              </div>
              <p className="admin-record-caption">{T('All analytics are computed from synthetic sample reports and do not represent live company performance.')}</p>
            </div>}
          </section>

          <button type="button" className="admin-injection-button" onClick={() => openDemoDialog('injection')}>
            <Plus size={20} /><span>{T('Direct Data Injection Desk')}</span><small>{T('LOCAL DEMO · NO DATABASE WRITE')}</small>
          </button>

          <div className="admin-overview-grid">
            <section className="admin-panel admin-recent-panel">
              <div className="admin-panel-heading"><div><span className="admin-eyebrow">{T('SAMPLE ACTIVITY')}</span><h2>{T('Sample Activity Feed')}</h2></div><span className="admin-demo-chip">{T('LOCAL DEMO')}</span><button type="button" className="admin-link-button" onClick={() => { setReportQuery(''); setStatusFilter('All'); setReportTypeFilter('All'); switchSection('reports'); }}>{T('View all')} <ArrowRight size={16} /></button></div>
              {activityReports.length ? <div className="admin-activity-list">{activityReports.map((report) => <ActivityFeedItem key={report.id} report={report} site={sites.find((site) => site.id === report.siteId)} reporter={report.anonymous ? null : employees.find((employee) => employee.empNo === report.reporterEmpNo) ?? null} locale={locale} onOpen={() => { setReportQuery(report.id); setReportTypeFilter('All'); setStatusFilter('All'); switchSection('reports'); }} onStatusChange={(nextStatus) => updateDemoReportStatus(report.id, nextStatus)} />)}</div> : <EmptyState title="No sample reports" detail="No sample reports are available for this selection." />}
              <p className="admin-record-caption">{T('Sample status actions are temporary and are not saved or sent to a database.')}</p>
            </section>

            <section className="admin-panel admin-actions-panel">
              <div className="admin-panel-heading"><div><span className="admin-eyebrow">{T('QUICK ACCESS')}</span><h2>{T('Management areas')}</h2></div></div>
              <div className="admin-action-list">
                <button type="button" onClick={() => { setReportQuery(''); setStatusFilter('All'); setReportTypeFilter('All'); switchSection('reports'); }}><span className="admin-action-icon reports"><ClipboardList size={19} /></span><span><b>{T('Report review')}</b><small>{T('Sample report queue')}</small></span><ChevronRight size={17} /></button>
                <button type="button" onClick={() => switchSection('employees')}><span className="admin-action-icon employees"><UsersRound size={19} /></span><span><b>{T('Employee directory')}</b><small>{T('Synthetic records only')}</small></span><ChevronRight size={17} /></button>
                <button type="button" onClick={() => switchSection('sites')}><span className="admin-action-icon sites"><Building2 size={19} /></span><span><b>{T('Sites & access')}</b><small>{T('Site setup preview')}</small></span><ChevronRight size={17} /></button>
                <button type="button" onClick={() => switchSection('content')}><span className="admin-action-icon content"><FolderOpen size={19} /></span><span><b>{T('Content & learning')}</b><small>{T('Publishing is not connected')}</small></span><ChevronRight size={17} /></button>
              </div>
            </section>
          </div>

          <section className="admin-command-group">
            <div className="admin-command-heading"><div><span className="admin-eyebrow">{T('GOVERNANCE & AUDITS')}</span><h2>{T('Governance & Audits')}</h2><p>{T('Management modules from the reference dashboard · preview only')}</p></div><span className="admin-not-configured-pill">{T('Not connected')}</span></div>
            <div className="admin-command-grid">{GOVERNANCE_MODULES.map(({ label, detail, icon }) => <DemoModuleCard
              key={label}
              label={label}
              detail={detail}
              icon={icon}
              state={label === 'Audits & checklists' || label === 'Employee profile editor' ? 'Demo preview' : 'Not configured'}
              onClick={label === 'Audits & checklists' ? () => openDemoDialog('audit') : label === 'Employee profile editor' ? () => openDemoDialog('employee') : undefined}
            />)}</div>
          </section>

          <section className="admin-command-group">
            <div className="admin-command-heading"><div><span className="admin-eyebrow">{T('WORKFORCE REVIEW')}</span><h2>{T('Workforce Review Desks')}</h2><p>{T('Select a report type to filter the synthetic review queue.')}</p></div><span className="admin-demo-chip">{T('SAMPLE QUEUE')}</span></div>
            <div className="admin-review-desk-grid">{REVIEW_DESKS.map(({ type, icon: Icon, detail }) => {
              const count = scopedReports.filter((report) => report.type === type).length;
              return <button type="button" className="admin-review-desk-card" key={type} onClick={() => { setReportQuery(''); setStatusFilter('All'); setReportTypeFilter(type); switchSection('reports'); }}>
                <span className="admin-review-desk-icon"><Icon size={18} /></span><Eye className="admin-review-eye" size={15} aria-hidden="true" /><b>{T(type)}</b><small>{T(detail)}</small><span className="admin-review-count">{new Intl.NumberFormat(locale).format(count)}</span>
              </button>;
            })}</div>
          </section>

          <section className="admin-command-group">
            <div className="admin-command-heading"><div><span className="admin-eyebrow">{T('DISPATCH & RECOGNITION')}</span><h2>{T('Dispatch & Recognition')}</h2><p>{T('These controls are shown for layout reference; no dispatch or publishing is enabled.')}</p></div><span className="admin-not-configured-pill">{T('Not connected')}</span></div>
            <div className="admin-command-grid">{DISPATCH_MODULES.map(({ label, detail, icon }) => <DemoModuleCard key={label} label={label} detail={detail} icon={icon} state="Not connected" />)}</div>
            <div className="admin-dispatch-actions">
              <button type="button" className="admin-dispatch-cta reward" onClick={() => openDemoDialog('reward')}><span className="admin-dispatch-cta-icon"><Trophy size={20} /></span><span><b>{T('Reward Entry')}</b><small>{T('Preview a recognition entry · demo only')}</small></span><ChevronRight size={18} /></button>
              <button type="button" className="admin-dispatch-cta consequence" onClick={() => openDemoDialog('consequence')}><span className="admin-dispatch-cta-icon"><AlertTriangle size={20} /></span><span><b>{T('Consequence Entry')}</b><small>{T('Personnel records are not connected')}</small></span><ChevronRight size={18} /></button>
            </div>
          </section>
        </>}

        {section === 'reports' && <>
          <PageHeading eyebrow="SAFETY REPORTS" title="Report review" description="Review synthetic sample reports. Live reports are not connected." />
          <div className="admin-filter-panel">
            <label className="admin-search"><Search size={17} /><input value={reportQuery} onChange={(event) => setReportQuery(event.target.value)} placeholder={T('Search report ID, type, area or site')} /></label>
            <label className="admin-filter-select"><span>{T('Status')}</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'All' | SafetyReport['status'])}><option value="All">{T('All statuses')}</option><option value="Open">{T('Open')}</option><option value="In Progress">{T('In Progress')}</option><option value="Closed">{T('Closed')}</option></select></label>
            <label className="admin-filter-select"><span>{T('Report type')}</span><select value={reportTypeFilter} onChange={(event) => setReportTypeFilter(event.target.value as 'All' | ReportType)}><option value="All">{T('All report types')}</option>{REVIEW_DESKS.map(({ type }) => <option key={type} value={type}>{T(type)}</option>)}</select></label>
            {sites.length > 1 && <label className="admin-filter-select"><span>{T('Site')}</span><select value={scopeSiteId} onChange={(event) => setScopeSiteId(event.target.value)}><option value="all">{T('All demo sites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>}
          </div>
          <div className="admin-results-meta"><b>{T('{count} sample reports', { count: new Intl.NumberFormat(locale).format(filteredReports.length) })}</b><span>{T('Synthetic data · not connected to a live database')}</span></div>
          <div className="admin-report-list">{filteredReports.map((report) => <AdminReportCard key={report.id} report={report} site={sites.find((site) => site.id === report.siteId)} locale={locale} />)}{filteredReports.length === 0 && <EmptyState title="No matching reports" detail="Try a different search or status filter." />}</div>
        </>}

        {section === 'employees' && <>
          <PageHeading eyebrow="PEOPLE" title="Employee directory" description="These records are synthetic examples. The real employee master is not connected." />
          <label className="admin-search admin-employee-search"><Search size={17} /><input value={employeeQuery} onChange={(event) => setEmployeeQuery(event.target.value)} placeholder={T('Search Employee ID, name or designation')} /></label>
          <div className="admin-results-meta"><b>{T('{count} sample employees', { count: new Intl.NumberFormat(locale).format(scopedEmployees.length) })}</b><span>{T('No real employee information is shown.')}</span></div>
          <div className="admin-employee-grid">{scopedEmployees.map((employee) => <article className="admin-employee-card" key={employee.id}>
            <span className="admin-employee-avatar" aria-hidden="true">{employee.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
            <div className="admin-employee-info"><b>{employee.name}</b><span>{employee.designation}</span><small>{employee.empNo}</small></div>
            <span className="admin-employee-site"><MapPin size={13} />{sites.find((site) => site.id === employee.siteId)?.name ?? T('Site')}</span>
          </article>)}{scopedEmployees.length === 0 && <EmptyState title="No matching employees" detail="Try a different search or site scope." />}</div>
        </>}

        {section === 'sites' && <>
          <PageHeading eyebrow="SITE SETUP" title="Sites & access" description="The site names below are demo values. Site memberships, roles and emergency contacts are not configured." />
          <div className="admin-site-grid">{sites.map((site) => <article className="admin-site-card" key={site.id}>
            <div className="admin-site-card-head"><span className="admin-site-icon"><Building2 size={20} /></span><span className="admin-not-configured-pill">{T('Demo site')}</span></div>
            <h2>{site.name}</h2><p>{site.region}</p>
            <div className="admin-site-setting"><span>{T('SOS emergency contact')}</span><b>{site.sosNumber ?? T('Not configured')}</b></div>
            <div className="admin-site-setting"><span>{T('Staff role access')}</span><b>{T('Not connected')}</b></div>
          </article>)}</div>
          <div className="admin-inline-warning"><LockKeyhole size={18} /><span><b>{T('No access roles have been verified.')}</b><small>{T('A site name or selected site does not prove identity or permission.')}</small></span></div>
        </>}

        {section === 'content' && <>
          <PageHeading eyebrow="PUBLISHING" title="Content & learning" description="Publishing controls are intentionally read-only until Admin records and permissions are configured." />
          <div className="admin-module-grid">{CONTENT_MODULES.map(({ label, detail, icon: Icon }) => <article className="admin-module-card" key={label}>
            <span className="admin-module-icon"><Icon size={20} /></span><div><h2>{T(label)}</h2><p>{T(detail)}</p></div><span className="admin-not-configured-pill">{T('Not connected')}</span>
          </article>)}</div>
          <div className="admin-inline-warning"><CircleAlert size={18} /><span><b>{T('No content can be published from this preview.')}</b><small>{T('Existing published records and live feeds are not connected.')}</small></span></div>
        </>}

        {section === 'settings' && <>
          <PageHeading eyebrow="ADMIN SETUP" title="Settings & readiness" description="Configuration information is shown as a preview. No account changes are available here." />
          <section className="admin-panel admin-readiness-panel">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">{T('CONNECTION STATUS')}</span><h2>{T('Backend readiness')}</h2></div><span className="admin-not-configured-pill">{T('Not connected')}</span></div>
            <ReadinessRow label="Staff authentication" detail="User lookup, role verification and OTP are not configured." />
            <ReadinessRow label="Database schema" detail="The expected dashboard tables and policies are not present in the configured project." />
            <ReadinessRow label="Report data" detail="No live report records are loaded in this preview." />
            <ReadinessRow label="Password recovery" detail="No reset email is sent by this demo." />
          </section>
          <section className="admin-panel admin-feature-panel">
            <div className="admin-panel-heading"><div><span className="admin-eyebrow">{T('OPTIONAL MODULES')}</span><h2>{T('Feature flags · demo only')}</h2></div><span className="admin-readonly-pill">{T('Read only')}</span></div>
            <p>{T('Optional feature availability is only shown from the local demo configuration. Changes are reserved for Safex Super Admin.')}</p>
            <div className="admin-feature-list">{FEATURE_FLAGS.map(([key, label]) => <div className="admin-feature-row" key={key}><span>{T(label)}</span><b className={DEMO_TENANT.features[key] ? 'enabled' : ''}>{T(DEMO_TENANT.features[key] ? 'Enabled in demo' : 'Off in demo')}</b></div>)}</div>
          </section>
        </>}
      </main>
    </div>

    {activeDialog && <AdminDashboardModal
      dialog={activeDialog}
      employees={employees}
      sites={sites}
      employeeTab={employeeEditorTab}
      onEmployeeTabChange={setEmployeeEditorTab}
      employeeSearch={employeeEditorSearch}
      onEmployeeSearch={setEmployeeEditorSearch}
      employeeMatches={employeeEditorMatches}
      selectedEmployee={selectedEditorEmployee}
      onSelectEmployee={setSelectedEmployeeId}
      selectedAudit={selectedAudit}
      onSelectAudit={(audit) => { setSelectedAudit(audit); setDialogNotice(T('No audit record was created.')); }}
      notice={dialogNotice}
      onNotice={setDialogNotice}
      onClose={() => setActiveDialog(null)}
    />}

    <footer className="admin-preview-footer"><ShieldCheck size={15} />{T('Local demo session · no backend authentication')}</footer>
  </div>;
}

type AdminDashboardModalProps = {
  dialog: Exclude<AdminDialogKey, null>;
  employees: Employee[];
  sites: Site[];
  employeeTab: 'existing' | 'new';
  onEmployeeTabChange: (tab: 'existing' | 'new') => void;
  employeeSearch: string;
  onEmployeeSearch: (value: string) => void;
  employeeMatches: Employee[];
  selectedEmployee: Employee | null;
  onSelectEmployee: (id: string) => void;
  selectedAudit: string;
  onSelectAudit: (audit: string) => void;
  notice: string;
  onNotice: (notice: string) => void;
  onClose: () => void;
};

function AdminDashboardModal({
  dialog, employees, sites, employeeTab, onEmployeeTabChange, employeeSearch, onEmployeeSearch,
  employeeMatches, selectedEmployee, onSelectEmployee, selectedAudit, onSelectAudit, notice, onNotice, onClose
}: AdminDashboardModalProps) {
  const { T } = useI18n();
  const titles: Record<Exclude<AdminDialogKey, null>, string> = {
    injection: 'Direct Data Injection Desk',
    employee: 'Employee Profile Editor',
    audit: 'Select Audit Type',
    reward: 'Reward Entry',
    consequence: 'Consequence Entry'
  };
  const icon = dialog === 'employee' ? <UserCog size={19} /> : dialog === 'audit' ? <ClipboardCheck size={19} /> : dialog === 'reward' ? <Trophy size={19} /> : dialog === 'consequence' ? <AlertTriangle size={19} /> : <Plus size={19} />;

  function handlePreviewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const noticeKey = dialog === 'injection'
      ? 'Demo payload checked only; no report was inserted.'
      : dialog === 'reward'
        ? 'Reward preview only; no recognition record was saved.'
        : dialog === 'consequence'
          ? 'Consequence preview only; no personnel record was saved.'
          : 'Employee preview only; no employee record was saved.';
    onNotice(T(noticeKey));
  }

  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`admin-dialog-card modal-${dialog}`} role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title">
      <header className="admin-dialog-header">
        <span className="admin-dialog-title-icon">{icon}</span>
        <span><small>{T('DEMO PREVIEW')}</small><h2 id="admin-dialog-title">{T(titles[dialog])}</h2></span>
        <button type="button" className="admin-dialog-close" onClick={onClose} aria-label={T('Close')}><X size={21} /></button>
      </header>
      <div className="admin-dialog-body">
        <div className="admin-dialog-caveat"><CircleAlert size={17} /><span><b>{T('Preview only — nothing is saved or sent.')}</b><small>{T('The live backend and authorization are not connected.')}</small></span></div>

        {dialog === 'employee' && <>
          <div className="admin-dialog-tabs" role="tablist" aria-label={T('Employee editor mode')}>
            <button type="button" role="tab" aria-selected={employeeTab === 'existing'} className={employeeTab === 'existing' ? 'active' : ''} onClick={() => { onEmployeeTabChange('existing'); onNotice(''); }}>{T('Edit Existing')}</button>
            <button type="button" role="tab" aria-selected={employeeTab === 'new'} className={employeeTab === 'new' ? 'active' : ''} onClick={() => { onEmployeeTabChange('new'); onNotice(''); onSelectEmployee(''); }}>{T('New Employee Entry')}</button>
          </div>
          {employeeTab === 'existing' ? <>
            <label className="admin-dialog-search"><Search size={16} /><span className="sr-only">{T('Search employee name or ID')}</span><input value={employeeSearch} onChange={(event) => onEmployeeSearch(event.target.value)} placeholder={T('Search name or Employee ID')} /></label>
            <div className="admin-dialog-employee-list">
              {employeeMatches.map((employee) => <button type="button" className={`admin-dialog-employee-option ${selectedEmployee?.id === employee.id ? 'selected' : ''}`} key={employee.id} onClick={() => onSelectEmployee(employee.id)}>
                <span className="admin-employee-avatar">{employee.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span><span><b>{employee.name}</b><small>{employee.empNo} · {employee.designation}</small></span><ChevronRight size={17} />
              </button>)}
              {!employeeMatches.length && <EmptyState title="No matching employees" detail="Try another synthetic Employee ID or name." />}
            </div>
            {selectedEmployee && <div className="admin-dialog-selected-profile">
              <div className="admin-dialog-profile-head"><b>{T('Selected sample profile')}</b><span className="admin-not-configured-pill">{T('Read only')}</span></div>
              <div className="admin-dialog-profile-grid"><span><small>{T('Employee ID')}</small><b>{selectedEmployee.empNo}</b></span><span><small>{T('Name')}</small><b>{selectedEmployee.name}</b></span><span><small>{T('Designation')}</small><b>{selectedEmployee.designation}</b></span><span><small>{T('Site')}</small><b>{sites.find((site) => site.id === selectedEmployee.siteId)?.name ?? T('Not configured')}</b></span></div>
            </div>}
          </> : <form className="admin-preview-form" onSubmit={handlePreviewSubmit}>
            <label>{T('Employee ID')}<input required placeholder={T('Enter a sample Employee ID')} /></label>
            <label>{T('Name')}<input required placeholder={T('Enter a sample name')} /></label>
            <label>{T('Designation')}<input required placeholder={T('Enter a sample designation')} /></label>
            <label>{T('Site')}<select required defaultValue=""><option value="" disabled>{T('Select a demo site')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <button type="submit" className="admin-dialog-primary">{T('Preview entry only')}</button>
          </form>}
        </>}

        {dialog === 'audit' && <div className="admin-audit-options">{AUDIT_TYPES.map(({ label, detail, icon: AuditIcon }) => <button type="button" className={`admin-audit-option ${selectedAudit === label ? 'selected' : ''}`} key={label} onClick={() => onSelectAudit(label)}>
          <span className="admin-audit-icon"><AuditIcon size={20} /></span><span><b>{T(label)}</b><small>{T(detail)}</small></span><ChevronRight size={18} />
        </button>)}</div>}

        {(dialog === 'injection' || dialog === 'reward' || dialog === 'consequence') && <form className="admin-preview-form" onSubmit={handlePreviewSubmit}>
          {dialog !== 'injection' && <label>{T('Select a synthetic employee')}<select required defaultValue=""><option value="" disabled>{T('Choose an employee')}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.empNo}</option>)}</select></label>}
          {dialog === 'injection' && <>
            <label>{T('Report type')}<select required defaultValue=""><option value="" disabled>{T('Select a report type')}</option>{REVIEW_DESKS.map(({ type }) => <option value={type} key={type}>{T(type)}</option>)}</select></label>
            <label>{T('Site')}<select required defaultValue=""><option value="" disabled>{T('Select a demo site')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
            <label>{T('Work area')}<input required placeholder={T('Enter a sample area')} /></label>
          </>}
          {dialog === 'reward' && <label>{T('Recognition entry')}<input required placeholder={T('Enter a sample recognition title')} /></label>}
          {dialog === 'consequence' && <label>{T('Consequence category')}<input required placeholder={T('Enter a demo category')} /></label>}
          <label>{T('Details / note')}<textarea required rows={3} placeholder={T('Enter demo details only')} /></label>
          <button type="submit" className="admin-dialog-primary">{T('Preview only — no record will be written')}</button>
        </form>}

        {notice && <p className="admin-dialog-result" role="status"><Check size={16} />{notice}</p>}
      </div>
      <footer className="admin-dialog-footer"><button type="button" onClick={onClose}>{T('Close')}</button></footer>
    </section>
  </div>;
}

function DemoModuleCard({
  label, detail, icon: Icon, state, onClick
}: { label: string; detail: string; icon: typeof FileText; state: string; onClick?: () => void }) {
  const { T } = useI18n();
  const contents = <><span className="admin-command-icon"><Icon size={19} /></span><span className="admin-command-copy"><b>{T(label)}</b><small>{T(detail)}</small></span><span className="admin-command-state">{T(state)}</span></>;
  return onClick
    ? <button type="button" className="admin-command-card interactive" onClick={onClick}>{contents}</button>
    : <article className="admin-command-card">{contents}</article>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  const { T } = useI18n();
  return <div className="admin-page-heading"><div><span className="admin-eyebrow">{T(eyebrow)}</span><h1>{T(title)}</h1><p>{T(description)}</p></div></div>;
}

function KpiCard({ icon: Icon, label, value, tone, onClick }: { icon: typeof FileText; label: string; value: number; tone: 'blue' | 'amber' | 'purple' | 'green'; onClick: () => void }) {
  const { T, language } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  return <button type="button" className={`admin-kpi-card ${tone}`} onClick={onClick}>
    <span className="admin-kpi-icon"><Icon size={20} /></span><span className="admin-kpi-label">{T(label)}</span><b>{new Intl.NumberFormat(locale).format(value)}</b><small>{T('Synthetic sample')}</small>
  </button>;
}

function AnalyticsStat({ label, value, tone }: { label: string; value: number | string; tone: 'blue' | 'amber' | 'purple' | 'green' }) {
  const { T, language } = useI18n();
  const displayValue = typeof value === 'number' ? new Intl.NumberFormat(LANGUAGE_LOCALE[language]).format(value) : value;
  return <div className={`admin-analytics-stat ${tone}`}><small>{T(label)}</small><b>{displayValue}</b></div>;
}

function ActivityFeedItem({
  report, site, reporter, locale, onOpen, onStatusChange
}: { report: SafetyReport; site?: Site; reporter: Employee | null; locale: string; onOpen: () => void; onStatusChange: (status: SafetyReport['status']) => void }) {
  const { T } = useI18n();
  const reporterLabel = report.anonymous ? T('Anonymous') : (reporter?.name ?? T('Demo reporter'));
  return <article className="admin-feed-row">
    <div className="admin-feed-main">
      <span className={`admin-feed-type ${statusTone(report.status)}`}>{T(report.type)}</span>
      <span className="admin-feed-copy">
        <span className="admin-feed-meta"><b>{report.anonymous ? T('Anonymous') : reporterLabel}</b><small>{report.id} · {formatRelativeTime(report.reportedAt, locale)}</small></span>
        <span className="admin-feed-description">{report.shortDescription}</span>
        <span className="admin-feed-site"><MapPin size={12} />{site?.name ?? T('Site')} · {report.area}</span>
      </span>
    </div>
    <div className="admin-feed-actions">
      <span className={`admin-status-badge ${statusTone(report.status)}`}>{T(report.status)}</span>
      <button type="button" className="admin-feed-action progress" onClick={() => onStatusChange('In Progress')} disabled={report.status === 'In Progress' || report.status === 'Closed'}><Activity size={13} />{T('Progress')}</button>
      <button type="button" className="admin-feed-action close" onClick={() => onStatusChange('Closed')} disabled={report.status === 'Closed'}><Check size={13} />{T('Close')}</button>
      <button type="button" className="admin-feed-action view" onClick={onOpen}><Eye size={13} />{T('View')}</button>
    </div>
  </article>;
}

function AdminReportCard({ report, site, locale, }: { report: SafetyReport; site?: Site; locale: string }) {
  const { T } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return <article className={`admin-report-card ${expanded ? 'expanded' : ''}`}>
    <button type="button" className="admin-report-card-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <span className={`admin-report-mark ${statusTone(report.status)}`}><FileText size={18} /></span>
      <span className="admin-report-main"><span className="admin-report-id-line"><b>{report.id}</b><span className={`admin-status-badge ${statusTone(report.status)}`}>{T(report.status)}</span></span><strong>{T(report.type)}{report.category ? ` · ${T(report.category)}` : ''}</strong><small><MapPin size={13} />{site?.name ?? T('Site')} · {report.area}</small></span>
      <span className="admin-report-date"><Clock3 size={14} />{formatDate(report.reportedAt, locale)}</span>
      <ChevronRight size={18} className="admin-row-chevron" />
    </button>
    {expanded && <div className="admin-report-details"><p>{report.shortDescription}</p><div><span>{T('Reported by')}</span><b>{report.anonymous ? T('Anonymous') : T('Demo record')}</b></div><div><span>{T('Attachment')}</span><b>{report.hasAttachment ? T('Sample attachment placeholder') : T('None')}</b></div><small>{T('Synthetic sample record · no real employee or incident data')}</small></div>}
  </article>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  const { T } = useI18n();
  return <div className="admin-empty-state"><ClipboardList size={24} /><b>{T(title)}</b><span>{T(detail)}</span></div>;
}

function ReadinessRow({ label, detail }: { label: string; detail: string }) {
  const { T } = useI18n();
  return <div className="admin-readiness-row"><span className="admin-readiness-icon"><CircleAlert size={17} /></span><span><b>{T(label)}</b><small>{T(detail)}</small></span><span className="admin-not-configured-pill">{T('Not configured')}</span></div>;
}
