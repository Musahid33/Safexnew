'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { AdminRecognitionItem } from '@/lib/recognitions';

type Draft = Omit<AdminRecognitionItem, 'id'> & { id?: string };
const blank: Draft = { employeeName: '', rewardFor: '', imageUrl: null, artworkIndex: 0, sortOrder: 0, consentConfirmed: false, isPublished: false };

export default function RecognitionManager() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [items, setItems] = useState<AdminRecognitionItem[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch('/api/admin/recognitions', { cache: 'no-store' });
    const data = await response.json();
    if (response.status === 401) { setSignedIn(false); throw new Error('Session expired. Sign in again.'); }
    if (!response.ok) throw new Error(data.error ?? 'Could not load rewards.');
    setItems(data.items);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/admin/session', { cache: 'no-store' }).then((response) => response.json()).then((data) => {
      if (!active) return;
      setConfigured(Boolean(data.configured));
      setSignedIn(Boolean(data.signedIn));
    }).catch(() => { if (active) setMessage('Could not check admin session. Please reload.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (signedIn) void load().catch((error) => setMessage(error.message));
  }, [signedIn]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Sign-in failed.');
      setPasscode(''); setSignedIn(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-in failed.'); }
    finally { setBusy(false); }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/recognitions', {
        method: draft.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft)
      });
      const data = await response.json();
      if (response.status === 401) setSignedIn(false);
      if (!response.ok) throw new Error(data.error ?? 'Could not save reward.');
      setDraft(blank);
      await load();
      setMessage('Reward saved. Published entries appear below the gallery on the home screen.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save reward.'); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this reward permanently? You can unpublish it instead by editing it.')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/recognitions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      const data = await response.json();
      if (response.status === 401) setSignedIn(false);
      if (!response.ok) throw new Error(data.error ?? 'Could not delete reward.');
      if (draft.id === id) setDraft(blank);
      await load(); setMessage('Reward deleted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete reward.'); }
    finally { setBusy(false); }
  }

  return <main className="recognition-admin">
    <a href="/">← Back to Safex</a>
    <h1>Rewards &amp; Recognition</h1>
    <p>Add a name and the reason for the reward. Only published entries with confirmed consent appear on the home screen.</p>
    {message && <p role="status" className="recognition-admin-message">{message}</p>}
    {configured === null && <p>Checking access…</p>}
    {configured === false && <p>The admin console is disabled. Configure SAFEX_ADMIN_PASSCODE on the server.</p>}
    {configured && !signedIn && <form className="recognition-admin-card" onSubmit={signIn}>
      <label htmlFor="recognition-passcode">Admin workspace passcode</label>
      <input id="recognition-passcode" type="password" minLength={12} required autoComplete="current-password" value={passcode} onChange={(event) => setPasscode(event.target.value)} />
      <button type="submit" disabled={busy}>Sign in</button>
    </form>}
    {configured && signedIn && <>
      <form className="recognition-admin-card" onSubmit={save}>
        <h2>{draft.id ? 'Edit reward' : 'New reward'}</h2>
        <label htmlFor="recognition-name">Name</label>
        <input id="recognition-name" required maxLength={120} value={draft.employeeName} onChange={(event) => setDraft({ ...draft, employeeName: event.target.value })} />
        <label htmlFor="recognition-reason">Reward For</label>
        <textarea id="recognition-reason" required maxLength={300} rows={3} value={draft.rewardFor} onChange={(event) => setDraft({ ...draft, rewardFor: event.target.value })} />
        <label htmlFor="recognition-image">Image URL (optional: /rewards/photo.jpg or public Supabase Storage URL)</label>
        <input id="recognition-image" type="text" maxLength={500} placeholder="/rewards/photo.jpg" value={draft.imageUrl ?? ''} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value || null })} />
        <div className="recognition-admin-pair">
          <label>Artwork if no image<select value={draft.artworkIndex} onChange={(event) => setDraft({ ...draft, artworkIndex: Number(event.target.value) })}><option value={0}>Trophy</option><option value={1}>Safety shield</option><option value={2}>Medal</option></select></label>
          <label>Order<input type="number" min={0} max={9999} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} /></label>
        </div>
        <label className="recognition-admin-check"><input type="checkbox" checked={draft.consentConfirmed} onChange={(event) => setDraft({ ...draft, consentConfirmed: event.target.checked, isPublished: event.target.checked ? draft.isPublished : false })} /> I confirm documented permission to display this person&apos;s name and image.</label>
        <label className="recognition-admin-check"><input type="checkbox" checked={draft.isPublished} disabled={!draft.consentConfirmed} onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })} /> Publish on home screen</label>
        <div className="recognition-admin-actions"><button type="submit" disabled={busy}>{busy ? 'Saving…' : draft.id ? 'Save changes' : 'Add reward'}</button>{draft.id && <button type="button" onClick={() => setDraft(blank)}>Cancel edit</button>}</div>
      </form>
      <section className="recognition-admin-card" aria-label="Existing rewards"><h2>Existing entries</h2>
        {items.length === 0 && <p>No rewards added yet.</p>}
        {items.map((item) => <div className="recognition-admin-row" key={item.id}>
          <div><strong>{item.employeeName}</strong><p>{item.rewardFor}</p><small>{item.isPublished ? 'Published' : 'Draft'}</small></div>
          <div className="recognition-admin-actions"><button type="button" onClick={() => { setDraft(item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button><button type="button" disabled={busy} onClick={() => void remove(item.id)}>Delete</button></div>
        </div>)}
      </section>
    </>}
  </main>;
}
