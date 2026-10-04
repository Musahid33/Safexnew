'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Info, LockKeyhole, Mail, Phone, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';
import { useI18n } from './I18nProvider';

type Props = { onClose: () => void; onDemoLogin: () => void };
type Role = 'employee' | 'supervisor' | 'admin';
type Mode = 'login' | 'otp' | 'reset';

const COUNTRY_CODES = ['+91', '+1', '+44', '+971'];
const DEMO_ADMIN_USERNAME = 'safety.officer.demo';
const DEMO_ADMIN_PASSWORD = 'SafetyDemo2026!';

export default function OfficerAccessDialog({ onClose, onDemoLogin }: Props) {
  const { T } = useI18n();
  const [role, setRole] = useState<Role>('employee');
  const [mode, setMode] = useState<Mode>('login');
  const [countryCode, setCountryCode] = useState('+91');
  const [employeeId, setEmployeeId] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [resetContact, setResetContact] = useState('');
  const [message, setMessage] = useState('');

  const employeeOtp = role === 'employee' && mode === 'otp';

  function chooseRole(nextRole: Role) {
    setRole(nextRole);
    setMode('login');
    setOtp('');
    setUsername('');
    setPassword('');
    setMessage('');
  }

  function requestEmployeeOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOtp('');
    setMode('otp');
    setMessage('Demo only: no OTP was sent. Connect employee verification and SMS delivery to enable sign-in.');
  }

  function verifyEmployeeOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('OTP verification is not connected in this demo. No sign-in has occurred.');
  }

  function submitStaffLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isDemoAdmin = role === 'admin'
      && username.trim().toLowerCase() === DEMO_ADMIN_USERNAME
      && password === DEMO_ADMIN_PASSWORD;
    setPassword('');
    setUsername('');
    if (isDemoAdmin) {
      setMessage('');
      onDemoLogin();
      return;
    }
    setMessage(role === 'admin'
      ? 'Demo login only. Use the username and password shown below. No credentials were sent or stored.'
      : 'Authentication is not connected in this demo. No credentials were sent or stored.');
  }

  function fillDemoAdminCredentials() {
    setUsername(DEMO_ADMIN_USERNAME);
    setPassword(DEMO_ADMIN_PASSWORD);
    setMessage('Demo credentials filled. Press Login to open the sample dashboard.');
  }

  function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(role === 'employee'
      ? 'Employee account recovery is not connected in this demo. No message was sent.'
      : 'Password reset is not connected in this demo. No email was sent.');
  }

  function openReset() {
    setResetIdentifier(role === 'employee' ? employeeId : username);
    setResetContact(role === 'employee' ? mobile : '');
    setMessage('');
    setMode('reset');
  }

  function backToLogin() {
    setMessage('');
    setMode('login');
  }

  const infoTitle = mode === 'otp'
    ? T('Verify your OTP')
    : mode === 'reset'
      ? role === 'employee' ? T('Employee Account Help') : T('Password Reset')
      : role === 'employee' ? T('Employee Login') : role === 'supervisor' ? T('Safety Supervisor / Site Supervisor Login') : T('Admin Login');
  const infoText = mode === 'otp'
    ? T('Enter the one-time code sent to your registered mobile number.')
    : mode === 'reset'
      ? role === 'employee' ? T('Enter your Employee ID and registered mobile number for account help.') : T('Enter your account ID and registered email to request a password reset.')
      : role === 'employee'
        ? T('Enter your Employee ID and registered mobile number to receive OTP.')
        : role === 'supervisor'
          ? T('Sign in with your Safety Supervisor or Site Supervisor account.')
          : T('Use the demo username and password shown here to open the local sample dashboard. This does not sign in to Supabase.');

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
        <button type="button" className={`account-role-tab ${role === 'employee' ? 'selected' : ''}`} aria-pressed={role === 'employee'} onClick={() => chooseRole('employee')}>
          <UserRound aria-hidden="true" />
          <b>{T('Employee')}</b>
        </button>
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
        <label htmlFor="account-reset-id">{role === 'employee' ? T('Employee ID') : role === 'supervisor' ? T('Supervisor ID') : T('Admin User ID')}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-reset-id" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder={role === 'employee' ? T('Enter your Employee ID') : T('Enter your account ID')} autoComplete="username" required /></div>
        <label htmlFor="account-reset-contact">{role === 'employee' ? T('Registered Mobile Number') : T('Registered Email')}</label>
        {role === 'employee' ? <div className="account-phone-row">
          <div className="account-country-wrap"><Phone size={18} /><select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} aria-label={T('Country calling code')}>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
          <div className="account-input-wrap phone-field"><input id="account-reset-contact" type="tel" inputMode="tel" autoComplete="tel-national" value={resetContact} onChange={(event) => setResetContact(event.target.value)} placeholder={T('Enter your registered mobile number')} minLength={8} maxLength={16} required /></div>
        </div> : <div className="account-input-wrap"><Mail size={19} /><input id="account-reset-contact" type="email" autoComplete="email" value={resetContact} onChange={(event) => setResetContact(event.target.value)} placeholder={T('Enter your registered email')} required /></div>}
        <button className="account-primary-button" type="submit">{role === 'employee' ? T('Get Account Help') : T('Send Reset Link')} <ArrowRight size={20} /></button>
        <button className="account-back-button" type="button" onClick={backToLogin}><ArrowLeft size={16} /> {T('Back to Login')}</button>
      </form> : employeeOtp ? <form className="account-login-form" onSubmit={verifyEmployeeOtp}>
        <label htmlFor="account-otp">{T('One-Time Password')}</label>
        <div className="account-input-wrap"><LockKeyhole size={19} /><input id="account-otp" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder={T('Enter 6-digit OTP')} minLength={6} maxLength={6} required /></div>
        <button className="account-primary-button" type="submit">{T('Verify & Continue')} <ArrowRight size={20} /></button>
        <button className="account-back-button" type="button" onClick={backToLogin}><ArrowLeft size={16} /> {T('Change Employee ID / Mobile')}</button>
      </form> : role === 'employee' ? <form className="account-login-form" onSubmit={requestEmployeeOtp}>
        <label htmlFor="account-employee-id">{T('Employee ID')}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-employee-id" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder={T('Enter your Employee ID')} autoComplete="username" required /></div>
        <label htmlFor="account-mobile">{T('Mobile Number')}</label>
        <div className="account-phone-row">
          <div className="account-country-wrap"><Phone size={18} /><select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} aria-label={T('Country calling code')}>{COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
          <div className="account-input-wrap phone-field"><input id="account-mobile" type="tel" inputMode="tel" autoComplete="tel-national" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder={T('Enter your registered mobile number')} minLength={8} maxLength={16} required /></div>
        </div>
        <button className="account-primary-button" type="submit">{T('Send OTP')} <ArrowRight size={21} /></button>
      </form> : <form className="account-login-form" onSubmit={submitStaffLogin}>
        <label htmlFor="account-username">{role === 'supervisor' ? T('Supervisor User ID') : T('Admin User ID')}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={role === 'supervisor' ? T('Enter your Supervisor ID') : T('Enter your Admin User ID')} autoComplete="username" required /></div>
        <label htmlFor="account-password">{T('Password')}</label>
        <div className="account-input-wrap"><LockKeyhole size={19} /><input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={T('Enter your password')} autoComplete="current-password" minLength={6} required /></div>
        <button className="account-primary-button" type="submit">{T('Login')} <ArrowRight size={21} /></button>
      </form>}

      {role === 'admin' && mode === 'login' && <section className="admin-demo-credentials" aria-label={T('Demo credentials')}>
        <div className="admin-demo-credentials-heading"><ShieldCheck size={18} /><span><b>{T('Local demo account')}</b><small>{T('These public demo credentials unlock synthetic dashboard data only. Supabase authentication is not used.')}</small></span></div>
        <div className="admin-demo-credential-values"><span><small>{T('Username')}</small><code>{DEMO_ADMIN_USERNAME}</code></span><span><small>{T('Password')}</small><code>{DEMO_ADMIN_PASSWORD}</code></span></div>
        <button type="button" className="admin-demo-fill-button" onClick={fillDemoAdminCredentials}>{T('Use demo credentials')}</button>
      </section>}
      {message && <div className="account-login-message" role="status">{T(message)}</div>}
      {mode !== 'reset' && <div className="account-login-footer"><span /><button type="button" onClick={openReset}>{T('Forgot Password?')}</button></div>}
      <div className="account-demo-note"><LockKeyhole size={14} /> {T('Demo interface only. OTP, password reset and live Supabase authentication are not connected; demo credentials stay local and are not saved.')}</div>
    </div>
  </div>;
}
