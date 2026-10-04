'use client';

import { BookOpen, CalendarDays, ChevronRight, ClipboardList, FileText, LockKeyhole, Scale, ShieldAlert, X, ScrollText, type LucideIcon } from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { APP_TIME_ZONE } from '@/lib/home-content';
import { useI18n } from './I18nProvider';

export type VaultCategoryId = 'sop-swp' | 'risk-assessments' | 'legal-compliance' | 'policies-procedures' | 'minutes-of-meeting';

type VaultDocument = { title: string; kind: string; revision: string; updated: string };
type VaultCategory = {
  id: VaultCategoryId;
  title: string;
  description: string;
  tone: string;
  icon: LucideIcon;
  documents: VaultDocument[];
};

export const DOCUMENT_VAULT_CATEGORIES: VaultCategory[] = [
  {
    id: 'sop-swp',
    title: 'SOP / SWP',
    description: 'Standard & safe work procedures',
    tone: 'red',
    icon: FileText,
    documents: [
      { title: 'SOP · Lockout / Tagout', kind: 'SOP', revision: 'Rev 02', updated: '2026-09-12' },
      { title: 'SWP · Working at Height', kind: 'SWP', revision: 'Rev 01', updated: '2026-08-29' },
      { title: 'SOP · Hot Work Permit', kind: 'SOP', revision: 'Rev 03', updated: '2026-08-16' }
    ]
  },
  {
    id: 'risk-assessments',
    title: 'Risk Assessments',
    description: 'JHA, HIRA & task risk reviews',
    tone: 'blue',
    icon: ShieldAlert,
    documents: [
      { title: 'JHA · Work at Height', kind: 'JHA', revision: 'Rev 01', updated: '2026-09-18' },
      { title: 'HIRA · Material Handling', kind: 'HIRA', revision: 'Rev 02', updated: '2026-09-05' },
      { title: 'Risk Review · Confined Space', kind: 'JHA', revision: 'Rev 01', updated: '2026-08-22' }
    ]
  },
  {
    id: 'legal-compliance',
    title: 'Legal & Statutory Compliance',
    description: 'Registers, checklists & obligations',
    tone: 'amber',
    icon: Scale,
    documents: [
      { title: 'Statutory Compliance Checklist · Sample', kind: 'Checklist', revision: 'Demo', updated: '2026-10-01' },
      { title: 'Applicable Law Matrix · Sample', kind: 'Register', revision: 'Demo', updated: '2026-09-15' },
      { title: 'Permit & Certificate Index · Sample', kind: 'Index', revision: 'Demo', updated: '2026-09-01' }
    ]
  },
  {
    id: 'policies-procedures',
    title: 'Policy & Procedures',
    description: 'Safety policy and management process',
    tone: 'purple',
    icon: ScrollText,
    documents: [
      { title: 'Occupational Health & Safety Policy · Sample', kind: 'Policy', revision: 'Demo', updated: '2026-09-10' },
      { title: 'Incident Reporting Procedure · Sample', kind: 'Procedure', revision: 'Demo', updated: '2026-09-04' },
      { title: 'Emergency Response Procedure · Sample', kind: 'Procedure', revision: 'Demo', updated: '2026-08-20' }
    ]
  },
  {
    id: 'minutes-of-meeting',
    title: 'Minutes of Meeting (MoM)',
    description: 'Safety committee & review meetings',
    tone: 'green',
    icon: ClipboardList,
    documents: [
      { title: 'Safety Committee Meeting · Q3', kind: 'MoM', revision: 'Sample', updated: '2026-09-28' },
      { title: 'Contractor Coordination Meeting', kind: 'MoM', revision: 'Sample', updated: '2026-09-12' },
      { title: 'Monthly EHS Review Meeting', kind: 'MoM', revision: 'Sample', updated: '2026-08-25' }
    ]
  }
];

export function DocumentVaultGrid({ onSelect }: { onSelect: (id: VaultCategoryId) => void }) {
  const { language, T } = useI18n();
  return <div className="vault-category-grid">
    {DOCUMENT_VAULT_CATEGORIES.map(({ id, title, description, tone, icon: Icon }) => <button className="vault-category-card" type="button" key={id} onClick={() => onSelect(id)}>
      <span className={`vault-category-icon ${tone}`}><Icon size={24} /></span>
      <span className="vault-category-copy"><b>{T(title)}</b><small>{T(description)}</small></span>
      <ChevronRight className="vault-category-arrow" size={19} />
    </button>)}
  </div>;
}

export function VaultCategoryDialog({ categoryId, siteName, onClose }: { categoryId: VaultCategoryId; siteName: string; onClose: () => void }) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const category = DOCUMENT_VAULT_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return null;
  const Icon = category.icon;

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
    <div className="modal vault-category-dialog">
      <div className="modal-header">
        <div className="vault-dialog-heading">
          <span className={`vault-category-icon ${category.tone}`}><Icon size={22} /></span>
          <div><span className="eyebrow">{T('DOCUMENT VAULT')} · {siteName}</span><h2 id="vault-dialog-title">{T(category.title)}</h2></div>
        </div>
        <button className="close-button" type="button" onClick={onClose} aria-label={T('Close document category')}><X /></button>
      </div>
      <p className="vault-dialog-intro">{T(category.description)}. {T('This is a sample index for the selected site.')}</p>
      <div className="vault-document-list">
        {category.documents.map((document) => <article className="vault-document-row" key={document.title}>
          <span className="vault-document-icon"><BookOpen size={19} /></span>
          <span className="vault-document-copy"><b>{document.title}</b><small>{T(document.kind)} · {document.revision} · {T('Updated')} {new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${document.updated}T12:00:00+05:30`))}</small></span>
          <span className="vault-document-status"><CalendarDays size={13} /> {T('Index only')}</span>
        </article>)}
      </div>
      <div className="modal-footnote"><LockKeyhole size={14} /> {T('Demo index only · no real document files or compliance records are connected.')}</div>
    </div>
  </div>;
}
