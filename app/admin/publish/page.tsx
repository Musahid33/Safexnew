'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import RewardsManager from '@/app/components/admin/RewardsManager';
import {
  DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, VAULT_CATEGORIES, vaultCategoriesForPublishing,
  type DocumentType, type VaultCategoryKey
} from '@/lib/content/catalog';
import type { AdminAnnouncement, AdminDocument, AdminEvent } from '@/lib/content/types';
import './publish.css';

/**
 * Publishing panel: Document Vault, Communications (circulars / notices / events) and Rewards.
 *
 * Everything saved here is a row in Supabase. The worker app reads the same rows through
 * `/api/content`, so publishing here is what makes content appear on a phone — there is no
 * separate copy and no build step.
 *
 * Drafts stay in this panel. Only `status = 'published'` is returned by the public API.
 */

type Tab = 'documents' | 'communications' | 'rewards';
type SiteOption = { id: string; slug: string; name: string };
type ContentListing = { documents: AdminDocument[]; announcements: AdminAnnouncement[]; events: AdminEvent[] };

const EMPTY_LISTING: ContentListing = { documents: [], announcements: [], events: [] };

const SHELVES = vaultCategoriesForPublishing();

type DocumentDraft = {
  id?: string;
  category: VaultCategoryKey;
  title: string;
  summary: string;
  documentCode: string;
  documentType: DocumentType;
  revision: string;
  effectiveDate: string;
  status: 'draft' | 'published' | 'archived';
  sortOrder: number;
  filePath: string | null;
  fileName: string | null;
  externalUrl: string;
  /** Editing a row that already has a file: keep it unless a new one is chosen. */
  keepFile?: boolean;
};

function blankDocument(): DocumentDraft {
  return {
    category: 'sop-swp', title: '', summary: '', documentCode: '', documentType: 'sop',
    revision: '', effectiveDate: '', status: 'draft', sortOrder: 0,
    filePath: null, fileName: null, externalUrl: '', keepFile: false
  };
}

type PostKind = 'circular' | 'notice' | 'event';
type PostDraft = {
  id?: string;
  kind: PostKind;
  title: string;
  summary: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  publishedOn: string;
  expiresOn: string;
  status: 'draft' | 'published' | 'archived';
  filePath: string | null;
  fileName: string | null;
  externalUrl: string;
  keepFile?: boolean;
  topic: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  eventStatus: 'draft' | 'published' | 'cancelled' | 'completed';
};

function blankPost(): PostDraft {
  return {
    kind: 'circular', title: '', summary: '', body: '', priority: 'normal',
    publishedOn: new Date().toISOString().slice(0, 10), expiresOn: '',
    status: 'draft', filePath: null, fileName: null, externalUrl: '', keepFile: false,
    topic: '', startsAt: '', endsAt: '', venue: '', eventStatus: 'draft'
  };
}

