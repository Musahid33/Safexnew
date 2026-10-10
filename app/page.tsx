'use client';

import {
  AlertTriangle, ArrowLeft, Bell, BookOpen, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3,
  ClipboardList, CloudOff, CloudUpload, Eye, FileText, FolderOpen, Globe2, Home, ImagePlus, Lightbulb, LockKeyhole, MapPin,
  Monitor, Mic, Moon, MoreHorizontal, Palette, RefreshCw, Search, Settings2, Shield, ShieldAlert,
  Smartphone, Sun, Trophy, UserRound, X, Zap, MessageSquare
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react';
import { LIFE_SAVING_RULES } from '@/lib/life-saving-rules';
import { DEMO_REPORTS, DEMO_TENANT } from '@/lib/demo-data';
import { DEMO_SAFETY_ALERTS, SAFETY_ALERT_FILTERS, type SafetyAlertCategory } from '@/lib/safety-alerts';
import { LANGUAGES, LANGUAGE_LOCALE } from '@/lib/i18n';
import LanguageStrip from './components/LanguageStrip';
import { useI18n } from './components/I18nProvider';
import ReportWorkflow, { type ReportSubmission } from './components/ReportWorkflow';
import TrainingPortal from './components/TrainingPortal';
import ProfileSearchDialog from './components/ProfileSearchDialog';
import OfficerAccessDialog from './components/OfficerAccessDialog';
import SafetyOsApp from './components/safetyos/SafetyOsApp';
import { DocumentVaultGrid, VaultCategoryDialog, type VaultCategoryId } from './components/DocumentVault';
import RewardCarousel from './components/RewardCarousel';
import { FeedArchivePage, HomeFeedDetailDialog } from './components/HomeFeedViews';
import { useSafexBootstrap } from './components/useSafexBootstrap';
import { AboutAppPage, AccountManagementPage, CompanyAboutPage, InstallAppPage, MoreInfoDialog, MoreMenuPage, type MoreInfoKind } from './components/MorePages';
import { APP_TIME_ZONE, formatHomeFeedDate, formatHomeFeedTime, getUpcomingEvents, type HomeFeedItem } from '@/lib/home-content';
import { createSubmissionId, enqueueReport, listQueuedReports, registerReportBackgroundSync, retryReportsNeedingAttention, syncPendingReports, type OutboxSyncResult, type QueuedReport } from '@/lib/report-outbox';
import { describeSyncStatus, SYNC_BANNER_AUTO_DISMISS_MS } from '@/lib/sync-status';
import type { Palette as PaletteName, ReportStatus, ReportType, SafetyReport, Site, ThemeMode } from '@/lib/types';

type PageKey = 'home' | 'reports' | 'alerts' | 'events' | 'circulars' | 'updates' | 'training' | 'more' | 'appearance' | 'install' | 'library' | 'company' | 'account' | 'aboutApp' | 'adminDashboard';
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
type UiMessage = { key: string; params?: Record<string, string | number>; report?: { type: ReportType; category: string | null } };

const REPORT_KINDS: { type: ReportType; icon: typeof Zap; tone: string; labelKey?: string; prefix?: string; suffix?: string; desc: string }[] = [
  { type: 'Near Miss', icon: Zap, tone: 'amber', labelKey: 'nearMiss', desc: 'Report something that almost caused injury or damage' },
  { type: 'Hazard', icon: AlertTriangle, tone: 'red', labelKey: 'hazard', desc: 'Spot and report an accident risk or property damage' },
  { type: 'Safety Observation', icon: Eye, tone: 'blue', labelKey: 'safetyObservation', suffix: '(UC / UA)', desc: 'Report or recognize a safety practice at work' },
  { type: 'Unsafe Condition', icon: AlertTriangle, tone: 'amber', labelKey: 'uc', prefix: 'UC', desc: 'Report an unsafe condition at your work site' },
  { type: 'Unsafe Act', icon: ShieldAlert, tone: 'red', labelKey: 'unsafeAct', prefix: 'UA', desc: 'Report an unsafe act or behaviour' },
  { type: 'Feedback', icon: MessageSquare, tone: 'teal', labelKey: 'feedback', desc: 'Share experience on PPE, equipment, training or welfare' },
  { type: 'Grievance', icon: MessageSquare, tone: 'purple', labelKey: 'grievance', desc: 'Raise a workplace concern for the safety team' },
  { type: 'Speak Up', icon: CircleHelp, tone: 'purple', labelKey: 'speakUp', desc: 'Raise a concern anonymously if you prefer' },
  { type: 'Suggestion', icon: Lightbulb, tone: 'green', labelKey: 'suggestion', desc: 'Suggest improvements for safer work' }
];

type HomeReportTile = {
  id: string;
  reportType?: ReportType;
  opensConcernChooser?: boolean;
  icon: typeof Zap;
  tone: string;
  labelKey?: string;
  titleEn?: string;
  titleHi?: string;
  descEn: string;
  descHi: string;
};

const HOME_REPORT_TILES: HomeReportTile[] = [
  { id: 'near-miss', reportType: 'Near Miss', icon: Zap, tone: 'amber', labelKey: 'nearMiss', descEn: 'A close call worth reporting', descHi: 'बाल-बाल बचे' },
  { id: 'hazard', reportType: 'Hazard', icon: AlertTriangle, tone: 'red', labelKey: 'hazard', descEn: 'Report a hazard', descHi: 'Hazard बताएँ' },
  { id: 'observation', reportType: 'Safety Observation', icon: Eye, tone: 'blue', labelKey: 'safetyObservation', titleHi: 'निरीक्षण', descEn: 'Unsafe condition / unsafe act', descHi: 'UC / UA' },
  { id: 'feedback', reportType: 'Feedback', icon: MessageSquare, tone: 'teal', labelKey: 'feedback', descEn: 'Share your experience', descHi: 'अनुभव बताएं' },
  { id: 'concern', opensConcernChooser: true, icon: Shield, tone: 'purple', titleEn: 'Grievance / Speak Up', titleHi: 'शिकायत / खुलकर बोलें', descEn: 'Anonymous option for Speak Up only', descHi: 'गुमनाम केवल Speak Up में' },
  { id: 'suggestion', reportType: 'Suggestion', icon: Lightbulb, tone: 'green', labelKey: 'suggestion', descEn: 'Share a safer-work idea', descHi: 'आइडिया दें' }
];

const STATUS_CLASS: Record<ReportStatus, string> = {
  Open: 'status-open',
  'In Progress': 'status-progress',
  Closed: 'status-closed'
};

function maskEmpNo(value: string | null): string {
  if (!value) return 'Anonymous';
  return value.length > 5 ? `${value.slice(0, 3)}••${value.slice(-2)}` : 'Employee';
}

function formatDate(value: string, locale = 'en-IN'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function getUpcomingEventStatus(value: string): 'Today' | 'Tomorrow' | 'Upcoming' {
  const eventDate = new Date(value);
  const now = new Date();
  const calendarDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
    return Date.UTC(part('year'), part('month') - 1, part('day'));
  };
  const daysAway = Math.round((calendarDay(eventDate) - calendarDay(now)) / 86_400_000);
  if (daysAway <= 0) return 'Today';
  if (daysAway === 1) return 'Tomorrow';
  return 'Upcoming';
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
  const { language, setLanguage, T } = useI18n();
  // Site list and employee directory come from the server: the real employee master when
  // one is configured; otherwise lookups report unavailable.
  const { ready: directoryReady, sites, directory, directoryMode, employeeCount, degraded } = useSafexBootstrap();
  const locale = LANGUAGE_LOCALE[language];
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [page, setPage] = useState<PageKey>('home');
  const [siteId, setSiteId] = useState('');
  const [siteReady, setSiteReady] = useState(false);
  const [siteDialog, setSiteDialog] = useState(false);
  const [siteDraft, setSiteDraft] = useState('');
  const [siteReturnPage, setSiteReturnPage] = useState<PageKey>('home');
  const [lifeRuleOpen, setLifeRuleOpen] = useState(false);
  const [lifeRuleSite, setLifeRuleSite] = useState<Site | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [palette, setPalette] = useState<PaletteName>('safex');
  const [reportType, setReportType] = useState<ReportType | null>(null);
  const [reportPickerOpen, setReportPickerOpen] = useState(false);
  const [quickConcernChooserOpen, setQuickConcernChooserOpen] = useState(false);
  const [reportDetail, setReportDetail] = useState<SafetyReport | null>(null);
  const [reports, setReports] = useState<SafetyReport[]>(DEMO_REPORTS);
  const [showAllSitesOtp, setShowAllSitesOtp] = useState(false);
  const [otpStage, setOtpStage] = useState<'details' | 'code'>('details');
  const [otpMessage, setOtpMessage] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [safetyAlertsOpen, setSafetyAlertsOpen] = useState(false);
  const [safetyAlertFilter, setSafetyAlertFilter] = useState<'All' | SafetyAlertCategory>('All');
  const [expandedSafetyAlertId, setExpandedSafetyAlertId] = useState<string | null>(null);
  const [sosOpen, setSosOpen] = useState(false);
  const [profileSearchOpen, setProfileSearchOpen] = useState(false);
  const [officerAccessOpen, setOfficerAccessOpen] = useState(false);
  const [moreInfoKind, setMoreInfoKind] = useState<MoreInfoKind | null>(null);
  const [notificationPermission, setNotificationPermission] = useState('not requested');
  const [pushPrefs, setPushPrefs] = useState({ safety: true, notices: true, training: true, ownReports: true, allVendorSites: false, hideLockScreen: true });
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installMessage, setInstallMessage] = useState<UiMessage | null>(null);
  const [toast, setToast] = useState<UiMessage | null>(null);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | ReportStatus>('All');
  const [vaultCategoryId, setVaultCategoryId] = useState<VaultCategoryId | null>(null);
  const [feedDetail, setFeedDetail] = useState<HomeFeedItem | null>(null);
  const [reportSyncEnabled, setReportSyncEnabled] = useState(false);
  const [queuedReportCount, setQueuedReportCount] = useState(0);
  // Starts `true` so the server-rendered markup and the first client render agree; the
  // effect below corrects it immediately when the device is actually offline.
  const [isOnline, setIsOnline] = useState(true);
  const [hideSyncedBanner, setHideSyncedBanner] = useState(false);
  const [outboxSyncState, setOutboxSyncState] = useState<OutboxSyncResult['status'] | 'syncing' | 'storage-error'>('idle');
  const [outboxMessage, setOutboxMessage] = useState('');
  const outboxSyncLock = useRef(false);
  const outboxSyncAgain = useRef(false);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const safetyAlertsScrollRef = useRef<HTMLDivElement>(null);
  const safetyAlertsTouchStart = useRef<{ x: number; y: number } | null>(null);

  const nextUpcomingEvent = useMemo(() => getUpcomingEvents()[0] ?? null, []);
  const filteredSafetyAlerts = useMemo(() => DEMO_SAFETY_ALERTS
    .filter((alert) => safetyAlertFilter === 'All' || alert.category === safetyAlertFilter)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [safetyAlertFilter]);
  const currentSite = sites.find((site) => site.id === siteId) ?? null;
  const isSingleSite = sites.length === 1;
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
        setOutboxMessage('Saved reports have synced to the configured database.');
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
      if (result.syncedIds.length) setToast({ key: '{count} queued reports synced.', params: { count: result.syncedIds.length } });
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
      const savedPush = localStorage.getItem('safex-push-preferences');
      if (savedMode && ['system', 'light', 'dark'].includes(savedMode)) setThemeMode(savedMode);
      if (savedPalette && ['safex', 'ocean', 'forest', 'contrast'].includes(savedPalette)) setPalette(savedPalette);
      if (savedPush) {
        const parsed = JSON.parse(savedPush) as Partial<typeof pushPrefs>;
        setPushPrefs((current) => ({ ...current, ...parsed }));
      }
      if ('Notification' in window) setNotificationPermission(Notification.permission);

    } catch {
      // Storage can be unavailable (private mode, locked-down device); defaults stand.
    }

    const handleInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const handleAppInstalled = () => setInstallMessage({ key: '{app} has been installed on this device.', params: { app: DEMO_TENANT.companyName || 'Company app' } });
    window.addEventListener('beforeinstallprompt', handleInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
      navigator.serviceWorker.register('/sw.js').catch(() => setToast({ key: 'Service worker could not be registered.' }));
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Waits for /api/bootstrap so a genuinely single-site tenant auto-selects instead of
  // briefly showing the demo multi-site chooser.
  useEffect(() => {
    if (!directoryReady || siteReady) return;
    try {
      if (sites.length === 1) {
        setSiteId(sites[0].id);
        setSiteDraft(sites[0].id);
      } else {
        const savedSite = sessionStorage.getItem('safex-active-site');
        if (savedSite && sites.some((site) => site.id === savedSite)) {
          setSiteId(savedSite);
          setSiteDraft(savedSite);
        } else {
          setSiteDialog(true);
        }
      }
    } catch {
      if (sites.length > 1) setSiteDialog(true);
      else if (sites[0]) setSiteId(sites[0].id);
    }
    setSiteReady(true);
  }, [directoryReady, siteReady, sites]);

  useEffect(() => {
    if (degraded) setToast({ key: 'The employee master is unavailable. No sample employees are shown. Please try again later.' });
  }, [degraded]);

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
      // Ignore messages that did not come from this origin's own service worker.
      if (event.origin && event.origin !== window.location.origin) return;
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

  // Connection banner. Losing the network is announced immediately - even with an empty queue -
  // because the worker needs to know a report was stored rather than lost. Coming back online
  // needs no special handling here: the 'online' listener in the outbox effect above already
  // starts the sync, which drives the banner to "syncing" and then "synced".
  useEffect(() => {
    const updateConnection = () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (!online) {
        setOutboxSyncState('offline');
        setOutboxMessage('No internet connection. Reports remain saved on this device and will retry automatically.');
      }
    };
    updateConnection();
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  // A finished sync is a confirmation, not a permanent panel, so it clears itself.
  useEffect(() => {
    if (outboxSyncState !== 'synced' || queuedReportCount > 0) {
      setHideSyncedBanner(false);
      return;
    }
    const timer = window.setTimeout(() => setHideSyncedBanner(true), SYNC_BANNER_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [outboxSyncState, queuedReportCount]);

  // Exactly one banner can ever render, or none at all (see describeSyncStatus).
  const syncBanner = useMemo(() => {
    const banner = describeSyncStatus({
      isOnline,
      syncState: outboxSyncState,
      queuedCount: queuedReportCount,
      syncEnabled: reportSyncEnabled
    });
    if (!banner) return null;
    if (banner.tone === 'synced' && hideSyncedBanner) return null;
    // The outbox sets a precise, already-translated message for each retry status; prefer it
    // over the generic fallback so the banner can never contradict the sync engine.
    const waiting = banner.tone === 'queued' || banner.tone === 'attention' || banner.tone === 'error';
    return waiting && outboxMessage ? { ...banner, detailKey: outboxMessage } : banner;
  }, [isOnline, outboxSyncState, queuedReportCount, reportSyncEnabled, hideSyncedBanner, outboxMessage]);

  useEffect(() => {
    document.documentElement.dataset.mode = themeMode;
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem('safex-theme-mode', themeMode);
      localStorage.setItem('safex-palette', palette);
    } catch { /* Preferences remain available for the current session if storage is blocked. */ }
  }, [themeMode, palette]);

  useEffect(() => {
    if (!languageMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setLanguageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [languageMenuOpen]);

  useEffect(() => {
    if (!safetyAlertsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSafetyAlertsOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [safetyAlertsOpen]);

  useEffect(() => {
    try { localStorage.setItem('safex-push-preferences', JSON.stringify(pushPrefs)); } catch { /* session-only preference */ }
  }, [pushPrefs]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function openSitePicker(returnTo: PageKey = page) {
    setSiteReturnPage(returnTo);
    setSiteDraft(siteId || sites[0]?.id || '');
    setSiteDialog(true);
  }

  function chooseSite(id: string) {
    const valid = sites.find((site) => site.id === id);
    if (!valid) return;
    setSiteId(valid.id);
    setSiteDraft(valid.id);
    try { sessionStorage.setItem('safex-active-site', valid.id); } catch { /* no-op */ }
    setSiteDialog(false);
    setPage(siteReturnPage);
    setToast({ key: 'Selected site {site}. Site content is now filtered for this visit.', params: { site: valid.name } });
  }

  function completeDemoAdminLogin() {
    setOfficerAccessOpen(false);
    setPage('adminDashboard');
  }

  function openLifeRuleForSite(site: Site) {
    setLifeRuleSite(site);
    setLifeRuleOpen(true);
  }



  function openReport(type: ReportType) {
    if (!currentSite) {
      openSitePicker('home');
      return;
    }
    setReportType(type);
  }

  function openSafetyAlerts() {
    setSafetyAlertFilter('All');
    setExpandedSafetyAlertId(null);
    setSafetyAlertsOpen(true);
  }

  function closeSafetyAlerts() {
    setSafetyAlertsOpen(false);
    setExpandedSafetyAlertId(null);
  }

  function handleSafetyAlertsBack() {
    if (expandedSafetyAlertId) setExpandedSafetyAlertId(null);
    else closeSafetyAlerts();
  }

  function handleSafetyAlertsTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    const touch = event.touches[0];
    if (touch) safetyAlertsTouchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleSafetyAlertsTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = safetyAlertsTouchStart.current;
    const touch = event.changedTouches[0];
    safetyAlertsTouchStart.current = null;
    if (!start || !touch) return;
    const deltaY = touch.clientY - start.y;
    const deltaX = touch.clientX - start.x;
    const scrollIsAtTop = (safetyAlertsScrollRef.current?.scrollTop ?? 0) <= 0;
    if (deltaY > 110 && Math.abs(deltaX) < 85 && scrollIsAtTop) closeSafetyAlerts();
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
    setToast({ key: '{report} saved on this device. Auto-sync will run when a connection is available.', report: { type: data.type, category: data.category } });
    void registerReportBackgroundSync();
    void syncOfflineReports();
  }

  async function requestPushPermission() {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      setToast({ key: 'This browser does not support web notifications.' });
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      if (result === 'granted') setToast({ key: 'Device permission granted. Server push delivery still needs VAPID/backend setup.' });
      else setToast({ key: 'Notifications remain off until device permission is granted.' });
    } catch {
      setToast({ key: 'Notification permission could not be requested in this browser.' });
    }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      setInstallMessage({ key: result.outcome === 'accepted' ? 'Install accepted. Follow your device prompt to finish.' : 'Install was dismissed; you can try again later.' });
      setInstallPrompt(null);
      return;
    }
    setInstallMessage({ key: 'No one-tap install prompt is available here. Use the browser menu → Install app / Add to Home Screen. On iPhone, use Share → Add to Home Screen.' });
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
  const nextEventDate = nextUpcomingEvent ? new Date(nextUpcomingEvent.date) : null;
  const nextEventDay = nextEventDate ? new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, day: '2-digit' }).format(nextEventDate) : '';
  const nextEventMonth = nextEventDate ? new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, month: 'short' }).format(nextEventDate).replace('.', '').toLocaleUpperCase(locale) : '';
  const nextEventStatus = nextUpcomingEvent ? getUpcomingEventStatus(nextUpcomingEvent.date) : null;

  const siteSelectionDialog = siteReady && siteDialog ? (
    <div className="overlay site-overlay" role="dialog" aria-modal="true" aria-labelledby="site-title"><div className="modal site-modal"><div className="modal-brand"><span className="brand-mark">{DEMO_TENANT.companyName.trim().charAt(0) || 'S'}</span><span><b>{DEMO_TENANT.companyName}</b><small>{T('Powered by')} Safex Safety</small></span><button className="close-button site-modal-close" type="button" onClick={() => setSiteDialog(false)} aria-label={T('Close site selection')}><X /></button></div><LanguageStrip language={language} onChange={setLanguage} className="site-language-strip" /><span className="eyebrow">{T('SITE SELECTION')}</span><h2 id="site-title">{T('sitePrompt')}</h2><p>{T('Select the site where you are working now. Home, reports and SOS will follow this site for this visit.')}</p><label className="field-label" htmlFor="site-select">{T('selectSite')}</label><select id="site-select" className="form-control" value={siteDraft} onChange={(e) => setSiteDraft(e.target.value)}>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.region}</option>)}</select><button className="primary-button full-button" onClick={() => chooseSite(siteDraft)}>{T('continue')} <ChevronRight size={17} /></button><div className="modal-footnote"><LockKeyhole size={14} /> {T('Site selection filters the page; it does not verify employee identity.')}{employeeCount > 0 ? ` · ${T('{count} employees in this directory', { count: new Intl.NumberFormat(locale).format(employeeCount) })}` : ''}</div></div></div>
  ) : null;

  // The Admin / HSE Manager dashboard is the uploaded SafetyOS console itself. It is
  // rendered on its own so the worker app's layout and globals cannot restyle it — the
  // design brings its own scoped stylesheet, topbar, sidebar and mobile behaviour.
  if (page === 'adminDashboard') {
    return (
      <>
        <SafetyOsApp
          sites={sites}
          selectedSiteId={siteId}
          onChangeSite={() => openSitePicker('adminDashboard')}
          canChangeSite={!isSingleSite}
          onExit={() => setPage('home')}
          officerName="Safety Officer"
          directoryMode={directoryMode}
        />
        {siteSelectionDialog}
      </>
    );
  }

  return (
    <div className="safex-app">
      <div className="demo-ribbon"><span className="demo-dot" /> {T(reportSyncEnabled ? 'Sample feeds only · employee master uses real data · new reports sync when online' : 'Sample feeds only · employee master uses real data · report sync is not configured')}</div>
      <div className="site-header-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <div className="topbar-brand-row">
              <button className="brand-button" onClick={() => setPage('home')} aria-label={T('Safex Home')}>
                <span className="topbar-company-logo" aria-hidden="true">{DEMO_TENANT.companyName.trim().charAt(0) || 'S'}</span>
                <span className="topbar-company-name">{DEMO_TENANT.companyName}</span>
              </button>
            </div>

            <hr className="topbar-divider" />

            <div className="header-toolbar">
              {isSingleSite ? (
                <div className="header-site-switch header-site-switch-static">
                  <MapPin size={16} aria-hidden="true" />
                  <span className="header-site-name">{currentSite?.name ?? T('Site')}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="header-site-switch"
                  onClick={() => openSitePicker(page)}
                  aria-label={currentSite ? T('Selected site {site}. Change site', { site: currentSite.name }) : T('Choose site')}
                >
                  <MapPin size={16} aria-hidden="true" />
                  <span className="header-site-name">{currentSite?.name ?? T('Choose site')}</span>
                  {currentSite && <span className="header-change-site">{T('changeSite')}</span>}
                  <ChevronDown size={14} className="header-site-chevron" aria-hidden="true" />
                </button>
              )}

              <div className="header-actions">
                <div className={`header-language ${languageMenuOpen ? 'open' : ''}`} ref={languageMenuRef}>
                  <button
                    id="safex-language-button"
                    type="button"
                    className="header-ui-button header-language-toggle"
                    aria-label={T('Choose language. Current selection: {language}', { language: LANGUAGES.find((item) => item.id === language)?.native ?? 'English' })}
                    title={T('Choose language')}
                    aria-haspopup="listbox"
                    aria-expanded={languageMenuOpen}
                    aria-controls="safex-language-menu"
                    onClick={() => setLanguageMenuOpen((open) => !open)}
                  >
                    <Globe2 size={20} aria-hidden="true" />
                    <span className="header-language-label-compact">{T('Lang')}</span>
                    <span className="header-language-label-wide">{T('Choose language')}</span>
                    <ChevronDown size={14} className="header-language-chevron" aria-hidden="true" />
                  </button>
                  {languageMenuOpen && <ul id="safex-language-menu" className="header-language-menu" role="listbox" aria-label={T('Choose language')}>
                    {LANGUAGES.map((item) => <li key={item.id}>
                      <button
                        type="button"
                        role="option"
                        className="header-language-option"
                        aria-selected={language === item.id}
                        onClick={() => { setLanguage(item.id); setLanguageMenuOpen(false); }}
                      >{item.native}</button>
                    </li>)}
                  </ul>}
                </div>
                {DEMO_TENANT.features.pushNotifications && <button className="header-ui-button header-notification-button" onClick={() => setNotificationsOpen(true)} aria-label={T('Notification settings, 3 sample updates')}>
                  <Bell size={19} aria-hidden="true" /><span className="header-notification-count">3</span>
                </button>}
                <button className="header-ui-button header-sos-button" onClick={() => currentSite ? setSosOpen(true) : setSiteDialog(true)} aria-label={T('SOS emergency contact')}>SOS</button>
                <button className="header-ui-button header-account-button" onClick={() => setOfficerAccessOpen(true)} aria-label={T('Login / account')}><UserRound size={19} aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        </header>
      </div>
      {syncBanner && <aside className={`sync-status-banner ${syncBanner.tone}`} role="status" aria-live="polite">
        <span className="sync-status-icon">{syncBanner.icon === 'offline' ? <CloudOff size={19} /> : syncBanner.icon === 'syncing' ? <RefreshCw size={19} className="sync-status-spin" /> : syncBanner.icon === 'synced' ? <Check size={19} /> : syncBanner.icon === 'attention' ? <AlertTriangle size={19} /> : <CloudUpload size={19} />}</span>
        <span className="sync-status-copy"><b>{T(syncBanner.titleKey, syncBanner.params)}</b><small>{T(syncBanner.detailKey)}</small></span>
        {syncBanner.action === 'sync-now' && <button type="button" className="sync-status-action" onClick={() => void syncOfflineReports(true)} disabled={!reportSyncEnabled}>{T('Sync now')}</button>}
      </aside>}

      <main className="main-content">
        {page === 'home' && <>
          <section className="hero-strip">
            <div className="hero-copy"><span className="eyebrow">{T('SAFETY HOME')}</span><h1>{T('Safety Portal')}</h1><p>{T('Report hazards, find safety updates and learn from reports at your selected site.')}</p></div>
            <button className="life-saving-card" type="button" onClick={() => currentSite && openLifeRuleForSite(currentSite)} disabled={!currentSite} aria-haspopup="dialog">
              <span className="life-saving-icon"><ShieldAlert size={22} /></span>
              <span className="life-saving-copy"><b>{T('LIFE SAVING RULE')}</b><small>West Bokaro (WBD) · 10 rules</small></span>
              <ChevronRight size={20} />
            </button>
          </section>
          <section className="section-block">
            <div className="section-heading"><div><span className="eyebrow">{T('TAKE ACTION')}</span><h2>{T('Report a safety concern')}</h2></div><span className="section-note">{T('No login needed to submit')}</span></div>
            <div className="report-grid">
              {HOME_REPORT_TILES.map((item) => {
                const Icon = item.icon;
                const title = item.labelKey ? T(item.labelKey) : T(item.titleEn ?? '');
                const description = T(item.descEn);
                return <button
                  key={item.id}
                  type="button"
                  className="report-tile"
                  aria-label={title}
                  onClick={() => item.opensConcernChooser ? setQuickConcernChooserOpen(true) : item.reportType ? openReport(item.reportType) : undefined}
                >
                  <span className={`tile-icon ${item.tone}`}><Icon size={26} strokeWidth={2.1} aria-hidden="true" /></span>
                  <span className="tile-copy"><b>{title}</b><small>{description}</small></span>
                </button>;
              })}
            </div>
          </section>
          <section className="section-block quick-section">
            <div className="section-heading"><div><span className="eyebrow">{T('QUICK ACCESS')}</span><h2>{T('Explore & Learn')}</h2></div></div>
            <div className="home-feature-list">
              <button className="home-feature-row reports-feature" onClick={() => setPage('reports')}>
                <span className="home-feature-icon"><FileText size={22} /></span>
                <span className="home-feature-copy"><b>{T('viewReports')}</b><small>{T('Track Open / Closed status')}</small></span>
                <ChevronRight size={20} />
              </button>
              {DEMO_TENANT.features.trainingManagement && <button className="home-feature-row" onClick={() => setPage('training')}>
                <span className="home-feature-icon"><Smartphone size={22} /></span>
                <span className="home-feature-copy"><b>{T('Training Management')}</b><small>{T('Modules, videos and progress')}</small></span>
                <ChevronRight size={20} />
              </button>}
              <button className="home-feature-row safety-alerts-feature" type="button" onClick={openSafetyAlerts} aria-haspopup="dialog">
                <span className="home-feature-icon safety-alerts-icon"><Bell size={22} /></span>
                <span className="home-feature-copy"><b>{T('Safety Alerts')}</b><small>{T('Incident alerts, controls & lessons learned')}</small></span>
                <span className="safety-alerts-demo-badge">{T('DEMO')}</span>
                <ChevronRight size={20} />
              </button>
              {(DEMO_TENANT.features.library || DEMO_TENANT.features.circulars) && <button className="home-feature-row" onClick={() => setPage('updates')}>
                <span className="home-feature-icon"><FileText size={22} /></span>
                <span className="home-feature-copy"><b>{T(DEMO_TENANT.features.library && !DEMO_TENANT.features.circulars ? 'Safety Library' : 'Circulars & Notices')}</b><small>{T('Browse all circulars and notices')}</small></span>
                <span className="home-feature-link">{T('See all ›')}</span>
              </button>}
              <section className="upcoming-events-module" aria-labelledby="upcoming-events-heading">
                <div className="upcoming-events-header">
                  <div className="upcoming-events-title"><span className="upcoming-events-icon"><CalendarDays size={22} aria-hidden="true" /></span><h3 id="upcoming-events-heading">{T('Upcoming Events')}</h3></div>
                  <button type="button" className="upcoming-events-view-all" onClick={() => setPage('events')} >{T('View All')} <ChevronRight size={17} aria-hidden="true" /></button>
                </div>
                {nextUpcomingEvent ? <button type="button" className="upcoming-event-summary" onClick={() => setFeedDetail(nextUpcomingEvent)} aria-label={T('Open event details: {title}, {date} {month}, {time}, {location}', { title: nextUpcomingEvent.title, date: nextEventDay, month: nextEventMonth, time: formatHomeFeedTime(nextUpcomingEvent.date, locale), location: nextUpcomingEvent.location ?? currentSite?.name ?? T('location to be announced') })}>
                  <span className="upcoming-event-date-badge"><b>{nextEventDay}</b><small>{nextEventMonth}</small></span>
                  <span className="upcoming-event-copy">
                    <span className="upcoming-event-title-row"><b>{nextUpcomingEvent.title}</b><span className={`upcoming-event-status ${nextEventStatus?.toLowerCase()}`}>{nextEventStatus ? T(nextEventStatus) : null}</span></span>
                    <span className="upcoming-event-meta"><span><Clock3 size={14} aria-hidden="true" />{formatHomeFeedTime(nextUpcomingEvent.date, locale)}</span><span className="upcoming-event-separator">•</span><span><MapPin size={14} aria-hidden="true" />{nextUpcomingEvent.location ?? currentSite?.name ?? T('Location to be announced')}</span></span>
                  </span>
                  <ChevronRight size={20} className="upcoming-event-arrow" aria-hidden="true" />
                </button> : <div className="upcoming-event-empty">{T('No upcoming events are scheduled for this site.')}</div>}
              </section>
            </div>
          </section>
          {DEMO_TENANT.features.library && <section className="section-block document-vault-section">
            <div className="section-heading vault-section-heading"><div className="vault-section-title"><span className="vault-title-icon"><FolderOpen size={23} /></span><div className="vault-section-heading-copy"><h2>{T('Document Vault / Library')}</h2></div></div></div>
            <DocumentVaultGrid onSelect={setVaultCategoryId} />
            <p className="home-demo-caption">{T('Site document categories · demo index only; files and compliance records are not connected.')}</p>
          </section>}
          {DEMO_TENANT.features.rewardWall && <section className="section-block reward-wall-section">
            <div className="section-heading"><div><span className="eyebrow">{T('RECOGNITION')}</span><h2 className="rewards-gallery-title"><span aria-hidden="true">🏆</span> {T('Rewards & Recognition Gallery')}</h2></div></div>
            <RewardCarousel />
          </section>}
        </>}

        {page === 'reports' && <section className="page-panel">
          <div className="page-heading"><div><span className="eyebrow">{currentSite?.name ?? T('SITE')}</span><h1>{T('reportsTitle')}</h1><p>{T('My Site Reports follows the site selected when the app opened. No Employee No. lookup is needed.')}</p></div><button className="secondary-button" onClick={() => !isSingleSite && openSitePicker('reports')}>{T('changeSite')}</button></div>
          <div className="report-scope-grid"><button className="scope-card selected" onClick={() => setStatusFilter('All')}><span className="scope-icon"><ClipboardList /></span><b>{T('mySiteReports')}</b><small>{currentSite?.name ?? T('Choose a site')} · {T('Site-filtered')}</small></button><button className="scope-card" onClick={() => { setShowAllSitesOtp(true); setOtpMessage(''); setOtpStage('details'); }}><span className="scope-icon locked"><LockKeyhole /></span><b>{T('allSiteReports')}</b><small>{T('Employee ID + registered mobile + OTP')}</small></button></div>
          <div className="stat-row"><div className="stat-card"><b>{activeSiteReports.length}</b><span>{T('Total')}</span></div><div className="stat-card"><b>{statusCounts.Open}</b><span>{T('Open')}</span></div><div className="stat-card"><b>{statusCounts['In Progress']}</b><span>{T('In progress')}</span></div><div className="stat-card"><b>{statusCounts.Closed}</b><span>{T('Closed')}</span></div></div>
          <div className="list-toolbar"><div className="search-box"><Search size={17} /><input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder={T('Search report ID, type or area')} /></div><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'All' | ReportStatus)} aria-label={T('Filter by status')}><option value="All">{T('All statuses')}</option><option value="Open">{T('Open')}</option><option value="In Progress">{T('In Progress')}</option><option value="Closed">{T('Closed')}</option></select></div>
          <div className="report-list">{filteredReports.map((item) => <ReportCard key={item.id} report={item} site={sites.find((s) => s.id === item.siteId)} onOpen={() => setReportDetail(item)} />)}{filteredReports.length === 0 && <div className="empty-state"><ClipboardList size={28} /><b>{T('No reports found')}</b><span>{T('Try another filter or report a safety concern.')}</span></div>}</div>
          <div className="privacy-note"><LockKeyhole size={15} /> {T('Demo summaries mask reporter IDs. Production access and attachments must be enforced server-side.')}</div>
        </section>}

        {page === 'alerts' && <FeedArchivePage kind="notices" siteName={currentSite?.name ?? T('Selected site')} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'events' && <FeedArchivePage kind="events" siteName={currentSite?.name ?? T('Selected site')} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'circulars' && <FeedArchivePage kind="circulars" siteName={currentSite?.name ?? T('Selected site')} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}
        {page === 'updates' && <FeedArchivePage kind="updates" siteName={currentSite?.name ?? T('Selected site')} onOpenItem={setFeedDetail} onBack={() => setPage('home')} />}

        {page === 'training' && <TrainingPortal site={currentSite} directory={directory} />}

        {page === 'library' && <section className="page-panel document-vault-page">
          <div className="page-heading"><div><span className="eyebrow">{T('DOCUMENTS')} · {currentSite?.name ?? T('SELECTED SITE')}</span><h1>{T('Document Vault / Library')}</h1><p>{T('Browse site safety procedures, risk assessments, compliance indexes, policies and meeting minutes.')}</p></div><FolderOpen size={28} /></div>
          <DocumentVaultGrid onSelect={setVaultCategoryId} />
          <div className="privacy-note"><LockKeyhole size={15} /> {T('Demo index only · actual site documents and statutory records are not connected.')}</div>
        </section>}

        {page === 'more' && <MoreMenuPage
          title={T('more')}
          companyName={DEMO_TENANT.companyName}
          onInstall={() => setPage('install')}
          onCompanyAbout={() => setPage('company')}
          onSearchEmployee={() => setProfileSearchOpen(true)}
          onAccount={() => setPage('account')}
          onAppearance={() => setPage('appearance')}
          onAboutApp={() => setPage('aboutApp')}
        />}

        {page === 'appearance' && <section className="page-panel narrow-panel"><div className="page-heading"><div><span className="eyebrow">{T('MORE · SETTINGS')}</span><h1>{T('appearance')}</h1><p>{T('Choose how the whole app looks on this device.')}</p></div><Palette size={28} /></div>
          <div className="settings-card"><h2>{T('Appearance mode')}</h2><div className="choice-row">{(['light', 'dark', 'system'] as ThemeMode[]).map((mode) => <button key={mode} className={`choice-chip ${themeMode === mode ? 'active' : ''}`} onClick={() => setThemeMode(mode)}>{mode === 'system' ? <Monitor size={16} /> : mode === 'light' ? <Sun size={16} /> : <Moon size={16} />}<span>{T(mode === 'system' ? 'System Default' : mode === 'light' ? 'Light Mode' : 'Dark Mode')}</span></button>)}</div></div>
          <div className="settings-card"><h2>{T('Colour theme')}</h2><p>{T('Colours apply to the header, home, report forms, cards and navigation.')}</p><div className="palette-grid">{([
            ['safex', 'Safex', '#0f2540', '#f5a623'], ['ocean', 'Ocean', '#123b5d', '#31b7c7'], ['forest', 'Forest', '#164b3a', '#70b77e'], ['contrast', 'High contrast', '#101820', '#ffd400']
          ] as [PaletteName, string, string, string][]).map(([id, name, primary, accent]) => <button key={id} className={`palette-choice ${palette === id ? 'selected' : ''}`} onClick={() => setPalette(id)}><span className="swatch-pair"><i style={{ background: primary }} /><i style={{ background: accent }} /></span><b>{T(name)}</b>{palette === id && <Check size={15} />}</button>)}</div></div>
          <div className="preview-card"><div className="preview-header"><span className="preview-logo">S</span><b>Safex · {currentSite?.name ?? T('Site')}</b><span className="preview-sos">SOS</span></div><div className="preview-body"><span>{T('Home')}</span><span>{T('Report')}</span><span>{T('Safety Alerts')}</span></div></div>
          <div className="privacy-note"><Check size={15} /> {T('Preferences save on this device. SOS and report-status colours keep their safety meaning.')}</div>
        </section>}

        {page === 'install' && <InstallAppPage company={DEMO_TENANT} canInstall={Boolean(installPrompt)} installMessage={installMessage} onInstall={installApp} onBack={() => setPage('more')} />}

        {page === 'company' && <CompanyAboutPage company={DEMO_TENANT} onBack={() => setPage('more')} />}
        {page === 'account' && <AccountManagementPage onBack={() => setPage('more')} onLogin={() => setOfficerAccessOpen(true)} onOpenInfo={setMoreInfoKind} />}
        {page === 'aboutApp' && <AboutAppPage company={DEMO_TENANT} onBack={() => setPage('more')} onOpenInfo={setMoreInfoKind} />}
      </main>

      {<nav className="bottom-nav" aria-label={T('Main navigation')}>
        <NavItem active={page === 'home'} icon={<Home />} label={T('home')} onClick={() => setPage('home')} />
        <NavItem active={safetyAlertsOpen} icon={<Bell />} label={T('Safety Alerts')} onClick={openSafetyAlerts} />
        <button className="nav-report" onClick={() => setReportPickerOpen(true)} aria-label={T('report')} aria-haspopup="dialog"><PlusIcon /><span>{T('report')}</span></button>
        {DEMO_TENANT.features.trainingManagement && <NavItem active={page === 'training'} icon={<BookOpen />} label={T('training')} onClick={() => setPage('training')} />}
        <NavItem active={page === 'more' || page === 'appearance' || page === 'install' || page === 'library' || page === 'company' || page === 'account' || page === 'aboutApp'} icon={<MoreHorizontal />} label={T('more')} onClick={() => setPage('more')} />
      </nav>}

      {siteSelectionDialog}

      {lifeRuleOpen && lifeRuleSite && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="life-rule-title"><div className="modal life-rule-modal"><div className="modal-header"><div><span className="eyebrow">{lifeRuleSite.name} · {T('LOCATION')}</span><h2 id="life-rule-title">{T('LIFE SAVING RULE')}</h2></div><button className="close-button" type="button" onClick={() => setLifeRuleOpen(false)} aria-label={T('Close Life Saving Rule')}><X /></button></div><div className="life-rule-site-banner"><span className="life-saving-icon"><ShieldAlert size={21} /></span><span><small>{T('SELECTED LOCATION')}</small><b>{lifeRuleSite.name}</b></span></div><p className="life-rule-intro" lang="en">Rules designed to protect your life! Please respect and adhere to these rules.</p><ol className="life-rule-list" lang="en">{LIFE_SAVING_RULES.map((rule, index) => <li key={rule.title}><span className="life-rule-number">{index + 1}</span><div><h3>{rule.title}</h3><p>{rule.text}</p></div></li>)}</ol><div className="life-rule-actions"><button className="primary-button" type="button" onClick={() => setLifeRuleOpen(false)}>{T('Close')}</button></div></div></div>}

      {quickConcernChooserOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="quick-concern-title"><div className="modal quick-concern-modal">
        <div className="modal-header"><div><span className="eyebrow">{T('SAFETY REPORT')}</span><h2 id="quick-concern-title">{T('Grievance or Speak Up?')}</h2><p>{T('Choose a path. Anonymous reporting is available only for Speak Up.')}</p></div><button className="close-button" type="button" onClick={() => setQuickConcernChooserOpen(false)} aria-label={T('Close report choices')}><X /></button></div>
        <div className="quick-concern-options">
          <button type="button" className="quick-concern-option" onClick={() => { setQuickConcernChooserOpen(false); openReport('Grievance'); }}><span className="tile-icon purple"><MessageSquare size={20} /></span><span><b>{T('grievance')}</b><small>{T('Employee profile required · not anonymous')}</small></span><ChevronRight size={18} /></button>
          <button type="button" className="quick-concern-option" onClick={() => { setQuickConcernChooserOpen(false); openReport('Speak Up'); }}><span className="tile-icon purple"><Shield size={20} /></span><span><b>{T('speakUp')}</b><small>{T('Anonymous option available')}</small></span><ChevronRight size={18} /></button>
        </div>
        <div className="modal-footnote"><LockKeyhole size={14} /> {T('Anonymous Speak Up reports are not linked to employee identity.')}</div>
      </div></div>}

      {safetyAlertsOpen && <div className="safety-alerts-modal-shell" role="dialog" aria-modal="true" aria-labelledby="safety-alerts-modal-title" onTouchStart={handleSafetyAlertsTouchStart} onTouchEnd={handleSafetyAlertsTouchEnd}>
        <section className="safety-alerts-modal">
          <header className="safety-alerts-header">
            <button type="button" className="safety-alerts-back" onClick={handleSafetyAlertsBack} aria-label={T(expandedSafetyAlertId ? 'Back to all safety alerts' : 'Back')}><ArrowLeft size={20} /><span>{T('Back')}</span></button>
            <div className="safety-alerts-header-title"><h2 id="safety-alerts-modal-title">{T('Safety Alerts')}</h2><small>{currentSite?.name ?? T('Selected site')}</small></div>
            <button type="button" className="safety-alerts-close" onClick={closeSafetyAlerts} aria-label={T('Close safety alerts')}><X size={21} /></button>
          </header>
          <div className="safety-alerts-scroll" ref={safetyAlertsScrollRef}>
            <div className="safety-alerts-demo-note"><AlertTriangle size={17} aria-hidden="true" /><span><b>{T('DEMO ALERTS')}</b> · {T('Synthetic examples only; no live incident feed is connected.')}</span></div>
            <div className="safety-alert-filter-row" role="group" aria-label={T('Filter safety alerts')}>
              {SAFETY_ALERT_FILTERS.map((filter) => <button key={filter} type="button" className={`safety-alert-filter-chip ${safetyAlertFilter === filter ? 'active' : ''}`} aria-pressed={safetyAlertFilter === filter} onClick={() => { setSafetyAlertFilter(filter); setExpandedSafetyAlertId(null); }}>{T(filter)}</button>)}
            </div>
            <div className="safety-alerts-results-heading"><h3>{safetyAlertFilter === 'All' ? T('All safety alerts') : T(safetyAlertFilter)}</h3><span>{T('{count} sample alerts', { count: new Intl.NumberFormat(locale).format(filteredSafetyAlerts.length) })}</span></div>
            <div className="safety-alert-list">
              {filteredSafetyAlerts.map((alert) => {
                const expanded = expandedSafetyAlertId === alert.id;
                const categoryClass = alert.category.toLowerCase().replace(/\s+/g, '-');
                const detailsId = `safety-alert-details-${alert.id}`;
                return <article className={`safety-alert-card ${categoryClass} ${expanded ? 'expanded' : ''}`} key={alert.id}>
                  <button type="button" className="safety-alert-card-toggle" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpandedSafetyAlertId((current) => current === alert.id ? null : alert.id)}>
                    <span className={`safety-alert-category-icon ${categoryClass}`}><AlertTriangle size={19} aria-hidden="true" /></span>
                    <span className="safety-alert-card-copy">
                      <span className="safety-alert-card-meta"><span className={`safety-alert-category-pill ${categoryClass}`}>{T(alert.category)}</span><time dateTime={alert.date}>{formatHomeFeedDate(alert.date, locale)} · {formatHomeFeedTime(alert.date, locale)}</time></span>
                      <b>{alert.title}</b>
                      <span className="safety-alert-location"><MapPin size={14} aria-hidden="true" />{alert.site} · {alert.area}</span>
                    </span>
                    <ChevronDown size={19} className={`safety-alert-expand-icon ${expanded ? 'expanded' : ''}`} aria-hidden="true" />
                  </button>
                  <div id={detailsId} className={`safety-alert-details ${expanded ? 'expanded' : ''}`} aria-hidden={!expanded}>
                    <div className="safety-alert-details-inner">
                      <section><h4>{T('Incident description')}</h4><p>{alert.description}</p></section>
                      <section><h4>{T('Root cause')}</h4><p>{alert.rootCause}</p></section>
                      <section><h4>{T('Immediate response')}</h4><ul>{alert.immediateActions.map((action) => <li key={action}>{action}</li>)}</ul></section>
                      <section><h4>{T('Corrective actions')}</h4><ul>{alert.correctiveActions.map((action) => <li key={action}>{action}</li>)}</ul></section>
                      <section><h4>{T('Lessons learned')}</h4><ul>{alert.lessonsLearned.map((lesson) => <li key={lesson}>{lesson}</li>)}</ul></section>
                      <small className="safety-alert-demo-reference">{T('Sample reference')} · {alert.id}</small>
                    </div>
                  </div>
                </article>;
              })}
              {filteredSafetyAlerts.length === 0 && <div className="safety-alerts-empty">{T('No alerts match this filter.')}</div>}
            </div>
          </div>
        </section>
      </div>}

      {reportPickerOpen && <div className="overlay report-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="report-picker-title">
        <div className="modal report-picker-modal">
          <div className="report-picker-handle" aria-hidden="true"><span /></div>
          <div className="modal-header report-picker-header">
            <h2 id="report-picker-title">{T('What would you like to report?')}</h2>
            <button className="close-button report-picker-close" type="button" onClick={() => setReportPickerOpen(false)} aria-label={T('Close report types')}><X /></button>
          </div>
          <div className="report-picker-grid">
            {REPORT_KINDS.map(({ type, icon: Icon, tone, labelKey, prefix, suffix, desc }) => <button key={type} type="button" className="report-picker-option" aria-label={T(type)} onClick={() => { setReportPickerOpen(false); openReport(type); }}>
              <span className={`tile-icon ${tone}`}><Icon size={24} aria-hidden="true" /></span>
              <span className="report-picker-copy"><b>{prefix ? `${prefix} · ` : ''}{labelKey ? T(labelKey) : T(type)}{suffix ? ` ${suffix}` : ''}</b><small className="sr-only">{T(desc)}</small></span>
              {DEMO_TENANT.features.voiceReporting && <span className="report-picker-voice" aria-hidden="true"><Mic size={22} /></span>}
            </button>)}
          </div>
        </div>
      </div>}

      {reportType && currentSite && <ReportWorkflow key={`${reportType}-${currentSite.id}`} type={reportType} site={currentSite} directory={directory} language={language} onLanguageChange={setLanguage} voiceEnabled={DEMO_TENANT.features.voiceReporting} syncEnabled={reportSyncEnabled} onClose={() => setReportType(null)} onSubmit={submitReport} />}
      {profileSearchOpen && <ProfileSearchDialog site={currentSite} directory={directory} onClose={() => setProfileSearchOpen(false)} />}
      {officerAccessOpen && <OfficerAccessDialog onClose={() => setOfficerAccessOpen(false)} onDemoLogin={completeDemoAdminLogin} />}
      {moreInfoKind && <MoreInfoDialog kind={moreInfoKind} company={DEMO_TENANT} onClose={() => setMoreInfoKind(null)} onLogin={() => { setMoreInfoKind(null); setOfficerAccessOpen(true); }} />}

      {showAllSitesOtp && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="otp-title"><div className="modal otp-modal"><div className="modal-header"><div><span className="eyebrow">{T('CROSS-SITE ACCESS')}</span><h2 id="otp-title">{T('allSiteReports')}</h2></div><button className="close-button" onClick={() => setShowAllSitesOtp(false)} aria-label={T('Close')}><X /></button></div><LanguageStrip language={language} onChange={setLanguage} className="modal-language-strip" /><p>{T('Verify your Employee ID and the mobile number registered in the employee master. Only redacted reports from your vendor tenant may be shown after OTP verification.')}</p>{otpStage === 'details' ? <form onSubmit={requestOtp}><label className="field-label" htmlFor="otp-emp">{T('Employee ID')}</label><input id="otp-emp" className="form-control" placeholder={T('Your Employee ID')} autoComplete="off" required /><label className="field-label" htmlFor="otp-phone">{T('Registered mobile number')}</label><input id="otp-phone" className="form-control" type="tel" inputMode="tel" placeholder={T('+91…')} minLength={10} maxLength={18} required /><button className="primary-button full-button" type="submit">{T('Send OTP')}</button></form> : <><div className="otp-message-preview"><LockKeyhole size={17} /><span>{T('Six-digit verification step · no real code is sent in demo mode.')}</span></div><form onSubmit={verifyOtp}><label className="field-label" htmlFor="otp-code">{T('Six-digit OTP')}</label><input id="otp-code" className="form-control otp-code-input" value={otpCode} onChange={(event) => setOtpCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••" required /><button className="primary-button full-button" type="submit">{T('Verify OTP')}</button><button className="text-button otp-back-button" type="button" onClick={() => { setOtpStage('details'); setOtpMessage(''); }}>{T('Back to Employee ID and mobile')}</button></form></>}{otpMessage && <div className="inline-notice warning" role="status">{T(otpMessage)}</div>}<div className="modal-footnote"><LockKeyhole size={14} /> {T('All-site access stays locked until registered-phone OTP, tenant scope and redaction are enforced by the server.')}</div></div></div>}

      {notificationsOpen && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="notification-title"><div className="modal settings-modal"><div className="modal-header"><div><span className="eyebrow">{T('DEVICE SETTINGS')}</span><h2 id="notification-title">{T('Push notifications')}</h2></div><button className="close-button" onClick={() => setNotificationsOpen(false)} aria-label={T('Close')}><X /></button></div><p>{T('Choose which published updates reach this device. Avoid sending every draft or internal edit.')}</p><div className="notification-status"><Bell size={17} /><span>{T('Browser permission:')} <b>{T(notificationPermission)}</b></span></div><Preference label="Safety Alerts and urgent notices" detail="New published safety alerts" checked={pushPrefs.safety} onChange={() => setPref('safety')} /><Preference label="Circulars and published updates" detail="Notices, events and training" checked={pushPrefs.notices} onChange={() => setPref('notices')} /><Preference label="My report status" detail="Updates only for your reports" checked={pushPrefs.ownReports} onChange={() => setPref('ownReports')} /><Preference label="All vendor-site updates" detail="Opt in for this vendor only" checked={pushPrefs.allVendorSites} onChange={() => setPref('allVendorSites')} /><Preference label="Hide details on lock screen" detail="Recommended for privacy" checked={pushPrefs.hideLockScreen} onChange={() => setPref('hideLockScreen')} /><button className="primary-button full-button" onClick={requestPushPermission}>{T('Allow notifications on this device')}</button><div className="modal-footnote">{T('Production push still requires a service worker subscription and server-side VAPID sender.')}</div></div></div>}

      {sosOpen && currentSite && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="sos-title"><div className="modal sos-modal"><div className="modal-header"><div><span className="eyebrow">{T('CURRENT SITE · EMERGENCY CONTACT')}</span><h2 id="sos-title">SOS · {currentSite.name}</h2></div><button className="close-button" onClick={() => setSosOpen(false)} aria-label={T('Close SOS')}><X /></button></div><p>{T('Safex will use the emergency number configured for {site}.', { site: currentSite.name })}</p>{currentSite.sosNumber ? <a className="sos-call-link" href={`tel:${currentSite.sosNumber}`}>{T('Call site emergency contact · {phone}', { phone: currentSite.sosNumber })}</a> : <div className="inline-notice warning">{T('No SOS number is configured for this demo site. Add and verify the real site contact before launch.')}</div>}<div className="modal-footnote"><AlertTriangle size={14} /> {T('Confirm the displayed site before calling. Emergency numbers must come from site Admin configuration.')}</div></div></div>}

      {reportDetail && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="detail-title"><div className="modal detail-modal"><div className="modal-header"><div><span className="eyebrow">{sites.find((site) => site.id === reportDetail.siteId)?.name}</span><h2 id="detail-title">{reportDetail.id}</h2></div><button className="close-button" onClick={() => setReportDetail(null)} aria-label={T('Close')}><X /></button></div><div className="detail-meta"><span className="type-chip">{T(reportDetail.type)}</span>{reportDetail.category && <span className="type-chip">{T(reportDetail.category)}</span>}<span className={`status-pill ${STATUS_CLASS[reportDetail.status]}`}>{T(reportDetail.status)}</span></div><dl className="detail-grid"><div><dt>{T('Reported by')}</dt><dd>{T(reportDetail.anonymous ? 'Anonymous' : maskEmpNo(reportDetail.reporterEmpNo))}</dd></div><div><dt>{T('Site')}</dt><dd>{sites.find((site) => site.id === reportDetail.siteId)?.name}</dd></div><div><dt>{T('Area')}</dt><dd>{reportDetail.area}</dd></div><div><dt>{T('Department')}</dt><dd>{reportDetail.department ?? T('N/A')}</dd></div><div><dt>{T('Severity')}</dt><dd>{reportDetail.severity ? T(reportDetail.severity) : T('N/A')}</dd></div><div><dt>{T('Incident date & time')}</dt><dd>{formatDate(reportDetail.incidentAt ?? reportDetail.reportedAt, locale)}</dd></div><div><dt>{T('Submitted on')}</dt><dd>{formatDate(reportDetail.reportedAt, locale)}</dd></div></dl><p className="detail-description">{reportDetail.description ?? reportDetail.shortDescription}</p>{reportDetail.immediateAction && <div className="detail-description"><b>{T('Immediate action:')}</b> {reportDetail.immediateAction}</div>}{reportDetail.hasAttachment && <div className="attachment-preview"><ImagePlus /><span>{T('Photo evidence noted')}</span><small>{T('Demo placeholder · original image is not uploaded or stored')}</small></div>}<div className="modal-footnote">{T('Worker view is redacted. Full IDs and unredacted evidence require authorized staff access.')}</div></div></div>}
      {vaultCategoryId && <VaultCategoryDialog categoryId={vaultCategoryId} siteName={currentSite?.name ?? T('Selected site')} onClose={() => setVaultCategoryId(null)} />}
      {feedDetail && <HomeFeedDetailDialog item={feedDetail} siteName={currentSite?.name ?? T('Selected site')} onClose={() => setFeedDetail(null)} />}

      {toast && <div className="toast" role="status">{T(toast.key, { ...toast.params, ...(toast.report ? { report: toast.report.category ? `${T(toast.report.type)} · ${T(toast.report.category)}` : T(toast.report.type) } : {}) })}</div>}
    </div>
  );
}

function ReportCard({ report, site, onOpen }: { report: SafetyReport; site?: Site; onOpen: () => void }) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const reporter = T(report.anonymous ? 'Anonymous' : maskEmpNo(report.reporterEmpNo));
  const syncLabel = report.syncState === 'synced' ? T('Synced to database') : report.syncState === 'needs-attention' ? T('Needs sync review') : report.syncState ? T('Saved on device · waiting to sync') : '';
  return <button className="report-card" onClick={onOpen}><div className="report-card-top"><b>{report.id}</b><span className={`status-pill ${STATUS_CLASS[report.status]}`}>{T(report.status)}</span></div><div className="report-card-type">{T(report.type)}{report.category && <span> · {T(report.category)}</span>}</div>{report.syncState && <span className={`report-sync-pill ${report.syncState}`}>{syncLabel}</span>}<p>{report.shortDescription}</p><div className="report-card-meta"><span><MapPin size={13} />{site?.name} · {report.area}</span><span>{T('By {name}', { name: reporter })}</span><span>{formatDate(report.reportedAt, locale)}</span></div>{report.hasAttachment && <span className="attachment-tag"><ImagePlus size={13} /> {T('Photo noted in demo')}</span>}</button>;
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  const { T } = useI18n();
  return <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}>{icon}<span>{T(label)}</span></button>;
}

function Preference({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: () => void }) {
  const { T } = useI18n();
  return <div className="preference-row"><div><b>{T(label)}</b><small>{T(detail)}</small></div><button className={`switch ${checked ? 'on' : ''}`} aria-pressed={checked} onClick={onChange}><span /></button></div>;
}

function PlusIcon() { return <span className="plus-symbol">+</span>; }
