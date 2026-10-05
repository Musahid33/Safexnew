'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, MapPin, Search, UserRound, X } from 'lucide-react';
import type { EmployeeDirectory } from '@/lib/employee-directory';
import type { Employee, Site } from '@/lib/types';
import { useI18n } from './I18nProvider';

type Props = { site: Site | null; directory: EmployeeDirectory; onClose: () => void };
type UiMessage = { key: string; params?: Record<string, string | number> };

export default function ProfileSearchDialog({ site, directory, onClose }: Props) {
  const { T } = useI18n();
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<Employee | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [searching, setSearching] = useState(false);
  const isMaster = directory.mode === 'master';

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = employeeId.trim().toUpperCase();
    setSearching(true);
    setProfileOpen(false);
    try {
      const match = await directory.findByEmployeeNo(site?.id ?? '', id);
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

  function searchAgain() {
    setProfileOpen(false);
    setResult(null);
    setEmployeeId('');
    setMessage(null);
  }

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-search-title"><div className="modal profile-search-modal">
    <div className="modal-header"><div><span className="eyebrow">{T(isMaster ? 'EMPLOYEE DIRECTORY' : 'EMPLOYEE DIRECTORY · DEMO')}</span><h2 id="profile-search-title">{profileOpen ? T('Employee Profile') : T('Search Employee Profile')}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={T('Close employee profile')}><X /></button></div>
    {!profileOpen ? <>
      <p>{site ? T('Search employees by Employee ID for the selected site: {site}.', { site: site.name }) : T('Search employees by Employee ID for the selected site.')}</p>
      <form className="profile-search-form" onSubmit={search}><label htmlFor="profile-search-code" className="field-label">{T('Employee ID')}</label><div className="search-box"><Search size={17} /><input id="profile-search-code" value={employeeId} onChange={(event) => { setEmployeeId(event.target.value.toUpperCase()); setResult(null); setMessage(null); }} placeholder={T(isMaster ? 'e.g. EMP001' : 'e.g. EMP-DEMO-01')} autoComplete="off" required /></div><button type="submit" className="primary-button full-button" disabled={searching}>{T(searching ? 'Searching…' : 'Search Employees')}</button></form>
      {message && <div className="inline-notice warning" role="status">{T(message.key, message.params)}</div>}
      {result && <button type="button" className="profile-search-result selectable" aria-label={T('Open profile for {name}', { name: result.name })} onClick={() => setProfileOpen(true)}><span className="profile-search-avatar">{result.name.slice(0, 1)}</span><span className="profile-search-result-copy"><span className="eyebrow">{T('EMPLOYEE FOUND · SELECT TO OPEN')}</span><b>{result.name}</b><small>{result.empNo} · {result.designation}</small></span><ChevronRight size={19} /></button>}
    </> : result && <div className="employee-profile-detail">
      <button type="button" className="text-button employee-profile-back" onClick={() => setProfileOpen(false)}><ArrowLeft size={15} />{T('Back to results')}</button>
      <div className="employee-profile-identity"><span className="profile-search-avatar"><UserRound size={23} /></span><div><span className="eyebrow">{T(isMaster ? 'EMPLOYEE PROFILE' : 'EMPLOYEE PROFILE · DEMO')}</span><h3>{result.name}</h3><p>{result.designation}</p></div></div>
      <dl className="employee-profile-fields"><div><dt>{T('Employee ID')}</dt><dd>{result.empNo}</dd></div><div><dt>{T('Designation')}</dt><dd>{result.designation}</dd></div><div><dt>{T('Site')}</dt><dd><MapPin size={14} />{site?.name ?? T('Selected site')}</dd></div></dl>
      <button type="button" className="secondary-button full-button" onClick={searchAgain}><Search size={16} />{T('Search another employee')}</button>
      <div className="modal-footnote">{T(isMaster ? 'Read-only record from the employee master. Editing and authenticated self-service are not connected yet.' : 'Synthetic directory record. Production employee profiles must be authenticated and tenant/site scoped.')}</div>
    </div>}
    {!profileOpen && <div className="modal-footnote">{T(isMaster ? 'Lookup runs on the server and is limited to the selected site. Only Employee ID, name and designation are returned.' : 'This public demo lookup displays only synthetic records. Production lookup must be server-side and tenant/site scoped.')}</div>}
  </div></div>;
}
