import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

// The same minimal TypeScript loader the other tests use.
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
    const names = [...code.matchAll(/^export (?:async )?(?:function|const|let|const|class) (\w+)/gm)].map((m) => m[1]);
    code = code.replace(/^import ['"]server-only['"];?/gm, '')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(source)});`)
      .replace(/^export (?=(?:async )?(?:function|const|let|const|class) )/gm, '');
    code += `\nObject.assign(exports, {${[...new Set(names)].join(',')}});`;
    const require = (name) => {
      if (name in overrides) return overrides[name];
      if (!name.startsWith('.') && !name.startsWith('@/')) return nodeRequire(name);
      const target = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(file), name);
      return load(`${target}.ts`);
    };
    new Function('exports', 'require', code)(exports, require);
    return exports;
  }
  return load;
}

/* ------------------------------------------------------------------------------------------
 * The register columns
 * ---------------------------------------------------------------------------------------- */

test('a document carries the register columns through validation', () => {
  const validation = loader()('lib/content/validation.ts');

  const input = validation.validDocumentInput({
    category: 'sop-swp', title: 'Grinder operation', status: 'published',
    department: '  Mechanical ', section: 'Workshop',
    documentCode: 'SOP-MECH-001', revision: 'Rev-02', validUpto: '2027-10-15'
  });
  assert.ok(input);
  assert.equal(input.department, 'Mechanical');
  assert.equal(input.section, 'Workshop');
  assert.equal(input.review_due_date, '2027-10-15', 'valid upto is stored as the review date');
  assert.equal(input.document_code, 'SOP-MECH-001');

  // A field that was not sent must not be erased by a publish/unpublish toggle.
  const toggle = validation.validDocumentInput({ category: 'sop-swp', title: 'Grinder operation', status: 'draft' });
  assert.equal('department' in toggle, false);
  assert.equal('section' in toggle, false);
  assert.equal('review_due_date' in toggle, false);

  // An explicit empty value clears the field.
  const cleared = validation.validDocumentInput({ category: 'sop-swp', title: 'x', department: '', section: '' });
  assert.equal(cleared.department, null);

  // Rejections.
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', department: 'd'.repeat(81) }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', section: 's'.repeat(81) }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', validUpto: '15-10-2027' }), null);
});

test('the published document exposes the register and hides the storage path', () => {
  const store = loader()('lib/content/store.ts');
  const document = store.mapPublishedDocument({
    id: 'doc-1', category_id: 'cat-1', title: 'Grinder operation', summary: null,
    document_code: 'SOP-MECH-001', document_type: 'sop', revision: 'Rev-02',
    department: 'Mechanical', section: 'Workshop',
    effective_date: '2026-10-01', review_due_date: '2027-10-15',
    status: 'published', storage_path: 'content/t/s/file.pdf',
    original_filename: 'grinder.pdf', mime_type: null,
    external_url: null, sort_order: 0, published_at: '2026-10-05T05:00:00Z'
  }, 'sop-swp');

  assert.equal(document.department, 'Mechanical');
  assert.equal(document.section, 'Workshop');
  assert.equal(document.validUpto, '2027-10-15');
  assert.equal(document.mimeType, 'application/pdf', 'the MIME type is derived when the row predates it');
  assert.equal(document.external, false);
  assert.equal('storage_path' in document, false);

  const linkOnly = store.mapPublishedDocument({
    id: 'doc-2', category_id: 'cat-1', title: 'Policy', summary: null,
    document_code: null, document_type: 'policy', revision: null,
    effective_date: null, review_due_date: null, status: 'published',
    storage_path: null, original_filename: null, mime_type: null,
    external_url: 'https://example.com/policy.pdf', sort_order: 0, published_at: null
  }, 'policies-procedures');
  assert.equal(linkOnly.external, true, 'a link row is opened as a link, not streamed');
  assert.equal(linkOnly.mimeType, null);
  assert.equal(linkOnly.department, null);
});

test('validity is computed from the review date, with a 30-day warning', () => {
  const register = loader()('lib/content/register.ts');

  assert.equal(register.registerDate('2027-10-15'), '15-10-2027');
  assert.equal(register.registerDate('2027-10-15T00:00:00Z'), '15-10-2027');
  assert.equal(register.registerDate(null), '—');

  assert.deepEqual(register.registerValidity('2027-10-15', '2026-10-21'), { key: 'valid', label: 'Valid' });
  assert.deepEqual(register.registerValidity('2026-11-05', '2026-10-21'), { key: 'due', label: 'Due soon' });
  assert.deepEqual(register.registerValidity('2026-10-20', '2026-10-21'), { key: 'expired', label: 'Expired' });
  assert.deepEqual(register.registerValidity(null, '2026-10-21'), { key: 'valid', label: 'Valid' }, 'no review date still reads Valid');
  // The boundary itself is still upcoming, not expired.
  assert.deepEqual(register.registerValidity('2026-10-21', '2026-10-21'), { key: 'due', label: 'Due soon' });
});

/* ------------------------------------------------------------------------------------------
 * The shelf screen
 * ---------------------------------------------------------------------------------------- */

test('the shelf shows the register columns and opens the document in place', () => {
  const shelf = readFileSync('app/components/VaultShelf.tsx', 'utf8');
  for (const heading of ['Sl. No.', 'Dept.', 'Sec.', 'Type of Doc', 'Validity Upto', 'Status', 'View']) {
    assert.ok(shelf.includes(`'${heading}'`), `the register has a ${heading} column`);
  }
  assert.ok(shelf.includes('registerValidity'), 'the status chip is derived from the validity date');
  // The file is streamed from this origin so it can be framed by the app itself.
  assert.ok(shelf.includes('?inline=1'));
  assert.ok(shelf.includes('?download=1'));
  assert.equal(shelf.includes('demo'), false, 'the register has no sample rows');
});

