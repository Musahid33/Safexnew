'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award, BriefcaseBusiness, Building2, CalendarDays, CheckCircle2, ChevronRight, Droplets,
  IdCard, ImagePlus, Loader2, Lock, Mail, MapPin, Phone, Plus, RotateCcw, Save,
  Search, ShieldAlert, ShieldCheck, Trash2, UserRound, Users, X
} from 'lucide-react';
import { compressPhoto } from './dm/photo';
import '../employee-passport.css';
import '../employee-admin.css';

/**
 * The admin console's Employee Passport.
 *
 * It is the screen a worker sees when they search an Employee ID on the public site — the
 * same credential sheet, same field order — with two differences that only make sense
 * behind a staff session: the personal fields are readable, and they are editable.
 *
 * The roster list stays light (no photo, no card per row); a person's full record, face
 * included, is fetched only when they are opened. Saves go to the API one employee at a
 * time and the screen shows the server's answer rather than assuming it worked.
 */

type EmployeeProfile = {
  empNo: string;
  name: string;
  designation: string;
  department: string | null;
  siteId: string;
  skillGrade: string | null;
  location: string | null;
  active?: boolean;
  safetyPassNo?: string | null;
  bloodGroup?: string | null;
  mobile?: string | null;
  email?: string | null;
  gender?: string | null;
  dob?: string | null;
  emergencyName?: string | null;
  emergencyMobile?: string | null;
  address?: string | null;
  notes?: string | null;
  photo?: string | null;
  photoAvailable?: boolean;
};

type Draft = {
  employeeNo: string;
  name: string;
  designation: string;
  department: string;
  mobile: string;
  email: string;
  gender: string;
  dob: string;
  bloodGroup: string;
  emergencyName: string;
  emergencyMobile: string;
  location: string;
  address: string;
  notes: string;
};

type Mode = 'idle' | 'view' | 'edit' | 'create';

const BLANK: Draft = {
  employeeNo: '', name: '', designation: '', department: '', mobile: '', email: '', gender: '',
  dob: '', bloodGroup: '', emergencyName: '', emergencyMobile: '', location: '', address: '', notes: ''
};

const GENDERS = ['', 'Female', 'Male', 'Other', 'Prefer not to say'];
const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function draftOf(employee: EmployeeProfile): Draft {
  return {
    employeeNo: employee.empNo,
    name: employee.name,
    designation: employee.designation ?? '',
    department: employee.department ?? '',
    mobile: employee.mobile ?? '',
    email: employee.email ?? '',
    gender: employee.gender ?? '',
    dob: employee.dob ?? '',
    bloodGroup: employee.bloodGroup ?? '',
    emergencyName: employee.emergencyName ?? '',
    emergencyMobile: employee.emergencyMobile ?? '',
    location: employee.location ?? '',
    address: employee.address ?? '',
    notes: employee.notes ?? ''
  };
}

/** Only what the operator actually changed, so a save never blanks a field it did not show. */
function patchOf(draft: Draft, original: Draft | null, photo: { changed: boolean; value: string }) {
  const fields: Record<string, string | null> = {};
  const keys = Object.keys(BLANK) as (keyof Draft)[];
  for (const key of keys) {
    if (key === 'employeeNo') continue;
    if (original) {
      // Editing: a touched field is written, an untouched one is left exactly as stored.
      if (draft[key] === original[key]) continue;
      fields[key] = draft[key].trim() || null;
    } else if (draft[key].trim()) {
      // Creating: an empty box is a column the database already defaults, not a null to send.
      fields[key] = draft[key].trim();
    }
  }
  if (!original && draft.employeeNo.trim()) fields.employeeNo = draft.employeeNo.trim();
  if (photo.changed) fields.photo = photo.value || null;
  return fields;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'SA';
}

