'use client';

import { useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { EmployeeDirectory } from '@/lib/employee-directory';
import type { Employee, Site } from '@/lib/types';
import { useI18n } from './I18nProvider';
import EmployeePassport from './EmployeePassport';

type Props = { site: Site | null; directory: EmployeeDirectory; onClose: () => void };
type UiMessage = { key: string; params?: Record<string, string | number> };

export default function ProfileSearchDialog({ site, directory, onClose }: Props) {
  const { T } = useI18n();
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<Employee | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = employeeId.trim().toUpperCase();
    if (!id || searching) return;
    setSearching(true);
    setMessage(null);
    try {
      const match = await directory.findByEmployeeNo(site?.id ?? '', id);
      // Go straight to the passport after an exact, site-scoped Employee ID match.
      setResult(match);
      setMessage(match ? null : site
        ? { key: 'No profile was found for {id} at {site}. Check the Employee ID and try again.', params: { id, site: site.name } }
        : { key: 'No profile was found for {id}. Check the Employee ID and try again.', params: { id } });
    } catch {
      setResult(null);
      setMessage({ key: 'The employee directory is unavailable right now. Try again in a moment.' });
    } finally {
      setSearching(false);
    }
  }

  if (result) return <EmployeePassport employee={result} site={site} onBack={() => { setResult(null); setEmployeeId(''); setMessage(null); }} onClose={onClose} />;

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-search-title"><div className="modal profile-search-modal">
    <div className="modal-header"><div><span className="eyebrow">{T('EMPLOYEE DIRECTORY')}</span><h2 id="profile-search-title">{T('Search Employee Profile')}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={T('Close employee profile')}><X /></button></div>
    <p>{site ? T('Search employees by Employee ID for the selected site: {site}.', { site: site.name }) : T('Search employees by Employee ID for the selected site.')}</p>
    <form className="profile-search-form" onSubmit={search}><label htmlFor="profile-search-code" className="field-label">{T('Employee ID')}</label><div className="search-box"><Search size={17} /><input id="profile-search-code" value={employeeId} onChange={(event) => { setEmployeeId(event.target.value.toUpperCase()); setMessage(null); }} placeholder={T('Enter Employee ID')} autoComplete="off" required /></div><button type="submit" className="primary-button full-button" disabled={searching}>{T(searching ? 'Searching…' : 'Search Employees')}</button></form>
    {message && <div className="inline-notice warning" role="status">{T(message.key, message.params)}</div>}
    <div className="modal-footnote">{T('Lookup runs on the server and is limited to the selected site. Only Employee ID, name and designation are returned.')}</div>
  </div></div>;
}