test('a phone card keeps one structure on every shelf', () => {
  const shelf = readFileSync('app/components/VaultShelf.tsx', 'utf8');
  const css = readFileSync('app/globals.css', 'utf8');

  // Line one: serial number + document name. Line two: document number, status, View.
  assert.ok(shelf.includes('vault-card-top'));
  assert.ok(shelf.includes('vault-card-index'));
  assert.ok(shelf.includes('vault-card-code'));
  assert.ok(shelf.includes('vault-card-meta'));

  const card = shelf.slice(shelf.indexOf('<div className="vault-card-list">'), shelf.indexOf('{open && <div className="vault-detail"'));
  assert.ok(card.includes('{index + 1}'), 'the card carries the serial number');
  assert.ok(card.includes('document.title'), 'the card carries the document name');
  assert.ok(card.includes('document.documentCode'), 'the card carries the document number');
  assert.ok(card.includes('vault-status'), 'the card carries the status');
  assert.ok(card.includes("T('View')"), 'the card carries View');
  for (const gone of ['Dept.', 'Sec.', 'Type of Doc', 'Validity Upto']) {
    assert.equal(card.includes(`T('${gone}')`), false, `${gone} is not repeated on a phone card`);
  }

  const phone = css.slice(css.indexOf('@media (max-width: 760px) {'), css.indexOf('@media (max-width: 460px)'));
  assert.ok(phone.includes('.vault-register-wrap { display: none; }'), 'the wide table steps aside on a phone');
  assert.ok(phone.includes('.vault-card-list { display: grid;'));
  assert.ok(phone.includes('.vault-card-meta { display: flex'), 'the second line stays horizontal');
  assert.equal(phone.includes('grid-template-columns: 92px minmax(0, 1fr)'), false, 'no stacked field list');
});

test('the register has no filter bar', () => {
  const shelf = readFileSync('app/components/VaultShelf.tsx', 'utf8');
  const css = readFileSync('app/globals.css', 'utf8');
  for (const gone of ['vault-filter-bar', 'All Department', 'All Section', 'All Document Type', 'Latest First', 'Reset']) {
    assert.equal(shelf.includes(gone), false, `${gone} is gone from the shelf`);
  }
  assert.equal(css.includes('.vault-filter-bar'), false, 'the filter styles are gone too');
});

test('viewing, printing and downloading all stay on the same page', () => {
  const shelf = readFileSync('app/components/VaultShelf.tsx', 'utf8');
  // The action block sits between the document heading and the viewer.
  const actions = shelf.slice(shelf.indexOf('vault-detail-actions'), shelf.indexOf('vault-viewer'));
  assert.equal(actions.includes('_blank'), false, 'Print and Download do not open a tab');
  assert.ok(actions.includes('Print'));
  assert.ok(actions.includes('?download=1'));
  assert.ok(actions.includes('download'), 'the download is a file save, not a page');

  // Printing uses the frame that is already on screen, with a page-print fallback.
  assert.ok(shelf.includes('contentWindow'));
  assert.ok(shelf.includes('target.print()'));
  assert.ok(shelf.includes('window.print()'));
  const css = readFileSync('app/globals.css', 'utf8');
  assert.ok(css.includes('@media print'), 'the print stylesheet hides the app chrome');
});

test('every shelf opens the same register screen', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.ok(page.includes("import { VaultShelf }"));
  assert.ok(page.includes("setPage('library')"), 'a shelf opens inside the library page');
  assert.ok(page.includes('<VaultShelf'));
  assert.equal(page.includes('VaultCategoryDialog'), false, 'the old list-only popup is gone');

  const vault = readFileSync('app/components/DocumentVault.tsx', 'utf8');
  const shelfIds = ['sop-swp', 'risk-assessments', 'legal-compliance', 'policies-procedures'];
  for (const id of shelfIds) assert.ok(vault.includes(`'${id}'`), `${id} is a shelf`);
});

test('the publishing panel collects the register fields', () => {
  const panel = readFileSync('app/admin/publish/page.tsx', 'utf8');
  assert.ok(panel.includes('Department'));
  assert.ok(panel.includes('Section'));
  assert.ok(panel.includes('Valid upto'));
  assert.ok(panel.includes('validUpto'));
  assert.ok(panel.includes('department: docDraft.department'));
});

test('the viewer route streams a published file and refuses an unpublished one', () => {
  const route = readFileSync('app/api/content/file/[kind]/[id]/route.ts', 'utf8');
  assert.ok(route.includes("searchParams.get('inline')"));
  assert.ok(route.includes('resolvePublishedFileAsset'));
  assert.ok(route.includes("'Content-Type': mimeType"));
  assert.ok(route.includes('inline; filename='));
  assert.ok(route.includes('302'), 'a plain link still redirects to a short-lived URL');

  // The file route is the only one allowed to be framed, and only by this app.
  const config = readFileSync('next.config.ts', 'utf8');
  assert.ok(config.includes("frame-src 'self'"));
  assert.ok(config.includes('SAMEORIGIN'));
  assert.ok(config.includes('frame-ancestors \'self\''));
});

test('the register migration adds department and section', () => {
  const sql = readFileSync('supabase/migrations/202610210006_document_register_fields.sql', 'utf8');
  assert.ok(sql.includes('add column if not exists department text'));
  assert.ok(sql.includes('add column if not exists section text'));
});
