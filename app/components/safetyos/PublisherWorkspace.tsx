'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BellRing, CalendarDays, CheckCircle2, FileText, Megaphone, Trophy } from 'lucide-react';
import { ALERT_CATEGORIES } from '@/lib/alerts/catalog';
import {
  DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, VAULT_CATEGORIES, vaultCategoriesForPublishing,
  type DocumentType, type VaultCategoryKey
} from '@/lib/content/catalog';
import type { AdminAnnouncement, AdminDocument, AdminEvent } from '@/lib/content/types';
import type { AdminRecognitionItem } from '@/lib/recognitions';

/**
 * The publishing workspace that lives inside the console.
 *
 * The design ships its own Documents and Communications screens, but their buttons only
 * redrew a local preview: nothing they "published" ever reached the worker app. Those nodes
 * stay hidden and this component takes their place — the same screen the operator is already
 * on. No link, no new tab, no second sign-in: pick the location, pick what to publish, attach
 * the file, publish.
 *
 * Every write goes through the same admin API the standalone panel uses
 * (`/api/admin/content`, `/api/admin/content/upload`, `/api/admin/recognitions`), so there is
 * one write path and one session. Only rows with `status = 'published'` reach the phone.
 */

type PublishKind = 'document' | 'circular' | 'notice' | 'event' | 'alert' | 'reward';

/** One alert row as `/api/admin/alerts` returns it. */
type AdminAlertRow = {
  id: string;
  category: string;
  title: string;
  date: string;
  area: string;
  department: string;
  reference: string;
  description: string;
  rootCause: string;
  immediateActions: string[];
  correctiveActions: string[];
  lessonsLearned: string[];
  status: 'draft' | 'published' | 'archived';
  updatedAt: string | null;
};
type SiteRow = { id: string; slug: string; name: string };
type Listing = { documents: AdminDocument[]; announcements: AdminAnnouncement[]; events: AdminEvent[] };

const EMPTY_LISTING: Listing = { documents: [], announcements: [], events: [] };
const SHELVES = vaultCategoriesForPublishing();
const MAX_FILE = 10 * 1024 * 1024;
const MAX_PHOTO = 5 * 1024 * 1024;

const KIND_CARDS: Array<{ kind: PublishKind; label: string; hint: string; icon: typeof FileText }> = [
  { kind: 'document', label: 'Document', hint: 'SOP, SWP, risk assessment or policy — goes into the Document Vault', icon: FileText },
  { kind: 'circular', label: 'Circular', hint: 'An instruction that stays on record for the site', icon: Megaphone },
  { kind: 'notice', label: 'Notice', hint: 'A short notice everyone at the site should see', icon: BellRing },
  { kind: 'event', label: 'Event', hint: 'Training, drill or meeting with a date, time and venue', icon: CalendarDays },
  { kind: 'alert', label: 'Safety Alert', hint: 'Incident alert with root cause, response and lessons learned', icon: AlertTriangle },
  { kind: 'reward', label: 'Reward', hint: 'Recognition card with the awardee name, reason and photo', icon: Trophy }
];

type DocDraft = {
  id?: string;
  category: VaultCategoryKey;
  documentType: DocumentType;
  title: string;
  summary: string;
  documentCode: string;
  revision: string;
  department: string;
  section: string;
  validUpto: string;
  sortOrder: number;
  filePath: string | null;
  fileName: string | null;
  /** Editing a row that already has a file: keep it unless a new one is chosen. */
  keepFile: boolean;
};

type PostDraft = {
  id?: string;
  kind: 'circular' | 'notice';
  title: string;
  summary: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  publishedOn: string;
  expiresOn: string;
  filePath: string | null;
  fileName: string | null;
  keepFile: boolean;
};

type EventDraft = {
  id?: string;
  title: string;
  topic: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venue: string;
};

type AlertDraft = {
  id?: string;
  category: string;
  title: string;
  reference: string;
  incidentAt: string;
  area: string;
  department: string;
  description: string;
  rootCause: string;
  immediateResponse: string;
  correctiveActions: string;
  lessonsLearned: string;
};

type RewardDraft = {
  id?: string;
  employeeName: string;
  rewardFor: string;
  imageUrl: string | null;
  sortOrder: number;
  consentConfirmed: boolean;
};

