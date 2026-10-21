'use client';

import { BookOpen, CalendarDays, ChevronRight, FileText, LockKeyhole, Scale, ShieldAlert, X, ScrollText, type LucideIcon } from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { APP_TIME_ZONE } from '@/lib/home-content';
import { useI18n } from './I18nProvider';

export type VaultCategoryId = 'sop-swp' | 'risk-assessments' | 'legal-compliance' | 'policies-procedures';

type VaultDocument = { title: string; kind: string; revision: string; updated: string };
type VaultCategory = {
  id: VaultCategoryId;
  title: string;
  description: string;
  tone: string;
  icon: LucideIcon;
  documents: VaultDocument[];
};

/**
 * The four shelves of the site library.
 *
 * The documents that used to sit inside them were sample files ("· Sample", "Demo") with
 * invented revisions. They are gone: a shelf with no published file opens to an empty state.
 * The shelves themselves stay, because they are the categories the site organises by.
 */
export const DOCUMENT_VAULT_CATEGORIES: VaultCategory[] = [
  { id: 'sop-swp', title: 'SOP / SWP', description: 'Standard & safe work procedures', tone: 'red', icon: FileText, documents: [] },
  { id: 'risk-assessments', title: 'Risk Assessments', description: 'JHA, HIRA & task risk reviews', tone: 'blue', icon: ShieldAlert, documents: [] },
  { id: 'legal-compliance', title: 'Legal & Statutory Compliance', description: 'Registers, checklists & obligations', tone: 'amber', icon: Scale, documents: [] },
  { id: 'policies-procedures', title: 'Policy & Procedures', description: 'Safety policy and management process', tone: 'purple', icon: ScrollText, documents: [] }
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
      <p className="vault-dialog-intro">{T(category.description)}. {T('Documents published for the selected site appear here.')}</p>
      <div className="vault-document-list">
        {category.documents.length === 0 && <div className="vault-document-empty">
          <FileText size={22} aria-hidden="true" />
          <b>{T('No documents published yet')}</b>
          <span>{T('Approved files will be listed here once the safety team publishes them.')}</span>
        </div>}
        {category.documents.map((document) => <article className="vault-document-row" key={document.title}>
          <span className="vault-document-icon"><BookOpen size={19} /></span>
          <span className="vault-document-copy"><b>{document.title}</b><small>{T(document.kind)} · {document.revision} · {T('Updated')} {new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${document.updated}T12:00:00+05:30`))}</small></span>
          <span className="vault-document-status"><CalendarDays size={13} /> {T('Index only')}</span>
        </article>)}
      </div>
      <div className="modal-footnote"><LockKeyhole size={14} /> {T('Only published files are listed. Nothing here is a sample entry.')}</div>
    </div>
  </div>;
}
