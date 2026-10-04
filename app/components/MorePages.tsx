'use client';

import {
  ArrowLeft, Building2, Check, ChevronRight, ExternalLink, FileText, Globe2, Info, KeyRound,
  LockKeyhole, LogIn, LogOut, Mail, MapPin, Palette, Phone, ShieldCheck, Smartphone, UserRound, X
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TenantBranding } from '@/lib/types';
import { APP_VERSION, SAFEX_WEBSITE_URL } from '@/lib/app-info';
import { useI18n } from './I18nProvider';

export type MoreInfoKind = 'privacy' | 'terms' | 'support' | 'change-password' | 'account-settings';

type MoreMenuPageProps = {
  title: string;
  companyName: string;
  onInstall: () => void;
  onCompanyAbout: () => void;
  onSearchEmployee: () => void;
  onAccount: () => void;
  onAppearance: () => void;
  onAboutApp: () => void;
};

type MoreOptionCardProps = {
  icon: LucideIcon;
  tone: string;
  title: string;
  description: string;
  onClick: () => void;
};

function safeExternalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function emailHref(value: string | null | undefined): string | null {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null;
}

function phoneHref(value: string | null | undefined): string | null {
  const phone = value?.trim();
  if (!phone) return null;
  const normalized = phone.replace(/[^\d+]/g, '');
  return normalized.length >= 7 ? `tel:${normalized}` : null;
}

function MoreOptionCard({ icon: Icon, tone, title, description, onClick }: MoreOptionCardProps) {
  const { T } = useI18n();
  return <button type="button" className="more-option-card" onClick={onClick}>
    <span className={`more-option-icon ${tone}`}><Icon size={20} aria-hidden="true" /></span>
    <span className="more-option-copy"><b>{T(title)}</b><small>{T(description)}</small></span>
    <ChevronRight size={19} className="more-option-arrow" aria-hidden="true" />
  </button>;
}

export function MoreMenuPage({ title, companyName, onInstall, onCompanyAbout, onSearchEmployee, onAccount, onAppearance, onAboutApp }: MoreMenuPageProps) {
  const { T } = useI18n();
  return <section className="page-panel more-landing-page">
    <div className="more-page-heading">
      <div><span className="eyebrow">{T('SAFETYOS · MENU')}</span><h1>{T(title)}</h1><p>{T('App tools, company details and personal settings.')}</p></div>
      <span className="more-heading-icon"><ShieldCheck size={24} aria-hidden="true" /></span>
    </div>
    <div className="more-option-list" aria-label={T('More options')}>
      <MoreOptionCard icon={Smartphone} tone="install" title="Install App" description={T('Install {company} on this device', { company: companyName || T('the company app') })} onClick={onInstall} />
      <MoreOptionCard icon={Building2} tone="company" title="Vendor / Company About Us" description="Company profile, services, contact and support" onClick={onCompanyAbout} />
      <MoreOptionCard icon={UserRound} tone="employee" title="Search Employee Profile" description="Find an employee using their Employee ID" onClick={onSearchEmployee} />
      <MoreOptionCard icon={LockKeyhole} tone="account" title="Account Login" description="Login, logout, password and account settings" onClick={onAccount} />
      <MoreOptionCard icon={Palette} tone="appearance" title="Appearance" description="Light Mode, Dark Mode and System Default" onClick={onAppearance} />
      <MoreOptionCard icon={Info} tone="about-app" title="About App" description="App version, policies and support information" onClick={onAboutApp} />
    </div>
  </section>;
}

function MoreSubpageHeading({ eyebrow, title, description, icon: Icon, onBack }: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  onBack: () => void;
}) {
  const { T } = useI18n();
  return <>
    <button type="button" className="more-page-back" onClick={onBack}><ArrowLeft size={16} /> {T('Back to More')}</button>
    <div className="more-page-heading subpage">
      <div><span className="eyebrow">{T(eyebrow)}</span><h1>{T(title)}</h1><p>{T(description)}</p></div>
      <span className="more-heading-icon"><Icon size={24} aria-hidden="true" /></span>
    </div>
  </>;
}

function CompanyLogo({ company, className = '', fallback = 'monogram' }: { company: TenantBranding; className?: string; fallback?: 'monogram' | 'safex' }) {
  const { T } = useI18n();
  const logoPath = company.logoPath?.trim();
  return <span className={`company-logo-mark ${className}`}>
    {logoPath
      ? <img src={logoPath} alt={T('{company} logo', { company: company.companyName })} />
      : fallback === 'safex'
        ? <img src="/icon-192.png" alt={T('Safex app icon fallback')} />
        : <span aria-hidden="true">{company.companyName.trim().charAt(0) || 'C'}</span>}
  </span>;
}

