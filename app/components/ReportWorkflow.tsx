'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronRight, ImagePlus, LockKeyhole, MapPin, Mic, Search, Send, X } from 'lucide-react';
import type { Employee, Language, ReportType, Site } from '@/lib/types';
import LanguageStrip from './LanguageStrip';

type CategoryOption = { value: string; label: string; description: string; icon: string };
type Severity = 'Low' | 'Medium' | 'High';

export type ReportSubmission = {
  type: ReportType;
  category: string | null;
  area: string;
  department: string | null;
  incidentAt: string;
  description: string;
  immediateAction: string;
  severity: Severity | null;
  employee: Employee | null;
  anonymous: boolean;
  photoName: string | null;
  photo: File | null;
};

type Props = {
  type: ReportType;
  site: Site;
  employees: Employee[];
  language: Language;
  onLanguageChange: (language: Language) => void;
  voiceEnabled: boolean;
  syncEnabled: boolean;
  onClose: () => void;
  onSubmit: (data: ReportSubmission) => Promise<void> | void;
};

type SpeechResultLike = { 0?: { transcript?: string } };
type SpeechEventLike = { results: ArrayLike<SpeechResultLike> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

const CATEGORY_OPTIONS: Partial<Record<ReportType, CategoryOption[]>> = {
  Hazard: [
    { value: 'Reporting Accident', label: 'Reporting Accident', description: 'An incident or accident that needs to be recorded', icon: '⚠️' },
    { value: 'Property Damage', label: 'Property Damage', description: 'Damage to equipment, tools, or site property', icon: '🏗️' },
    { value: 'Red Risk Incident', label: 'Red Risk Incident', description: 'A high-potential or critical safety event', icon: '🔥' }
  ],
  'Safety Observation': [
    { value: 'Unsafe Condition', label: 'UC · Unsafe Condition', description: 'Report an unsafe condition observed at work', icon: '⚠️' },
    { value: 'Unsafe Act', label: 'UA · Unsafe Act', description: 'Report an unsafe act or behaviour observed', icon: '🚧' },
    { value: 'Safe Observation', label: 'Safe Observation · Good practice', description: 'Recognize a safe act or good safety practice', icon: '✅' }
  ],
  Feedback: [
    { value: 'PPE Feedback', label: 'PPE · Personal protective equipment', description: 'Fit, comfort, quality, or availability', icon: '👕' },
    { value: 'Tool Tackles', label: 'Tools, tackles & equipment', description: 'Condition, suitability, or availability', icon: '🔧' },
    { value: 'Training Feedback', label: 'Training feedback', description: 'Training content, delivery, or effectiveness', icon: '📚' },
    { value: 'Grievance Feedback', label: 'Grievance feedback', description: 'Feedback about an existing concern', icon: '😞' },
    { value: 'Amenities Welfare', label: 'Amenities & welfare', description: 'Canteen, facilities, or welfare services', icon: '🏢' },
    { value: 'Observation Closing', label: 'Observation closure', description: 'Feedback on an observation or incident closure', icon: '✅' }
  ],
  Grievance: [
    { value: 'Welfare', label: 'Welfare', description: 'Welfare services or support', icon: '💝' },
    { value: 'Amenities', label: 'Amenities', description: 'Facilities, canteen, water, or sanitation', icon: '🏢' },
    { value: 'Wages / Salary', label: 'Wages / salary', description: 'A concern about wages or salary', icon: '💰' },
    { value: 'Safety Concerns', label: 'Safety concerns', description: 'A workplace safety concern', icon: '🛡️' },
    { value: 'Workplace Issues', label: 'Workplace issues', description: 'A concern about work conditions', icon: '🏭' },
    { value: 'Other', label: 'Other', description: 'Another workplace concern', icon: '❓' }
  ],
  Suggestion: [
    { value: 'PPE Suggestion', label: 'PPE suggestion', description: 'Ideas to improve protective equipment', icon: '👕' },
    { value: 'Training Suggestion', label: 'Training suggestion', description: 'Ideas to improve training', icon: '📚' },
    { value: 'Tool Suggestion', label: 'Tools & equipment suggestion', description: 'Ideas to improve tools or equipment', icon: '🔧' }
  ]
};

const VOICE_LANG: Record<Language, string> = {
  en: 'en-IN', hi: 'hi-IN', or: 'or-IN', bn: 'bn-IN', pa: 'pa-IN', mr: 'mr-IN'
};

function localDateTime(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function descriptionConfig(type: ReportType, category: string | null): { label: string; placeholder: string } {
  if (type === 'Near Miss') return { label: '📝 Description of Incident', placeholder: 'Describe what happened clearly...' };
  if (type === 'Hazard') return { label: '⚠️ Description of Hazard', placeholder: 'Describe the hazard in detail...' };
  if (type === 'Unsafe Condition' || (type === 'Safety Observation' && category === 'Unsafe Condition')) return { label: '⚠️ Description of Unsafe Condition', placeholder: 'Describe the unsafe condition observed...' };
  if (type === 'Unsafe Act' || (type === 'Safety Observation' && category === 'Unsafe Act')) return { label: '⚠️ Description of Unsafe Act', placeholder: 'Describe the unsafe act or behaviour observed...' };
  if (type === 'Safety Observation' && category === 'Safe Observation') return { label: '📝 Description of Safe Observation', placeholder: 'Describe the safe practice or good behavior observed...' };
  if (type === 'Safety Observation') return { label: '📝 Description of Safety Observation', placeholder: 'Describe the safety practice or concern observed...' };
  if (type === 'Speak Up') return { label: '🎙️ Your Concern / Issue', placeholder: 'Speak up about your concern, issue, or suggestion...' };
  if (type === 'Feedback') {
    const labels: Record<string, { label: string; placeholder: string }> = {
      'PPE Feedback': { label: '👕 Feedback on PPE', placeholder: 'Share feedback on PPE quality, fit, comfort, or availability...' },
      'Tool Tackles': { label: '🔧 Feedback on Tools / Equipment', placeholder: 'Share feedback on tools, tackles, or equipment condition...' },
      'Training Feedback': { label: '📚 Training Feedback', placeholder: 'Share feedback on training content, delivery, or effectiveness...' },
      'Grievance Feedback': { label: '😞 Grievance Feedback', placeholder: 'Provide details about your feedback or complaint...' },
      'Amenities Welfare': { label: '🏢 Amenities & Welfare Feedback', placeholder: 'Share feedback on amenities, canteen, facilities, or welfare...' },
      'Observation Closing': { label: '✅ Observation Closing Feedback', placeholder: 'Share feedback on the closure of an observation or incident...' }
    };
    return labels[category ?? ''] ?? { label: '📝 Feedback', placeholder: 'Share your feedback...' };
  }
  if (type === 'Grievance') return { label: `😞 Description of ${category ?? 'Workplace'} Grievance`, placeholder: `Describe your ${(category ?? 'workplace').toLowerCase()} grievance in detail...` };
  if (type === 'Suggestion') {
    const labels: Record<string, { label: string; placeholder: string }> = {
      'PPE Suggestion': { label: '👕 PPE Suggestion', placeholder: 'Suggest improvements for PPE...' },
      'Training Suggestion': { label: '📚 Training Suggestion', placeholder: 'Suggest improvements for training programs...' },
      'Tool Suggestion': { label: '🔧 Tools / Equipment Suggestion', placeholder: 'Suggest improvements for tools or equipment...' }
    };
    return labels[category ?? ''] ?? { label: '💡 Suggestion', placeholder: 'Describe your suggestion...' };
  }
  return { label: '📝 Description', placeholder: 'Describe the details...' };
}

export default function ReportWorkflow({ type, site, employees, language, onLanguageChange, voiceEnabled, syncEnabled, onClose, onSubmit }: Props) {
  const categories = CATEGORY_OPTIONS[type] ?? [];
  const [screen, setScreen] = useState<'category' | 'form'>(categories.length ? 'category' : 'form');
  const [category, setCategory] = useState<string | null>(null);
  const canReportAnonymously = type === 'Speak Up';
  const [anonymous, setAnonymous] = useState(canReportAnonymously);
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [location, setLocation] = useState('');
  const [department, setDepartment] = useState('');
  const [incidentAt, setIncidentAt] = useState('');
  const [description, setDescription] = useState('');
  const [immediateAction, setImmediateAction] = useState('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const filteredEmployees = useMemo(() => {
    const query = employeeQuery.trim().toLowerCase();
    if (!query) return [];
    return employees.filter((item) => item.siteId === site.id && `${item.empNo} ${item.name} ${item.designation}`.toLowerCase().includes(query)).slice(0, 6);
  }, [employeeQuery, employees, site.id]);

  useEffect(() => {
    setIncidentAt(localDateTime());
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const isIncident = type === 'Near Miss' || type === 'Hazard' || type === 'Unsafe Condition' || type === 'Unsafe Act' || type === 'Safety Observation' || type === 'Speak Up';
  const showLocation = isIncident;
  const showDepartment = type === 'Near Miss' || type === 'Hazard';
  const departmentRequired = type === 'Near Miss';
  const showSeverity = type === 'Hazard';
  const descriptionMeta = descriptionConfig(type, category);
  const displayTitle = type === 'Unsafe Condition' ? 'UC · Unsafe Condition' : type === 'Unsafe Act' ? 'UA · Unsafe Act' : category && type === 'Grievance' ? `Grievance · ${category}` : category && type === 'Hazard' ? `Hazard · ${category}` : category && type === 'Feedback' ? `Feedback · ${category}` : category && type === 'Suggestion' ? `Suggestion · ${category}` : category && type === 'Safety Observation' ? `Safety Observation · ${category}` : type;

  function selectEmployee(match: Employee) {
    setEmployee(match);
    setEmployeeQuery(`${match.empNo} · ${match.name}`);
    setError('');
  }

  function toggleAnonymous() {
    if (!canReportAnonymously) return;
    setAnonymous((current) => {
      const next = !current;
      if (next) {
        setEmployee(null);
        setEmployeeQuery('');
      }
      return next;
    });
    setError('');
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhoto(null);
      event.target.value = '';
      setError('Choose a JPEG, PNG, or WebP image for photo evidence.');
      return;
    }
    if (file && file.size > 12 * 1024 * 1024) {
      setPhoto(null);
      event.target.value = '';
      setError('Photo cannot exceed 12 MB. Choose a smaller image.');
      return;
    }
    setPhoto(file);
    setError('');
  }

  function handleVoice() {
    if (voiceRecording) {
      recognitionRef.current?.stop();
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError('Voice typing is unavailable in this browser. You can still type your report.');
      return;
    }
    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = VOICE_LANG[language];
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setVoiceRecording(true);
      recognition.onend = () => setVoiceRecording(false);
      recognition.onerror = () => {
        setVoiceRecording(false);
        setError('Voice input stopped. Check microphone permission and try again.');
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0]?.[0]?.transcript?.trim();
        if (transcript) setDescription((current) => current ? `${current.trim()} ${transcript}` : transcript);
      };
      recognition.start();
    } catch {
      setVoiceRecording(false);
      setError('Microphone could not be started. You can still type your report.');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const reportIsAnonymous = canReportAnonymously && anonymous;
    if (categories.length && !category) {
      setScreen('category');
      setError('Choose a category to continue.');
      return;
    }
    if (!reportIsAnonymous && !employee) {
      setError('Search by employee number or name and select your matching profile.');
      return;
    }
    if (showLocation && !location.trim()) {
      setError('Enter the work area or location for this report.');
      return;
    }
    if (departmentRequired && !department.trim()) {
      setError('Department is required for a Near Miss report.');
      return;
    }
    if (!incidentAt) {
      setError('Select the incident date and time.');
      return;
    }
    if (description.trim().length < 8) {
      setError('Please enter at least 8 characters so the safety team can understand the report.');
      return;
    }
    if (showSeverity && !severity) {
      setError('Select a severity rating.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        type,
        category,
        area: location.trim(),
        department: department.trim() || null,
        incidentAt,
        description: description.trim(),
        immediateAction: immediateAction.trim(),
        severity: (severity || null) as Severity | null,
        employee: reportIsAnonymous ? null : employee,
        anonymous: reportIsAnonymous,
        photoName: photo?.name ?? null,
        photo
      });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'The report could not be saved on this device. Keep this form open and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="report-title">
    <div className={`modal report-modal report-workflow ${screen === 'category' ? 'category-screen' : ''}`}>
      <div className="modal-header report-workflow-header">
        <div className="workflow-heading">
          {screen === 'form' && categories.length > 0 && <button type="button" className="workflow-back" aria-label="Back to categories" onClick={() => { setScreen('category'); setError(''); }}><ArrowLeft size={17} /></button>}
          <div><span className="eyebrow">{site.name} · SAFETY REPORT</span><h2 id="report-title">{screen === 'category' ? `Select ${type} category` : displayTitle}</h2></div>
        </div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close report"><X /></button>
      </div>
      <LanguageStrip language={language} onChange={onLanguageChange} className="workflow-language-strip" />
      {screen === 'category' ? <div className="report-category-screen">
        <p className="category-intro">Choose the option that best describes your report. Your selection will tailor the form to the information needed.</p>
        <div className="report-category-options">
          {categories.map((option) => <button type="button" className="report-category-option" key={option.value} onClick={() => { setCategory(option.value); setScreen('form'); setError(''); }}>
            <span className="report-category-emoji" aria-hidden="true">{option.icon}</span><span className="report-category-copy"><b>{option.label}</b><small>{option.description}</small></span><ChevronRight size={18} />
          </button>)}
        </div>
        <button type="button" className="text-button category-back" onClick={onClose}>Cancel</button>
      </div> : <form className="report-workflow-form" onSubmit={handleSubmit}>
        <div className="site-context compact"><MapPin size={16} /><span>Filed under <b>{site.name}</b>{category && <> · <b>{category}</b></>}</span></div>

        {canReportAnonymously && <div className="anonymous-row report-anonymous-row"><div><b>🤫 Submit anonymously · गुमनाम रूप से सबमिट करें</b><small>Your name and Employee ID will be left blank and not linked to this report.</small></div><button className={`switch ${anonymous ? 'on' : ''}`} type="button" aria-pressed={anonymous} onClick={toggleAnonymous}><span /></button></div>}

        {!anonymous && <section className="report-identity-section" aria-label="Reporter identity">
          <label className="field-label" htmlFor="report-employee-lookup">👤 Your Name / Employee ID <span className="required">*</span></label>
          <div className="search-box employee-search-box"><Search size={17} /><input id="report-employee-lookup" value={employeeQuery} onChange={(event) => { setEmployeeQuery(event.target.value); setEmployee(null); setError(''); }} placeholder="Type your name or Employee ID" autoComplete="off" aria-autocomplete="list" aria-controls="report-employee-suggestions" /><span className="lookup-hint">Selected site only</span></div>
          {employeeQuery && !employee && <div className="suggestions" id="report-employee-suggestions" role="listbox">{filteredEmployees.length ? filteredEmployees.map((item) => <button type="button" role="option" aria-selected="false" key={item.id} onClick={() => selectEmployee(item)}><span className="avatar-mini">{item.name.slice(0, 1)}</span><span><b>{item.name}</b><small>{item.empNo} · {item.designation}</small></span><ChevronRight size={16} /></button>) : <div className="no-suggestion">No match at {site.name}. Check the spelling or use your Employee ID.</div>}</div>}
          {employee && <div className="auto-fields report-identity-fields"><label><small>Your Name</small><input className="identity-readonly" value={employee.name} readOnly /></label><label><small>Employee ID</small><input className="identity-readonly" value={employee.empNo} readOnly /></label><label className="wide"><small>Designation · auto-filled</small><input className="identity-readonly" value={employee.designation} readOnly /></label><button type="button" className="clear-employee" onClick={() => { setEmployee(null); setEmployeeQuery(''); }}>Change profile</button></div>}
          <small className="field-help">Select a suggestion to fill your name, Employee ID and designation. The lookup is limited to the selected site in this demo.</small>
        </section>}
        {anonymous && <div className="privacy-note report-privacy"><LockKeyhole size={15} /> Identity fields are hidden. The report is submitted without an employee link.</div>}

        <div className={`form-two-column ${showLocation && !showDepartment ? 'single-column' : ''}`}>
          {showLocation && <div><label className="field-label" htmlFor="report-location">📍 Location / area <span className="required">*</span></label><input id="report-location" className="form-control" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="E.g., Blast Furnace Site-4, Sheet Mill A" required /></div>}
          {showDepartment && <div><label className="field-label" htmlFor="report-department">🏢 Department {departmentRequired && <span className="required">*</span>}{!departmentRequired && <span className="optional">Optional</span>}</label><input id="report-department" className="form-control" value={department} onChange={(event) => setDepartment(event.target.value)} placeholder="E.g., Operations" required={departmentRequired} /></div>}
        </div>

        <label className="field-label" htmlFor="report-datetime">🕐 Date &amp; time of incident <span className="required">*</span></label><input id="report-datetime" className="form-control" type="datetime-local" value={incidentAt} onChange={(event) => setIncidentAt(event.target.value)} required />

        <label className="field-label" htmlFor="report-description">{descriptionMeta.label} <span className="required">*</span></label><div className="text-input-wrap"><textarea id="report-description" className="form-control" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={1200} placeholder={descriptionMeta.placeholder} required />{voiceEnabled && <button className={`mic-button ${voiceRecording ? 'recording' : ''}`} type="button" onClick={handleVoice} aria-label={voiceRecording ? 'Stop voice input' : 'Speak to fill description'} title={voiceRecording ? 'Stop voice input' : 'Speak to fill'}><Mic size={18} /></button>}</div>

        {showSeverity && <div className="severity-control"><label className="field-label" htmlFor="report-severity">⚠️ Severity rating <span className="required">*</span></label><select id="report-severity" className="form-control" value={severity} onChange={(event) => setSeverity(event.target.value as Severity | '')} required><option value="">Select severity</option><option value="Low">🟢 Low risk</option><option value="Medium">🟡 Medium risk</option><option value="High">🔴 High risk</option></select></div>}

        <label className="field-label" htmlFor="report-action">⚡ Immediate action taken <span className="optional">Optional</span></label><textarea id="report-action" className="form-control" value={immediateAction} onChange={(event) => setImmediateAction(event.target.value)} rows={2} maxLength={600} placeholder="Optional — what action was taken immediately?" />

        <label className="upload-button report-upload"><ImagePlus size={17} /><span>{photo?.name ?? 'Attach photo (optional)'}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoChange} /><small>Image only · maximum 12 MB</small></label>
        {photo && <div className="photo-file-row"><span><ImagePlus size={14} />{photo.name}</span><button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo">Remove</button></div>}

        {error && <div className="inline-notice warning" role="alert">{error}</div>}
        <div className="form-footer report-submit-footer"><span>{syncEnabled ? 'Saved on this device first · automatic database sync is enabled' : 'Saved on this device · database sync is not configured'}</span><button className="primary-button" type="submit" disabled={submitting}><Send size={16} /> {submitting ? 'Saving report…' : 'Save report'}</button></div>
        <div className="modal-footnote report-demo-note"><LockKeyhole size={14} /> Pending report details and any photo stay in this browser until sync succeeds. Avoid shared devices. Database delivery requires a configured Safex server.</div>
      </form>}
    </div>
  </div>;
}
