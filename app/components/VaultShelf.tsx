'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, FileText, ExternalLink, ShieldAlert, Scale, ScrollText, type LucideIcon } from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { DOCUMENT_TYPE_LABELS, VAULT_CATEGORIES, type DocumentType } from '@/lib/content/catalog';
import { registerDate, registerValidity, registerToday } from '@/lib/content/register';
import { useI18n } from './I18nProvider';
import { DOCUMENT_VAULT_CATEGORIES, type VaultCategoryId, type VaultDocument } from './DocumentVault';

/**
 * One vault shelf, shown as the site's document register.
 *
 * The register is the same for every shelf — SOP / SWP, Risk Assessments, Legal & Statutory
 * Compliance and Policy & Procedures — because the four shelves hold the same columns:
 * department, section, document type, document number, name, revision, validity and status.
 * Rows come only from published database rows; the shelf never fills itself.
 *
 * Opening a row shows the document itself: a PDF is streamed from this origin and displayed
 * in the page, an image is displayed the same way, and a link-only row offers the link.
 */

type SortKey = 'latest' | 'oldest' | 'code' | 'name';

const SHELF_TEXT: Record<VaultCategoryId, { code: string; name: string }> = {
  'sop-swp': { code: 'SOP No.', name: 'SOP Name' },
  'risk-assessments': { code: 'RA No.', name: 'Risk Assessment' },
  'legal-compliance': { code: 'Legal No.', name: 'Compliance Name' },
  'policies-procedures': { code: 'Doc No.', name: 'Policy Name' }
};

const SHELF_ICON: Record<VaultCategoryId, LucideIcon> = {
  'sop-swp': FileText,
  'risk-assessments': ShieldAlert,
  'legal-compliance': Scale,
  'policies-procedures': ScrollText
};