function CompanyDetail({ icon: Icon, label, value, href }: { icon: LucideIcon; label: string; value: string | null | undefined; href?: string | null }) {
  const { T } = useI18n();
  return <div className="company-detail-row">
    <span className="company-detail-icon"><Icon size={17} aria-hidden="true" /></span>
    <span className="company-detail-copy"><small>{T(label)}</small>{href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}>{value}</a> : <b>{value?.trim() || T('Not configured by Admin')}</b>}</span>
  </div>;
}

export function CompanyAboutPage({ company, onBack }: { company: TenantBranding; onBack: () => void }) {
  const { T } = useI18n();
  const websiteHref = safeExternalUrl(company.website);
  const services = (company.services ?? []).map((service) => service.trim()).filter(Boolean);
  const companyName = company.companyName.trim() || T('Company Name');
  return <section className="page-panel more-subpage-panel company-about-page">
    <MoreSubpageHeading eyebrow="COMPANY PROFILE" title="Vendor / Company About Us" description="Company information published by your Admin." icon={Building2} onBack={onBack} />
    <div className="company-profile-banner">
      <CompanyLogo company={company} />
      <span className="company-profile-banner-copy"><small>{T('VENDOR / COMPANY')}</small><b>{companyName}</b><span>{T('Admin-managed profile')}</span></span>
      <span className="company-profile-check"><Check size={17} aria-label={T('Profile details are tenant-managed')} /></span>
    </div>
    <div className="company-about-card">
      <div className="company-about-card-heading"><span className="company-about-card-icon"><Info size={18} /></span><h2>{T('Introduction')}</h2></div>
      <p>{company.companyIntroduction?.trim() || T('Company introduction has not been configured by Admin.')}</p>
    </div>
    <div className="company-about-card">
      <div className="company-about-card-heading"><span className="company-about-card-icon services"><ShieldCheck size={18} /></span><h2>{T('Services')}</h2></div>
      {services.length > 0
        ? <ul className="company-services-list">{services.map((service) => <li key={service}>{service}</li>)}</ul>
        : <p>{T('Company services have not been configured by Admin.')}</p>}
    </div>
    <div className="company-about-card">
      <div className="company-about-card-heading"><span className="company-about-card-icon contact"><Phone size={18} /></span><h2>{T('Contact Details')}</h2></div>
      <div className="company-detail-list">
        <CompanyDetail icon={MapPin} label="Address" value={company.companyAddress} />
        <CompanyDetail icon={Mail} label="Email" value={company.email} href={emailHref(company.email)} />
        <CompanyDetail icon={Phone} label="Phone" value={company.mobile} href={phoneHref(company.mobile)} />
        <CompanyDetail icon={Globe2} label="Website" value={company.website} href={websiteHref} />
      </div>
    </div>
    <div className="company-about-card">
      <div className="company-about-card-heading"><span className="company-about-card-icon support"><LockKeyhole size={18} /></span><h2>{T('Support')}</h2></div>
      <div className="company-detail-list">
        <CompanyDetail icon={Mail} label="Support email" value={company.supportEmail} href={emailHref(company.supportEmail)} />
        <CompanyDetail icon={Phone} label="Support phone" value={company.supportMobile} href={phoneHref(company.supportMobile)} />
      </div>
    </div>
    <div className="more-demo-note"><Info size={15} /> {T('Blank company fields are intentionally shown as not configured; no contact information is guessed in this demo.')}</div>
  </section>;
}

