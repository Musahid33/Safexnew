'use client';

import { useState, type FormEvent } from 'react';
import { BookOpen, CheckCircle2, Clock3, FileText, PlayCircle, X } from 'lucide-react';
import type { EmployeeDirectory } from '@/lib/employee-directory';
import type { Employee, Site } from '@/lib/types';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { useI18n } from './I18nProvider';

type Props = { site: Site | null; directory: EmployeeDirectory };
type Material = { title: string; description: string; type: 'Video' | 'Module'; durationMinutes?: number };
type TrainingCheck = { employee: Employee; completed: string[]; pending: string[]; hasRecords: boolean };
type UiMessage = { key: string; params?: Record<string, string | number> };

const TRAINING_VIDEOS: Material[] = [
  { title: 'Safety Fundamentals · Part 1', description: 'Core workplace safety and hazard awareness.', type: 'Video', durationMinutes: 12 },
  { title: 'PPE Usage & Care', description: 'Select, inspect and care for personal protective equipment.', type: 'Video', durationMinutes: 8 },
  { title: 'Hazard Identification', description: 'Recognize unsafe conditions and report them promptly.', type: 'Video', durationMinutes: 15 }
];

const TRAINING_MODULES: Material[] = [
  { title: 'Life Saving Rules', description: 'Key rules designed to prevent serious injury.', type: 'Module' },
  { title: 'Working at Height', description: 'Fall prevention, permits and approved protection.', type: 'Module' },
  { title: 'Hazard Identification Guide', description: 'Identify unsafe conditions, unsafe acts and controls.', type: 'Module' }
];

const COMPLETED_BY_DEMO_EMPLOYEE: Record<string, string[]> = {
  'demo-e1': ['Safety Fundamentals · Part 1', 'PPE Usage & Care'],
  'demo-e2': ['Safety Fundamentals · Part 1'],
  'demo-e3': ['PPE Usage & Care', 'Hazard Identification'],
  'demo-e4': []
};

const ALL_TOPICS = [...TRAINING_VIDEOS.map((item) => item.title), ...TRAINING_MODULES.map((item) => item.title)];

