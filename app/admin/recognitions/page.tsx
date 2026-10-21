'use client';

import { useEffect, useState, type FormEvent } from 'react';
import RewardsManager from '@/app/components/admin/RewardsManager';

/**
 * Standalone rewards editor (kept at its old URL) and the sign-in gate for it.
 *
 * The same editor is also a tab in /admin/publish. Both talk to /api/admin/recognitions, so
 * there is one write path and one session.
 */
export default function RecognitionManager() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/session', { cache: 'no-store' }).then((response) => response.json()).then((data) => {
      if (!active) return;
      setConfigured(Boolean(data.configured));
      setSignedIn(Boolean(data.signedIn));
    }).catch(() => { if (active) setMessage('Could not check admin session. Please reload.'); });
    return () => { active = false; };
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
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
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="recognition-admin">
    <a href="/admin/publish">← Publishing panel</a>
    <a href="/">Safex home</a>
    <h1>Rewards &amp; Recognition</h1>
    <p>Add a name and the reason for the reward. Only published entries with confirmed consent appear on the home screen.</p>
    {message && <p role="status" className="recognition-admin-message">{message}</p>}
    {configured === null && <p>Checking access…</p>}
    {configured === false && <p>The admin console is disabled. Configure SAFEX_ADMIN_PASSCODE on the server.</p>}
    {configured && !signedIn && <form className="recognition-admin-card" onSubmit={signIn}>
      <label htmlFor="recognition-username">Admin User ID</label>
      <input id="recognition-username" required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
      <label htmlFor="recognition-password">Password</label>
      <input id="recognition-password" type="password" minLength={6} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button type="submit" disabled={busy}>Sign in</button>
      <small>Signed in to the app already? This page reuses that session.</small>
    </form>}
    {configured && signedIn && <RewardsManager />}
  </main>;
}
