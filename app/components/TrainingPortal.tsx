'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { BookOpen, CheckCircle2, Clock3, FileText, PlayCircle, X } from 'lucide-react';
import type { Employee, Site } from '@/lib/types';

type Props = { site: Site | null; employees: Employee[] };
type Material = { title: string; description: string; type: 'Video' | 'Module'; duration?: string };
type TrainingCheck = { employee: Employee; completed: string[]; pending: string[] };

const TRAINING_VIDEOS: Material[] = [
  { title: 'Safety Fundamentals · Part 1', description: 'Core workplace safety and hazard awareness.', type: 'Video', duration: '12 mins' },
  { title: 'PPE Usage & Care', description: 'Select, inspect and care for personal protective equipment.', type: 'Video', duration: '8 mins' },
  { title: 'Hazard Identification', description: 'Recognize unsafe conditions and report them promptly.', type: 'Video', duration: '15 mins' }
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

export default function TrainingPortal({ site, employees }: Props) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [check, setCheck] = useState<TrainingCheck | null>(null);
  const [message, setMessage] = useState('');
  const [material, setMaterial] = useState<Material | null>(null);
  const siteEmployees = useMemo(() => employees.filter((employee) => !site || employee.siteId === site.id), [employees, site]);

  function checkTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = employeeCode.trim().toUpperCase();
    if (!code) {
      setMessage('Enter your Employee Code to check training.');
      setCheck(null);
      return;
    }
    const found = siteEmployees.find((item) => item.empNo.toUpperCase() === code);
    if (!found) {
      setCheck(null);
      setMessage(`No demo employee profile for ${code} was found${site ? ` at ${site.name}` : ''}. Check the code and try again.`);
      return;
    }
    const completed = COMPLETED_BY_DEMO_EMPLOYEE[found.id] ?? [];
    setCheck({ employee: found, completed, pending: ALL_TOPICS.filter((topic) => !completed.includes(topic)) });
    setMessage('');
  }

  return <section className="page-panel training-portal">
    <div className="page-heading"><div><span className="eyebrow">LEARN &amp; REFRESH · {site?.name ?? 'SITE'}</span><h1>Training Management</h1><p>Browse safety learning material and check your own training status.</p></div><BookOpen size={28} /></div>

    <section className="training-section training-videos">
      <div className="training-section-heading"><span className="training-section-icon"><PlayCircle size={19} /></span><div><h2>📺 Training Videos</h2><small>Choose a video to preview</small></div><span className="training-section-tag">DEMO CATALOG</span></div>
      <div className="training-material-list">{TRAINING_VIDEOS.map((item) => <button type="button" className="training-material-row" key={item.title} onClick={() => setMaterial(item)}><span className="training-material-icon video"><PlayCircle size={18} /></span><span><b>{item.title}</b><small>{item.description}</small></span><span className="training-material-meta"><Clock3 size={13} />{item.duration}</span></button>)}</div>
    </section>

    <section className="training-section training-modules">
      <div className="training-section-heading"><span className="training-section-icon"><BookOpen size={19} /></span><div><h2>📚 Training Modules</h2><small>Reference guides and standards</small></div><span className="training-section-tag">PDF / PPT / STANDARD</span></div>
      <div className="training-module-grid">{TRAINING_MODULES.map((item) => <button type="button" className="training-module-card" key={item.title} onClick={() => setMaterial(item)}><FileText size={18} /><span><b>{item.title}</b><small>{item.description}</small></span></button>)}</div>
    </section>

    <section className="training-section training-check">
      <div className="training-section-heading"><span className="training-section-icon"><CheckCircle2 size={19} /></span><div><h2>✅ Check My Training</h2><small>View applicable, available, pending and completed learning</small></div></div>
      <p className="training-check-help">Enter your own Employee Code. In this demo, results use synthetic records scoped to the selected site.</p>
      <form className="training-check-form" onSubmit={checkTraining}><label htmlFor="training-employee-code" className="sr-only">Employee Code</label><input id="training-employee-code" autoComplete="off" value={employeeCode} onChange={(event) => { setEmployeeCode(event.target.value.toUpperCase()); setCheck(null); setMessage(''); }} placeholder="Enter Employee Code" required /><button type="submit" className="primary-button">Check</button></form>
      {message && <div className="inline-notice warning training-check-message" role="status">{message}</div>}
      {check && <div className="training-results" aria-live="polite">
        <div className="training-employee-found"><span className="live-dot" /><b>{check.employee.name}</b><span>{check.employee.empNo} · {check.employee.designation}</span></div>
        <div className="training-count-grid"><div><small>Applicable</small><b>{ALL_TOPICS.length}</b></div><div><small>Available</small><b>{ALL_TOPICS.length}</b></div><div><small>Pending</small><b>{check.pending.length}</b></div><div><small>Completed</small><b>{check.completed.length}</b></div></div>
        {check.completed.length > 0 && <div className="training-result-list"><h3>✅ Completed Trainings ({check.completed.length})</h3>{check.completed.map((topic) => <div className="training-result-row completed" key={topic}><CheckCircle2 size={15} /><span>{topic}</span><small>Demo record</small></div>)}</div>}
        {check.pending.length > 0 && <div className="training-result-list"><h3>⏳ Pending Trainings ({check.pending.length})</h3>{check.pending.map((topic) => <div className="training-result-row pending" key={topic}><Clock3 size={15} /><span>{topic}</span><small>Not completed</small></div>)}</div>}
        <p className="training-demo-note">Demo training records are synthetic and are not saved or checked against a real employee database.</p>
      </div>}
    </section>

    <div className="privacy-note"><CheckCircle2 size={15} /> Live training catalog, employee training records and material links are not connected in this demo.</div>

    {material && <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="training-material-title"><div className="modal training-material-modal"><div className="modal-header"><div><span className="eyebrow">TRAINING VIEWER · {material.type}</span><h2 id="training-material-title">{material.title}</h2></div><button className="close-button" type="button" onClick={() => setMaterial(null)} aria-label="Close training viewer"><X /></button></div><p>{material.description}</p><div className="training-material-placeholder"><FileText size={27} /><b>Learning material preview</b><small>The demo catalog has no connected file or video link.</small></div><button className="secondary-button full-button" type="button" onClick={() => setMaterial(null)}>Close</button></div></div>}
  </section>;
}
