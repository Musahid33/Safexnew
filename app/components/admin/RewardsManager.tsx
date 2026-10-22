'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { AdminRecognitionItem } from '@/lib/recognitions';

/**
 * Rewards & Recognition editor.
 *
 * Extracted from /admin/recognitions so the same component can sit inside the publishing
 * panel's Rewards tab. The write path is unchanged: `/api/admin/recognitions`, signed-in staff
 * only, and only consented + published rows reach the home screen.
 *
 * It renders the fields only — the page around it owns the sign-in gate and the heading.
 */

type Draft = Omit<AdminRecognitionItem, 'id'> & { id?: string };
const blank: Draft = {
  employeeName: '', rewardFor: '', imageUrl: null, artworkIndex: 0,
  sortOrder: 0, consentConfirmed: false, isPublished: false
};

export default function RewardsManager() {
  const [items, setItems] = useState<AdminRecognitionItem[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch('/api/admin/recognitions', { cache: 'no-store' });
    const data = await response.json();
    if (response.status === 401) throw new Error('Session expired. Sign in again.');
    if (!response.ok) throw new Error(data.error ?? 'Could not load rewards.');
    setItems(data.items);
  }

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load rewards.'));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/recognitions', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save reward.');
      setDraft(blank);
      await load();
      setMessage('Reward saved. Published entries appear in the Reward Wall on the home screen.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save reward.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Upload straight from the form and keep the returned URL in the draft, so one save writes
   * both the photo and the caption. One button on purpose: the hidden input is opened by it,
   * and a phone offers camera or gallery from the same picker.
   */
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow choosing the same file again after a failed upload.
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setMessage('');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/admin/recognitions/photo', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not upload the photo.');
      setDraft((current) => ({ ...current, imageUrl: data.url as string }));
      setMessage('Photo uploaded. Save to publish it.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this reward permanently? You can unpublish it instead by editing it.')) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/recognitions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not delete reward.');
      if (draft.id === id) setDraft(blank);
      await load();
      setMessage('Reward deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete reward.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="content-admin-manager">
    {message && <p role="status" className="content-admin-message">{message}</p>}

    <form className="content-admin-card" onSubmit={save}>
      <h2>{draft.id ? 'Edit reward' : 'New reward'}</h2>
      <label htmlFor="recognition-name">Name</label>
      <input id="recognition-name" required maxLength={120} value={draft.employeeName} onChange={(event) => setDraft({ ...draft, employeeName: event.target.value })} />

      <label htmlFor="recognition-reason">Reward For</label>
      <textarea id="recognition-reason" required maxLength={300} rows={3} value={draft.rewardFor} onChange={(event) => setDraft({ ...draft, rewardFor: event.target.value })} />

      <div className="content-admin-photo">
        <div className="content-admin-photo-preview" data-empty={draft.imageUrl ? undefined : 'true'}>
          {draft.imageUrl
            ? <img src={draft.imageUrl} alt="Selected employee photo" />
            : <span>Photo appears on the award card</span>}
        </div>
        <div className="content-admin-photo-copy">
          <strong>Employee photo</strong>
          <p>The photo is the award card on the home screen, and the name and the reward are printed on it. Portrait photos fit best.</p>
          <input
            id="recognition-photo"
            ref={photoInput}
            className="content-admin-photo-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => void uploadPhoto(event)}
          />
          <div className="content-admin-actions">
            <button type="button" disabled={uploading || busy} onClick={() => photoInput.current?.click()}>
              {uploading ? 'Uploading…' : draft.imageUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {draft.imageUrl && <button type="button" disabled={busy} onClick={() => setDraft({ ...draft, imageUrl: null })}>Remove photo</button>}
          </div>
          <small>JPG, PNG or WEBP, up to 5 MB.</small>
        </div>
      </div>

      <div className="content-admin-pair">
        <label>Artwork if no photo
          <select value={draft.artworkIndex} onChange={(event) => setDraft({ ...draft, artworkIndex: Number(event.target.value) })}>
            <option value={0}>Trophy</option>
            <option value={1}>Safety shield</option>
            <option value={2}>Medal</option>
          </select>
        </label>
        <label>Order
          <input type="number" min={0} max={9999} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} />
        </label>
      </div>

      <label className="content-admin-check">
        <input type="checkbox" checked={draft.consentConfirmed} onChange={(event) => setDraft({ ...draft, consentConfirmed: event.target.checked, isPublished: event.target.checked ? draft.isPublished : false })} />
        I confirm documented permission to display this person&apos;s name and image.
      </label>
      <label className="content-admin-check">
        <input type="checkbox" checked={draft.isPublished} disabled={!draft.consentConfirmed} onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })} />
        Publish in the Reward Wall on the home screen
      </label>

      <div className="content-admin-actions">
        <button type="submit" disabled={busy}>{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Add reward'}</button>
        {draft.id && <button type="button" onClick={() => setDraft(blank)}>Cancel edit</button>}
      </div>
    </form>

    <section className="content-admin-card" aria-label="Existing rewards">
      <h2>Existing rewards</h2>
      {items.length === 0 && <p className="content-admin-empty">No rewards added yet.</p>}
      {items.map((item) => <div className="content-admin-row" key={item.id}>
        {item.imageUrl && <img className="content-admin-thumb" src={item.imageUrl} alt="" loading="lazy" decoding="async" />}
        <div>
          <strong>{item.employeeName}</strong>
          <p>{item.rewardFor}</p>
          <small className={item.isPublished ? 'is-published' : 'is-draft'}>{item.isPublished ? 'Published' : 'Draft'}</small>
        </div>
        <div className="content-admin-actions">
          <button type="button" onClick={() => { setDraft(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
          <button type="button" disabled={busy} onClick={() => void remove(item.id)}>Delete</button>
        </div>
      </div>)}
    </section>
  </div>;
}