export function AccountManagementPage({ onBack, onLogin, onOpenInfo }: {
  onBack: () => void;
  onLogin: () => void;
  onOpenInfo: (kind: MoreInfoKind) => void;
}) {
  const { T } = useI18n();
  return <section className="page-panel more-subpage-panel account-management-page">
    <MoreSubpageHeading eyebrow="ACCOUNT" title="Account Login" description="Access and account preferences." icon={LockKeyhole} onBack={onBack} />
    <div className="account-session-note"><span><LockKeyhole size={19} /></span><div><b>{T('Demo mode · no active session')}</b><small>{T('Authentication is not connected. No login or logout state is stored.')}</small></div></div>
    <div className="more-option-list account-option-list" aria-label={T('Account actions')}>
      <MoreOptionCard icon={LogIn} tone="employee" title="Login" description="Employee, supervisor or admin access" onClick={onLogin} />
      <button type="button" className="more-option-card disabled" disabled aria-disabled="true">
        <span className="more-option-icon account"><LogOut size={20} aria-hidden="true" /></span>
        <span className="more-option-copy"><b>{T('Logout')}</b><small>{T('No signed-in account to log out')}</small></span>
        <ChevronRight size={19} className="more-option-arrow" aria-hidden="true" />
      </button>
      <MoreOptionCard icon={KeyRound} tone="company" title="Change Password" description="Password changes require a connected account" onClick={() => onOpenInfo('change-password')} />
      <MoreOptionCard icon={Palette} tone="appearance" title="Account Settings" description="Review account-specific settings and preferences" onClick={() => onOpenInfo('account-settings')} />
    </div>
    <div className="more-demo-note"><Info size={15} /> {T('Login, logout and password services remain demo-only until secure authentication is configured.')}</div>
  </section>;
}

function AboutLink({ icon: Icon, title, description, url, onClick }: {
  icon: LucideIcon;
  title: string;
  description: string;
  url?: string | null;
  onClick: () => void;
}) {
  const { T } = useI18n();
  const href = safeExternalUrl(url);
  const content = <>
    <span className="more-option-icon about-app"><Icon size={19} aria-hidden="true" /></span>
    <span className="more-option-copy"><b>{T(title)}</b><small>{T(description)}</small></span>
    {href ? <ExternalLink size={16} className="more-option-arrow" aria-hidden="true" /> : <ChevronRight size={19} className="more-option-arrow" aria-hidden="true" />}
  </>;
  return href
    ? <a className="more-option-card" href={href} target="_blank" rel="noopener noreferrer">{content}</a>
    : <button type="button" className="more-option-card" onClick={onClick}>{content}</button>;
}

export function AboutAppPage({ company, onBack, onOpenInfo }: {
  company: TenantBranding;
  onBack: () => void;
  onOpenInfo: (kind: MoreInfoKind) => void;
}) {
  const { T } = useI18n();
  const appName = company.companyName.trim() || T('Company App');
  return <section className="page-panel more-subpage-panel about-app-page">
    <MoreSubpageHeading eyebrow="SAFETYOS · APP INFORMATION" title="About App" description="App identity, version and legal/support resources." icon={Info} onBack={onBack} />
    <div className="about-app-identity-card">
      <CompanyLogo company={company} className="about-app-logo" fallback="safex" />
      <div className="about-app-facts">
        <div><span>{T('App Name')}</span><b>{appName}</b></div>
        <div><span>{T('Version')}</span><b>{APP_VERSION}</b></div>
        <div><span>{T('Powered by')}</span><a href={SAFEX_WEBSITE_URL} target="_blank" rel="noopener noreferrer">Safex.com <ExternalLink size={13} /></a></div>
      </div>
    </div>
    <div className="about-app-section-heading"><span className="eyebrow">{T('INFORMATION & SUPPORT')}</span></div>
    <div className="more-option-list about-app-links">
      <AboutLink icon={FileText} title="Privacy Policy" description={company.privacyPolicyUrl ? 'Open the company privacy policy' : 'Not configured by Admin'} url={company.privacyPolicyUrl} onClick={() => onOpenInfo('privacy')} />
      <AboutLink icon={ShieldCheck} title="Terms & Conditions" description={company.termsAndConditionsUrl ? 'Open the company terms' : 'Not configured by Admin'} url={company.termsAndConditionsUrl} onClick={() => onOpenInfo('terms')} />
      <MoreOptionCard icon={Mail} tone="company" title="Contact Support" description="View company support contact information" onClick={() => onOpenInfo('support')} />
    </div>
  </section>;
}

