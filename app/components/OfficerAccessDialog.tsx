'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Info, LockKeyhole, Mail, Phone, ShieldCheck, UserRound, UsersRound, X } from 'lucide-react';

type Props = { onClose: () => void };
type Role = 'employee' | 'supervisor' | 'admin';
type Mode = 'login' | 'otp' | 'reset';

const COUNTRY_CODES = ['+91', '+1', '+44', '+971'];

export default function OfficerAccessDialog({ onClose }: Props) {
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

  const roleLabel = role === 'employee' ? 'Employee' : role === 'supervisor' ? 'Safety Supervisor / Site Supervisor' : 'Admin';
  const employeeOtp = role === 'employee' && mode === 'otp';

  function chooseRole(nextRole: Role) {
    setRole(nextRole);
    setMode('login');
    setOtp('');
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
    setPassword('');
    setMessage('Authentication is not connected in this demo. No credentials were sent or stored.');
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
    ? 'Verify your OTP'
    : mode === 'reset'
      ? role === 'employee' ? 'Employee Account Help' : 'Password Reset'
      : `${roleLabel} Login`;
  const infoText = mode === 'otp'
    ? 'Enter the one-time code sent to your registered mobile number.'
    : mode === 'reset'
      ? role === 'employee' ? 'Enter your Employee ID and registered mobile number for account help.' : 'Enter your account ID and registered email to request a password reset.'
      : role === 'employee'
        ? 'Enter your Employee ID and registered mobile number to receive OTP.'
        : role === 'supervisor'
          ? 'Sign in with your Safety Supervisor or Site Supervisor account.'
          : 'Sign in with your Admin account (Safety Officer / Manager / Head).';

  return <div className="overlay account-login-overlay" role="dialog" aria-modal="true" aria-labelledby="officer-access-title">
    <div className="modal account-login-modal">
      <div className="modal-header account-login-heading">
        <div>
          <h2 id="officer-access-title">Welcome Back</h2>
          <p>Login to your account</p>
        </div>
        <button className="close-button account-login-close" type="button" onClick={onClose} aria-label="Close login"><X /></button>
      </div>

      <div className="account-role-grid" role="group" aria-label="Choose account type">
        <button type="button" className={`account-role-tab ${role === 'employee' ? 'selected' : ''}`} aria-pressed={role === 'employee'} onClick={() => chooseRole('employee')}>
          <UserRound aria-hidden="true" />
          <b>Employee</b>
        </button>
        <button type="button" className={`account-role-tab ${role === 'supervisor' ? 'selected' : ''}`} aria-pressed={role === 'supervisor'} onClick={() => chooseRole('supervisor')}>
          <UsersRound aria-hidden="true" />
          <b>Safety Supervisor<br />/ Site Supervisor</b>
        </button>
        <button type="button" className={`account-role-tab ${role === 'admin' ? 'selected' : ''}`} aria-pressed={role === 'admin'} onClick={() => chooseRole('admin')}>
          <ShieldCheck aria-hidden="true" />
          <b>Admin</b>
          <small>(Safety Officer /<br />Manager / Head)</small>
        </button>
      </div>

      <div className="account-login-info" role="status">
        <span className="account-info-icon"><Info size={20} /></span>
        <span><b>{infoTitle}</b><small>{infoText}</small></span>
      </div>

      {mode === 'reset' ? <form className="account-login-form" onSubmit={submitReset}>
        <label htmlFor="account-reset-id">{role === 'employee' ? 'Employee ID' : role === 'supervisor' ? 'Supervisor ID' : 'Admin User ID'}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-reset-id" value={resetIdentifier} onChange={(event) => setResetIdentifier(event.target.value)} placeholder={role === 'employee' ? 'Enter your Employee ID' : 'Enter your account ID'} autoComplete="username" required /></div>
        <label htmlFor="account-reset-contact">{role === 'employee' ? 'Registered Mobile Number' : 'Registered Email'}</label>
        {role === 'employee' ? <div className="account-phone-row">
          <div className="account-country-wrap"><Phone size={18} /><select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} aria-label="Country calling code">{COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
          <div className="account-input-wrap phone-field"><input id="account-reset-contact" type="tel" inputMode="tel" autoComplete="tel-national" value={resetContact} onChange={(event) => setResetContact(event.target.value)} placeholder="Enter your registered mobile number" minLength={8} maxLength={16} required /></div>
        </div> : <div className="account-input-wrap"><Mail size={19} /><input id="account-reset-contact" type="email" autoComplete="email" value={resetContact} onChange={(event) => setResetContact(event.target.value)} placeholder="Enter your registered email" required /></div>}
        <button className="account-primary-button" type="submit">{role === 'employee' ? 'Get Account Help' : 'Send Reset Link'} <ArrowRight size={20} /></button>
        <button className="account-back-button" type="button" onClick={backToLogin}><ArrowLeft size={16} /> Back to Login</button>
      </form> : employeeOtp ? <form className="account-login-form" onSubmit={verifyEmployeeOtp}>
        <label htmlFor="account-otp">One-Time Password</label>
        <div className="account-input-wrap"><LockKeyhole size={19} /><input id="account-otp" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="Enter 6-digit OTP" minLength={6} maxLength={6} required /></div>
        <button className="account-primary-button" type="submit">Verify &amp; Continue <ArrowRight size={20} /></button>
        <button className="account-back-button" type="button" onClick={backToLogin}><ArrowLeft size={16} /> Change Employee ID / Mobile</button>
      </form> : role === 'employee' ? <form className="account-login-form" onSubmit={requestEmployeeOtp}>
        <label htmlFor="account-employee-id">Employee ID</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-employee-id" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="Enter your Employee ID" autoComplete="username" required /></div>
        <label htmlFor="account-mobile">Mobile Number</label>
        <div className="account-phone-row">
          <div className="account-country-wrap"><Phone size={18} /><select value={countryCode} onChange={(event) => setCountryCode(event.target.value)} aria-label="Country calling code">{COUNTRY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
          <div className="account-input-wrap phone-field"><input id="account-mobile" type="tel" inputMode="tel" autoComplete="tel-national" value={mobile} onChange={(event) => setMobile(event.target.value)} placeholder="Enter your registered mobile number" minLength={8} maxLength={16} required /></div>
        </div>
        <button className="account-primary-button" type="submit">Send OTP <ArrowRight size={21} /></button>
      </form> : <form className="account-login-form" onSubmit={submitStaffLogin}>
        <label htmlFor="account-username">{role === 'supervisor' ? 'Supervisor User ID' : 'Admin User ID'}</label>
        <div className="account-input-wrap"><UserRound size={19} /><input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={role === 'supervisor' ? 'Enter your Supervisor ID' : 'Enter your Admin User ID'} autoComplete="username" required /></div>
        <label htmlFor="account-password">Password</label>
        <div className="account-input-wrap"><LockKeyhole size={19} /><input id="account-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" minLength={6} required /></div>
        <button className="account-primary-button" type="submit">Login <ArrowRight size={21} /></button>
      </form>}

      {message && <div className="account-login-message" role="status">{message}</div>}
      {mode !== 'reset' && <div className="account-login-footer"><span /><button type="button" onClick={openReset}>Forgot Password?</button></div>}
      <div className="account-demo-note"><LockKeyhole size={14} /> Demo interface only. OTP, password reset and account authentication are not connected; no credentials are stored.</div>
    </div>
  </div>;
}