export function VaultShelf({ categoryId, siteName, documents = [], onBack }: {
  categoryId: VaultCategoryId;
  siteName: string;
  documents?: VaultDocument[];
  onBack: () => void;
}) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const category = DOCUMENT_VAULT_CATEGORIES.find((item) => item.id === categoryId);
  const [department, setDepartment] = useState('all');
  const [section, setSection] = useState('all');
  const [type, setType] = useState('all');
  const [sort, setSort] = useState<SortKey>('latest');
  const [openId, setOpenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDepartment('all');
    setSection('all');
    setType('all');
    setSort('latest');
    setOpenId(null);
  }, [categoryId]);

  const shelf = useMemo(
    () => documents.filter((document) => document.category === categoryId),
    [documents, categoryId]
  );

  const departments = useMemo(() => unique(shelf.map((document) => document.department)), [shelf]);
  const sections = useMemo(() => unique(shelf.map((document) => document.section)), [shelf]);
  const types = useMemo(() => unique(shelf.map((document) => document.documentType)), [shelf]);

  const rows = useMemo(() => {
    const filtered = shelf.filter((document) =>
      (department === 'all' || (document.department ?? '') === department)
      && (section === 'all' || (document.section ?? '') === section)
      && (type === 'all' || document.documentType === type)
    );
    const byDate = (document: VaultDocument) => document.publishedAt ? new Date(document.publishedAt).getTime() : 0;
    return [...filtered].sort((a, b) => {
      if (sort === 'code') return (a.documentCode ?? a.title).localeCompare(b.documentCode ?? b.title, locale);
      if (sort === 'name') return a.title.localeCompare(b.title, locale);
      if (sort === 'oldest') return byDate(a) - byDate(b);
      return byDate(b) - byDate(a);
    });
  }, [shelf, department, section, type, sort, locale]);

  // Opening a row on a phone should land on the document, not leave the reader at the table.
  useEffect(() => {
    if (openId) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId]);

  if (!category) return null;

  const text = SHELF_TEXT[categoryId];
  const Icon = SHELF_ICON[categoryId];
  const open = shelf.find((document) => document.id === openId) ?? null;
  const today = registerToday();
  const filtersOn = department !== 'all' || section !== 'all' || type !== 'all';
  const count = new Intl.NumberFormat(locale).format(shelf.length);

  function resetFilters() {
    setDepartment('all');
    setSection('all');
    setType('all');
    setSort('latest');
  }

  return <section className="page-panel vault-shelf-page">
    <button className="vault-shelf-back" type="button" onClick={onBack}><ArrowLeft size={16} /> {T('Document Vault / Library')}</button>

    <div className="vault-shelf-head">
      <span className={`vault-category-icon ${category.tone}`}><Icon size={24} /></span>
      <div className="vault-shelf-head-copy">
        <span className="eyebrow">{T('DOCUMENT VAULT')} · {siteName}</span>
        <h1>{T(category.title)}</h1>
        <p>{T(category.description)} · {T('{count} published', { count })}</p>
      </div>
    </div>

    <div className="vault-filter-bar">
          <label><span>{T('Department')}</span>
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="all">{T('All Department')}</option>
              {departments.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label><span>{T('Section')}</span>
            <select value={section} onChange={(event) => setSection(event.target.value)}>
              <option value="all">{T('All Section')}</option>
              {sections.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label><span>{T('Document Type')}</span>
            <select value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">{T('All Document Type')}</option>
              {types.map((value) => <option key={value} value={value}>{T(DOCUMENT_TYPE_LABELS[value as DocumentType] ?? value)}</option>)}
            </select>
          </label>
          <label><span>{T('Order')}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              <option value="latest">{T('Latest First')}</option>
              <option value="oldest">{T('Oldest First')}</option>
              <option value="code">{T('Document No.')}</option>
              <option value="name">{T('Name A–Z')}</option>
            </select>
          </label>
          <button className="vault-filter-reset" type="button" onClick={resetFilters} disabled={!filtersOn && sort === 'latest'}>{T('Reset')}</button>
        </div>

        <div className="vault-register-wrap">
          <table className="vault-register">
            <thead>
              <tr>
                <th scope="col">{T('Sl. No.')}</th>
                <th scope="col">{T('Department')}</th>
                <th scope="col">{T('Section')}</th>
                <th scope="col">{T('Document Type')}</th>
                <th scope="col">{T(text.code)}</th>
                <th scope="col">{T(text.name)}</th>
                <th scope="col">{T('Rev.')}</th>
                <th scope="col">{T('Valid Upto')}</th>
                <th scope="col">{T('Status')}</th>
                <th scope="col">{T('Action')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((document, index) => {
                const validity = registerValidity(document.validUpto, today);
                return <tr key={document.id} className={openId === document.id ? 'is-open' : ''}>
                  <td data-label={T('Sl. No.')}>{index + 1}</td>
                  <td data-label={T('Department')}>{document.department ?? '—'}</td>
                  <td data-label={T('Section')}>{document.section ?? '—'}</td>
                  <td data-label={T('Document Type')}>{T(DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType)}</td>
                  <td data-label={T(text.code)} className="vault-register-code">{document.documentCode ?? '—'}</td>
                  <td data-label={T(text.name)} className="vault-register-name">
                    <button type="button" onClick={() => setOpenId(document.id)}>{document.title}</button>
                  </td>
                  <td data-label={T('Rev.')}>{document.revision ?? '—'}</td>
                  <td data-label={T('Valid Upto')}>{registerDate(document.validUpto)}</td>
                  <td data-label={T('Status')}><span className={`vault-status ${validity.key}`}>{T(validity.label)}</span></td>
                  <td data-label={T('Action')} className="vault-register-actions">
                    <button type="button" className="vault-icon-button" aria-label={T('View {name}', { name: document.title })} onClick={() => setOpenId(document.id)}>
                      <Eye size={16} />
                    </button>
                    {document.fileUrl && <a
                      className="vault-icon-button"
                      href={`${document.fileUrl}?download=1`}
                      aria-label={T('Download {name}', { name: document.title })}
                      target="_blank"
                      rel="noreferrer"
                    ><Download size={16} /></a>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="vault-register-none">
            <b>{T(shelf.length === 0 ? 'No documents published yet' : 'No documents match these filters.')}</b>
            {shelf.length === 0 && <>
              <span>{T('Approved files will be listed here once the safety team publishes them from the admin panel.')}</span>
              <a href="/admin/publish" target="_blank" rel="noreferrer">{T('Publish from the admin panel')}</a>
            </>}
          </div>}
    </div>

    {open && <div className="vault-detail" ref={detailRef}>
      <button className="vault-detail-back" type="button" onClick={() => setOpenId(null)}><ArrowLeft size={16} /> {T('Back')}</button>
      <div className="vault-detail-head">
        <div className="vault-detail-copy">
          <span className="vault-detail-code">{open.documentCode ?? T(VAULT_CATEGORIES[open.category].title)}</span>
          <h2>{open.title}</h2>
          <p>{open.summary ?? T(VAULT_CATEGORIES[open.category].description)}</p>
          <div className="vault-detail-meta">
            {open.department && <span>{T('Department')}: <b>{open.department}</b></span>}
            {open.section && <span>{T('Section')}: <b>{open.section}</b></span>}
            <span>{T('Revision')}: <b>{open.revision ?? '—'}</b></span>
            <span>{T('Valid Upto')}: <b>{registerDate(open.validUpto)}</b></span>
            <span className={`vault-status ${registerValidity(open.validUpto, today).key}`}>{T(registerValidity(open.validUpto, today).label)}</span>
          </div>
        </div>
        {open.fileUrl && <div className="vault-detail-actions">
          <a className="secondary-button" href={open.fileUrl} target="_blank" rel="noreferrer"><Eye size={16} /> {T('View')}</a>
          <a className="primary-button" href={`${open.fileUrl}?download=1`} target="_blank" rel="noreferrer"><Download size={16} /> {T('Download')}</a>
        </div>}
      </div>

      {open.fileUrl && !open.external && open.mimeType === 'application/pdf' && <div className="vault-viewer">
        <iframe
          key={open.id}
          src={`${open.fileUrl}?inline=1#navpanes=0&view=FitH`}
          title={open.title}
          loading="lazy"
        />
      </div>}
      {open.fileUrl && !open.external && Boolean(open.mimeType?.startsWith('image/')) && <div className="vault-viewer is-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${open.fileUrl}?inline=1`} alt={open.title} />
      </div>}
      {open.fileUrl && <a className="vault-detail-link" href={open.fileUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> {open.external
          ? T('Open {name}', { name: open.fileName ?? open.title })
          : T('Open the file in a new tab')}
      </a>}
      {!open.fileUrl && <p className="vault-detail-note">{T('No file is attached to this document.')}</p>}
    </div>}
  </section>;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}