export function InstallAppPage({ company, canInstall, installMessage, onInstall, onBack }: {
  company: TenantBranding;
  canInstall: boolean;
  installMessage: { key: string; params?: Record<string, string | number> } | null;
  onInstall: () => void;
  onBack: () => void;
}) {
  const { T } = useI18n();
  const appName = company.companyName.trim() || T('Company App');
  return <section className="page-panel more-subpage-panel narrow-panel install-app-page">
    <MoreSubpageHeading eyebrow="MORE · APP" title="Install App" description="Add your company’s safety app to this device." icon={Smartphone} onBack={onBack} />
    <div className="install-card install-company-card">
      <CompanyLogo company={company} className="install-company-logo" fallback="safex" />
      <span className="install-company-kicker">{T('COMPANY-BRANDED APP')}</span>
      <h2>{appName}</h2>
      <p>{T('The installed app name follows the Admin-configured Company Name.')}</p>
      <button className="primary-button install-button" onClick={onInstall}><Smartphone size={17} /> {T('Install {app}', { app: appName })}</button>
      {installMessage && <div className="inline-notice" role="status">{T(installMessage.key, installMessage.params)}</div>}
      {!installMessage && <div className="install-availability"><span className={`install-availability-dot ${canInstall ? 'available' : ''}`} />{canInstall ? T('One-tap installation is available in this browser.') : T('If no prompt appears, use your browser menu to install or add to the Home Screen.')}</div>}
    </div>
    <div className="company-logo-install-note"><Info size={16} /><span>{company.logoPath ? T('The PWA manifest uses the Admin-configured Company Logo.') : T('No Company Logo is configured in this demo tenant; the bundled Safex icon is used until Admin uploads one.')}</span></div>
    <div className="settings-card install-branding-note"><h2>{T('Install branding')}</h2><p>{T('The PWA manifest, browser title and install name use the configured Company Name. The manifest icon uses the configured Company Logo, with a Safex fallback when none is set. Production admin changes must be published to the tenant manifest before installation.')}</p></div>
  </section>;
}

export function MoreInfoDialog({ kind, company, onClose, onLogin }: {
  kind: MoreInfoKind;
  company: TenantBranding;
  onClose: () => void;
  onLogin: () => void;
}) {
  const { T } = useI18n();
  const title = kind === 'privacy' ? T('Privacy Policy')
    : kind === 'terms' ? T('Terms & Conditions')
      : kind === 'support' ? T('Contact Support')
        : kind === 'change-password' ? T('Change Password')
          : T('Account Settings');
  const hasSupport = Boolean(company.supportEmail?.trim() || company.supportMobile?.trim());
  return <div className="overlay more-info-overlay" role="dialog" aria-modal="true" aria-labelledby="more-info-title">
    <div className="modal more-info-modal">
      <div className="modal-header"><div><span className="eyebrow">{T('MORE · INFORMATION')}</span><h2 id="more-info-title">{title}</h2></div><button type="button" className="close-button" onClick={onClose} aria-label={T('Close {title}', { title })}><X size={18} /></button></div>
      {kind === 'privacy' && <div className="more-info-copy"><p>{T('An approved Privacy Policy has not been published for this demo tenant.')}</p><p>{T('Ask the company Admin to configure the policy URL before collecting or processing production employee information.')}</p></div>}
      {kind === 'terms' && <div className="more-info-copy"><p>{T('Terms & Conditions have not been published for this demo tenant.')}</p><p>{T('Ask the company Admin to configure the approved terms before production use.')}</p></div>}
      {kind === 'support' && <div className="more-info-copy"><p>{T('Support contacts for {company}:', { company: company.companyName || T('this company') })}</p>{hasSupport ? <div className="company-detail-list support-dialog-details">
        <CompanyDetail icon={Mail} label="Support email" value={company.supportEmail} href={emailHref(company.supportEmail)} />
        <CompanyDetail icon={Phone} label="Support phone" value={company.supportMobile} href={phoneHref(company.supportMobile)} />
      </div> : <div className="more-info-unconfigured">{T('Support email and phone have not been configured by Admin.')}</div>}</div>}
      {kind === 'change-password' && <div className="more-info-copy"><p>{T('Password changes are unavailable because authentication is not connected in this demo. No password was changed.')}</p><p>{T('Once account authentication is configured, use the verified account flow to change or recover a password.')}</p><button type="button" className="primary-button full-button more-info-primary" onClick={onLogin}><LogIn size={16} /> {T('Open Account Login')}</button></div>}
      {kind === 'account-settings' && <div className="more-info-copy"><p>{T('There is no signed-in account in this demo, so account-specific settings are unavailable.')}</p><p>{T('Appearance and notification preferences remain available locally. Secure account preferences require an authenticated server session.')}</p></div>}
      <div className="modal-footnote"><Info size={14} /> {T('Missing company policy and support details are not replaced with guessed content.')}</div>
    </div>
  </div>;
}
