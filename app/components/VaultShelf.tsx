'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Download, Eye, ExternalLink, FileText, Printer, Scale, ScrollText, ShieldAlert,
  type LucideIcon
} from 'lucide-react';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { DOCUMENT_TYPE_LABELS, VAULT_CATEGORIES } from '@/lib/content/catalog';
import { registerDate, registerValidity, registerToday } from '@/lib/content/register';
import { useI18n } from './I18nProvider';
import { DOCUMENT_VAULT_CATEGORIES, type VaultCategoryId, type VaultDocument } from './DocumentVault';

/**
 * One vault shelf, shown as the site's document register.
 *
 * The register is the same for every shelf — SOP / SWP, Risk Assessments, Legal & Statutory
 * Compliance and Policy & Procedures: serial number, department, section, document type,
 * document number, document name, validity and status. Rows come only from published database
 * rows; the shelf never fills itself.
 *
 * Viewing a row keeps the reader on this page: the document is streamed from this origin and
 * displayed underneath the register, with Print and Download beside it. Neither action opens a
 * tab — printing goes to the same page's viewer and downloading stays a file download.
 */

/** Per-shelf column wording, so the register speaks the shelf's own language. */
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
  const [openId, setOpenId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => { setOpenId(null); }, [categoryId]);

  const shelf = useMemo(
    () => documents.filter((document) => document.category === categoryId),
    [documents, categoryId]
  );

  // Opening a row on a phone should land on the document, not leave the reader at the table.
  useEffect(() => {
    if (openId) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openId]);

  if (!category) return null;

  const text = SHELF_TEXT[categoryId];
  const Icon = SHELF_ICON[categoryId];
  const open = shelf.find((document) => document.id === openId) ?? null;
  const today = registerToday();
  const count = new Intl.NumberFormat(locale).format(shelf.length);
  const viewerKind = !open?.fileUrl || open.external
    ? 'none'
    : open.mimeType === 'application/pdf'
      ? 'pdf'
      : open.mimeType?.startsWith('image/')
        ? 'image'
        : 'none';

  /**
   * Print the document that is already on screen. The viewer is same-origin, so its own frame
   * is what goes to the printer; if the browser refuses that, the page falls back to printing
   * itself (the print stylesheet hides everything except the document).
   */
  function printDocument() {
    const frame = viewerRef.current;
    const target = frame?.contentWindow;
    try {
      if (target) {
        target.focus();
        target.print();
        return;
      }
    } catch {
      // Fall through to printing the page itself.
    }
    window.print();
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

    <div className="vault-register-wrap">
      <table className="vault-register">
        <thead>
          <tr>
            <th scope="col">{T('Sl. No.')}</th>
            <th scope="col">{T('Dept.')}</th>
            <th scope="col">{T('Sec.')}</th>
            <th scope="col">{T('Type of Doc')}</th>
            <th scope="col">{T(text.code)}</th>
            <th scope="col">{T(text.name)}</th>
            <th scope="col">{T('Validity Upto')}</th>
            <th scope="col">{T('Status')}</th>
            <th scope="col">{T('View')}</th>
          </tr>
        </thead>
        <tbody>
          {shelf.map((document, index) => {
            const validity = registerValidity(document.validUpto, today);
            return <tr key={document.id} className={openId === document.id ? 'is-open' : ''}>
              <td data-label={T('Sl. No.')}>{index + 1}</td>
              <td data-label={T('Dept.')}>{document.department ?? '—'}</td>
              <td data-label={T('Sec.')}>{document.section ?? '—'}</td>
              <td data-label={T('Type of Doc')}>{T(DOCUMENT_TYPE_LABELS[document.documentType] ?? document.documentType)}</td>
              <td data-label={T(text.code)} className="vault-register-code">{document.documentCode ?? '—'}</td>
              <td data-label={T(text.name)} className="vault-register-name">
                <button type="button" onClick={() => setOpenId(document.id)}>{document.title}</button>
              </td>
              <td data-label={T('Validity Upto')}>{registerDate(document.validUpto)}</td>
              <td data-label={T('Status')}><span className={`vault-status ${validity.key}`}>{T(validity.label)}</span></td>
              <td data-label={T('View')} className="vault-register-actions">
                <button
                  type="button"
                  className="vault-view-button"
                  aria-label={T('View {name}', { name: document.title })}
                  aria-expanded={openId === document.id}
                  onClick={() => setOpenId(document.id)}
                ><Eye size={15} /> {T('View')}</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
      {shelf.length === 0 && <div className="vault-register-none">
        <b>{T('No documents published yet')}</b>
        <span>{T('Approved files will be listed here once the safety team publishes them from the admin panel.')}</span>
        <a href="/admin/publish" target="_blank" rel="noreferrer">{T('Publish from the admin panel')}</a>
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
            {open.department && <span>{T('Dept.')}: <b>{open.department}</b></span>}
            {open.section && <span>{T('Sec.')}: <b>{open.section}</b></span>}
            <span>{T('Revision')}: <b>{open.revision ?? '—'}</b></span>
            <span>{T('Validity Upto')}: <b>{registerDate(open.validUpto)}</b></span>
            <span className={`vault-status ${registerValidity(open.validUpto, today).key}`}>{T(registerValidity(open.validUpto, today).label)}</span>
          </div>
        </div>
        {open.fileUrl && !open.external && <div className="vault-detail-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={printDocument}
            disabled={viewerKind === 'none'}
          ><Printer size={16} /> {T('Print')}</button>
          <a className="primary-button" href={`${open.fileUrl}?download=1`} download><Download size={16} /> {T('Download')}</a>
        </div>}
      </div>

      {viewerKind === 'pdf' && <div className="vault-viewer">
        <iframe
          ref={viewerRef}
          key={open.id}
          src={`${open.fileUrl}?inline=1#navpanes=0&view=FitH`}
          title={open.title}
        />
      </div>}
      {viewerKind === 'image' && <div className="vault-viewer is-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${open.fileUrl}?inline=1`} alt={open.title} />
      </div>}
      {open.fileUrl && open.external && <a className="vault-detail-link" href={open.fileUrl} target="_blank" rel="noreferrer">
        <ExternalLink size={16} /> {T('Open the linked document')}
      </a>}
      {!open.fileUrl && <p className="vault-detail-note">{T('No file is attached to this document.')}</p>}
    </div>}
  </section>;
}
