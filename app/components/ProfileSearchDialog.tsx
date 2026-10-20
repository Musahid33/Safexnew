'use client';

import { useState, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import type { EmployeeDirectory } from '@/lib/employee-directory';
import type { DirectoryUnavailableReason, Employee, Site } from '@/lib/types';
import { useI18n } from './I18nProvider';
import EmployeePassport from './EmployeePassport';

type Props = {
  site: Site | null;
  companyName?: string | null;
  directory: EmployeeDirectory;
  /** Which source answered, so a test never confuses "not found" with "wrong source". */
  directoryMode?: 'supabase' | 'sheet' | 'unavailable';
  /** Server-side cause when the directory is down; drives an actionable hint. */
  directoryReason?: DirectoryUnavailableReason | null;
  employeeCount?: number;
  onClose: () => void;
};

const SOURCE_LABEL: Record<'supabase' | 'sheet' | 'unavailable', string> = {
  supabase: 'Live Supabase directory',
  sheet: 'Employee master snapshot',
  unavailable: 'Directory unavailable'
};

/**
 * One sentence per real cause. "Keys are not configured" was misleading when the server
 * key existed but the database was unreachable, so each failure now names itself.
 */
const UNAVAILABLE_HINT: Record<DirectoryUnavailableReason, string> = {
  keys_missing: 'server-side Supabase keys are not configured on this deployment',
  database_unreachable: 'the server could not reach the employee database',
  tenant_unresolved: 'this deployment is not mapped to exactly one tenant',
  no_sites: 'the tenant has no active site configured',
  empty_directory: 'the tenant has no active employees loaded',
  snapshot_unreadable: 'the roster snapshot file could not be read'
};
type UiMessage = { key: string; params?: Record<string, string | number> };

export default function ProfileSearchDialog({ site, companyName, directory, directoryMode, directoryReason, employeeCount = 0, onClose }: Props) {
  const { T } = useI18n();
  const [employeeId, setEmployeeId] = useState('');
  const [result, setResult] = useState<Employee | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [searching, setSearching] = useState(false);
  // With no usable source, every search would end as "no profile was found", which reads
  // as a wrong Employee ID. Block the lookup and say what is actually wrong instead.
  const lookupUnavailable = directoryMode === 'unavailable';

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

  if (result) {
    return <EmployeePassport
      employee={result}
      site={site}
      companyName={companyName}
      onBack={() => { setResult(null); setEmployeeId(''); setMessage(null); }}
      onClose={onClose}
    />;
  }

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="profile-search-title"><div className="modal profile-search-modal">
    <div className="modal-header"><div><span className="eyebrow">{T('EMPLOYEE DIRECTORY')}</span><h2 id="profile-search-title">{T('Search Employee Profile')}</h2></div><button className="close-button" type="button" onClick={onClose} aria-label={T('Close employee profile')}><X /></button></div>
    <p>{site ? T('Search employees by Employee ID for the selected site: {site}.', { site: site.name }) : T('Search employees by Employee ID for the selected site.')}</p>
    <form className="profile-search-form" onSubmit={search}><label htmlFor="profile-search-code" className="field-label">{T('Employee ID')}</label><div className="search-box"><Search size={17} /><input id="profile-search-code" value={employeeId} onChange={(event) => { setEmployeeId(event.target.value.toUpperCase()); setMessage(null); }} placeholder={lookupUnavailable ? T('Employee master not connected') : T('Enter Employee ID')} autoComplete="off" required /></div><button type="submit" className="primary-button full-button" disabled={searching || lookupUnavailable}>{T(searching ? 'Searching…' : lookupUnavailable ? 'Search unavailable' : 'Search Employees')}</button></form>
    {message && <div className="inline-notice warning" role="status">{T(message.key, message.params)}</div>}
    {directoryMode && <div className={`directory-source ${directoryMode === 'unavailable' ? 'is-unavailable' : ''}`} role="status">
      <span className="directory-source-dot" aria-hidden="true" />
      <b>{SOURCE_LABEL[directoryMode]}</b>
      {directoryMode !== 'unavailable' && <span>· {employeeCount.toLocaleString('en-IN')} active employees at this site</span>}
      {directoryMode === 'unavailable' && <span>· {directoryReason ? UNAVAILABLE_HINT[directoryReason] : 'no employee source answered'}</span>}
    </div>}
    <div className="modal-footnote">{T('Lookup runs on the server and is limited to the selected site. The passport shows Employee ID, name, designation, department and skill grade; contact and health details are withheld.')}</div>
  </div></div>;
}