function today(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

function toLocalInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function PublishPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [tab, setTab] = useState<Tab>('documents');
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [siteSlug, setSiteSlug] = useState('');
  const [listing, setListing] = useState<ContentListing>(EMPTY_LISTING);
  const [loading, setLoading] = useState(false);

  const [docDraft, setDocDraft] = useState<DocumentDraft>(blankDocument);
  const [postDraft, setPostDraft] = useState<PostDraft>(blankPost);

  const siteName = useMemo(() => sites.find((site) => site.slug === siteSlug)?.name ?? '', [sites, siteSlug]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/session', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setConfigured(Boolean(data.configured));
        setSignedIn(Boolean(data.signedIn));
      })
      .catch(() => { if (active) setError('Could not check the admin session. Reload the page.'); });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (slug: string) => {
    setLoading(true);
    try {
      const query = slug ? `?site=${encodeURIComponent(slug)}` : '';
      const response = await fetch(`/api/admin/content${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.status === 401) { setSignedIn(false); throw new Error('Session expired. Sign in again.'); }
      if (!response.ok) throw new Error(data.error ?? 'Could not load published content.');
      const nextSites: SiteOption[] = Array.isArray(data.sites) ? data.sites : [];
      setSites(nextSites);
      setListing({ documents: data.documents ?? [], announcements: data.announcements ?? [], events: data.events ?? [] });
      const nextSlug = data.site?.slug ?? (slug || nextSites[0]?.slug || '');
      if (nextSlug && nextSlug !== slug) setSiteSlug(nextSlug);
      else if (!siteSlug && nextSlug) setSiteSlug(nextSlug);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load published content.');
    } finally {
      setLoading(false);
    }
  }, [siteSlug]);

  useEffect(() => {
    if (signedIn) void load('');
  }, [signedIn, load]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Sign-in failed.');
      setPassword('');
      setSignedIn(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function changeSite(slug: string) {
    setSiteSlug(slug);
    setListing(EMPTY_LISTING);
    await load(slug);
  }

  async function upload(file: File): Promise<{ path: string; fileName: string } | null> {
    if (!siteSlug) { setError('Choose a site before uploading.'); return null; }
    if (file.size > 10 * 1024 * 1024) { setError('Files must be 10 MB or smaller.'); return null; }
    const form = new FormData();
    form.set('site', siteSlug);
    form.set('file', file);
    try {
      const response = await fetch('/api/admin/content/upload', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error ?? 'Upload failed.');
      return { path: data.path as string, fileName: data.fileName as string };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
      return null;
    }
  }

  async function send(method: 'POST' | 'PUT' | 'DELETE', payload: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/admin/content', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, site: siteSlug })
      });
      const data = await response.json();
      if (response.status === 401) { setSignedIn(false); throw new Error('Session expired. Sign in again.'); }
      if (!response.ok) throw new Error(data.error ?? 'The request failed.');
      await load(siteSlug);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      kind: 'document',
      id: docDraft.id,
      category: docDraft.category,
      title: docDraft.title,
      summary: docDraft.summary,
      documentCode: docDraft.documentCode,
      documentType: docDraft.documentType,
      revision: docDraft.revision,
      effectiveDate: docDraft.effectiveDate || null,
      status: docDraft.status,
      sortOrder: docDraft.sortOrder,
      // Absent file fields tell the server to keep whatever is stored.
      ...(docDraft.keepFile && !docDraft.filePath && !docDraft.externalUrl ? {} : {
        filePath: docDraft.filePath,
        fileName: docDraft.fileName,
        externalUrl: docDraft.externalUrl
      })
    };
    const ok = await send(docDraft.id ? 'PUT' : 'POST', payload);
    if (ok) {
      setDocDraft(blankDocument());
      setMessage(docDraft.status === 'published' ? 'Document published. It is on the phone app now.' : 'Draft saved. Publish it when it is ready.');
    }
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (postDraft.kind === 'event') {
      const startsAt = postDraft.startsAt ? new Date(postDraft.startsAt) : null;
      const endsAt = postDraft.endsAt ? new Date(postDraft.endsAt) : null;
      if (!startsAt || Number.isNaN(startsAt.getTime())) {
        setError('Choose the date and time the event starts.');
        return;
      }
      if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt < startsAt)) {
        setError('The event has to end after it starts.');
        return;
      }
      const payload = {
        kind: 'event',
        id: postDraft.id,
        title: postDraft.title,
        topic: postDraft.topic,
        description: postDraft.body,
        // datetime-local has no timezone; the browser knows which zone it meant.
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : null,
        venue: postDraft.venue,
        status: postDraft.eventStatus
      };
      if (await send(postDraft.id ? 'PUT' : 'POST', payload)) {
        setPostDraft(blankPost());
        setMessage(postDraft.eventStatus === 'published' ? 'Event published.' : 'Event saved as draft.');
      }
      return;
    }

    const payload = {
      kind: 'announcement',
      id: postDraft.id,
      type: postDraft.kind,
      title: postDraft.title,
      summary: postDraft.summary,
      body: postDraft.body,
      priority: postDraft.priority,
      publishedOn: postDraft.publishedOn || null,
      expiresAt: postDraft.expiresOn ? `${postDraft.expiresOn}T23:59:59+05:30` : null,
      status: postDraft.status,
      ...(postDraft.keepFile && !postDraft.filePath && !postDraft.externalUrl ? {} : {
        filePath: postDraft.filePath,
        externalUrl: postDraft.externalUrl
      })
    };
    if (await send(postDraft.id ? 'PUT' : 'POST', payload)) {
      setPostDraft(blankPost());
      setMessage(postDraft.status === 'published' ? `${postDraft.kind === 'circular' ? 'Circular' : 'Notice'} published.` : 'Draft saved.');
    }
  }

  function editDocument(row: AdminDocument) {
    setTab('documents');
    setDocDraft({
      id: row.id,
      category: row.category,
      title: row.title,
      summary: row.summary ?? '',
      documentCode: row.documentCode ?? '',
      documentType: row.documentType,
      revision: row.revision ?? '',
      effectiveDate: today(row.effectiveDate),
      status: row.status,
      sortOrder: row.sortOrder,
      // The stored path is not exposed; `keepFile` keeps the attachment as it is.
      filePath: null,
      fileName: row.fileName,
      externalUrl: '',
      keepFile: Boolean(row.fileUrl)
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editPost(row: AdminAnnouncement | AdminEvent) {
    setTab('communications');
    if ('kind' in row) {
      setPostDraft({
        ...blankPost(),
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        body: row.body,
        priority: row.priority,
        publishedOn: today(row.publishedOn),
        expiresOn: today(row.expiresAt),
        status: row.status,
        fileName: null,
        keepFile: Boolean(row.attachmentUrl)
      });
    } else {
      setPostDraft({
        ...blankPost(),
        id: row.id,
        kind: 'event',
        title: row.title,
        topic: row.topic ?? '',
        body: row.description,
        startsAt: toLocalInput(row.startsAt),
        endsAt: toLocalInput(row.endsAt),
        venue: row.venue ?? '',
        eventStatus: row.status
      });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleDocument(row: AdminDocument) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await send('PUT', {
      kind: 'document', id: row.id, category: row.category, title: row.title,
      summary: row.summary, documentCode: row.documentCode, documentType: row.documentType,
      revision: row.revision, effectiveDate: row.effectiveDate, status, sortOrder: row.sortOrder
    });
    if (ok) setMessage(status === 'published' ? 'Document published.' : 'Document moved back to draft.');
  }

  async function togglePost(row: AdminAnnouncement) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await send('PUT', {
      kind: 'announcement', id: row.id, type: row.kind, title: row.title,
      summary: row.summary, body: row.body, priority: row.priority,
      publishedOn: row.publishedOn, expiresAt: row.expiresAt, status
    });
    if (ok) setMessage(status === 'published' ? 'Published.' : 'Moved back to draft.');
  }

  async function toggleEvent(row: AdminEvent) {
    const status = row.status === 'published' ? 'draft' : 'published';
    const ok = await send('PUT', {
      kind: 'event', id: row.id, title: row.title, topic: row.topic,
      description: row.description, startsAt: row.startsAt, endsAt: row.endsAt,
      venue: row.venue, status
    });
    if (ok) setMessage(status === 'published' ? 'Event published.' : 'Event moved back to draft.');
  }

  async function remove(kind: 'document' | 'announcement' | 'event', id: string) {
    if (!window.confirm('Delete this permanently? Unpublish it instead if it should stay on record.')) return;
    if (await send('DELETE', { kind, id })) setMessage('Deleted.');
  }

  return <main className="content-admin">
    <div className="content-admin-top">
      <a href="/">← Safex home</a>
      <a href="/admin/recognitions">Rewards page (old URL)</a>
    </div>
    <h1>Publish content</h1>
    <p className="content-admin-lede">
      Documents, circulars, notices, events and rewards saved here go straight to the database.
      The phone app reads them on its next refresh — publish to make something visible.
    </p>

    {error && <p role="alert" className="content-admin-error">{error}</p>}
    {message && <p role="status" className="content-admin-message">{message}</p>}
    {configured === null && <p>Checking access…</p>}
    {configured === false && <p>The admin console is disabled. Configure SAFEX_ADMIN_PASSCODE on the server.</p>}

    {configured && !signedIn && <form className="content-admin-card content-admin-signin" onSubmit={signIn}>
      <h2>Admin sign-in</h2>
      <label htmlFor="publish-username">Admin User ID</label>
      <input id="publish-username" required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
      <label htmlFor="publish-password">Password</label>
      <input id="publish-password" type="password" minLength={6} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <div className="content-admin-actions"><button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
    </form>}

    {configured && signedIn && <>
      <div className="content-admin-toolbar">
        <label className="content-admin-site">
          Publishing to
          <select value={siteSlug} onChange={(event) => void changeSite(event.target.value)}>
            {sites.length === 0 && <option value="">No active site</option>}
            {sites.map((site) => <option key={site.id} value={site.slug}>{site.name}{site.slug ? ` · ${site.slug}` : ''}</option>)}
          </select>
        </label>
        <button type="button" className="content-admin-refresh" onClick={() => void load(siteSlug)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <span className="content-admin-counts">
          {listing.documents.length} docs · {listing.announcements.length} posts · {listing.events.length} events
        </span>
      </div>

      <nav className="content-admin-tabs" aria-label="Publishing sections">
        <button type="button" className={tab === 'documents' ? 'is-active' : ''} onClick={() => setTab('documents')}>Document Vault</button>
        <button type="button" className={tab === 'communications' ? 'is-active' : ''} onClick={() => setTab('communications')}>Communications</button>
        <button type="button" className={tab === 'rewards' ? 'is-active' : ''} onClick={() => setTab('rewards')}>Rewards</button>
      </nav>

      {tab === 'documents' && <>
        <form className="content-admin-card" onSubmit={saveDocument}>
          <h2>{docDraft.id ? 'Edit document' : 'Publish a document'}</h2>

          <div className="content-admin-pair">
            <label>Shelf
              <select value={docDraft.category} onChange={(event) => {
                const category = event.target.value as VaultCategoryKey;
                setDocDraft({ ...docDraft, category, documentType: VAULT_CATEGORIES[category].docType as DocumentType });
              }}>
                {SHELVES.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.title}</option>)}
              </select>
            </label>
            <label>Document type
              <select value={docDraft.documentType} onChange={(event) => setDocDraft({ ...docDraft, documentType: event.target.value as DocumentType })}>
                {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>)}
              </select>
            </label>
          </div>

          <label>Title
            <input required maxLength={160} value={docDraft.title} onChange={(event) => setDocDraft({ ...docDraft, title: event.target.value })} />
          </label>

          <div className="content-admin-pair">
            <label>Document number
              <input maxLength={40} value={docDraft.documentCode} onChange={(event) => setDocDraft({ ...docDraft, documentCode: event.target.value })} />
            </label>
            <label>Revision
              <input maxLength={40} value={docDraft.revision} onChange={(event) => setDocDraft({ ...docDraft, revision: event.target.value })} />
            </label>
          </div>

          <label>Summary
            <textarea rows={2} maxLength={500} value={docDraft.summary} onChange={(event) => setDocDraft({ ...docDraft, summary: event.target.value })} />
          </label>

          <div className="content-admin-pair">
            <label>Effective date
              <input type="date" value={docDraft.effectiveDate} onChange={(event) => setDocDraft({ ...docDraft, effectiveDate: event.target.value })} />
            </label>
            <label>Order on the shelf
              <input type="number" min={0} max={9999} value={docDraft.sortOrder} onChange={(event) => setDocDraft({ ...docDraft, sortOrder: Number(event.target.value) })} />
            </label>
          </div>

          <label>File (PDF or image, 10 MB)
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              event.target.value = '';
              const uploaded = await upload(file);
              if (uploaded) setDocDraft((draft) => ({ ...draft, filePath: uploaded.path, fileName: uploaded.fileName, externalUrl: '', keepFile: false }));
            }} />
          </label>
          {docDraft.fileName && <p className="content-admin-hint">Attached: <b>{docDraft.fileName}</b></p>}
          {docDraft.keepFile && !docDraft.filePath && <p className="content-admin-hint">The saved file stays unless you choose a new one or add a link.</p>}

          <label>…or an https link instead of a file
            <input type="url" placeholder="https://…" maxLength={600} value={docDraft.externalUrl} onChange={(event) => setDocDraft({ ...docDraft, externalUrl: event.target.value, keepFile: false, filePath: event.target.value ? null : docDraft.filePath })} />
          </label>

          <div className="content-admin-pair">
            <label>Visibility
              <select value={docDraft.status} onChange={(event) => setDocDraft({ ...docDraft, status: event.target.value as DocumentDraft['status'] })}>
                <option value="draft">Draft — hidden</option>
                <option value="published">Published — visible in the app</option>
                <option value="archived">Archived</option>
              </select>
            </label>
          </div>

          <div className="content-admin-actions">
            <button type="submit" disabled={busy || !siteSlug}>{busy ? 'Saving…' : docDraft.id ? 'Save document' : 'Save document'}</button>
            {docDraft.id && <button type="button" onClick={() => setDocDraft(blankDocument())}>Cancel edit</button>}
          </div>
        </form>

        <section className="content-admin-card">
          <h2>Vault documents {siteName ? `· ${siteName}` : ''}</h2>
          {listing.documents.length === 0 && <p className="content-admin-empty">Nothing published for this site yet.</p>}
          {listing.documents.map((row) => <div className="content-admin-row" key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p>{VAULT_CATEGORIES[row.category]?.title} · {DOCUMENT_TYPE_LABELS[row.documentType] ?? row.documentType}{row.revision ? ` · Rev ${row.revision}` : ''}</p>
              <small className={row.status === 'published' ? 'is-published' : 'is-draft'}>{row.status}</small>
              {row.fileUrl && (row.status === 'published'
                ? <a className="content-admin-file" href={row.fileUrl} target="_blank" rel="noreferrer">Open file</a>
                : <span className="content-admin-file">{row.fileName ?? 'File attached'}</span>)}
            </div>
            <div className="content-admin-actions">
              <button type="button" onClick={() => editDocument(row)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => void toggleDocument(row)}>{row.status === 'published' ? 'Unpublish' : 'Publish'}</button>
              <button type="button" disabled={busy} onClick={() => void remove('document', row.id)}>Delete</button>
            </div>
          </div>)}
        </section>
      </>}

      {tab === 'communications' && <>
        <form className="content-admin-card" onSubmit={savePost}>
          <h2>{postDraft.id ? 'Edit entry' : 'Publish a circular, notice or event'}</h2>

          <label>What is this?
            <select value={postDraft.kind} onChange={(event) => setPostDraft({ ...blankPost(), kind: event.target.value as PostKind })}>
              <option value="circular">Circular</option>
              <option value="notice">Notice</option>
              <option value="event">Event</option>
            </select>
          </label>

          <label>Title
            <input required maxLength={160} value={postDraft.title} onChange={(event) => setPostDraft({ ...postDraft, title: event.target.value })} />
          </label>

          {postDraft.kind === 'event' ? <>
            <label>Topic
              <input maxLength={120} value={postDraft.topic} onChange={(event) => setPostDraft({ ...postDraft, topic: event.target.value })} />
            </label>
            <div className="content-admin-pair">
              <label>Starts
                <input required type="datetime-local" value={postDraft.startsAt} onChange={(event) => setPostDraft({ ...postDraft, startsAt: event.target.value })} />
              </label>
              <label>Ends (optional)
                <input type="datetime-local" value={postDraft.endsAt} onChange={(event) => setPostDraft({ ...postDraft, endsAt: event.target.value })} />
              </label>
            </div>
            <label>Venue
              <input maxLength={160} value={postDraft.venue} onChange={(event) => setPostDraft({ ...postDraft, venue: event.target.value })} />
            </label>
            <label>Description
              <textarea rows={3} maxLength={5000} value={postDraft.body} onChange={(event) => setPostDraft({ ...postDraft, body: event.target.value })} />
            </label>
            <label>Visibility
              <select value={postDraft.eventStatus} onChange={(event) => setPostDraft({ ...postDraft, eventStatus: event.target.value as PostDraft['eventStatus'] })}>
                <option value="draft">Draft — hidden</option>
                <option value="published">Published — visible in the app</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </> : <>
            <label>Summary
              <input maxLength={300} value={postDraft.summary} onChange={(event) => setPostDraft({ ...postDraft, summary: event.target.value })} />
            </label>
            <label>Details
              <textarea rows={4} maxLength={5000} value={postDraft.body} onChange={(event) => setPostDraft({ ...postDraft, body: event.target.value })} />
            </label>
            <div className="content-admin-pair">
              <label>Date
                <input type="date" value={postDraft.publishedOn} onChange={(event) => setPostDraft({ ...postDraft, publishedOn: event.target.value })} />
              </label>
              <label>Priority
                <select value={postDraft.priority} onChange={(event) => setPostDraft({ ...postDraft, priority: event.target.value as PostDraft['priority'] })}>
                  <option value="normal">Normal</option>
                  <option value="important">Important</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <div className="content-admin-pair">
              <label>Hide after (optional)
                <input type="date" value={postDraft.expiresOn} onChange={(event) => setPostDraft({ ...postDraft, expiresOn: event.target.value })} />
              </label>
              <label>Visibility
                <select value={postDraft.status} onChange={(event) => setPostDraft({ ...postDraft, status: event.target.value as PostDraft['status'] })}>
                  <option value="draft">Draft — hidden</option>
                  <option value="published">Published — visible in the app</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <label>Attachment (PDF or image, 10 MB)
              <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                event.target.value = '';
                const uploaded = await upload(file);
                if (uploaded) setPostDraft((draft) => ({ ...draft, filePath: uploaded.path, fileName: uploaded.fileName, externalUrl: '', keepFile: false }));
              }} />
            </label>
            {postDraft.fileName && <p className="content-admin-hint">Attached: <b>{postDraft.fileName}</b></p>}
            {postDraft.keepFile && !postDraft.filePath && <p className="content-admin-hint">The saved attachment stays unless you choose a new file or add a link.</p>}
            <label>…or an https link
              <input type="url" placeholder="https://…" maxLength={600} value={postDraft.externalUrl} onChange={(event) => setPostDraft({ ...postDraft, externalUrl: event.target.value, keepFile: false, filePath: event.target.value ? null : postDraft.filePath })} />
            </label>
          </>}

          <div className="content-admin-actions">
            <button type="submit" disabled={busy || !siteSlug}>{busy ? 'Saving…' : postDraft.id ? 'Save entry' : 'Save entry'}</button>
            {postDraft.id && <button type="button" onClick={() => setPostDraft(blankPost())}>Cancel edit</button>}
          </div>
        </form>

        <section className="content-admin-card">
          <h2>Circulars &amp; notices {siteName ? `· ${siteName}` : ''}</h2>
          {listing.announcements.length === 0 && <p className="content-admin-empty">No circulars or notices yet.</p>}
          {listing.announcements.map((row) => <div className="content-admin-row" key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p>{row.kind === 'notice' ? 'Notice' : 'Circular'} · {row.publishedOn ?? 'no date'}{row.priority !== 'normal' ? ` · ${row.priority}` : ''}</p>
              <small className={row.status === 'published' ? 'is-published' : 'is-draft'}>{row.status}</small>
              {row.attachmentUrl && (row.status === 'published'
                ? <a className="content-admin-file" href={row.attachmentUrl} target="_blank" rel="noreferrer">Open attachment</a>
                : <span className="content-admin-file">Attachment attached</span>)}
            </div>
            <div className="content-admin-actions">
              <button type="button" onClick={() => editPost(row)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => void togglePost(row)}>{row.status === 'published' ? 'Unpublish' : 'Publish'}</button>
              <button type="button" disabled={busy} onClick={() => void remove('announcement', row.id)}>Delete</button>
            </div>
          </div>)}
        </section>

        <section className="content-admin-card">
          <h2>Events {siteName ? `· ${siteName}` : ''}</h2>
          {listing.events.length === 0 && <p className="content-admin-empty">No events yet.</p>}
          {listing.events.map((row) => <div className="content-admin-row" key={row.id}>
            <div>
              <strong>{row.title}</strong>
              <p>{new Date(row.startsAt).toLocaleString()}{row.venue ? ` · ${row.venue}` : ''}</p>
              <small className={row.status === 'published' ? 'is-published' : 'is-draft'}>{row.status}</small>
            </div>
            <div className="content-admin-actions">
              <button type="button" onClick={() => editPost(row)}>Edit</button>
              <button type="button" disabled={busy} onClick={() => void toggleEvent(row)}>{row.status === 'published' ? 'Unpublish' : 'Publish'}</button>
              <button type="button" disabled={busy} onClick={() => void remove('event', row.id)}>Delete</button>
            </div>
          </div>)}
        </section>
      </>}

      {tab === 'rewards' && <RewardsManager />}
    </>}
  </main>;
}
