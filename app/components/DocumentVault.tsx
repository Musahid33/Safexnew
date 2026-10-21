'use client';

import { BookOpen, ChevronRight, ExternalLink, FileText, LockKeyhole, Scale, ShieldAlert, X, ScrollText, type LucideIcon } from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { APP_TIME_ZONE } from '@/lib/home-content';
import { DOCUMENT_TYPE_LABELS, VAULT_CATEGORIES, type DocumentType } from '@/lib/content/catalog';
import { useI18n } from './I18nProvider';

export type VaultCategoryId = 'sop-swp' | 'risk-assessments' | 'legal-compliance' | 'policies-procedures';

/** A document as the publishing panel saved it, and as /api/content returns it. */
export type VaultDocument = {
  id: string;
  category: VaultCategoryId;
  title: string;
  summary: string | null;
  documentCode: string | null;
  documentType: DocumentType;
  revision: string | null;
  effectiveDate: string | null;
  publishedAt: string | null;
  fileUrl: string | null;
  fileName: string | null;
};

type VaultCategory = {
  id: VaultCategoryId;
  title: string;
  description: string;
  tone: string;
  icon: LucideIcon;
};

/** The four shelves of the site library — fixed navigation, filled from the database. */
export const DOCUMENT_VAULT_CATEGORIES: VaultCategory[] = [
  { id: 'sop-swp', title: 'SOP / SWP', description: 'Standard & safe work procedures', tone: 'red', icon: FileText },
  { id: 'risk-assessments', title: 'Risk Assessments', description: 'JHA, HIRA & task risk reviews', tone: 'blue', icon: ShieldAlert },
  { id: 'legal-compliance', title: 'Legal & Statutory Compliance', description: 'Registers, checklists & obligations', tone: 'amber', icon: Scale },
  { id: 'policies-procedures', title: 'Policy & Procedures', description: 'Safety policy and management process', tone: 'purple', icon: ScrollText }
];

export function DocumentVaultGrid({ onSelect, documents = [] }: {
  onSelect: (id: VaultCategoryId) => void;
  documents?: VaultDocument[];
}) {
  const { T } = useI18n();
  return <div className="vault-category-grid">
    {DOCUMENT_VAULT_CATEGORIES.map(({ id, title, description, tone, icon: Icon }) => {
      const count = documents.filter((document) => document.category === id).length;
      return <button className="vault-category-card" type="button" key={id} onClick={() => onSelect(id)}>
        <span className={`vault-category-icon ${tone}`}><Icon size={24} /></span>
        <span className="vault-category-copy">
          <b>{T(title)}</b>
          <small>{T(description)}</small>
          <em className={count ? 'has-files' : ''}>{count ? T('{count} published', { count }) : T('No files yet')}</em>
        </span>
        <ChevronRight className="vault-category-arrow" size={19} />
      </button>;
    })}
  </div>;
}

export function VaultCategoryDialog({ categoryId, siteName, documents = [], onClose }: {
  categoryId: VaultCategoryId;
  siteName: string;
  documents?: VaultDocument[];
  onClose: () => void;
}) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const category = DOCUMENT_VAULT_CATEGORIES.find((item) => item.id === categoryId);
  if (!category) return null;
  const Icon = category.icon;
  const published = documents.filter((document) => document.category === categoryId);

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
        {published.length === 0 && <div className="vault-document-empty">
          <FileText size={22} aria-hidden="true" />
          <b>{T('No documents published yet')}</b>
          <span>{T('Approved files will be listed here once the safety team publishes them from the admin panel.')}</span>
        </div>}
        {published.map((document) => {
          const date = document.effectiveDate ?? document.publishedAt;
          const kind = DOCUMENT_TYPE_LABELS[document.documentType] ?? VAULT_CATEGORIES[document.category].title;
          return <article className="vault-document-row" key={document.id}>
            <span className="vault-document-icon"><BookOpen size={19} /></span>
            <span className="vault-document-copy">
              <b>{document.title}</b>
              <small>
                {kind}{document.revision ? ` · ${document.revision}` : ''}{date ? ` · ${T('Updated')} ${new Intl.DateTimeFormat(locale, { timeZone: APP_TIME_ZONE, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))}` : ''}
              </small>
              {document.summary && <small className="vault-document-summary">{document.summary}</small>}
            </span>
            {document.fileUrl
              ? <a className="vault-document-open" href={document.fileUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {T('Open')}</a>
              : <span className="vault-document-status">{T('Index only')}</span>}
          </article>;
        })}
      </div>
      <div className="modal-footnote"><LockKeyhole size={14} /> {T('Only published files are listed. Nothing here is a sample entry.')}</div>
    </div>
  </div>;
}