export default function EmployeePassportAdmin({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EmployeeProfile[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [searching, setSearching] = useState(true);
  const [selected, setSelected] = useState<EmployeeProfile | null>(null);
  const [loadingPerson, setLoadingPerson] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [original, setOriginal] = useState<Draft | null>(null);
  const [photo, setPhoto] = useState<{ changed: boolean; value: string }>({ changed: false, value: '' });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [photoAvailable, setPhotoAvailable] = useState(true);
  const [piiIncluded, setPiiIncluded] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const firstLoad = useRef(true);

  const siteParam = siteId && siteId !== 'all' ? siteId : '';

  const load = useCallback(async (needle: string) => {
    setSearching(true);
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (siteParam) params.set('siteId', siteParam);
      if (needle.trim().length >= 2) params.set('q', needle.trim());
      const response = await fetch(`/api/admin/employees?${params.toString()}`, { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'The employee master could not be read.');
        setResults([]);
        return;
      }
      setError('');
      setResults(data.employees as EmployeeProfile[]);
      setTotal(typeof data.total === 'number' ? data.total : null);
      // The roster already knows whether personal fields are released; read it here too so
      // the "New employee" form is locked the moment it opens, not after a failed save.
      if (typeof data.piiIncluded === 'boolean') setPiiIncluded(data.piiIncluded);
    } catch {
      setError('The employee master could not be reached.');
    } finally {
      setSearching(false);
    }
  }, [siteParam]);

  // First page on mount, then a short debounce while the operator types.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      void load('');
      return;
    }
    const timer = window.setTimeout(() => void load(query), 260);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const open = useCallback(async (employeeNo: string) => {
    setLoadingPerson(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/employees/${encodeURIComponent(employeeNo)}`, { credentials: 'same-origin' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'That employee could not be opened.');
        return;
      }
      const employee = data.employee as EmployeeProfile;
      setSelected(employee);
      setPhotoAvailable(employee.photoAvailable !== false);
      setPiiIncluded(data.piiIncluded !== false);
      if (typeof data.companyName === 'string') setCompanyName(data.companyName);
      setMode('view');
      setPhoto({ changed: false, value: employee.photo ?? '' });
      setPhotoError('');
    } catch {
      setError('The employee record could not be reached.');
    } finally {
      setLoadingPerson(false);
    }
  }, []);

  const startEdit = () => {
    if (!selected) return;
    const next = draftOf(selected);
    setDraft(next);
    setOriginal(next);
    setPhoto({ changed: false, value: selected.photo ?? '' });
    setPhotoError('');
    setError('');
    setMode('edit');
  };

  const startCreate = () => {
    setSelected(null);
    setDraft(BLANK);
    setOriginal(null);
    setPhoto({ changed: false, value: '' });
    setPhotoError('');
    setError('');
    setMode('create');
  };

  const cancel = () => {
    setDraft(BLANK);
    setOriginal(null);
    setPhoto({ changed: false, value: selected?.photo ?? '' });
    setPhotoError('');
    setError('');
    setMode(selected ? 'view' : 'idle');
  };

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError('');
    setPhotoBusy(true);
    try {
      const dataUrl = await compressPhoto(file);
      setPhoto({ changed: true, value: dataUrl });
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : 'That photo could not be read.');
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function save() {
    if (saving) return;
    if (!draft.name.trim()) {
      setError('Employee ka naam zaroori hai.');
      return;
    }
    if (mode === 'create' && !draft.employeeNo.trim()) {
      setError('Employee number zaroori hai.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const fields = patchOf(draft, original, photo);
      if (Object.keys(fields).length === 0) {
        setNotice('Kuch bhi nahi badla — pehle koi field edit karein.');
        setMode(selected ? 'view' : 'create');
        setSaving(false);
        return;
      }

      const creating = mode === 'create';
      const response = await fetch(
        creating ? '/api/admin/employees' : `/api/admin/employees/${encodeURIComponent(original?.employeeNo ?? draft.employeeNo)}`,
        {
          method: creating ? 'POST' : 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creating
            ? { siteId: siteParam, fields: { ...fields, employeeNo: draft.employeeNo.trim() } }
            : { fields })
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? `The record could not be ${creating ? 'created' : 'saved'}.`);
        return;
      }

      const employeeNo = String(data.employeeNo ?? draft.employeeNo);
      setNotice(data.photoSaved === false
        ? 'Details saved. Photo save nahi hua — employee photo migration abhi apply nahi hai.'
        : creating ? 'Naya employee profile ban gaya.' : 'Profile update ho gaya.');
      await load(query);
      await open(employeeNo);
    } catch {
      setError('The server could not be reached.');
    } finally {
      setSaving(false);
    }
  }

  async function deactivate() {
    if (!selected) return;
    const ok = window.confirm(`${selected.name} (${selected.empNo}) ko roster se hata dein? History safe rahegi.`);
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/employees/${encodeURIComponent(selected.empNo)}`, {
        method: 'DELETE', credentials: 'same-origin'
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? 'The employee could not be removed.');
        return;
      }
      setSelected(null);
      setMode('idle');
      setNotice(`${selected.name} roster se hata diya (history safe hai).`);
      await load(query);
    } catch {
      setError('The server could not be reached.');
    } finally {
      setSaving(false);
    }
  }

  // The frontend passport's own 13 rows, in its order and with its wording. The difference
  // is the value: staff access means the row shows the number instead of "restricted".
  const detailRows = useMemo(() => {
    if (!selected) return [];
    return [
      { label: 'Full Name', value: selected.name, icon: UserRound },
      { label: 'Employee ID', value: selected.empNo, icon: IdCard },
      { label: 'Safety Pass Validity', value: 'Not on record', icon: CalendarDays, missing: true },
      { label: 'Designation', value: selected.designation, icon: BriefcaseBusiness, missing: !selected.designation },
      { label: 'Department', value: selected.department ?? '', icon: Building2, missing: !selected.department },
      { label: 'Blood Group', value: selected.bloodGroup ?? '', icon: Droplets, missing: !selected.bloodGroup },
      { label: 'Skill Grade', value: selected.skillGrade ?? '', icon: Award, missing: !selected.skillGrade },
      { label: 'Mobile No.', value: selected.mobile ?? '', icon: Phone, missing: !selected.mobile },
      { label: 'Email ID', value: selected.email ?? '', icon: Mail, missing: !selected.email },
      { label: 'Company', value: companyName, icon: Building2, missing: !companyName },
      { label: 'Site / Location', value: selected.location || siteName, icon: MapPin, missing: false },
      { label: 'Address', value: selected.address ?? '', icon: MapPin, missing: !selected.address },
      { label: 'Joining Date', value: 'Not on record', icon: CalendarDays, missing: true }
    ];
  }, [selected, siteName, companyName]);

  const heading = mode === 'create'
    ? 'New employee profile'
    : mode === 'edit' ? `Edit ${selected?.name ?? 'employee'}` : 'Employee passport';

  return <div className="epa">
    <header className="epa-head">
      <div>
        <span className="epa-eyebrow">SAFETY PASSPORT · STAFF ACCESS</span>
        <h2>{heading}</h2>
        <p>
          Search a person, open the same passport the worker app shows, and correct their photo,
          personal and contact details from here.
        </p>
      </div>
      <button type="button" className="epa-primary" onClick={startCreate}>
        <Plus size={16} /> New employee
      </button>
    </header>

    {!piiIncluded && <p className="epa-warn" role="status">
      <ShieldAlert size={15} />
      <span>
        Personal fields (mobile, email, DOB, blood group, emergency contact, address, notes)
        is deployment par band hain. Vercel me <code>SAFEX_ADMIN_PII_ENABLED=true</code> set
        karke redeploy karein — tab ye sab edit honge. Naam, designation, department,
        location aur photo abhi bhi save honge.
      </span>
    </p>}
    {notice && <p className="epa-notice" role="status"><CheckCircle2 size={15} /> {notice}</p>}
    {error && <p className="epa-error" role="alert"><ShieldAlert size={15} /> {error}</p>}

    <div className="epa-grid">
      <aside className="epa-list" aria-label="Employee directory">
        <label className="epa-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Employee no. ya naam"
            aria-label="Search employees"
            autoComplete="off"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <p className="epa-count">
          {searching ? <><Loader2 size={12} className="epa-spin" /> Loading…</> : `${results.length}${total !== null ? ` of ${total}` : ''} on file`}
        </p>

        <ul className="epa-people">
          {!searching && results.length === 0 && <li className="epa-empty-row">Koi employee nahi mila.</li>}
          {results.map((employee) => <li key={employee.empNo}>
            <button
              type="button"
              className={`epa-person${selected?.empNo === employee.empNo ? ' is-active' : ''}`}
              onClick={() => void open(employee.empNo)}
            >
              <span className="epa-person-avatar">{initials(employee.name)}</span>
              <span className="epa-person-copy">
                <strong>{employee.name}</strong>
                <small>{employee.empNo}{employee.designation ? ` · ${employee.designation}` : ''}</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </li>)}
        </ul>
      </aside>

      <section className="epa-sheet" aria-live="polite">
        {loadingPerson && <p className="epa-loading"><Loader2 size={16} className="epa-spin" /> Opening the record…</p>}

        {!loadingPerson && mode === 'idle' && <div className="epa-placeholder">
          <span className="epa-placeholder-icon"><Users size={26} /></span>
          <strong>Select an employee</strong>
          <p>Left side se koi employee chuno — passport khulega aur wahin se edit hoga. Ya “New employee” se naya profile banao.</p>
        </div>}

        {!loadingPerson && (mode === 'view' || mode === 'edit') && selected && <>
          <article className="pp-card pp-profile epa-profile">
            <div className={`pp-avatar${selected.active === false ? ' is-inactive' : ''}`}>
              {photo.value
                ? /* eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a Next image */
                  <img src={photo.value} alt={`${selected.name} photograph`} />
                : <span>{initials(selected.name)}</span>}
            </div>
            <div className="pp-profile-copy">
              <span className={`pp-chip ${selected.active === false ? 'inactive' : 'active'}`}>
                {selected.active === false ? <ShieldAlert size={12} /> : <CheckCircle2 size={12} />}
                {selected.active === false ? 'Inactive' : 'Active'}
              </span>
              <h2>{selected.name}</h2>
              <p className="pp-empno">EMP ID : <strong>{selected.empNo}</strong></p>
              <p className="epa-sub">
                {selected.designation || 'Designation not on record'}
                {selected.department ? ` · ${selected.department}` : ''}
                {selected.location || siteName ? ` · ${selected.location || siteName}` : ''}
              </p>
            </div>
            <div className="epa-profile-actions">
              {mode === 'view'
                ? <button type="button" className="epa-primary" onClick={startEdit}><Save size={15} /> Edit profile</button>
                : <>
                  <button type="button" className="epa-primary" onClick={() => void save()} disabled={saving}>
                    {saving ? <><Loader2 size={15} className="epa-spin" /> Saving…</> : <><Save size={15} /> Save changes</>}
                  </button>
                  <button type="button" className="epa-ghost" onClick={cancel} disabled={saving}><RotateCcw size={15} /> Cancel</button>
                </>}
            </div>
          </article>

          {mode === 'edit' && <section className="pp-card epa-card">
            <div className="pp-card-head">
              <span className="pp-head-icon blue"><ImagePlus size={17} /></span>
              <div className="pp-head-copy">
                <h3>Employee photo</h3>
                <p>Camera ya gallery se — ek hi button, browser apna sheet dikhayega.</p>
              </div>
              <span className="pp-head-note">{photo.value ? 'On record' : 'Not on record'}</span>
            </div>
            <div className="epa-photo">
              <div className="epa-photo-preview">
                {photo.value
                  ? /* eslint-disable-next-line @next/next/no-img-element -- a data URL preview */
                    <img src={photo.value} alt="Employee photograph" />
                  : <span>{initials(selected.name)}</span>}
              </div>
              <div className="epa-photo-actions">
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  className="epa-photo-input"
                  onChange={(event) => void pickPhoto(event.target.files?.[0])}
                />
                <button
                  type="button"
                  className="epa-ghost"
                  onClick={() => fileInput.current?.click()}
                  disabled={photoBusy}
                >{photoBusy ? 'Reading…' : photo.value ? 'Change photo' : 'Add photo'}</button>
                {photo.value && <button
                  type="button"
                  className="epa-ghost is-danger"
                  onClick={() => setPhoto({ changed: true, value: '' })}
                  disabled={photoBusy}
                >Remove</button>}
                <small>{photoAvailable ? 'Browser me 1000 px tak resize hoti hai, phir save.' : 'Photo column abhi database me nahi — migration apply karein.'}</small>
              </div>
            </div>
            {photoError && <p className="epa-error" role="alert">{photoError}</p>}
          </section>}

          {mode === 'view'
            ? <section className="pp-card epa-card">
              <div className="pp-card-head">
                <span className="pp-head-icon blue"><UserRound size={17} /></span>
                <div className="pp-head-copy">
                  <h3>Personal &amp; contact details</h3>
                  <p>Staff access — the public passport withholds these.</p>
                </div>
                <span className="pp-head-note"><ShieldCheck size={12} /> Staff only</span>
              </div>
              <dl className="ppa-details">
                {detailRows.map(({ label, value, icon: Icon, missing }) => <div key={label}>
                  <dt><Icon size={14} aria-hidden="true" />{label}</dt>
                  <dd className={missing ? 'is-missing' : undefined}>
                    {!value && !piiIncluded && <Lock size={10} aria-hidden="true" />}
                    {value || (piiIncluded ? 'Not on record' : 'Restricted')}
                  </dd>
                </div>)}
              </dl>
              <div className="epa-danger-row">
                <button type="button" className="epa-ghost is-danger" onClick={() => void deactivate()} disabled={saving}>
                  <Trash2 size={15} /> Remove from roster
                </button>
                <small>History (reports, DM, training) bani rahegi — record sirf inactive hota hai.</small>
              </div>
            </section>
            : <EmployeeForm
              draft={draft}
              mode={mode}
              pii={piiIncluded}
              onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
              onSubmit={() => void save()}
              onCancel={cancel}
              saving={saving}
            />}
        </>}

        {!loadingPerson && mode === 'create' && <>
          <article className="pp-card pp-profile epa-profile">
            <div className="pp-avatar"><span>{draft.name ? initials(draft.name) : 'NEW'}</span></div>
            <div className="pp-profile-copy">
              <span className="pp-chip active"><Plus size={12} /> New record</span>
              <h2>{draft.name || 'New employee'}</h2>
              <p className="pp-empno">EMP ID : <strong>{draft.employeeNo || '—'}</strong></p>
              <p className="epa-sub">Naya profile seedha is site ({siteName}) ke roster me judega.</p>
            </div>
            <div className="epa-profile-actions">
              <button type="button" className="epa-primary" onClick={() => void save()} disabled={saving}>
                {saving ? <><Loader2 size={15} className="epa-spin" /> Creating…</> : <><Save size={15} /> Create profile</>}
              </button>
              <button type="button" className="epa-ghost" onClick={cancel} disabled={saving}><X size={15} /> Cancel</button>
            </div>
          </article>
          <EmployeeForm
            draft={draft}
            mode={mode}
            pii={piiIncluded}
            onChange={(key, value) => setDraft((current) => ({ ...current, [key]: value }))}
            onSubmit={() => void save()}
            onCancel={cancel}
            saving={saving}
          />
        </>}
      </section>
    </div>
  </div>;
}
/** The editable half: every field the passport shows, minus the ones the server owns. */
function EmployeeForm({
  draft, mode, pii, onChange, onSubmit, onCancel, saving
}: {
  draft: Draft;
  mode: Mode;
  pii: boolean;
  onChange: (key: keyof Draft, value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  // Locked rather than hidden: the operator can see the shape of the record and why a
  // personal box is refusing input, instead of typing into it and being rejected on save.
  const personal = pii ? {} : { disabled: true, placeholder: 'PII release off' };
  return <section className="pp-card epa-card">
    <div className="pp-card-head">
      <span className="pp-head-icon blue"><IdCard size={17} /></span>
      <div className="pp-head-copy">
        <h3>Identity &amp; contact</h3>
        <p>{mode === 'create' ? 'Employee number aur naam zaroori hain.' : 'Jo field chhodi, wahi waise hi rahegi.'}</p>
      </div>
    </div>

    <form className="epa-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="epa-fields">
        <label className="epa-field">
          <span>Employee no. *</span>
          <input
            value={draft.employeeNo}
            onChange={(event) => onChange('employeeNo', event.target.value.toUpperCase())}
            maxLength={32}
            placeholder="e.g. EIPL-1042"
            disabled={mode === 'edit'}
            autoComplete="off"
            required
          />
          {mode === 'edit' && <small>Number badalna ho to naya profile banayein; purani history isi number se judi hai.</small>}
        </label>
        <label className="epa-field">
          <span>Full name *</span>
          <input
            value={draft.name}
            onChange={(event) => onChange('name', event.target.value)}
            maxLength={120}
            placeholder="Employee name"
            autoComplete="name"
            required
          />
        </label>
        <label className="epa-field">
          <span>Designation</span>
          <input value={draft.designation} onChange={(event) => onChange('designation', event.target.value)} maxLength={120} placeholder="Job title" />
        </label>
        <label className="epa-field">
          <span>Department</span>
          <input value={draft.department} onChange={(event) => onChange('department', event.target.value)} maxLength={120} placeholder="Department / team" />
        </label>
        <label className="epa-field">
          <span>Mobile number</span>
          <input
            type="tel"
            value={draft.mobile}
            onChange={(event) => onChange('mobile', event.target.value)}
            maxLength={20}
            placeholder="+91 98765 43210"
            autoComplete="tel"
            {...personal}
          />
        </label>
        <label className="epa-field">
          <span>Email</span>
          <input
            type="email"
            value={draft.email}
            onChange={(event) => onChange('email', event.target.value)}
            maxLength={160}
            placeholder="name@example.com"
            autoComplete="email"
            {...personal}
          />
        </label>
        <label className="epa-field">
          <span>Gender</span>
          <select value={draft.gender} onChange={(event) => onChange('gender', event.target.value)} {...personal}>
            {GENDERS.map((gender) => <option key={gender} value={gender}>{gender || 'Not specified'}</option>)}
          </select>
        </label>
        <label className="epa-field">
          <span>Date of birth</span>
          <input type="date" value={draft.dob} onChange={(event) => onChange('dob', event.target.value)} {...personal} />
        </label>
        <label className="epa-field">
          <span>Blood group</span>
          <select value={draft.bloodGroup} onChange={(event) => onChange('bloodGroup', event.target.value)} {...personal}>
            {BLOOD_GROUPS.map((group) => <option key={group} value={group}>{group || 'Not specified'}</option>)}
          </select>
        </label>
        <label className="epa-field">
          <span>Emergency contact</span>
          <input value={draft.emergencyName} onChange={(event) => onChange('emergencyName', event.target.value)} maxLength={120} placeholder="Contact person" {...personal} />
        </label>
        <label className="epa-field">
          <span>Emergency mobile</span>
          <input type="tel" value={draft.emergencyMobile} onChange={(event) => onChange('emergencyMobile', event.target.value)} maxLength={20} placeholder="Contact number" {...personal} />
        </label>
        <label className="epa-field">
          <span>Site / work location</span>
          <input value={draft.location} onChange={(event) => onChange('location', event.target.value)} maxLength={120} placeholder="Area / department" />
        </label>
        <label className="epa-field is-wide">
          <span>Address</span>
          <textarea rows={2} value={draft.address} onChange={(event) => onChange('address', event.target.value)} maxLength={240} placeholder="Address or other relevant personal details" {...personal} />
        </label>
        <label className="epa-field is-wide">
          <span>Notes</span>
          <textarea rows={2} value={draft.notes} onChange={(event) => onChange('notes', event.target.value)} maxLength={2000} placeholder="Optional profile notes" {...personal} />
        </label>
      </div>

      <div className="epa-form-actions">
        <button type="button" className="epa-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="epa-primary" disabled={saving}>
          {saving ? <><Loader2 size={15} className="epa-spin" /> Saving…</> : <><Save size={15} /> {mode === 'create' ? 'Create profile' : 'Save changes'}</>}
        </button>
      </div>
    </form>
  </section>;
}