function localDate(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function blankDoc(): DocDraft {
  return {
    category: 'sop-swp', documentType: 'sop', title: '', summary: '', documentCode: '',
    revision: '', department: '', section: '', validUpto: '', sortOrder: 0,
    filePath: null, fileName: null, keepFile: false
  };
}

function blankPost(kind: 'circular' | 'notice'): PostDraft {
  return {
    kind, title: '', summary: '', body: '', priority: 'normal', publishedOn: localDate(),
    expiresOn: '', filePath: null, fileName: null, keepFile: false
  };
}

function blankEvent(): EventDraft {
  return { title: '', topic: '', description: '', startsAt: '', endsAt: '', venue: '' };
}

function blankAlert(): AlertDraft {
  return {
    category: 'First Aid', title: '', reference: '', incidentAt: '', area: '', department: '',
    description: '', rootCause: '', immediateResponse: '', correctiveActions: '', lessonsLearned: ''
  };
}

function blankReward(): RewardDraft {
  return { employeeName: '', rewardFor: '', imageUrl: null, sortOrder: 0, consentConfirmed: false };
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

function dateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function readableDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function PublisherWorkspace({ section, selectedSiteId }: {
  section: 'documents' | 'communications';
  selectedSiteId: string;
}) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [slug, setSlug] = useState('');
  const [listing, setListing] = useState<Listing>(EMPTY_LISTING);
  const [rewards, setRewards] = useState<AdminRecognitionItem[]>([]);
  const [open, setOpen] = useState<PublishKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [docDraft, setDocDraft] = useState<DocDraft>(blankDoc);
  const [postDraft, setPostDraft] = useState<PostDraft>(() => blankPost('circular'));
  const [eventDraft, setEventDraft] = useState<EventDraft>(blankEvent);
  const [rewardDraft, setRewardDraft] = useState<RewardDraft>(blankReward);
  const [alerts, setAlerts] = useState<AdminAlertRow[]>([]);
  const [alertDraft, setAlertDraft] = useState<AlertDraft>(blankAlert);

  const filePicker = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);

  const siteName = sites.find((row) => row.slug === slug)?.name ?? '';

  const load = useCallback(async (siteSlug: string) => {
    if (!siteSlug) return;
    setLoading(true);
    try {
      const [contentResponse, rewardsResponse, alertsResponse] = await Promise.all([
        fetch(`/api/admin/content?site=${encodeURIComponent(siteSlug)}`, { cache: 'no-store' }),
        fetch('/api/admin/recognitions', { cache: 'no-store' }),
        fetch(`/api/admin/alerts?site=${encodeURIComponent(siteSlug)}`, { cache: 'no-store' })
      ]);
      const content = await contentResponse.json();
      if (contentResponse.status === 401) throw new Error('Session expired. Sign in to the console again.');
      if (!contentResponse.ok) throw new Error(content.error ?? 'Could not load what is published.');
      if (Array.isArray(content.sites) && content.sites.length) setSites(content.sites as SiteRow[]);
      setListing({
        documents: Array.isArray(content.documents) ? content.documents : [],
        announcements: Array.isArray(content.announcements) ? content.announcements : [],
        events: Array.isArray(content.events) ? content.events : []
      });
      if (rewardsResponse.ok) {
        const rewardData = await rewardsResponse.json();
        if (rewardData?.ok && Array.isArray(rewardData.items)) setRewards(rewardData.items as AdminRecognitionItem[]);
      }
      if (alertsResponse.ok) {
        const alertData = await alertsResponse.json();
        if (alertData?.ok && Array.isArray(alertData.alerts)) setAlerts(alertData.alerts as AdminAlertRow[]);
      }
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load what is published.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The console already knows which site the officer is working on; the list from the publishing
  // API carries the slug every write needs, so the two are matched by id.
  useEffect(() => {
    let active = true;
    fetch('/api/admin/content', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        const rows: SiteRow[] = Array.isArray(data?.sites) ? data.sites : [];
        setSites(rows);
        const preferred = rows.find((row) => row.id === selectedSiteId) ?? rows[0];
        if (preferred) setSlug(preferred.slug);
        else { setLoading(false); setError('No active site is configured, so nothing can be published.'); }
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError('Could not reach the publishing service. Reload the console and try again.');
      });
    return () => { active = false; };
  }, [selectedSiteId]);

  useEffect(() => { if (slug) void load(slug); }, [slug, load]);

  async function changeSite(next: string) {
    if (next === slug) return;
    setSlug(next);
    setListing(EMPTY_LISTING);
    setRewards([]);
    setAlerts([]);
    setOpen(null);
    setNotice('');
  }

  async function sendContent(method: 'POST' | 'PUT' | 'DELETE', payload: Record<string, unknown>): Promise<boolean> {
    if (!slug) { setError('Choose a location first.'); return false; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/content', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, site: slug })
      });
      const data = await response.json();
      if (response.status === 401) throw new Error('Session expired. Sign in to the console again.');
      if (!response.ok) throw new Error(data.error ?? 'The request failed.');
      await load(slug);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendAlert(method: 'POST' | 'PUT' | 'DELETE', payload: Record<string, unknown>): Promise<boolean> {
    if (!slug) { setError('Choose a location first.'); return false; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/alerts', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, site: slug })
      });
      const data = await response.json();
      if (response.status === 401) throw new Error('Session expired. Sign in to the console again.');
      if (!response.ok) throw new Error(data.error ?? 'The request failed.');
      await load(slug);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveAlert(intent: 'draft' | 'published') {
    if (!alertDraft.title.trim()) { setError('Enter the alert headline.'); return; }
    if (!alertDraft.incidentAt) { setError('Choose when the incident happened.'); return; }
    if (!alertDraft.description.trim()) { setError('Describe what happened.'); return; }
    const payload: Record<string, unknown> = {
      category: alertDraft.category,
      title: alertDraft.title,
      reference: alertDraft.reference,
      incidentAt: alertDraft.incidentAt,
      area: alertDraft.area,
      department: alertDraft.department,
      description: alertDraft.description,
      rootCause: alertDraft.rootCause,
      immediateResponse: alertDraft.immediateResponse,
      correctiveActions: alertDraft.correctiveActions,
      lessonsLearned: alertDraft.lessonsLearned,
      status: intent
    };
    if (alertDraft.id) payload.id = alertDraft.id;
    if (await sendAlert(alertDraft.id ? 'PUT' : 'POST', payload)) {
      setOpen(null);
      setAlertDraft(blankAlert());
      setNotice(intent === 'published' ? 'Safety alert published. It is live in the worker app now.' : 'Alert saved as draft.');
    }
  }

  async function uploadFile(file: File): Promise<{ path: string; fileName: string } | null> {
    if (file.size > MAX_FILE) { setError('Files must be 10 MB or smaller.'); return null; }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.set('site', slug);
      form.set('file', file);
      const response = await fetch('/api/admin/content/upload', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'Upload failed.');
      return { path: data.path as string, fileName: data.fileName as string };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function uploadPhoto(file: File): Promise<string | null> {
    if (file.size > MAX_PHOTO) { setError('Photos must be 5 MB or smaller.'); return null; }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/admin/recognitions/photo', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'Photo upload failed.');
      return data.url as string;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Photo upload failed.');
      return null;
    } finally {
      setUploading(false);
    }
  }

  function openForm(kind: PublishKind) {
    setNotice('');
    setError('');
    setDocDraft(blankDoc());
    setPostDraft(blankPost(kind === 'notice' ? 'notice' : 'circular'));
    setEventDraft(blankEvent());
    setRewardDraft(blankReward());
    setAlertDraft(blankAlert());
    setOpen(kind);
  }

  function closeForm() {
    setOpen(null);
    setError('');
  }

  async function saveDocument(intent: 'draft' | 'published') {
    if (!docDraft.title.trim()) { setError('Enter the document title.'); return; }
    if (intent === 'published' && !docDraft.filePath && !docDraft.keepFile) {
      setError('Attach the file before publishing. A draft can be saved without one.');
      return;
    }
    const payload: Record<string, unknown> = {
      kind: 'document',
      category: docDraft.category,
      documentType: docDraft.documentType,
      title: docDraft.title,
      summary: docDraft.summary,
      documentCode: docDraft.documentCode,
      revision: docDraft.revision,
      department: docDraft.department,
      section: docDraft.section,
      validUpto: docDraft.validUpto || null,
      sortOrder: docDraft.sortOrder,
      status: intent
    };
    if (docDraft.id) payload.id = docDraft.id;
    // Absent file keys mean "keep the stored file" — that is how an edit keeps its PDF.
    if (docDraft.filePath) {
      payload.filePath = docDraft.filePath;
      payload.fileName = docDraft.fileName;
    } else if (!docDraft.keepFile) {
      payload.filePath = null;
      payload.fileName = null;
    }
    if (await sendContent(docDraft.id ? 'PUT' : 'POST', payload)) {
      setOpen(null);
      setDocDraft(blankDoc());
      setNotice(intent === 'published' ? 'Document published. It is in the worker app now.' : 'Draft saved.');
    }
  }

  async function savePost(intent: 'draft' | 'published') {
    if (!postDraft.title.trim()) { setError(`Enter the ${postDraft.kind} title.`); return; }
    if (intent === 'published' && !postDraft.summary.trim() && !postDraft.body.trim()) {
      setError('Add a summary or the text before publishing.');
      return;
    }
    const payload: Record<string, unknown> = {
      kind: 'announcement',
      type: postDraft.kind,
      title: postDraft.title,
      summary: postDraft.summary,
      body: postDraft.body,
      priority: postDraft.priority,
      publishedOn: postDraft.publishedOn || null,
      expiresAt: postDraft.expiresOn ? `${postDraft.expiresOn}T23:59:59+05:30` : null,
      status: intent
    };
    if (postDraft.id) payload.id = postDraft.id;
    if (postDraft.filePath) {
      payload.filePath = postDraft.filePath;
    } else if (!postDraft.keepFile) {
      payload.filePath = null;
    }
    if (await sendContent(postDraft.id ? 'PUT' : 'POST', payload)) {
      setOpen(null);
      setPostDraft(blankPost(postDraft.kind));
      setNotice(intent === 'published' ? `${postDraft.kind === 'circular' ? 'Circular' : 'Notice'} published.` : 'Draft saved.');
    }
  }

  async function saveEvent(intent: 'draft' | 'published') {
    if (!eventDraft.title.trim()) { setError('Enter the event title.'); return; }
    const starts = eventDraft.startsAt ? new Date(eventDraft.startsAt) : null;
    if (!starts || Number.isNaN(starts.getTime())) { setError('Choose the date and time the event starts.'); return; }
    const ends = eventDraft.endsAt ? new Date(eventDraft.endsAt) : null;
    if (ends && (Number.isNaN(ends.getTime()) || ends < starts)) {
      setError('The event has to end after it starts.');
      return;
    }
    const payload: Record<string, unknown> = {
      kind: 'event',
      title: eventDraft.title,
      topic: eventDraft.topic,
      description: eventDraft.description,
      startsAt: starts.toISOString(),
      endsAt: ends ? ends.toISOString() : null,
      venue: eventDraft.venue,
      status: intent
    };
    if (eventDraft.id) payload.id = eventDraft.id;
    if (await sendContent(eventDraft.id ? 'PUT' : 'POST', payload)) {
      setOpen(null);
      setEventDraft(blankEvent());
      setNotice(intent === 'published' ? 'Event published.' : 'Event saved as draft.');
    }
  }

  async function saveReward(intent: 'draft' | 'published') {
    if (!rewardDraft.employeeName.trim()) { setError('Enter the employee name.'); return; }
    if (!rewardDraft.rewardFor.trim()) { setError('Enter what the reward is for.'); return; }
    if (intent === 'published' && !rewardDraft.consentConfirmed) {
      setError('Tick the consent box before publishing the name and photo.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/admin/recognitions', {
        method: rewardDraft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(rewardDraft.id ? { id: rewardDraft.id } : {}),
          employeeName: rewardDraft.employeeName,
          rewardFor: rewardDraft.rewardFor,
          imageUrl: rewardDraft.imageUrl,
          artworkIndex: 0,
          sortOrder: rewardDraft.sortOrder,
          consentConfirmed: rewardDraft.consentConfirmed,
          isPublished: intent === 'published'
        })
      });
      const data = await response.json();
      if (response.status === 401) throw new Error('Session expired. Sign in to the console again.');
      if (!response.ok) throw new Error(data.error ?? 'Could not save the reward.');
      await load(slug);
      setOpen(null);
      setRewardDraft(blankReward());
      setNotice(intent === 'published' ? 'Reward published on the home screen.' : 'Reward saved as draft.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the reward.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleDocument(row: AdminDocument) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await sendContent('PUT', {
      kind: 'document', id: row.id, category: row.category, title: row.title,
      summary: row.summary, documentCode: row.documentCode, documentType: row.documentType,
      revision: row.revision, department: row.department, section: row.section,
      validUpto: row.validUpto, status, sortOrder: row.sortOrder
    });
    if (ok) setNotice(status === 'published' ? 'Document published.' : 'Document moved back to draft.');
  }

  async function togglePost(row: AdminAnnouncement) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await sendContent('PUT', {
      kind: 'announcement', id: row.id, type: row.kind, title: row.title, summary: row.summary,
      body: row.body, priority: row.priority, publishedOn: row.publishedOn,
      expiresAt: row.expiresAt, status
    });
    if (ok) setNotice(status === 'published' ? 'Published.' : 'Moved back to draft.');
  }

  async function toggleEvent(row: AdminEvent) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await sendContent('PUT', {
      kind: 'event', id: row.id, title: row.title, topic: row.topic, description: row.description,
      startsAt: row.startsAt, endsAt: row.endsAt, venue: row.venue, status
    });
    if (ok) setNotice(status === 'published' ? 'Event published.' : 'Event moved back to draft.');
  }

  async function toggleAlert(row: AdminAlertRow) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await sendAlert('PUT', {
      id: row.id,
      category: row.category,
      title: row.title,
      reference: row.reference,
      incidentAt: row.date,
      area: row.area,
      department: row.department,
      description: row.description,
      rootCause: row.rootCause,
      immediateResponse: row.immediateActions,
      correctiveActions: row.correctiveActions,
      lessonsLearned: row.lessonsLearned,
      status
    });
    if (ok) setNotice(status === 'published' ? 'Safety alert published.' : 'Alert moved back to draft.');
  }

  function editAlert(row: AdminAlertRow) {
    setAlertDraft({
      id: row.id,
      category: row.category,
      title: row.title,
      reference: row.reference,
      incidentAt: dateTimeInput(row.date),
      area: row.area,
      department: row.department,
      description: row.description,
      rootCause: row.rootCause,
      immediateResponse: row.immediateActions.join('\n'),
      correctiveActions: row.correctiveActions.join('\n'),
      lessonsLearned: row.lessonsLearned.join('\n')
    });
    setOpen('alert');
    setNotice('');
  }

  async function toggleReward(row: AdminRecognitionItem) {
    const publish = !row.isPublished;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/recognitions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row, isPublished: publish })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not update the reward.');
      await load(slug);
      setNotice(publish ? 'Reward published.' : 'Reward moved back to draft.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not update the reward.');
    } finally {
      setBusy(false);
    }
  }

  async function removeRow(kind: 'document' | 'announcement' | 'event' | 'alert' | 'reward', id: string) {
    if (!window.confirm('Delete this permanently? Unpublishing keeps it on record instead.')) return;
    if (kind === 'alert') {
      if (await sendAlert('DELETE', { id })) setNotice('Safety alert deleted.');
      return;
    }
    if (kind === 'reward') {
      setBusy(true);
      try {
        const response = await fetch('/api/admin/recognitions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        if (!response.ok) throw new Error('Could not delete the reward.');
        await load(slug);
        setNotice('Reward deleted.');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not delete the reward.');
      } finally {
        setBusy(false);
      }
      return;
    }
    if (await sendContent('DELETE', { kind, id })) setNotice('Deleted.');
  }

  function editDocument(row: AdminDocument) {
    setDocDraft({
      id: row.id, category: row.category, documentType: row.documentType, title: row.title,
      summary: row.summary ?? '', documentCode: row.documentCode ?? '', revision: row.revision ?? '',
      department: row.department ?? '', section: row.section ?? '', validUpto: dateOnly(row.validUpto),
      sortOrder: row.sortOrder, filePath: null, fileName: row.fileName, keepFile: Boolean(row.fileUrl)
    });
    setOpen('document');
    setNotice('');
  }

  function editPost(row: AdminAnnouncement) {
    setPostDraft({
      id: row.id, kind: row.kind, title: row.title, summary: row.summary, body: row.body,
      priority: row.priority, publishedOn: dateOnly(row.publishedOn),
      expiresOn: dateOnly(row.expiresAt), filePath: null, fileName: row.attachmentName,
      keepFile: Boolean(row.attachmentUrl)
    });
    setOpen(row.kind);
    setNotice('');
  }

  function editEvent(row: AdminEvent) {
    setEventDraft({
      id: row.id, title: row.title, topic: row.topic ?? '', description: row.description,
      startsAt: dateTimeInput(row.startsAt), endsAt: dateTimeInput(row.endsAt), venue: row.venue ?? ''
    });
    setOpen('event');
    setNotice('');
  }

  function editReward(row: AdminRecognitionItem) {
    setRewardDraft({
      id: row.id, employeeName: row.employeeName, rewardFor: row.rewardFor,
      imageUrl: row.imageUrl, sortOrder: row.sortOrder, consentConfirmed: row.consentConfirmed
    });
    setOpen('reward');
    setNotice('');
  }

  const counts: Record<PublishKind, number> = {
    document: listing.documents.length,
    circular: listing.announcements.filter((row) => row.kind === 'circular').length,
    notice: listing.announcements.filter((row) => row.kind === 'notice').length,
    event: listing.events.length,
    alert: alerts.length,
    reward: rewards.length
  };

  type RecentRow = {
    key: string;
    label: string;
    title: string;
    meta: string;
    status: string;
    sort: string;
    edit: () => void;
    toggle: () => void;
    remove: () => void;
  };

  const recent: RecentRow[] = [
    ...listing.documents.map((row) => ({
      key: `doc-${row.id}`,
      label: 'Document',
      title: row.title,
      meta: [row.documentCode, VAULT_CATEGORIES[row.category]?.title, row.validUpto ? `Valid to ${readableDate(row.validUpto)}` : ''].filter(Boolean).join(' · '),
      status: row.status,
      sort: row.updatedAt ?? row.publishedAt ?? '',
      edit: () => editDocument(row),
      toggle: () => void toggleDocument(row),
      remove: () => void removeRow('document', row.id)
    })),
    ...listing.announcements.map((row) => ({
      key: `post-${row.id}`,
      label: row.kind === 'circular' ? 'Circular' : 'Notice',
      title: row.title,
      meta: readableDate(row.publishedOn),
      status: row.status,
      sort: row.updatedAt ?? row.publishedOn ?? '',
      edit: () => editPost(row),
      toggle: () => void togglePost(row),
      remove: () => void removeRow('announcement', row.id)
    })),
    ...listing.events.map((row) => ({
      key: `event-${row.id}`,
      label: 'Event',
      title: row.title,
      meta: [readableDate(row.startsAt), row.venue].filter(Boolean).join(' · '),
      status: row.status,
      sort: row.updatedAt ?? row.publishedAt ?? '',
      edit: () => editEvent(row),
      toggle: () => void toggleEvent(row),
      remove: () => void removeRow('event', row.id)
    })),
    ...alerts.map((row) => ({
      key: `alert-${row.id}`,
      label: 'Safety Alert',
      title: row.title,
      meta: [row.category, readableDate(row.date), row.area].filter(Boolean).join(' · '),
      status: row.status,
      sort: row.updatedAt ?? row.date,
      edit: () => editAlert(row),
      toggle: () => void toggleAlert(row),
      remove: () => void removeRow('alert', row.id)
    })),
    ...rewards.map((row) => ({
      key: `reward-${row.id}`,
      label: 'Reward',
      title: row.employeeName,
      meta: row.rewardFor,
      status: row.isPublished ? 'published' : 'draft',
      sort: '',
      edit: () => editReward(row),
      toggle: () => void toggleReward(row),
      remove: () => void removeRow('reward', row.id)
    }))
  ].sort((left, right) => right.sort.localeCompare(left.sort)).slice(0, 12);

  const attachmentLabel = (name: string | null, keep: boolean): string =>
    name ?? (keep ? 'Current file kept' : 'PDF, PNG, JPG or WEBP · up to 10 MB');

  return <div className="pub">
    <header className="pub-head">
      <div className="pub-head-copy">
        <span className="pub-eyebrow">{section === 'documents' ? 'DOCUMENT VAULT' : 'COMMUNICATIONS'} · PUBLISHING</span>
        <h1>Publish to the worker app</h1>
        <p>Choose the location, pick what to publish and attach the file. Everything happens on this screen — nothing opens elsewhere.</p>
      </div>
      <label className="pub-site">
        <span>Location</span>
        <select value={slug} onChange={(event) => void changeSite(event.target.value)} disabled={!sites.length || busy}>
          {!sites.length && <option value="">{loading ? 'Loading locations…' : 'No active site'}</option>}
          {sites.map((row) => <option key={row.id} value={row.slug}>{row.name}</option>)}
        </select>
      </label>
    </header>

    {error && <p className="pub-alert is-error" role="alert">{error}</p>}
    {notice && <p className="pub-alert is-ok" role="status"><CheckCircle2 size={15} aria-hidden="true" /> {notice}</p>}

    {open === null && <>
      <div className="pub-cards">
        {KIND_CARDS.map(({ kind, label, hint, icon: Icon }) => <button
          key={kind}
          type="button"
          className="pub-card"
          onClick={() => openForm(kind)}
          disabled={!slug}
        >
          <span className="pub-card-icon" aria-hidden="true"><Icon size={20} /></span>
          <b>{label}</b>
          <span>{hint}</span>
          <em>{counts[kind]} saved</em>
        </button>)}
      </div>

      <section className="pub-recent" aria-label="Published entries">
        <div className="pub-recent-head">
          <h2>Manage what is published</h2>
          {loading && <span className="pub-loading">Loading…</span>}
        </div>
        {recent.length === 0 && !loading && <p className="pub-empty">Nothing saved for {siteName || 'this location'} yet. Pick a card above to publish the first entry.</p>}
        {recent.length > 0 && <ul>
          {recent.map((row) => <li key={row.key}>
            <span className="pub-tag">{row.label}</span>
            <div className="pub-row-copy">
              <b>{row.title}</b>
              {row.meta && <small>{row.meta}</small>}
            </div>
            <span className={`pub-state is-${row.status}`}>{row.status}</span>
            <div className="pub-row-actions">
              <button type="button" onClick={row.edit} disabled={busy}>Edit</button>
              <button type="button" onClick={row.toggle} disabled={busy}>{row.status === 'published' ? 'Unpublish' : 'Publish'}</button>
              <button type="button" className="is-danger" onClick={row.remove} disabled={busy}>Delete</button>
            </div>
          </li>)}
        </ul>}
      </section>
    </>}

    {open === 'document' && <form className="pub-form" onSubmit={(event) => { event.preventDefault(); void saveDocument('published'); }}>
      <div className="pub-form-head">
        <button type="button" className="pub-back" onClick={closeForm}>← All types</button>
        <h2>{docDraft.id ? 'Edit document' : 'Publish a document'}</h2>
        <p>{siteName || 'Choose a location'} · Document Vault</p>
      </div>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Shelf *</span>
          <select value={docDraft.category} onChange={(event) => {
            const category = event.target.value as VaultCategoryKey;
            setDocDraft({ ...docDraft, category, documentType: VAULT_CATEGORIES[category].docType as DocumentType });
          }}>
            {SHELVES.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.title}</option>)}
          </select>
        </label>
        <label className="pub-field">
          <span>Document type</span>
          <select value={docDraft.documentType} onChange={(event) => setDocDraft({ ...docDraft, documentType: event.target.value as DocumentType })}>
            {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>)}
          </select>
        </label>
      </div>

      <label className="pub-field">
        <span>Title *</span>
        <input required maxLength={160} value={docDraft.title} onChange={(event) => setDocDraft({ ...docDraft, title: event.target.value })} placeholder="Grinder Safe Operating Procedure" />
      </label>

      <div className="pub-grid">
        <label className="pub-field">
          <span>SOP / document no.</span>
          <input maxLength={40} value={docDraft.documentCode} onChange={(event) => setDocDraft({ ...docDraft, documentCode: event.target.value })} placeholder="SOP-MECH-001" />
        </label>
        <label className="pub-field">
          <span>Revision</span>
          <input maxLength={40} value={docDraft.revision} onChange={(event) => setDocDraft({ ...docDraft, revision: event.target.value })} placeholder="Rev-01" />
        </label>
        <label className="pub-field">
          <span>Department</span>
          <input maxLength={80} value={docDraft.department} onChange={(event) => setDocDraft({ ...docDraft, department: event.target.value })} placeholder="Mechanical" />
        </label>
        <label className="pub-field">
          <span>Section</span>
          <input maxLength={80} value={docDraft.section} onChange={(event) => setDocDraft({ ...docDraft, section: event.target.value })} placeholder="Workshop" />
        </label>
        <label className="pub-field">
          <span>Valid upto</span>
          <input type="date" value={docDraft.validUpto} onChange={(event) => setDocDraft({ ...docDraft, validUpto: event.target.value })} />
        </label>
      </div>

      <label className="pub-field">
        <span>Summary</span>
        <textarea rows={2} maxLength={500} value={docDraft.summary} onChange={(event) => setDocDraft({ ...docDraft, summary: event.target.value })} placeholder="One line shown under the title in the app." />
      </label>

      <div className="pub-file">
        <div className="pub-file-copy">
          <strong>Attachment</strong>
          <small>{attachmentLabel(docDraft.fileName, docDraft.keepFile)}</small>
        </div>
        <input
          ref={filePicker}
          className="pub-hidden-input"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void uploadFile(file).then((uploaded) => {
              if (uploaded) setDocDraft((current) => ({ ...current, filePath: uploaded.path, fileName: uploaded.fileName, keepFile: false }));
            });
          }}
        />
        <button type="button" className="pub-secondary" disabled={uploading || busy} onClick={() => filePicker.current?.click()}>
          {uploading ? 'Uploading…' : docDraft.filePath ? 'Replace file' : 'Attach file'}
        </button>
        {(docDraft.filePath || docDraft.keepFile) && <button type="button" className="pub-ghost" disabled={busy} onClick={() => setDocDraft({ ...docDraft, filePath: null, fileName: null, keepFile: false })}>Remove</button>}
      </div>

      <div className="pub-actions">
        <button type="submit" disabled={busy || uploading}>{busy ? 'Saving…' : docDraft.id ? 'Save & publish' : 'Publish now'}</button>
        <button type="button" className="pub-secondary" disabled={busy || uploading} onClick={() => void saveDocument('draft')}>Save as draft</button>
        <button type="button" className="pub-ghost" onClick={closeForm}>Cancel</button>
      </div>
    </form>}

    {(open === 'circular' || open === 'notice') && <form className="pub-form" onSubmit={(event) => { event.preventDefault(); void savePost('published'); }}>
      <div className="pub-form-head">
        <button type="button" className="pub-back" onClick={closeForm}>← All types</button>
        <h2>{postDraft.id ? `Edit ${postDraft.kind}` : `Publish a ${postDraft.kind}`}</h2>
        <p>{siteName || 'Choose a location'} · Communications</p>
      </div>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Type</span>
          <select value={postDraft.kind} onChange={(event) => setPostDraft({ ...postDraft, kind: event.target.value as 'circular' | 'notice' })}>
            <option value="circular">Circular</option>
            <option value="notice">Notice</option>
          </select>
        </label>
        <label className="pub-field">
          <span>Priority</span>
          <select value={postDraft.priority} onChange={(event) => setPostDraft({ ...postDraft, priority: event.target.value as PostDraft['priority'] })}>
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>

      <label className="pub-field">
        <span>Title *</span>
        <input required maxLength={160} value={postDraft.title} onChange={(event) => setPostDraft({ ...postDraft, title: event.target.value })} placeholder="Monsoon safety advisory" />
      </label>

      <label className="pub-field">
        <span>Summary</span>
        <input maxLength={300} value={postDraft.summary} onChange={(event) => setPostDraft({ ...postDraft, summary: event.target.value })} placeholder="Shown on the app card" />
      </label>

      <label className="pub-field">
        <span>Text</span>
        <textarea rows={5} maxLength={5000} value={postDraft.body} onChange={(event) => setPostDraft({ ...postDraft, body: event.target.value })} placeholder="What everyone needs to read." />
      </label>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Published on</span>
          <input type="date" value={postDraft.publishedOn} onChange={(event) => setPostDraft({ ...postDraft, publishedOn: event.target.value })} />
        </label>
        <label className="pub-field">
          <span>Expires on</span>
          <input type="date" value={postDraft.expiresOn} onChange={(event) => setPostDraft({ ...postDraft, expiresOn: event.target.value })} />
        </label>
      </div>

      <div className="pub-file">
        <div className="pub-file-copy">
          <strong>Attachment</strong>
          <small>{attachmentLabel(postDraft.fileName, postDraft.keepFile)}</small>
        </div>
        <input
          ref={filePicker}
          className="pub-hidden-input"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void uploadFile(file).then((uploaded) => {
              if (uploaded) setPostDraft((current) => ({ ...current, filePath: uploaded.path, fileName: uploaded.fileName, keepFile: false }));
            });
          }}
        />
        <button type="button" className="pub-secondary" disabled={uploading || busy} onClick={() => filePicker.current?.click()}>
          {uploading ? 'Uploading…' : postDraft.filePath ? 'Replace file' : 'Attach file'}
        </button>
        {(postDraft.filePath || postDraft.keepFile) && <button type="button" className="pub-ghost" disabled={busy} onClick={() => setPostDraft({ ...postDraft, filePath: null, fileName: null, keepFile: false })}>Remove</button>}
      </div>

      <div className="pub-actions">
        <button type="submit" disabled={busy || uploading}>{busy ? 'Saving…' : postDraft.id ? 'Save & publish' : 'Publish now'}</button>
        <button type="button" className="pub-secondary" disabled={busy || uploading} onClick={() => void savePost('draft')}>Save as draft</button>
        <button type="button" className="pub-ghost" onClick={closeForm}>Cancel</button>
      </div>
    </form>}

    {open === 'event' && <form className="pub-form" onSubmit={(event) => { event.preventDefault(); void saveEvent('published'); }}>
      <div className="pub-form-head">
        <button type="button" className="pub-back" onClick={closeForm}>← All types</button>
        <h2>{eventDraft.id ? 'Edit event' : 'Publish an event'}</h2>
        <p>{siteName || 'Choose a location'} · Upcoming events</p>
      </div>

      <label className="pub-field">
        <span>Title *</span>
        <input required maxLength={160} value={eventDraft.title} onChange={(event) => setEventDraft({ ...eventDraft, title: event.target.value })} placeholder="Fire drill — Workshop" />
      </label>

      <label className="pub-field">
        <span>Topic</span>
        <input maxLength={120} value={eventDraft.topic} onChange={(event) => setEventDraft({ ...eventDraft, topic: event.target.value })} placeholder="Emergency preparedness" />
      </label>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Starts *</span>
          <input required type="datetime-local" value={eventDraft.startsAt} onChange={(event) => setEventDraft({ ...eventDraft, startsAt: event.target.value })} />
        </label>
        <label className="pub-field">
          <span>Ends</span>
          <input type="datetime-local" value={eventDraft.endsAt} onChange={(event) => setEventDraft({ ...eventDraft, endsAt: event.target.value })} />
        </label>
      </div>

      <label className="pub-field">
        <span>Venue</span>
        <input maxLength={160} value={eventDraft.venue} onChange={(event) => setEventDraft({ ...eventDraft, venue: event.target.value })} placeholder="Training hall" />
      </label>

      <label className="pub-field">
        <span>Description</span>
        <textarea rows={4} maxLength={5000} value={eventDraft.description} onChange={(event) => setEventDraft({ ...eventDraft, description: event.target.value })} placeholder="What happens, who should attend." />
      </label>

      <div className="pub-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : eventDraft.id ? 'Save & publish' : 'Publish now'}</button>
        <button type="button" className="pub-secondary" disabled={busy} onClick={() => void saveEvent('draft')}>Save as draft</button>
        <button type="button" className="pub-ghost" onClick={closeForm}>Cancel</button>
      </div>
    </form>}

    {open === 'alert' && <form className="pub-form" onSubmit={(event) => { event.preventDefault(); void saveAlert('published'); }}>
      <div className="pub-form-head">
        <button type="button" className="pub-back" onClick={closeForm}>← All types</button>
        <h2>{alertDraft.id ? 'Edit safety alert' : 'Publish a safety alert'}</h2>
        <p>{siteName || 'Choose a location'} · Safety Alerts</p>
      </div>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Category *</span>
          <select value={alertDraft.category} onChange={(event) => setAlertDraft({ ...alertDraft, category: event.target.value })}>
            {ALERT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
        <label className="pub-field">
          <span>Incident date &amp; time *</span>
          <input required type="datetime-local" value={alertDraft.incidentAt} onChange={(event) => setAlertDraft({ ...alertDraft, incidentAt: event.target.value })} />
        </label>
        <label className="pub-field">
          <span>Alert reference</span>
          <input maxLength={40} value={alertDraft.reference} onChange={(event) => setAlertDraft({ ...alertDraft, reference: event.target.value })} placeholder="ALR-2026-014" />
        </label>
      </div>

      <label className="pub-field">
        <span>Headline *</span>
        <input required maxLength={160} value={alertDraft.title} onChange={(event) => setAlertDraft({ ...alertDraft, title: event.target.value })} placeholder="Hand injury while changing a grinder wheel" />
      </label>

      <div className="pub-grid">
        <label className="pub-field">
          <span>Area</span>
          <input maxLength={120} value={alertDraft.area} onChange={(event) => setAlertDraft({ ...alertDraft, area: event.target.value })} placeholder="Workshop" />
        </label>
        <label className="pub-field">
          <span>Department</span>
          <input maxLength={120} value={alertDraft.department} onChange={(event) => setAlertDraft({ ...alertDraft, department: event.target.value })} placeholder="Mechanical" />
        </label>
      </div>

      <label className="pub-field">
        <span>What happened *</span>
        <textarea required rows={3} maxLength={5000} value={alertDraft.description} onChange={(event) => setAlertDraft({ ...alertDraft, description: event.target.value })} placeholder="Describe the incident in plain words." />
      </label>

      <label className="pub-field">
        <span>Root cause</span>
        <textarea rows={2} maxLength={2000} value={alertDraft.rootCause} onChange={(event) => setAlertDraft({ ...alertDraft, rootCause: event.target.value })} />
      </label>

      <p className="pub-hint">One line per point — each line becomes a bullet in the app.</p>
      <div className="pub-grid">
        <label className="pub-field">
          <span>Immediate response</span>
          <textarea rows={3} maxLength={3000} value={alertDraft.immediateResponse} onChange={(event) => setAlertDraft({ ...alertDraft, immediateResponse: event.target.value })} placeholder={'First aid given\nArea cordoned off'} />
        </label>
        <label className="pub-field">
          <span>Corrective actions</span>
          <textarea rows={3} maxLength={3000} value={alertDraft.correctiveActions} onChange={(event) => setAlertDraft({ ...alertDraft, correctiveActions: event.target.value })} placeholder={'Wheel guard refitted\nToolbox talk held'} />
        </label>
        <label className="pub-field">
          <span>Lessons learned</span>
          <textarea rows={3} maxLength={3000} value={alertDraft.lessonsLearned} onChange={(event) => setAlertDraft({ ...alertDraft, lessonsLearned: event.target.value })} placeholder={'Isolate before changing the wheel'} />
        </label>
      </div>

      <div className="pub-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : alertDraft.id ? 'Save & publish' : 'Publish alert'}</button>
        <button type="button" className="pub-secondary" disabled={busy} onClick={() => void saveAlert('draft')}>Save as draft</button>
        <button type="button" className="pub-ghost" onClick={closeForm}>Cancel</button>
      </div>
    </form>}

    {open === 'reward' && <form className="pub-form" onSubmit={(event) => { event.preventDefault(); void saveReward('published'); }}>
      <div className="pub-form-head">
        <button type="button" className="pub-back" onClick={closeForm}>← All types</button>
        <h2>{rewardDraft.id ? 'Edit reward' : 'Publish a reward'}</h2>
        <p>Rewards &amp; Recognition · shown on the app home screen</p>
      </div>

      <label className="pub-field">
        <span>Employee name *</span>
        <input required maxLength={120} value={rewardDraft.employeeName} onChange={(event) => setRewardDraft({ ...rewardDraft, employeeName: event.target.value })} placeholder="Musahid" />
      </label>

      <label className="pub-field">
        <span>Reward for *</span>
        <textarea required rows={2} maxLength={300} value={rewardDraft.rewardFor} onChange={(event) => setRewardDraft({ ...rewardDraft, rewardFor: event.target.value })} placeholder="Best Supervisor of the Month — Sep 2026" />
      </label>

      <div className="pub-file">
        <div className="pub-photo-preview" data-empty={rewardDraft.imageUrl ? undefined : 'true'}>
          {rewardDraft.imageUrl
            ? <img src={rewardDraft.imageUrl} alt="Selected employee" />
            : <span>Photo</span>}
        </div>
        <div className="pub-file-copy">
          <strong>Employee photo</strong>
          <small>{rewardDraft.imageUrl ? 'The name and the reward print on this photo in the gallery.' : 'JPG, PNG or WEBP · up to 5 MB. Portrait fits best.'}</small>
          <div className="pub-file-actions">
            <input
              ref={photoPicker}
              className="pub-hidden-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void uploadPhoto(file).then((url) => {
                  if (url) setRewardDraft((current) => ({ ...current, imageUrl: url }));
                });
              }}
            />
            <button type="button" className="pub-secondary" disabled={uploading || busy} onClick={() => photoPicker.current?.click()}>
              {uploading ? 'Uploading…' : rewardDraft.imageUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {rewardDraft.imageUrl && <button type="button" className="pub-ghost" disabled={busy} onClick={() => setRewardDraft({ ...rewardDraft, imageUrl: null })}>Remove</button>}
          </div>
        </div>
      </div>

      <label className="pub-check">
        <input type="checkbox" checked={rewardDraft.consentConfirmed} onChange={(event) => setRewardDraft({ ...rewardDraft, consentConfirmed: event.target.checked })} />
        I confirm documented permission to display this person&apos;s name and photo.
      </label>

      <div className="pub-actions">
        <button type="submit" disabled={busy || uploading}>{busy ? 'Saving…' : rewardDraft.id ? 'Save & publish' : 'Publish reward'}</button>
        <button type="button" className="pub-secondary" disabled={busy || uploading} onClick={() => void saveReward('draft')}>Save as draft</button>
        <button type="button" className="pub-ghost" onClick={closeForm}>Cancel</button>
      </div>
    </form>}
  </div>;
}
