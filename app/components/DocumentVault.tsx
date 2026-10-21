'use client';

import { ChevronRight, FileText, Scale, ShieldAlert, ScrollText, type LucideIcon } from 'lucide-react';
import type { DocumentType } from '@/lib/content/catalog';
import { useI18n } from './I18nProvider';

export type VaultCategoryId = 'sop-swp' | 'risk-assessments' | 'legal-compliance' | 'policies-procedures';

/**
 * A document as the publishing panel saved it, and as /api/content returns it.
 *
 * These are the register columns: department, section, document number, revision and the
 * validity date the shelf's status chip is computed from.
 */
export type VaultDocument = {
  id: string;
  category: VaultCategoryId;
  title: string;
  summary: string | null;
  documentCode: string | null;
  documentType: DocumentType;
  revision: string | null;
  department: string | null;
  section: string | null;
  effectiveDate: string | null;
  validUpto: string | null;
  publishedAt: string | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  /** True for a row that points at an external link instead of an uploaded file. */
  external: boolean;
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
