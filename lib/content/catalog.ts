/**
 * The vocabulary shared by the publishing panel and the worker app.
 *
 * The app's four vault shelves are fixed navigation; the database stores a stable
 * `category_key` for each one (`public.document_category_defaults`). This module is the single
 * translation between the two, so a shelf id is never spelled out in a query string by hand.
 */

export const VAULT_CATEGORY_IDS = ['sop-swp', 'risk-assessments', 'legal-compliance', 'policies-procedures'] as const;
export type VaultCategoryKey = (typeof VAULT_CATEGORY_IDS)[number];

export type VaultCategoryDefinition = {
  /** Key used by `public.document_categories.category_key`. */
  dbKey: string;
  /** Shelf heading in the app. */
  title: string;
  description: string;
  /** Default `documents.document_type` for this shelf. */
  docType: string;
};

export const VAULT_CATEGORIES: Record<VaultCategoryKey, VaultCategoryDefinition> = {
  'sop-swp': {
    dbKey: 'sop_swp',
    title: 'SOP / SWP',
    description: 'Standard & safe work procedures',
    docType: 'sop'
  },
  'risk-assessments': {
    dbKey: 'risk_assessments',
    title: 'Risk Assessments',
    description: 'JHA, HIRA & task risk reviews',
    docType: 'risk_assessment'
  },
  'legal-compliance': {
    dbKey: 'legal_statutory_compliance',
    title: 'Legal & Statutory Compliance',
    description: 'Registers, checklists & obligations',
    docType: 'legal_register'
  },
  'policies-procedures': {
    dbKey: 'policy_procedures',
    title: 'Policy & Procedures',
    description: 'Safety policy and management process',
    docType: 'policy'
  }
};

/** Database vocabulary for `documents.document_type`. */
export const DOCUMENT_TYPES = [
  'sop', 'swp', 'risk_assessment', 'legal_register', 'policy', 'procedure', 'minutes', 'document'
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  sop: 'SOP',
  swp: 'SWP',
  risk_assessment: 'Risk assessment',
  legal_register: 'Legal register',
  policy: 'Policy',
  procedure: 'Procedure',
  minutes: 'Minutes',
  document: 'Document'
};

export function isVaultCategoryKey(value: unknown): value is VaultCategoryKey {
  return typeof value === 'string' && (VAULT_CATEGORY_IDS as readonly string[]).includes(value);
}

/** Map a stored `category_key` back to the app shelf. Unknown keys stay unpublished. */
export function vaultCategoryFromDbKey(dbKey: string): VaultCategoryKey | null {
  const entry = (Object.entries(VAULT_CATEGORIES) as Array<[VaultCategoryKey, VaultCategoryDefinition]>)
    .find(([, definition]) => definition.dbKey === dbKey);
  return entry ? entry[0] : null;
}

export function vaultCategoriesForPublishing() {
  return VAULT_CATEGORY_IDS.map((id) => ({ id, ...VAULT_CATEGORIES[id] }));
}