export default function TrainingPortal({ site, directory }: Props) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const [employeeCode, setEmployeeCode] = useState('');
  const [check, setCheck] = useState<TrainingCheck | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [checking, setChecking] = useState(false);
  const isMaster = directory.mode === 'master';

  async function checkTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = employeeCode.trim().toUpperCase();
    if (!code) {
      setMessage({ key: 'Enter your Employee Code to check training.' });
      setCheck(null);
      return;
    }
    setChecking(true);
    try {
      const found = await directory.findByEmployeeNo(site?.id ?? '', code);
      if (!found) {
        setCheck(null);
        setMessage(site
          ? { key: 'No employee profile for {code} was found at {site}. Check the code and try again.', params: { code, site: site.name } }
          : { key: 'No employee profile for {code} was found. Check the code and try again.', params: { code } });
        return;
      }
      // Completion records only exist for the synthetic roster. Against a real employee
      // master there is no training source yet, so claiming "0 completed" would be a lie.
      const completed = isMaster ? [] : COMPLETED_BY_DEMO_EMPLOYEE[found.id] ?? [];
      setCheck({
        employee: found,
        completed,
        pending: isMaster ? [] : ALL_TOPICS.filter((topic) => !completed.includes(topic)),
        hasRecords: !isMaster
      });
      setMessage(null);
    } catch {
      setCheck(null);
      setMessage({ key: 'The employee directory is unavailable right now. Try again in a moment.' });
    } finally {
      setChecking(false);
    }
  }

  return <section className="page-panel training-portal">
    <div className="page-heading"><div><span className="eyebrow">{T('LEARN & REFRESH')} · {site?.name ?? T('SITE')}</span><h1>{T('Training Management')}</h1><p>{T('Browse safety learning material and check your own training status.')}</p></div><BookOpen size={28} /></div>

    <section className="training-section training-videos">
      <div className="training-section-heading"><span className="training-section-icon"><PlayCircle size={19} /></span><div><h2>📺 {T('Training Videos')}</h2><small>{T('Choose a video to preview')}</small></div><span className="training-section-tag">{T('DEMO CATALOG')}</span></div>
      <div className="training-material-list">{TRAINING_VIDEOS.map((item) => <button type="button" className="training-material-row" key={item.title} onClick={() => setMaterial(item)}><span className="training-material-icon video"><PlayCircle size={18} /></span><span><b>{item.title}</b><small>{item.description}</small></span>{item.durationMinutes !== undefined && <span className="training-material-meta"><Clock3 size={13} />{T('{count} minutes', { count: new Intl.NumberFormat(locale).format(item.durationMinutes) })}</span>}</button>)}</div>
    </section>

    <section className="training-section training-modules">
      <div className="training-section-heading"><span className="training-section-icon"><BookOpen size={19} /></span><div><h2>📚 {T('Training Modules')}</h2><small>{T('Reference guides and standards')}</small></div><span className="training-section-tag">{T('PDF / PPT / STANDARD')}</span></div>
      <div className="training-module-grid">{TRAINING_MODULES.map((item) => <button type="button" className="training-module-card" key={item.title} onClick={() => setMaterial(item)}><FileText size={18} /><span><b>{item.title}</b><small>{item.description}</small></span></button>)}</div>
    </section>

    <section className="training-section training-check">
      <div className="training-section-heading"><span className="training-section-icon"><CheckCircle2 size={19} /></span><div><h2>✅ {T('Check My Training')}</h2><small>{T('View applicable, available, pending and completed learning')}</small></div></div>
      <p className="training-check-help">{T(isMaster ? 'Enter your own Employee Code. The profile is read from the employee master for the selected site.' : 'Enter your own Employee Code. In this demo, results use synthetic records scoped to the selected site.')}</p>
      <form className="training-check-form" onSubmit={checkTraining}><label htmlFor="training-employee-code" className="sr-only">{T('Employee Code')}</label><input id="training-employee-code" autoComplete="off" value={employeeCode} onChange={(event) => { setEmployeeCode(event.target.value.toUpperCase()); setCheck(null); setMessage(null); }} placeholder={T('Enter Employee Code')} required /><button type="submit" className="primary-button" disabled={checking}>{T(checking ? 'Checking…' : 'Check')}</button></form>
      {message && <div className="inline-notice warning training-check-message" role="status">{T(message.key, message.params)}</div>}
      {check && <div className="training-results" aria-live="polite">
        <div className="training-employee-found"><span className="live-dot" /><b>{check.employee.name}</b><span>{check.employee.empNo} · {check.employee.designation}</span></div>
        {!check.hasRecords && <div className="inline-notice warning" role="status">{T('This profile was found in the employee master, but training completion records are not connected yet.')}</div>}
        {check.hasRecords && <div className="training-count-grid"><div><small>{T('Applicable')}</small><b>{ALL_TOPICS.length}</b></div><div><small>{T('Available')}</small><b>{ALL_TOPICS.length}</b></div><div><small>{T('Pending')}</small><b>{check.pending.length}</b></div><div><small>{T('Completed')}</small><b>{check.completed.length}</b></div></div>}
        {check.completed.length > 0 && <div className="training-result-list"><h3>✅ {T('Completed Trainings')} ({check.completed.length})</h3>{check.completed.map((topic) => <div className="training-result-row completed" key={topic}><CheckCircle2 size={15} /><span>{topic}</span><small>{T('Demo record')}</small></div>)}</div>}
        {check.pending.length > 0 && <div className="training-result-list"><h3>⏳ {T('Pending Trainings')} ({check.pending.length})</h3>{check.pending.map((topic) => <div className="training-result-row pending" key={topic}><Clock3 size={15} /><span>{topic}</span><small>{T('Not completed')}</small></div>)}</div>}
        <p className="training-demo-note">{T('Demo training records are synthetic and are not saved or checked against a real employee database.')}</p>
      </div>}
    </section>

    <div className="privacy-note"><CheckCircle2 size={15} /> {T('Live training catalog, employee training records and material links are not connected in this demo.')}</div>

    {material && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="training-material-title"><div className="modal training-material-modal"><div className="modal-header"><div><span className="eyebrow">{T('TRAINING VIEWER')} · {T(material.type)}</span><h2 id="training-material-title">{material.title}</h2></div><button className="close-button" type="button" onClick={() => setMaterial(null)} aria-label={T('Close training viewer')}><X /></button></div><p>{material.description}</p><div className="training-material-placeholder"><FileText size={27} /><b>{T('Learning material preview')}</b><small>{T('The demo catalog has no connected file or video link.')}</small></div><button className="secondary-button full-button" type="button" onClick={() => setMaterial(null)}>{T('Close')}</button></div></div>}
  </section>;
}
