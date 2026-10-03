'use client';

import {
  AlertTriangle, Bell, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp,
  ClipboardList, CloudUpload, FileText, FolderOpen, Home, ImagePlus, Lightbulb, LockKeyhole, MapPin,
  Monitor, Moon, MoreHorizontal, Palette, Search, Settings2, ShieldAlert,
  Smartphone, Sun, ThumbsUp, Trophy, UserRound, X, Zap, MessageSquare
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { DEMO_EMPLOYEES, DEMO_REPORTS, DEMO_SITES, DEMO_TENANT } from '@/lib/demo-data';
import { t } from '@/lib/i18n';
import LanguageStrip from './components/LanguageStrip';
import ReportWorkflow, { type ReportSubmission } from './components/ReportWorkflow';
import TrainingPortal from './components/TrainingPortal';
import ProfileSearchDialog from './components/ProfileSearchDialog';
import OfficerAccessDialog from './components/OfficerAccessDialog';
import { DocumentVaultGrid, VaultCategoryDialog, type VaultCategoryId } from './components/DocumentVault';
import RewardCarousel from './components/RewardCarousel';
import { FeedArchivePage, HomeFeedDetailDialog, HomeFeedSection } from './components/HomeFeedViews';
import { getHomeFeedItems, getUpcomingEvents, type HomeFeedItem } from '@/lib/home-content';
import { createSubmissionId, enqueueReport, listQueuedReports, registerReportBackgroundSync, retryReportsNeedingAttention, syncPendingReports, type OutboxSyncResult, type QueuedReport } from '@/lib/report-outbox';
import type { Language, Palette as PaletteName, ReportStatus, ReportType, SafetyReport, Site, ThemeMode } from '@/lib/types';

type PageKey = 'home' | 'reports' | 'alerts' | 'events' | 'circulars' | 'updates' | 'training' | 'more' | 'appearance' | 'install' | 'library';
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const REPORT_KINDS: { type: ReportType; icon: typeof Zap; tone: string; labelKey?: Parameters<typeof t>[1]; prefix?: string; desc: string }[] = [
  { type: 'Near Miss', icon: Zap, tone: 'amber', labelKey: 'nearMiss', desc: 'Report something that almost caused injury or damage' },
  { type: 'Unsafe Condition', icon: AlertTriangle, tone: 'amber', labelKey: 'uc', prefix: 'UC', desc: 'Report an unsafe condition at your work site' },
  { type: 'Unsafe Act', icon: ShieldAlert, tone: 'red', labelKey: 'unsafeAct', prefix: 'UA', desc: 'Report an unsafe act or behaviour' },
  { type: 'Hazard', icon: AlertTriangle, tone: 'red', labelKey: 'hazard', desc: 'Spot and report an accident risk or property damage' },
  { type: 'Grievance', icon: MessageSquare, tone: 'purple', labelKey: 'grievance', desc: 'Raise a workplace concern for the safety team' },
  { type: 'Speak Up', icon: CircleHelp, tone: 'purple', labelKey: 'speakUp', desc: 'Raise a concern anonymously if you prefer' },
  { type: 'Suggestion', icon: Lightbulb, tone: 'green', labelKey: 'suggestion', desc: 'Suggest improvements for safer work' },
  { type: 'Feedback', icon: ThumbsUp, tone: 'teal', labelKey: 'feedback', desc: 'Share experience on PPE, equipment, training or welfare' },
  { type: 'Safety Observation', icon: ShieldAlert, tone: 'blue', labelKey: 'safetyObservation', desc: 'Report or recognize a safety practice at work' }
];

const HOME_REPORT_ORDER: ReportType[] = ['Near Miss', 'Safety Observation', 'Hazard', 'Grievance', 'Speak Up', 'Suggestion', 'Feedback'];
const HOME_REPORT_KINDS = HOME_REPORT_ORDER.flatMap((type) => {
  const kind = REPORT_KINDS.find((item) => item.type === type);
  return kind ? [kind] : [];
});

const STATUS_CLASS: Record<ReportStatus, string> = {
  Open: 'status-open',
  'In Progress': 'status-progress',
  Closed: 'status-closed'
};

function maskEmpNo(value: string | null): string {
  if (!value) return 'Anonymous';
  return value.length > 5 ? `${value.slice(0, 3)}••${value.slice(-2)}` : 'Employee';
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function queuedReportToSafetyReport(entry: QueuedReport): SafetyReport {
  const payload = entry.payload;
  return {
    id: `LOCAL-${entry.id.slice(0, 8).toUpperCase()}`,
    clientSubmissionId: entry.id,
    type: payload.type,
    category: payload.category,
    siteId: payload.siteId,
    area: payload.area || 'Area not specified',
    department: payload.department,
    incidentAt: payload.incidentAt,
    severity: payload.severity,
    immediateAction: payload.immediateAction,
    description: payload.description,
    shortDescription: payload.description.slice(0, 120),
    status: 'Open',
    reportedAt: payload.clientSubmittedAt || entry.queuedAt,
    reporterEmpNo: payload.anonymous ? null : payload.employeeNo,
    anonymous: payload.anonymous,
    hasAttachment: Boolean(entry.attachment),
    syncState: entry.state === 'needs-attention' ? 'needs-attention' : 'queued'
  };
}

export default function SafexHome() {
  const [language, setLanguage] = useState<Language>('hi');
  const [page, setPage] = useState<PageKey>('home');
  const [siteId, setSiteId] = useState('');
  const [siteReady, setSiteReady] = useState(false);
  const [siteDialog, setSiteDialog] = useState(false);
  const [siteDraft, setSiteDraft] = useState(DEMO_SITES[0]?.id ?? '');
  const [lifeRuleLocationOpen, setLifeRuleLocationOpen] = useState(false);
  const [lifeRuleOpen, setLifeRuleOpen] = useState(false);
  const [lifeRuleSite, setLifeRuleSite] = useState<Site | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [palette, setPalette] = useState<PaletteName>('safex');
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [reportDetail, setReportDetail] = useState<SafetyReport | null>(null);
  const [reports, setReports] = useState<SafetyReport[]>(DEMO_REPORTS);
  const [showAllSitesOtp, setShowAllSitesOtp] = useState(false);
  const [otpStage, setOtpStage] = useState<'details' | 'code'>('details');
  const [otpMessage, setOtpMessage] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [profileSearchOpen, setProfileSearchOpen] = useState(false);
  const [officerAccessOpen, setOfficerAccessOpen] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState('not requested');
  const [pushPrefs, setPushPrefs] = useState({ safety: true, notices: true, training: true, ownReports: true, allVendorSites: false, hideLockScreen: true });
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState('');
  const [toast, setToast] = useState('');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ReportStatus>('All');
  const [vaultCategoryId, setVaultCategoryId] = useState<VaultCategoryId | null>(null);
  const [feedDetail, setFeedDetail] = useState<HomeFeedItem | null>(null);
  const [reportSyncEnabled, setReportSyncEnabled] = useState(false);
  const [queuedReportCount, setQueuedReportCount] = useState(0);
  const [outboxSyncState, setOutboxSyncState] = useState<OutboxSyncResult['status'] | 'syncing' | 'storage-error'>('idle');
  const [outboxMessage, setOutboxMessage] = useState('');
  const outboxSyncLock = useRef(false);
  const outboxSyncAgain = useRef(false);

  const nextUpcomingEvent = useMemo(() => getUpcomingEvents()[0] ?? null, []);
  const latestCircular = useMemo(() => getHomeFeedItems('circulars')[0] ?? null, []);
  const latestNotice = useMemo(() => getHomeFeedItems('notices')[0] ?? null, []);
  const currentSite = DEMO_SITES.find((site) => site.id === siteId) ?? null;
  const isSingleSite = DEMO_SITES.length === 1;
  const T = (key: Parameters<typeof t>[1]) => t(language, key);
  const activeSiteReports = useMemo(() => reports.filter((report) => report.siteId === siteId), [reports, siteId]);
  const filteredReports = useMemo(() => activeSiteReports.filter((report) => {
    const textMatches = `${report.id} ${report.type} ${report.category ?? ''} ${report.area} ${report.department ?? ''} ${report.shortDescription}`.toLowerCase().includes(searchText.toLowerCase());
    const statusMatches = statusFilter === 'All' || report.status === statusFilter;
    return textMatches && statusMatches;
  }), [activeSiteReports, searchText, statusFilter]);

  async function refreshOutboxState() {
    const entries = await listQueuedReports();
    setQueuedReportCount(entries.length);
    setReports((current) => {
      const next = [...current];
      for (const entry of entries) {
        const local = queuedReportToSafetyReport(entry);
        const index = next.findIndex((item) => item.clientSubmissionId === entry.id);
        if (index >= 0) next[index] = { ...next[index], syncState: local.syncState, hasAttachment: local.hasAttachment };
        else next.unshift(local);
      }
      return next;
    });
    return entries;
  }

  async function syncOfflineReports(manual = false) {
    if (outboxSyncLock.current) {
      outboxSyncAgain.current = true;
      return;
    }
    outboxSyncLock.current = true;
    setOutboxSyncState('syncing');
    try {
      if (manual) await retryReportsNeedingAttention();
      const result = await syncPendingReports();
      setOutboxSyncState(result.status);
      if (result.syncedIds.length) {
        const synced = new Set(result.syncedIds);
        setReports((items) => items.map((item) => item.clientSubmissionId && synced.has(item.clientSubmissionId) ? { ...item, syncState: 'synced' } : item));
        setOutboxMessage(`${result.syncedIds.length} report${result.syncedIds.length === 1 ? '' : 's'} synced to the configured database.`);
      } else {
        const statusMessages: Record<OutboxSyncResult['status'], string> = {
          idle: '',
          synced: 'All saved reports are synced.',
          offline: 'No internet connection. Reports remain saved on this device and will retry automatically.',
          'backend-unconfigured': 'Reports are saved on this device. Database sync is not configured on the Safex server yet.',
          'server-error': 'The database server is unavailable. Reports remain saved here and will retry.',
          'needs-attention': 'Some queued reports need attention before they can sync.',
          'rate-limited': 'Sync is temporarily rate-limited; it will retry later.'
        };
        setOutboxMessage(statusMessages[result.status]);
      }
      await refreshOutboxState();
      if (result.syncedIds.length) setToast(`${result.syncedIds.length} queued report${result.syncedIds.length === 1 ? '' : 's'} synced.`);
    } catch {
      setOutboxSyncState('storage-error');
      setOutboxMessage('Offline report storage could not be read. Keep the form open and try again.');
    } finally {
      outboxSyncLock.current = false;
      if (outboxSyncAgain.current) {
        outboxSyncAgain.current = false;
        void syncOfflineReports();
      }
    }
  }

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem('safex-theme-mode') as ThemeMode | null;
      const savedPalette = localStorage.getItem('safex-palette') as PaletteName | null;
      const savedLanguage = localStorage.getItem('safex-language') as Language | null;
      const savedPush = localStorage.getItem('safex-push-preferences');
      if (savedMode && ['system', 'light', 'dark'].includes(savedMode)) setThemeMode(savedMode);
      if (savedPalette && ['safex', 'ocean', 'forest', 'contrast'].includes(savedPalette)) setPalette(savedPalette);
      if (savedLanguage && ['en', 'hi', 'or', 'bn', 'pa', 'mr'].includes(savedLanguage)) setLanguage(savedLanguage);
      if (savedPush) {
        const parsed = JSON.parse(savedPush) as Partial<typeof pushPrefs>;
        setPushPrefs((current) => ({ ...current, ...parsed }));
      }
      if ('Notification' in window) setNotificationPermission(Notification.permission);

      if (DEMO_SITES.length === 1) {
        setSiteId(DEMO_SITES[0].id);
        setSiteDraft(DEMO_SITES[0].id);
      } else {
        const savedSite = sessionStorage.getItem('safex-active-site');
        if (savedSite && DEMO_SITES.some((site) => site.id === savedSite)) {
          setSiteId(savedSite);
          setSiteDraft(savedSite);
        } else {
          setSiteDialog(true);
        }
      }
    } catch {
      if (DEMO_SITES.length > 1) setSiteDialog(true);
      else if (DEMO_SITES[0]) setSiteId(DEMO_SITES[0].id);
    }
    setSiteReady(true);

    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleInstall);
    window.addEventListener('appinstalled', () => setInstallMessage('Safex has been installed on this device.'));
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => setToast('Service worker could not be registered.'));
    }
    return () => window.removeEventListener('beforeinstallprompt', handleInstall);
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/health', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((health) => {
      if (active) setReportSyncEnabled(Boolean(health?.reportSubmissionEnabled));
    }).catch(() => {
      if (active) setReportSyncEnabled(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const refreshAndSync = async () => {
      try {
        const entries = await refreshOutboxState();
        if (!active || !entries.length) return;
        if (navigator.onLine) void syncOfflineReports();
        else {
          setOutboxSyncState('offline');
          setOutboxMessage('No internet connection. Saved reports will sync automatically when you reconnect.');
        }
      } catch {
        if (active) {
          setOutboxSyncState('storage-error');
          setOutboxMessage('Offline report storage is not available in this browser.');
        }
      }
    };
    const trySync = () => { if (active) void syncOfflineReports(); };
    const handleVisibility = () => { if (document.visibilityState === 'visible') trySync(); };
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SAFE_REPORT_OUTBOX_UPDATED') trySync();
    };

    void refreshAndSync();
    window.addEventListener('online', trySync);
    window.addEventListener('focus', trySync);
    document.addEventListener('visibilitychange', handleVisibility);
    navigator.serviceWorker?.addEventListener('message', handleWorkerMessage);
    return () => {
      active = false;
      window.removeEventListener('online', trySync);
      window.removeEventListener('focus', trySync);
      document.removeEventListener('visibilitychange', handleVisibility);
      navigator.serviceWorker?.removeEventListener('message', handleWorkerMessage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.mode = themeMode;
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem('safex-theme-mode', themeMode);
      localStorage.setItem('safex-palette', palette);
      localStorage.setItem('safex-language', language);
    } catch { /* Preferences remain available for the current session if storage is blocked. */ }
  }, [themeMode, palette, language]);

  useEffect(() => {
    const htmlLang: Record<Language, string> = { en: 'en', hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', pa: 'pa-IN', mr: 'mr-IN' };
    document.documentElement.lang = htmlLang[language];
  }, [language]);

  useEffect(() => {
    try { localStorage.setItem('safex-push-preferences', JSON.stringify(pushPrefs)); } catch { /* session-only preference */ }
  }, [pushPrefs]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function chooseSite(id: string) {
    const valid = DEMO_SITES.find((site) => site.id === id);
    if (!valid) return;
    setSiteId(valid.id);
    setSiteDraft(valid.id);
    try { sessionStorage.setItem('safex-active-site', valid.id); } catch { /* no-op */ }
    setSiteDialog(false);
    setPage('home');
    setToast(`${valid.name} selected. Site content is now filtered for this visit.`);
  }

  function openLifeRuleForSite(site: Site) {
    setLifeRuleSite(site);
    setLifeRuleLocationOpen(false);
    setLifeRuleOpen(true);
  }

  function changeLifeRuleLocation() {
    setLifeRuleOpen(false);
    setLifeRuleLocationOpen(true);
  }

  function openReport(type: ReportType) {
    if (!currentSite) {
      setSiteDialog(true);
      return;
    }
    setReportType(type);
  }

  async function submitReport(data: ReportSubmission) {
    if (!currentSite) throw new Error('Select a site before saving the report.');
    const clientSubmittedAt = new Date().toISOString();
    const clientSubmissionId = createSubmissionId();
    const queued = await enqueueReport({
      clientSubmissionId,
      siteId: currentSite.id,
      type: data.type,
      category: data.category,
      anonymous: data.type === 'Speak Up' && data.anonymous,
      employeeNo: data.type === 'Speak Up' && data.anonymous ? null : data.employee?.empNo ?? null,
      area: data.area,
      department: data.department,
      incidentAt: data.incidentAt,
      description: data.description,
      immediateAction: data.immediateAction,
      severity: data.severity,
      clientSubmittedAt
    }, data.photo);
    const fresh = queuedReportToSafetyReport(queued);
    setReports((items) => [fresh, ...items]);
    setReportType(null);
    setQueuedReportCount((count) => count + 1);
    setOutboxSyncState(navigator.onLine ? 'idle' : 'offline');
    setOutboxMessage('Report saved on this device. It will try to sync automatically when online.');
    const reportLabel = data.category ? `${data.type} · ${data.category}` : data.type;
    setToast(`${reportLabel} saved on this device. Auto-sync will run when a connection is available.`);
    void registerReportBackgroundSync();
    void syncOfflineReports();
  }

  async function requestPushPermission() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setToast('This browser does not support web notifications.');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      if (result === 'granted') setToast('Device permission granted. Server push delivery still needs VAPID/backend setup.');
      else setToast('Notifications remain off until device permission is granted.');
    } catch {
      setToast('Notification permission could not be requested in this browser.');
    }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      setInstallMessage(result.outcome === 'accepted' ? 'Install accepted. Follow your device prompt to finish.' : 'Install was dismissed; you can try again later.');
      setInstallPrompt(null);
      return;
    }
    setInstallMessage('No one-tap install prompt is available here. Use the browser menu → Install app / Add to Home Screen. On iPhone, use Share → Add to Home Screen.');
  }

  function requestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOtpCode('');
    setOtpStage('code');
    setOtpMessage('Demo only: no OTP was sent. Connect phone verification to the registered employee record before enabling All Site Reports.');
  }

  function verifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOtpMessage('OTP verification is not connected. All Site Reports remain locked until the registered-phone OTP service is configured.');
  }

  function setPref(key: keyof typeof pushPrefs) {
    setPushPrefs((prefs) => ({ ...prefs, [key]: !prefs[key] }));
  }

  const statusCounts = {
    Open: activeSiteReports.filter((item) => item.status === 'Open').length,
    'In Progress': activeSiteReports.filter((item) => item.status === 'In Progress').length,
    Closed: activeSiteReports.filter((item) => item.status === 'Closed').length
  };

  return (
    <div className="safex-app">
      <div className="demo-ribbon"><span className="demo-dot" /> {reportSyncEnabled ? 'DEMO MODE · Sample feed records only · new reports sync when online' : 'DEMO MODE · Sample records only · database sync is not configured'}</div>
      <div className="site-header-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <button className="brand-button" onClick={() => setPage('home')} aria-label="Safex Home">
              <span className="brand-mark">{DEMO_TENANT.companyName.trim().charAt(0) || 'S'}</span><span className="brand-copy"><b>{DEMO_TENANT.companyName}</b></span>
            </button>
            {isSingleSite ? <div className="site-switch site-switch-static"><MapPin size={13} /><span>{currentSite?.name ?? 'Site'}</span></div> : <button className="site-switch" onClick={() => { setSiteDraft(siteId || DEMO_SITES[0].id); setSiteDialog(true); }} aria-label={currentSite ? `Selected site ${currentSite.name}. Change site` : 'Choose site'}><MapPin size={13} /><span>{currentSite?.name ?? 'Choose site'}</span><span className="change-link">{T('changeSite')}</span><ChevronDown size={12} /></button>}
          </div>
          <div className="header-actions">
            {DEMO_TENANT.features.pushNotifications && <button className="icon-button notification-button" onClick={() => setNotificationsOpen(true)} aria-label="Notification settings, 3 sample updates"><Bell size={19} /><span className="notification-count">3</span></button>}
            <button className="sos-button" onClick={() => currentSite ? setSosOpen(true) : setSiteDialog(true)} aria-label="SOS emergency contact">SOS</button>
            <button className="icon-button profile-button" onClick={() => setOfficerAccessOpen(true)} aria-label="Account login"><UserRound size={19} /></button>
          </div>
        </header>
        <LanguageStrip language={language} onChange={setLanguage} className="home-language-strip" />
      </div>
      {queuedReportCount > 0 && <aside className={`sync-status-banner ${outboxSyncState}`} role="status" aria-live="polite">
        <span className="sync-status-icon"><CloudUpload size={19} /></span>
        <span className="sync-status-copy"><b>{queuedReportCount} report{queuedReportCount === 1 ? '' : 's'} saved on this device</b><small>{outboxMessage || 'Waiting for a connection and a configured database endpoint.'}</small></span>
        <button type="button" className="sync-status-action" onClick={() => void syncOfflineReports(true)} disabled={outboxSyncState === 'syncing' || !reportSyncEnabled}>{outboxSyncState === 'syncing' ? 'Syncing…' : 'Sync now'}</button>
      </aside>}

      <main className="main-content">
        {page === 'home' && <>
          <section className="hero-strip">
            <div className="hero-copy"><span className="eyebrow">SAFETY HOME</span><h1>Safety Portal</h1><p>Report hazards, find safety updates and learn from reports at your selected site.</p></div>
            <button className="life-saving-card" type="button" onClick={() => setLifeRuleLocationOpen(true)} aria-haspopup="dialog">
              <span className="life-saving-icon"><ShieldAlert size={22} /></span>
              <span className="life-saving-copy"><b>LIFE SAVING RULE</b><small>Select a location to view site rules</small></span>
              <ChevronRight size={20} />
            </button>
          </section>
          <section className="section-block">
            <div className="section-heading"><div><span className="eyebrow">TAKE ACTION</span><h2>Report a safety concern</h2></div><span className="section-note">No login needed to submit</span></div>
            <div className="report-grid">
              {HOME_REPORT_KINDS.map(({ type, icon: Icon, tone, labelKey, prefix, desc }) => <button key={type} className="report-tile" onClick={() => openReport(type)}>
                <span className={`tile-icon ${tone}`}><Icon size={20} /></span><span className="tile-copy"><b>{prefix ? `${prefix} · ` : ''}{labelKey ? T(labelKey) : type}</b><small>{desc}</small></span><ChevronRight size={17} className="tile-arrow" />
              </button>)}
            </div>
          </section>
          <section className="section-block quick-section">
            <div className="section-heading"><div><span className="eyebrow">QUICK ACCESS</span><h2>Shortcuts</h2></div></div>
            <div className="home-feature-list">
              <button className="home-feature-row reports-feature" onClick={() => setPage('reports')}>
                <span className="home-feature-icon"><FileText size={22} /></span>
                <span className="home-feature-copy"><b>{T('viewReports')}</b><small>{language === 'hi' ? 'Open / Closed स्टेटस ट्रैक करें' : 'Track Open / Closed status'}</small></span>
                <ChevronRight size={20} />
              </button>
              {DEMO_TENANT.features.trainingManagement && <button className="home-feature-row" onClick={() => setPage('training')}>
                <span className="home-feature-icon"><Smartphone size={22} /></span>
                <span className="home-feature-copy"><b>{language === 'hi' ? 'ट्रेनिंग मैनेजमेंट' : 'Training Management'}</b><small>{language === 'hi' ? 'मॉड्यूल, वीडियो और प्रगति' : 'Modules, videos and progress'}</small></span>
                <ChevronRight size={20} />
              </button>}
              {(DEMO_TENANT.features.library || DEMO_TENANT.features.circulars) && <button className="home-feature-row" onClick={() => setPage('updates')}>
                <span className="home-feature-icon"><FileText size={22} /></span>
                <span className="home-feature-copy"><b>{language === 'hi' ? 'सर्कुलर और नोटिस' : DEMO_TENANT.features.library && !DEMO_TENANT.features.circulars ? 'Safety Library' : 'Circulars & Notices'}</b><small>{language === 'hi' ? 'ताज़ा सूचनाएँ' : 'Browse all circulars and notices'}</small></span>
                <span className="home-feature-link">{language === 'hi' ? 'सभी देखें ›' : 'See all ›'}</span>
              </button>}
            </div>
          </section>
          {DEMO_TENANT.features.library && <section className="section-block document-vault-section">
            <div className="section-heading vault-section-heading"><div className="vault-section-title"><span className="vault-title-icon"><FolderOpen size={23} /></span><div><span className="eyebrow">DOCUMENTS</span><h2>Document Vault / Library</h2></div></div><button className="secondary-button vault-open-button" type="button" onClick={() => setPage('library')}>Open Library</button></div>
            <DocumentVaultGrid onSelect={setVaultCategoryId} />
            <p className="home-demo-caption">Site document categories · demo index only; files and compliance records are not connected.</p>
          </section>}
          {DEMO_TENANT.features.rewardWall && <section className="section-block reward-wall-section">
            <div className="section-heading"><div><span className="eyebrow">RECOGNITION</span><h2>Wall of Fame / Reward Wall</h2></div></div>
            <RewardCarousel />
          </section>}
          {DEMO_TENANT.features.circulars && <>
            <HomeFeedSection kind="events" eyebrow="COMING UP" title="Upcoming Event" item={nextUpcomingEvent} siteName={currentSite?.name ?? 'Selected site'} onViewAll={() => setPage('events')} onOpenItem={setFeedDetail} />
            <HomeFeedSection kind="circulars" eyebrow="DOCUMENTS & UPDATES" title="Latest Circular" item={latestCircular} siteName={currentSite?.name ?? 'Selected site'} onViewAll={() => setPage('circulars')} onOpenItem={setFeedDetail} />
            <HomeFeedSection kind="notices" eyebrow="SITE UPDATES" title="Latest Notice" item={latestNotice} siteName={currentSite?.name ?? 'Selected site'} onViewAll={() => setPage('alerts')} onOpenItem={setFeedDetail} />
          </>}
        </>}

        {page === 'reports' && <section className="page-panel">
          <div className="page-heading"><div><span className="eyebrow">{currentSite?.name ?? 'SITE'}</span><h1>{T('reportsTitle')}</h1><p>My Site Reports follows the site selected when the app opened. No Employee No. lookup is needed.</p></div><button className="secondary-button" onClick={() => !isSingleSite && setSiteDialog(true)}>{T('changeSite')}</button></div>
          <div className="report-scope-grid"><button className="scope-card selected" onClick={() => setStatusFilter('All')}><span className="scope-icon"><ClipboardList /></span><b>{T('mySiteReports')}</b><small>{currentSite?.name ?? 'Choose a site'} · Site-filtered</small></button><button className="scope-card" onClick={() => { setShowAllSitesOtp(true); setOtpMessage(''); setOtpStage('details'); }}><span className="scope-icon locked"><LockKeyhole /></span><b>{T('allSiteReports')}</b><small>Employee ID + registered mobile + OTP</small></button></div>
          <div className="stat-row"><div className="stat-card"><b>{activeSiteReports.length}</b><span>Total</span></div><div className="stat-card"><b>{statusCounts.Open}</b><span>Open</span></div><div className="stat-card"><b>{statusCounts['In Progress']}</b><span>In progress</span></div><div className="stat-card"><b>{statusCounts.Closed}</b><span>Closed</span></div></div>
          <div className="list-toolbar"><div className="search-box"><Search size={17} /><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search report ID, type or area" /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'All' | ReportStatus)} aria-label="Filter by status"><option value="All">All statuses</option><option>Open</option><option>In Progress</option><option>Closed</option></select></div>
          <div className="report-list">{filteredReports.map((item) => <ReportCard key={item.id} report={item} site={DEMO_SITES.find((s) => s.id === item.siteId)} onOpen={() => setReportDetail(item)} />)}{filteredReports.length === 0 && <div className="empty-state"><ClipboardList size={28} /><b>No reports found</b><span>Try another filter or report a safety concern.</span></div>}</div>
          <div className="privacy-note"><LockKeyhole size={15} /> Demo summaries mask reporter IDs. Production access and attachments must be enforced server-side.</div>
        </section>}

        {page === 'alerts' && <FeedArchivePage kind="notices" siteName={currentSite?.name ?? 'Selected site'} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'events' && <FeedArchivePage kind="events" siteName={currentSite?.name ?? 'Selected site'} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'circulars' && <FeedArchivePage kind="circulars" siteName={currentSite?.name ?? 'Selected site'} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'updates' && <FeedArchivePage kind="updates" siteName={currentSite?.name ?? 'Selected site'} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}

        {page === 'training' && <TrainingPortal site={currentSite} employees={DEMO_EMPLOYEES} />}

        {page === 'library' && <section className="page-panel document-vault-page">
          <div className="page-heading"><div><span className="eyebrow">DOCUMENTS · {currentSite?.name ?? 'SELECTED SITE'}</span><h1>Document Vault / Library</h1><p>Browse site safety procedures, risk assessments, compliance indexes, policies and meeting minutes.</p></div><FolderOpen size={28} /></div>
          <DocumentVaultGrid onSelect={setVaultCategoryId} />
          <div className="privacy-note"><LockKeyhole size={15} /> Demo index only · actual site documents and statutory records are not connected.</div>
        </section>}

        {page === 'more' && <section className="page-panel"><div className="page-heading"><div><span className="eyebrow">SAFEX</span><h1>{T('more')}</h1><p>Install the app, change its appearance or open safety resources.</p></div><MoreHorizontal size={28} /></div><div className="more-list">
          <button className="more-row" onClick={() => setPage('install')}><span className="more-icon"><Smartphone /></span><span><b>{T('installApp')}</b><small>Add Safex to this device’s Home Screen</small></span><ChevronRight /></button>
          <button className="more-row" onClick={() => setPage('appearance')}><span className="more-icon amber"><Palette /></span><span><b>{T('appearance')}</b><small>System, light/dark and colour palette</small></span><ChevronRight /></button>
          <button className="more-row" onClick={() => setPage('reports')}><span className="more-icon"><ClipboardList /></span><span><b>{T('viewReports')}</b><small>Selected-site reports and OTP all-site flow</small></span><ChevronRight /></button>
          {DEMO_TENANT.features.library && <button className="more-row" onClick={() => setPage('library')}><span className="more-icon"><BookOpen /></span><span><b>Document Vault / Library</b><small>SOP/SWP, risk assessments, compliance, policies and MoM</small></span><ChevronRight /></button>}
          {DEMO_TENANT.features.circulars && <button className="more-row" onClick={() => setPage('updates')}><span className="more-icon"><FileText /></span><span><b>Circulars & notices</b><small>Browse the complete demo update archive</small></span><ChevronRight /></button>}
          {DEMO_TENANT.features.trainingManagement && <button className="more-row" onClick={() => setPage('training')}><span className="more-icon"><BookOpen /></span><span><b>Training Management</b><small>Optional vendor feature</small></span><ChevronRight /></button>}
          {DEMO_TENANT.features.rewardWall && <button className="more-row" onClick={() => setToast('Reward Wall is enabled for this demo tenant; backend content is not connected.')}><span className="more-icon"><Trophy /></span><span><b>Reward Wall</b><small>Optional vendor feature</small></span><ChevronRight /></button>}
          <button className="more-row" onClick={() => setProfileSearchOpen(true)}><span className="more-icon"><Search /></span><span><b>Search Worker Profile</b><small>Find a worker using an Employee Code</small></span><ChevronRight /></button>
          <button className="more-row" onClick={() => setOfficerAccessOpen(true)}><span className="more-icon"><LockKeyhole /></span><span><b>Account Login</b><small>Employee, supervisor or admin sign in</small></span><ChevronRight /></button>
          <div className="more-row static"><span className="more-icon"><Settings2 /></span><span><b>Data connection</b><small>{process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Supabase URL configured; verify schema and policies' : 'Demo mode · Supabase not configured'}</small></span><span className="connection-dot" /></div>
        </div><div className="privacy-note"><LockKeyhole size={15} /> Never place a Supabase service-role key in browser code or public environment variables.</div></section>}

        {page === 'appearance' && <section className="page-panel narrow-panel"><div className="page-heading"><div><span className="eyebrow">MORE · SETTINGS</span><h1>{T('appearance')}</h1><p>Choose how the whole app looks on this device.</p></div><Palette size={28} /></div>
          <div className="settings-card"><h2>Appearance mode</h2><div className="choice-row">{(['system', 'light', 'dark'] as ThemeMode[]).map((mode) => <button key={mode} className={`choice-chip ${themeMode === mode ? 'active' : ''}`} onClick={() => setThemeMode(mode)}>{mode === 'system' ? <Monitor size={16} /> : mode === 'light' ? <Sun size={16} /> : <Moon size={16} />}<span>{mode[0].toUpperCase() + mode.slice(1)}</span></button>)}</div></div>
          <div className="settings-card"><h2>Colour theme</h2><p>Colours apply to the header, home, report forms, cards and navigation.</p><div className="palette-grid">{([
            ['safex', 'Safex', '#0f2540', '#f5a623'], ['ocean', 'Ocean', '#123b5d', '#31b7c7'], ['forest', 'Forest', '#164b3a', '#70b77e'], ['contrast', 'High contrast', '#101820', '#ffd400']
          ] as [PaletteName, string, string, string][]).map(([id, name, primary, accent]) => <button key={id} className={`palette-choice ${palette === id ? 'selected' : ''}`} onClick={() => setPalette(id)}><span className="swatch-pair"><i style={{ background: primary }} /><i style={{ background: accent }} /></span><b>{name}</b>{palette === id && <Check size={15} />}</button>)}</div></div>
          <div className="preview-card"><div className="preview-header"><span className="preview-logo">S</span><b>Safex · {currentSite?.name ?? 'Site'}</b><span className="preview-sos">SOS</span></div><div className="preview-body"><span>Home</span><span>Report</span><span>Alerts</span></div></div>
          <div className="privacy-note"><Check size={15} /> Preferences save on this device. SOS and report-status colours keep their safety meaning.</div>
        </section>}

        {page === 'install' && <section className="page-panel narrow-panel"><div className="page-heading"><div><span className="eyebrow">MORE · APP</span><h1>{T('installApp')}</h1><p>Add Safex to your Home Screen for app-like access.</p></div><Smartphone size={28} /></div><div className="install-card"><div className="app-icon">S</div><h2>Safex Safety</h2><p>Site-aware safety reporting and alerts</p><button className="primary-button install-button" onClick={installApp}><Smartphone size={17} /> Install Safex App</button>{installMessage && <div className="inline-notice">{installMessage}</div>}</div><div className="settings-card"><h2>If the install button is unavailable</h2><ol className="install-steps"><li>Open the browser menu and choose <b>Install app</b> or <b>Add to Home Screen</b>.</li><li>On iPhone, use <b>Share → Add to Home Screen</b>.</li><li>Your device/browser may ask you to confirm installation.</li></ol></div><div className="privacy-note"><CircleHelp size={15} /> PWA installation requires HTTPS, a web manifest and service worker. This starter includes those basics; platform support still varies.</div></section>}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavItem active={page === 'home'} icon={<Home />} label={T('home')} onClick={() => setPage('home')} />
        <NavItem active={page === 'alerts' || page === 'events' || page === 'circulars' || page === 'updates'} icon={<Bell />} label={T('alerts')} onClick={() => setPage('alerts')} />
        <button className="nav-report" onClick={() => setReportPickerOpen(true)} aria-label={T('report')} aria-haspopup="dialog"><PlusIcon /><span>{T('report')}</span></button>
        {DEMO_TENANT.features.trainingManagement && <NavItem active={page === 'training'} icon={<BookOpen />} label={T('training')} onClick={() => setPage('training')} />}
        <NavItem active={page === 'more' || page === 'appearance' || page === 'install' || page === 'library'} icon={<MoreHorizontal />} label={T('more')} onClick={() => setPage('more')} />
      </nav>

      {siteReady && siteDialog && <div className="overlay site-overlay" role="dialog" aria-modal="true" aria-labelledby="site-title"><div className="modal site-modal"><div className="modal-brand"><span className="brand-mark">{DEMO_TENANT.companyName.trim().charAt(0) || 'S'}</span><span><b>{DEMO_TENANT.companyName}</b><small>Powered by Safex Safety</small></span><button className="close-button site-modal-close" type="button" onClick={() => setSiteDialog(false)} aria-label="Close site selection"><X /></button></div><LanguageStrip language={language} onChange={setLanguage} className="site-language-strip" /><span className="eyebrow">SITE SELECTION</span><h2 id="site-title">{T('sitePrompt')}</h2><p>Select the site where you are working now. Home, reports and SOS will follow this site for this visit.</p><label className="field-label" htmlFor="site-select">{T('selectSite')}</label><select id="site-select" className="form-control" value={siteDraft} onChange={(e) => setSiteDraft(e.target.value)}>{DEMO_SITES.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.region}</option>)}</select><button className="primary-button full-button" onClick={() => chooseSite(siteDraft)}>{T('continue')} <ChevronRight size={17} /></button><div className="modal-footnote"><LockKeyhole size={14} /> Site selection filters the page; it does not verify employee identity.</div></div></div>}

      {lifeRuleLocationOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="life-rule-location-title"><div className="modal life-rule-location-modal"><div className="modal-header"><div><span className="eyebrow">LIFE SAVING RULE</span><h2 id="life-rule-location-title">Select a location</h2><p>Choose the site whose Life Saving Rules you want to view.</p></div><button className="close-button" type="button" onClick={() => setLifeRuleLocationOpen(false)} aria-label="Close location selection"><X /></button></div><div className="life-rule-location-list">{[...(currentSite ? [currentSite] : []), ...DEMO_SITES.filter((site) => site.id !== currentSite?.id)].map((site) => <button key={site.id} className={`life-rule-location-option ${site.id === currentSite?.id ? 'current' : ''}`} type="button" onClick={() => openLifeRuleForSite(site)}><span className="life-location-icon"><MapPin size={18} /></span><span><b>{site.name}</b><small>{site.region}{site.id === currentSite?.id ? ' · Current site' : ''}</small></span><ChevronRight size={18} /></button>)}</div><button className="secondary-button full-button" type="button" onClick={() => setLifeRuleLocationOpen(false)}>Back to Safety Portal</button></div></div>}

      {lifeRuleOpen && lifeRuleSite && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="life-rule-title"><div className="modal life-rule-modal"><div className="modal-header"><div><span className="eyebrow">{lifeRuleSite.name} · LOCATION</span><h2 id="life-rule-title">LIFE SAVING RULE</h2></div><button className="close-button" type="button" onClick={() => setLifeRuleOpen(false)} aria-label="Close Life Saving Rule"><X /></button></div><div className="life-rule-site-banner"><span className="life-saving-icon"><ShieldAlert size={21} /></span><span><small>SELECTED LOCATION</small><b>{lifeRuleSite.name}</b></span></div><div className="life-rule-placeholder"><BookOpen size={28} /><b>Approved rules are not published yet</b><p>Company-approved Life Saving Rules for {lifeRuleSite.name} have not been configured in this demo. Confirm your site’s current rules with the Safety team before beginning work.</p></div><div className="life-rule-actions"><button className="secondary-button" type="button" onClick={changeLifeRuleLocation}><MapPin size={15} /> Change location</button><button className="primary-button" type="button" onClick={() => setLifeRuleOpen(false)}>Close</button></div></div></div>}

      {reportPickerOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="report-picker-title"><div className="modal report-picker-modal"><div className="modal-header"><div><span className="eyebrow">{currentSite?.name ?? 'SAFETY REPORTING'}</span><h2 id="report-picker-title">What would you like to report?</h2><p>Choose a report type to continue.</p></div><button className="close-button" type="button" onClick={() => setReportPickerOpen(false)} aria-label="Close report types"><X /></button></div><div className="report-picker-grid">{REPORT_KINDS.map(({ type, icon: Icon, tone, labelKey, prefix, desc }) => <button key={type} type="button" className="report-picker-option" onClick={() => { setReportPickerOpen(false); openReport(type); }}><span className={`tile-icon ${tone}`}><Icon size={19} /></span><span className="report-picker-copy"><b>{prefix ? `${prefix} · ` : ''}{labelKey ? T(labelKey) : type}</b><small>{desc}</small></span><ChevronRight size={17} /></button>)}</div></div></div>}

      {reportType && currentSite && <ReportWorkflow key={`${reportType}-${currentSite.id}`} type={reportType} site={currentSite} employees={DEMO_EMPLOYEES} language={language} onLanguageChange={setLanguage} voiceEnabled={DEMO_TENANT.features.voiceReporting} syncEnabled={reportSyncEnabled} onClose={() => setReportType(null)} onSubmit={submitReport} />}
      {profileSearchOpen && <ProfileSearchDialog site={currentSite} employees={DEMO_EMPLOYEES} onClose={() => setProfileSearchOpen(false)} />}
      {officerAccessOpen && <OfficerAccessDialog onClose={() => setOfficerAccessOpen(false)} />}

      {showAllSitesOtp && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="otp-title"><div className="modal otp-modal"><div className="modal-header"><div><span className="eyebrow">CROSS-SITE ACCESS</span><h2 id="otp-title">{T('allSiteReports')}</h2></div><button className="close-button" onClick={() => setShowAllSitesOtp(false)} aria-label="Close"><X /></button></div><LanguageStrip language={language} onChange={setLanguage} className="modal-language-strip" /><p>Verify your Employee ID and the mobile number registered in the employee master. Only redacted reports from your vendor tenant may be shown after OTP verification.</p>{otpStage === 'details' ? <form onSubmit={requestOtp}><label className="field-label" htmlFor="otp-emp">Employee ID</label><input id="otp-emp" className="form-control" placeholder="Your Employee ID" autoComplete="off" required /><label className="field-label" htmlFor="otp-phone">Registered mobile number</label><input id="otp-phone" className="form-control" type="tel" inputMode="tel" placeholder="+91…" minLength={10} maxLength={18} required /><button className="primary-button full-button" type="submit">Send OTP</button></form> : <><div className="otp-message-preview"><LockKeyhole size={17} /><span>Six-digit verification step · no real code is sent in demo mode.</span></div><form onSubmit={verifyOtp}><label className="field-label" htmlFor="otp-code">Six-digit OTP</label><input id="otp-code" className="form-control otp-code-input" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" required /><button className="primary-button full-button" type="submit">Verify OTP</button><button className="text-button otp-back-button" type="button" onClick={() => { setOtpStage('details'); setOtpMessage(''); }}>Back to Employee ID and mobile</button></form></>}{otpMessage && <div className="inline-notice warning" role="status">{otpMessage}</div>}<div className="modal-footnote"><LockKeyhole size={14} /> All-site access stays locked until registered-phone OTP, tenant scope and redaction are enforced by the server.</div></div></div>}

      {notificationsOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="notification-title"><div className="modal settings-modal"><div className="modal-header"><div><span className="eyebrow">DEVICE SETTINGS</span><h2 id="notification-title">Push notifications</h2></div><button className="close-button" onClick={() => setNotificationsOpen(false)} aria-label="Close"><X /></button></div><p>Choose which published updates reach this device. Avoid sending every draft or internal edit.</p><div className="notification-status"><Bell size={17} /><span>Browser permission: <b>{notificationPermission}</b></span></div><Preference label="Safety Alerts and urgent notices" detail="New published safety alerts" checked={pushPrefs.safety} onChange={() => setPref('safety')} /><Preference label="Circulars and published updates" detail="Notices, events and training" checked={pushPrefs.notices} onChange={() => setPref('notices')} /><Preference label="My report status" detail="Updates only for your reports" checked={pushPrefs.ownReports} onChange={() => setPref('ownReports')} /><Preference label="All vendor-site updates" detail="Opt in for this vendor only" checked={pushPrefs.allVendorSites} onChange={() => setPref('allVendorSites')} /><Preference label="Hide details on lock screen" detail="Recommended for privacy" checked={pushPrefs.hideLockScreen} onChange={() => setPref('hideLockScreen')} /><button className="primary-button full-button" onClick={requestPushPermission}>Allow notifications on this device</button><div className="modal-footnote">Production push still requires a service worker subscription and server-side VAPID sender.</div></div></div>}

      {sosOpen && currentSite && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="sos-title"><div className="modal sos-modal"><div className="modal-header"><div><span className="eyebrow">CURRENT SITE · EMERGENCY CONTACT</span><h2 id="sos-title">SOS · {currentSite.name}</h2></div><button className="close-button" onClick={() => setSosOpen(false)} aria-label="Close SOS"><X /></button></div><p>Safex will use the emergency number configured for <b>{currentSite.name}</b>.</p>{currentSite.sosNumber ? <a className="sos-call-link" href={`tel:${currentSite.sosNumber}`}>Call site emergency contact · {currentSite.sosNumber}</a> : <div className="inline-notice warning">No SOS number is configured for this demo site. Add and verify the real site contact before launch.</div>}<div className="modal-footnote"><AlertTriangle size={14} /> Confirm the displayed site before calling. Emergency numbers must come from site Admin configuration.</div></div></div>}

      {reportDetail && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="modal detail-modal"><div className="modal-header"><div><span className="eyebrow">{DEMO_SITES.find((site) => site.id === reportDetail.siteId)?.name}</span><h2 id="detail-title">{reportDetail.id}</h2></div><button className="close-button" onClick={() => setReportDetail(null)} aria-label="Close"><X /></button></div><div className="detail-meta"><span className="type-chip">{reportDetail.type}</span>{reportDetail.category && <span className="type-chip">{reportDetail.category}</span>}<span className={`status-pill ${STATUS_CLASS[reportDetail.status]}`}>{reportDetail.status}</span></div><dl className="detail-grid"><div><dt>Reported by</dt><dd>{reportDetail.anonymous ? 'Anonymous' : maskEmpNo(reportDetail.reporterEmpNo)}</dd></div><div><dt>Site</dt><dd>{DEMO_SITES.find((site) => site.id === reportDetail.siteId)?.name}</dd></div><div><dt>Area</dt><dd>{reportDetail.area}</dd></div><div><dt>Department</dt><dd>{reportDetail.department ?? 'N/A'}</dd></div><div><dt>Severity</dt><dd>{reportDetail.severity ?? 'N/A'}</dd></div><div><dt>Incident date & time</dt><dd>{formatDate(reportDetail.incidentAt ?? reportDetail.reportedAt)}</dd></div><div><dt>Submitted on</dt><dd>{formatDate(reportDetail.reportedAt)}</dd></div></dl><p className="detail-description">{reportDetail.description ?? reportDetail.shortDescription}</p>{reportDetail.immediateAction && <div className="detail-description"><b>Immediate action:</b> {reportDetail.immediateAction}</div>}{reportDetail.hasAttachment && <div className="attachment-preview"><ImagePlus /><span>Photo evidence noted</span><small>Demo placeholder · original image is not uploaded or stored</small></div>}<div className="modal-footnote">Worker view is redacted. Full IDs and unredacted evidence require authorized staff access.</div></div></div>}
      {vaultCategoryId && <VaultCategoryDialog categoryId={vaultCategoryId} siteName={currentSite?.name ?? 'Selected site'} onClose={() => setVaultCategoryId(null)} />}
      {feedDetail && <HomeFeedDetailDialog item={feedDetail} siteName={currentSite?.name ?? 'Selected site'} onClose={() => setFeedDetail(null)} />}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function ReportCard({ report, site, onOpen }: { report: SafetyReport; site?: Site; onOpen: () => void }) {
  return <button className="report-card" onClick={onOpen}><div className="report-card-top"><b>{report.id}</b><span className={`status-pill ${STATUS_CLASS[report.status]}`}>{report.status}</span></div><div className="report-card-type">{report.type}{report.category && <span> · {report.category}</span>}</div>{report.syncState && <span className={`report-sync-pill ${report.syncState}`}>{report.syncState === 'synced' ? 'Synced to database' : report.syncState === 'needs-attention' ? 'Needs sync review' : 'Saved on device · waiting to sync'}</span>}<p>{report.shortDescription}</p><div className="report-card-meta"><span><MapPin size={13} />{site?.name} · {report.area}</span><span>By {report.anonymous ? 'Anonymous' : maskEmpNo(report.reporterEmpNo)}</span><span>{formatDate(report.reportedAt)}</span></div>{report.hasAttachment && <span className="attachment-tag"><ImagePlus size={13} /> Photo noted in demo</span>}</button>;
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function Preference({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: () => void }) {
  return <div className="preference-row"><div><b>{label}</b><small>{detail}</small></div><button className={`switch ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={onChange}><span /></button></div>;
}

function PlusIcon() { return <span className="plus-symbol">+</span>; }
