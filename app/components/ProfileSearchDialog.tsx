'use client';

import { useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { Employee, Site } from '@/lib/types';

type Props = { site: Site | null; employees: Employee[]; onClose: () => void };

export default function ProfileSearchDialog({ site, employees, onClose }: Props) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [result, setResult] = useState<Employee | null>(null);
  const [message, setMessage] = useState('');

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = employeeCode.trim().toUpperCase();
    const match = employees.find((employee) => employee.empNo.toUpperCase() === code && (!site || employee.siteId === site.id));
    setResult(match ?? null);
    setMessage(match ? '' : `No profile was found for ${code}${site ? ` at ${site.name}` : ''}. Check the Employee Code and try again.`);
  }

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-search-title"><div className="modal profile-search-modal">
    <div className="modal-header"><div><span className="eyebrow">EMPLOYEE DIRECTORY · DEMO</span><h2 id="profile-search-title">Search Worker Profile</h2></div><button className="close-button" type="button" onClick={onClose} aria-label="Close profile search"><X /></button></div>
    <p>Enter an Employee Code to find the demo worker profile for the selected site{site ? `, ${site.name}` : ''}.</p>
    <form className="profile-search-form" onSubmit={search}><label htmlFor="profile-search-code" className="field-label">Employee Code / ID</label><div className="search-box"><Search size={17} /><input id="profile-search-code" value={employeeCode} onChange={(event) => { setEmployeeCode(event.target.value.toUpperCase()); setResult(null); setMessage(''); }} placeholder="e.g. EMP-DEMO-01" autoComplete="off" required /></div><button type="submit" className="primary-button full-button">Search</button></form>
    {message && <div className="inline-notice warning" role="status">{message}</div>}
    {result && <div className="profile-search-result" aria-live="polite"><div className="profile-search-avatar">{result.name.slice(0, 1)}</div><div><span className="eyebrow">PROFILE FOUND</span><h3>{result.name}</h3><p>{result.empNo} · {result.designation}</p><small>{site?.name ?? 'Site-specific demo profile'}</small></div></div>}
    <div className="modal-footnote">This public demo lookup displays only synthetic records. Production lookup must be server-side and tenant/site scoped.</div>
  </div></div>;
}
