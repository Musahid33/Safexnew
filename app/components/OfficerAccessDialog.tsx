'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Info, LockKeyhole, Mail, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useI18n } from './I18nProvider';

type Props = { onClose: () => void; onSignedIn: () => void };
/**
 * Staff sign-in only. Employees never hold an account here: they use the public app
 * (report submission needs no login) and identify themselves through the Employee-ID
 * lookup on the profile screen.
 */
type Role = 'supervisor' | 'admin';
type Mode = 'login' | 'reset';

export default function OfficerAccessDialog({ onClose, onSignedIn }: Props) {
  const { T } = useI18n();
  const [role, setRole] = useState<Role>('supervisor');
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetContact, setResetContact] = useState('');
  const [message, setMessage] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  function chooseRole(nextRole: Role) {
    setRole(nextRole);
    setMode('login');
    setUsername('');
    setPassword('');
    setMessage('');
  }

  async function submitStaffLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Supervisor sign-in is not wired to a backend yet — admin login is the flow that
    // talks to the server during this hookup phase.
    if (role !== 'admin') {
      setMessage('Supervisor sign-in is not connected yet. No credentials were sent or stored.');
      return;
    }

    setSigningIn(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await response.json().catch(() => null);
      setPassword('');
      setUsername('');
      if (response.ok && data?.ok) {
        // The server accepted the credentials and set the signed session cookie —
        // the dashboard opens through the same session it reads.
        onSignedIn();
        return;
      }
      setMessage(response.status === 429
        ? 'Too many sign-in attempts. Please wait a moment and try again.'
        : (data?.error ?? 'Sign-in failed. Check your credentials and try again.'));
    } catch {
      setMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setSigningIn(false);
    }
  }

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('Password reset is not connected yet. No email was sent.');
  }

  function openReset() {
    setResetIdentifier(username);
    setResetContact('');
    setMessage('');
    setMode('reset');
  }

  function backToLogin() {
    setMessage('');
    setMode('login');
  }

  const infoTitle = mode === 'reset'
    ? T('Password Reset')
    : role === 'supervisor' ? T('Safety Supervisor / Site Supervisor Login') : T('Admin Login');
  const infoText = mode === 'reset'
    ? T('Enter your account ID and registered email to request a password reset.')
    : role === 'supervisor'
      ? T('Sign in with your Safety Supervisor or Site Supervisor account.')
      : T('Sign in with the User ID (or email) and password issued to you. The Safex server verifies them and issues the session.');

  return <div className="overlay account-login-overlay" role="dialog" aria-modal="true" aria-labelledby="officer-access-title">
    <div className="modal account-login-modal">
      <div className="modal-header account-login-heading">
        <div>
          <h2 id="officer-access-title">{T('Welcome Back')}</h2>
          <p>{T('Login to your account')}</p>
        </div>
        <button className="close-button account-login-close" type="button" onClick={onClose} aria-label={T('Close login')}><X /></button>
      </div>

      <div className="account-role-grid" role="group" aria-label={T('Choose account type')}>
        <button type="button" className={`account-role-tab ${role === 'supervisor' ? 'selected' : ''}`} aria-pressed={role === 'supervisor'} onClick={() => chooseRole('supervisor')}>
          <UsersRound aria-hidden="true" />
          <b>{T('Safety Supervisor')}<br />/ {T('Site Supervisor')}</b>
        </button>
        <button type="button" className={`account-role-tab ${role === 'admin' ? 'selected' : ''}`} aria-pressed={role === 'admin'} onClick={() => chooseRole('admin')}>
          <ShieldCheck aria-hidden="true" />
          <b>{T('Admin')}</b>
          <small>({T('Safety Officer')} /<br />{T('Manager')} / {T('Head')})</small>
        </button>
      </div>

      <div className="account-login-info" role="status">
        <span className="account-info-icon"><Info size={20} /></span>
        <span><b>{infoTitle}</b><small>{infoText}</small></span>
      </div>

      {mode === 'reset' ? <form className="account-login-form" onSubmit={submitReset}>
        <label htmlFor="account-reset-id">{role === 'supervisor' ? T('Supervisor ID') : T('Admin User ID')}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-reset-id" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder={T('Enter your account ID')} autoComplete="username" required /></div>
        <label htmlFor="account-reset-contact">{T('Registered Email')}</label>
        <div className="account-input-wrap"><Mail size={19} /><input id="account-reset-contact" type="email" autoComplete="email" value={resetContact} onChange={(event) => setResetContact(event.target.value)} placeholder={T('Enter your registered email')} required /></div>
        <button className="account-primary-button" type="submit">{T('Send Reset Link')} <ArrowRight size={20} /></button>
        <button className="account-back-button" type="button" onClick={backToLogin}><ArrowLeft size={16} /> {T('Back to Login')}</button>
      </form> : <form className="account-login-form" onSubmit={submitStaffLogin}>
        <label htmlFor="account-username">{role === 'supervisor' ? T('Supervisor User ID') : T('Admin User ID')}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={role === 'supervisor' ? T('Enter your Supervisor ID') : T('Enter your Admin User ID or email')} autoComplete="username" required /></div>
        <label htmlFor="account-password">{T('Password')}</label>
        <div className="account-input-wrap"><LockKeyhole size={19} /><input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={T('Enter your password')} autoComplete="current-password" minLength={6} required /></div>
        <button className="account-primary-button" type="submit" disabled={signingIn}>{signingIn ? T('Signing in…') : T('Login')} <ArrowRight size={21} /></button>
      </form>}

      {message && <div className="account-login-message" role="status">{T(message)}</div>}
      {mode !== 'reset' && <div className="account-login-footer"><span /><button type="button" onClick={openReset}>{T('Forgot Password?')}</button></div>}
    </div>
  </div>;
}
