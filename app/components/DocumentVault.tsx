'use client';

import { BookOpen, CalendarDays, ChevronRight, ClipboardList, FileText, LockKeyhole, Scale, ShieldAlert, X, ScrollText, type LucideIcon } from 'lucide-react';

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
      { title: 'SOP · Lockout / Tagout', kind: 'SOP', revision: 'Rev 02', updated: '12 Sep 2026' },
      { title: 'SWP · Working at Height', kind: 'SWP', revision: 'Rev 01', updated: '29 Aug 2026' },
      { title: 'SOP · Hot Work Permit', kind: 'SOP', revision: 'Rev 03', updated: '16 Aug 2026' }
    ]
  },
  {
    id: 'risk-assessments',
    title: 'Risk Assessments',
    description: 'JHA, HIRA & task risk reviews',
    tone: 'blue',
    icon: ShieldAlert,
    documents: [
      { title: 'JHA · Work at Height', kind: 'JHA', revision: 'Rev 01', updated: '18 Sep 2026' },
      { title: 'HIRA · Material Handling', kind: 'HIRA', revision: 'Rev 02', updated: '05 Sep 2026' },
      { title: 'Risk Review · Confined Space', kind: 'JHA', revision: 'Rev 01', updated: '22 Aug 2026' }
    ]
  },
  {
    id: 'legal-compliance',
    title: 'Legal & Statutory Compliance',
    description: 'Registers, checklists & obligations',
    tone: 'amber',
    icon: Scale,
    documents: [
      { title: 'Statutory Compliance Checklist · Sample', kind: 'Checklist', revision: 'Demo', updated: '01 Oct 2026' },
      { title: 'Applicable Law Matrix · Sample', kind: 'Register', revision: 'Demo', updated: '15 Sep 2026' },
      { title: 'Permit & Certificate Index · Sample', kind: 'Index', revision: 'Demo', updated: '01 Sep 2026' }
    ]
  },
  {
    id: 'policies-procedures',
    title: 'Policy & Procedures',
    description: 'Safety policy and management process',
    tone: 'purple',
    icon: ScrollText,
    documents: [
      { title: 'Occupational Health & Safety Policy · Sample', kind: 'Policy', revision: 'Demo', updated: '10 Sep 2026' },
      { title: 'Incident Reporting Procedure · Sample', kind: 'Procedure', revision: 'Demo', updated: '04 Sep 2026' },
      { title: 'Emergency Response Procedure · Sample', kind: 'Procedure', revision: 'Demo', updated: '20 Aug 2026' }
    ]
  },
  {
    id: 'minutes-of-meeting',
    title: 'Minutes of Meeting (MoM)',
    description: 'Safety committee & review meetings',
    tone: 'green',
    icon: ClipboardList,
    documents: [
      { title: 'Safety Committee Meeting · Q3', kind: 'MoM', revision: 'Sample', updated: '28 Sep 2026' },
      { title: 'Contractor Coordination Meeting', kind: 'MoM', revision: 'Sample', updated: '12 Sep 2026' },
      { title: 'Monthly EHS Review Meeting', kind: 'MoM', revision: 'Sample', updated: '25 Aug 2026' }
    ]
  }
];

export function DocumentVaultGrid({ onSelect }: { onSelect: (id: VaultCategoryId) => void }) {
  return <div className="vault-category-grid">
    {DOCUMENT_VAULT_CATEGORIES.map(({ id, title, description, tone, icon: Icon }) => <button className="vault-category-card" type="button" key={id} onClick={() => onSelect(id)}>
      <span className={`vault-category-icon ${tone}`}><Icon size={24} /></span>
      <span className="vault-category-copy"><b>{title}</b><small>{description}</small></span>
      <ChevronRight className="vault-category-arrow" size={19} />
    </button>)}
  </div>;
}

export function VaultCategoryDialog({ categoryId, siteName, onClose }: { categoryId: VaultCategoryId; siteName: string; onClose: () => void }) {
  const category = DOCUMENT_VAULT_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return null;
  const Icon = category.icon;

  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="vault-dialog-title">
    <div className="modal vault-category-dialog">
      <div className="modal-header">
        <div className="vault-dialog-heading">
          <span className={`vault-category-icon ${category.tone}`}><Icon size={22} /></span>
          <div><span className="eyebrow">DOCUMENT VAULT · {siteName}</span><h2 id="vault-dialog-title">{category.title}</h2></div>
        </div>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close document category"><X /></button>
      </div>
      <p className="vault-dialog-intro">{category.description}. This is a sample index for the selected site.</p>
      <div className="vault-document-list">
        {category.documents.map((document) => <article className="vault-document-row" key={document.title}>
          <span className="vault-document-icon"><BookOpen size={19} /></span>
          <span className="vault-document-copy"><b>{document.title}</b><small>{document.kind} · {document.revision} · Updated {document.updated}</small></span>
          <span className="vault-document-status"><CalendarDays size={13} /> Index only</span>
        </article>)}
      </div>
      <div className="modal-footnote"><LockKeyhole size={14} /> Demo index only · no real document files or compliance records are connected.</div>
    </div>
  </div>;
}
