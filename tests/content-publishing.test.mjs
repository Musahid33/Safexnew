import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

// Same minimal TypeScript loader the other tests use: strip types, resolve relative
// imports, no extra runtime dependency.
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

const TENANT = 'tenant-1';
const SITE_ID = 'site-1';

/**
 * A stand-in for the admin Supabase client.
 *
 * `tables` maps a table name to a function returning a response (or an array of responses,
 * consumed in order, so a test can make the first read fail and the retry succeed).
 */
function fakeAdmin(config = {}) {
  const queries = [];
  const signed = [];
  const calls = new Map();

  function nextResult(table) {
    const entry = config.tables?.[table];
    if (!entry) return { data: [], error: null, count: 0 };
    if (typeof entry === 'function') return entry();
    if (Array.isArray(entry)) {
      const index = calls.get(table) ?? 0;
      calls.set(table, index + 1);
      return entry[Math.min(index, entry.length - 1)];
    }
    return entry;
  }

  function builder(table) {
    const entry = { table, select: null, count: null, filters: [], orders: [], limit: null };
    queries.push(entry);
    const api = {
      select(columns, options) { entry.select = columns; entry.count = options?.count ?? null; return api; },
      eq(column, value) { entry.filters.push([column, value]); return api; },
      in(column, values) { entry.filters.push([column, { in: values }]); return api; },
      order(column, options) { entry.orders.push([column, options]); return api; },
      limit(value) { entry.limit = value; return api; },
      range(from, to) { entry.range = [from, to]; return api; },
      maybeSingle() { return Promise.resolve(nextResult(table)); },
      then(onFulfilled, onRejected) { return Promise.resolve(nextResult(table)).then(onFulfilled, onRejected); }
    };
    return api;
  }

  return {
    queries,
    signed,
    from: (table) => builder(table),
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            signed.push({ bucket, path, ttl });
            if (config.signing === 'fail') return { data: null, error: { message: 'storage down' } };
            return { data: { signedUrl: `https://storage.test/${bucket}/${path}?token=t` }, error: null };
          }
        };
      }
    }
  };
}

function loadStore(client) {
  return loader({
    '@/lib/supabase/admin': { getAdminSupabase: () => client },
    '@/lib/employee-master/db-source': { resolveTenantId: async () => TENANT }
  })('lib/content/store.ts');
}

const SITE = { data: { id: SITE_ID, slug: 'wbd', name: 'WEST BOKARO', region: 'Jharkhand' }, error: null };

function documentRow(overrides = {}) {
  return {
    id: 'doc-1',
    category_id: 'cat-1',
    title: 'Working at height procedure',
    summary: 'Ladder and scaffold rules',
    document_code: 'SOP-012',
    document_type: 'sop',
    revision: 'R3',
    effective_date: '2026-10-01',
    status: 'published',
    storage_path: 'content/t/s/doc-1.pdf',
    original_filename: 'height.pdf',
    external_url: null,
    sort_order: 1,
    published_at: '2026-10-02T06:00:00Z',
    updated_at: '2026-10-02T06:00:00Z',
    ...overrides
  };
}

function announcementRow(overrides = {}) {
  return {
    id: 'post-1',
    post_type: 'circular',
    title: 'Monsoon safety advisory',
    summary: 'Slippery walkways',
    body: 'Full text of the circular.',
    priority: 'important',
    published_on: '2026-10-05',
    status: 'published',
    attachment_path: null,
    external_url: null,
    published_at: '2026-10-05T05:00:00Z',
    expires_at: null,
    updated_at: '2026-10-05T05:00:00Z',
    ...overrides
  };
}

function eventRow(overrides = {}) {
  return {
    id: 'event-1',
    title: 'Fire drill',
    topic: 'Quarterly evacuation drill',
    description: 'Assembly point B.',
    starts_at: '2026-11-01T04:30:00Z',
    ends_at: null,
    venue: 'Gate 2',
    status: 'published',
    published_at: '2026-10-20T05:00:00Z',
    updated_at: '2026-10-20T05:00:00Z',
    ...overrides
  };
}

/* ------------------------------------------------------------------------------------------
 * Catalogue and validation
 * ---------------------------------------------------------------------------------------- */

test('the four shelves map to the stored category keys', () => {
  const catalog = loader()('lib/content/catalog.ts');
  assert.equal(catalog.VAULT_CATEGORIES['sop-swp'].dbKey, 'sop_swp');
  assert.equal(catalog.VAULT_CATEGORIES['risk-assessments'].dbKey, 'risk_assessments');
  assert.equal(catalog.VAULT_CATEGORIES['legal-compliance'].dbKey, 'legal_statutory_compliance');
  assert.equal(catalog.VAULT_CATEGORIES['policies-procedures'].dbKey, 'policy_procedures');
  assert.equal(catalog.vaultCategoryFromDbKey('sop_swp'), 'sop-swp');
  assert.equal(catalog.vaultCategoryFromDbKey('minutes_of_meeting'), null);
  assert.deepEqual(catalog.vaultCategoriesForPublishing().map((shelf) => shelf.id), [...catalog.VAULT_CATEGORY_IDS]);
});

test('a document is validated and mapped to exact columns', () => {
  const validation = loader()('lib/content/validation.ts');

  const draft = validation.validDocumentInput({
    category: 'risk-assessments', title: '  Height risk assessment  ', revision: 'R1',
    status: 'draft', filePath: 'content/t/s/a.pdf', fileName: 'a.pdf'
  });
  assert.ok(draft);
  assert.equal(draft.title, 'Height risk assessment');
  assert.equal(draft.document_type, 'risk_assessment', 'the shelf supplies the default type');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.published_at, null, 'a draft has no publish timestamp');

  const published = validation.validDocumentInput({ category: 'sop-swp', title: 'SOP', status: 'published' });
  assert.ok(published.published_at, 'publishing stamps the time');

  // Rejections
  assert.equal(validation.validDocumentInput({ category: 'nope', title: 'x' }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: '   ' }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', status: 'live' }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', sortOrder: -1 }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x'.repeat(161) }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', externalUrl: 'http://insecure.example/a.pdf' }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', externalUrl: 'javascript:alert(1)' }), null);
  assert.equal(validation.validDocumentInput({ category: 'sop-swp', title: 'x', filePath: '../../etc/passwd' }), null);
});

test('a status-only edit leaves the stored file untouched', () => {
  const validation = loader()('lib/content/validation.ts');
  const changed = validation.validDocumentInput({ category: 'sop-swp', title: 'SOP', status: 'published' });
  assert.equal('storage_path' in changed, false, 'absent filePath means "keep what is stored"');
  assert.equal('external_url' in changed, false);

  const cleared = validation.validDocumentInput({ category: 'sop-swp', title: 'SOP', filePath: '', externalUrl: '' });
  assert.equal(cleared.storage_path, null, 'an explicit empty value clears it');
  assert.equal(cleared.external_url, null);
});

test('circulars, notices and events are validated', () => {
  const validation = loader()('lib/content/validation.ts');

  const circular = validation.validAnnouncementInput({
    kind: 'announcement', type: 'circular', title: 'Monsoon advisory', summary: 'Slippery',
    body: 'Text', priority: 'urgent', publishedOn: '2026-10-05', status: 'published'
  });
  assert.ok(circular);
  assert.equal(circular.post_type, 'circular');
  assert.equal(circular.priority, 'urgent');
  assert.equal(circular.published_on, '2026-10-05');

  const notice = validation.validAnnouncementInput({ type: 'notice', title: 'Notice', status: 'draft' });
  assert.equal(notice.post_type, 'notice');
  assert.equal(notice.priority, 'normal');
  assert.equal(notice.status, 'draft');

  assert.equal(validation.validAnnouncementInput({ type: 'event', title: 'x' }), null);
  assert.equal(validation.validAnnouncementInput({ type: 'notice', title: 'x', publishedOn: '05-10-2026' }), null);
  assert.equal(validation.validAnnouncementInput({ type: 'notice', title: 'x', status: 'live' }), null);

  const event = validation.validEventInput({
    title: 'Fire drill', startsAt: '2026-11-01T10:00:00+05:30', endsAt: '2026-11-01T11:00:00+05:30',
    venue: 'Gate 2', status: 'published'
  });
  assert.ok(event);
  assert.equal(event.starts_at, '2026-11-01T04:30:00.000Z', 'stored as an instant');
  assert.equal(event.status, 'published');

  assert.equal(validation.validEventInput({ title: 'No start' }), null);
  assert.equal(validation.validEventInput({ title: 'Backwards', startsAt: '2026-11-01T10:00:00Z', endsAt: '2026-11-01T09:00:00Z' }), null);
  assert.equal(validation.validEventInput({ title: 'x', startsAt: 'not a date' }), null);
});

/* ------------------------------------------------------------------------------------------
 * Mapping
 * ---------------------------------------------------------------------------------------- */

test('published rows map to the app shapes and drop anything unknown', () => {
  const store = loader()('lib/content/store.ts');

  const document = store.mapPublishedDocument(documentRow(), 'sop-swp');
  assert.equal(document.category, 'sop-swp');
  assert.equal(document.documentType, 'sop');
  assert.equal(document.fileUrl, '/api/content/file/document/doc-1');
  assert.equal('storage_path' in document, false, 'the bucket path never leaves the server');

  assert.equal(store.mapPublishedDocument(documentRow(), null), null, 'an unknown category is not shown');

  const circular = store.mapAnnouncement(announcementRow());
  assert.equal(circular.type, 'Circular');
  assert.equal(circular.date, '2026-10-05T05:00:00Z');

  const dateOnly = store.mapAnnouncement(announcementRow({ published_at: null }));
  assert.equal(dateOnly.date, '2026-10-05T12:00:00+05:30', 'a date-only post is read at site noon');

  const withLink = store.mapAnnouncement(announcementRow({ external_url: 'https://example.com/a.pdf' }));
  assert.equal(withLink.attachmentUrl, '/api/content/file/announcement/post-1');

  assert.equal(store.mapAnnouncement(announcementRow({ post_type: 'event' })), null);

  const event = store.mapEvent(eventRow());
  assert.equal(event.type, 'Event');
  assert.equal(event.location, 'Gate 2');
  assert.equal(event.summary, 'Quarterly evacuation drill');
});

test('expired and unpublished announcements are not live', () => {
  const store = loader()('lib/content/store.ts');
  const now = Date.parse('2026-10-21T00:00:00Z');

  assert.equal(store.isLiveAnnouncement(announcementRow(), now), true);
  assert.equal(store.isLiveAnnouncement(announcementRow({ status: 'draft' }), now), false);
  assert.equal(store.isLiveAnnouncement(announcementRow({ expires_at: '2026-10-20T00:00:00Z' }), now), false);
  assert.equal(store.isLiveAnnouncement(announcementRow({ expires_at: '2026-12-01T00:00:00Z' }), now), true);
});

test('the feed is ordered newest first', () => {
  const store = loader()('lib/content/store.ts');
  const sorted = store.sortContentFeed([
    { id: 'a', type: 'Notice', title: 'A', date: '2026-10-01T00:00:00Z', summary: '', details: '', attachmentUrl: null },
    { id: 'b', type: 'Event', title: 'B', date: '2026-11-01T00:00:00Z', summary: '', details: '', attachmentUrl: null }
  ]);
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'a']);
});

/* ------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------- */

test('published content is scoped to the tenant and the site, published only', async () => {
  const client = fakeAdmin({
    tables: {
      sites: SITE,
      document_categories: { data: [{ id: 'cat-1', category_key: 'sop_swp' }], error: null },
      documents: { data: [documentRow()], error: null },
      site_announcements: { data: [announcementRow()], error: null },
      site_events: { data: [eventRow()], error: null }
    }
  });
  const store = loadStore(client);
  const content = await store.readPublishedContent('wbd');

  assert.ok(content);
  assert.deepEqual(content.documents.map((row) => row.title), ['Working at height procedure']);
  assert.deepEqual(content.feed.map((row) => row.type).sort(), ['Circular', 'Event']);

  for (const table of ['documents', 'site_announcements', 'site_events']) {
    const query = client.queries.find((entry) => entry.table === table);
    const filters = new Map(query.filters.map(([column, value]) => [column, value]));
    assert.equal(filters.get('company_id'), TENANT, `${table} is tenant-scoped`);
    assert.equal(filters.get('location_id'), SITE_ID, `${table} is site-scoped`);
    assert.equal(filters.get('status'), 'published', `${table} only reads published rows`);
  }
});

test('an unknown site reads nothing instead of everything', async () => {
  const client = fakeAdmin({ tables: { sites: { data: null, error: null } } });
  const content = await loadStore(client).readPublishedContent('typo-site');
  assert.equal(content, null);
  assert.equal(client.queries.some((entry) => entry.table === 'documents'), false);
});

test('an expired announcement disappears from the feed', async () => {
  const client = fakeAdmin({
    tables: {
      sites: SITE,
      document_categories: { data: [{ id: 'cat-1', category_key: 'sop_swp' }], error: null },
      documents: { data: [], error: null },
      site_announcements: {
        data: [announcementRow({ expires_at: '2020-01-01T00:00:00Z' }), announcementRow({ id: 'post-2', title: 'Still live' })],
        error: null
      },
      site_events: { data: [], error: null }
    }
  });
  const content = await loadStore(client).readPublishedContent('wbd');
  assert.deepEqual(content.feed.map((row) => row.title), ['Still live']);
});

test('a database one migration behind still reads documents', async () => {
  // First read asks for external_url, which does not exist yet; the retry must drop it.
  const client = fakeAdmin({
    tables: {
      sites: SITE,
      document_categories: { data: [{ id: 'cat-1', category_key: 'sop_swp' }], error: null },
      documents: [
        { data: null, error: { code: '42703', message: 'column documents.external_url does not exist' } },
        { data: [documentRow()], error: null }
      ],
      site_announcements: { data: [], error: null },
      site_events: { data: [], error: null }
    }
  });
  const content = await loadStore(client).readPublishedContent('wbd');
  assert.equal(content.documents.length, 1);

  const documentQueries = client.queries.filter((entry) => entry.table === 'documents');
  assert.equal(documentQueries.length, 2);
  assert.ok(documentQueries[0].select.includes('external_url'));
  assert.equal(documentQueries[1].select.includes('external_url'), false);
});

test('a file is only served when its row is published', async () => {
  const draft = fakeAdmin({ tables: { documents: { data: { status: 'draft', storage_path: 'a/b.pdf', external_url: null }, error: null } } });
  assert.equal(await loadStore(draft).resolvePublishedFile('document', 'doc-1'), null);

  const published = fakeAdmin({ tables: { documents: { data: { status: 'published', storage_path: 'a/b.pdf', external_url: null }, error: null } } });
  const url = await loadStore(published).resolvePublishedFile('document', 'doc-1');
  assert.match(url, /^https:\/\/storage\.test\/safex-content\//);
  assert.equal(published.signed[0].bucket, 'safex-content');
  assert.ok(published.signed[0].ttl <= 300, 'the link is short-lived');

  const external = fakeAdmin({ tables: { documents: { data: { status: 'published', storage_path: null, external_url: 'https://example.com/a.pdf' }, error: null } } });
  assert.equal(await loadStore(external).resolvePublishedFile('document', 'doc-1'), 'https://example.com/a.pdf');

  const expired = fakeAdmin({ tables: { site_announcements: { data: { status: 'published', attachment_path: 'a/b.pdf', external_url: null, expires_at: '2020-01-01T00:00:00Z' }, error: null } } });
  assert.equal(await loadStore(expired).resolvePublishedFile('announcement', 'post-1'), null);
});

/* ------------------------------------------------------------------------------------------
 * Routes and screens
 * ---------------------------------------------------------------------------------------- */

test('the public route reads published content and asks for no credentials', () => {
  const route = readFileSync('app/api/content/route.ts', 'utf8');
  assert.ok(route.includes('readPublishedContent'));
  assert.ok(route.includes('sameOrigin(request)'));
  assert.ok(route.includes('NO_STORE'));
  assert.equal(route.includes('readSession'), false, 'the worker app never needs a session');
  assert.equal(route.includes('employeeNo'), false);

  const store = readFileSync('lib/content/store.ts', 'utf8');
  assert.ok(store.includes(".eq('status', 'published')"));
  assert.ok(store.includes("eq('company_id', store.tenantId)"));
});

test('the publishing API is staff-only and site-scoped', () => {
  const route = readFileSync('app/api/admin/content/route.ts', 'utf8');
  assert.ok(route.includes('readSession(request)'), 'writes require the admin session');
  assert.ok(route.includes('sameOrigin(request)'));
  assert.ok(route.includes('validDocumentInput'));
  assert.ok(route.includes('validAnnouncementInput'));
  assert.ok(route.includes('validEventInput'));
  assert.equal(route.includes('SUPABASE_SERVICE_ROLE_KEY'), false);

  const writes = readFileSync('lib/content/writes.ts', 'utf8');
  assert.ok(writes.includes(".eq('company_id', store.tenantId)"));
  assert.ok(writes.includes(".eq('location_id', siteId)"));

  const upload = readFileSync('app/api/admin/content/upload/route.ts', 'utf8');
  assert.ok(upload.includes('readSession(request)'));
  assert.ok(upload.includes('application/pdf'));
  assert.ok(upload.includes('MAX_BYTES'));
});

test('the migration adds every column the store reads', () => {
  const sql = readFileSync('supabase/migrations/202610210005_content_publishing.sql', 'utf8');
  // A column the store selects but the migration never adds makes every read fail with 42703.
  for (const column of ['external_url', 'sort_order']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), `${column} must be added`);
  }
  assert.ok(sql.includes('documents_external_url_https'));
  assert.ok(sql.includes('site_announcements_external_url_https'));
  assert.ok(sql.includes("'safex-content'"));
  assert.ok(sql.includes('to service_role'));
});

test('the worker app loads documents and the feed from the database', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.ok(page.includes('fetch(`/api/content?site=${encodeURIComponent(siteId)}`'));
  assert.ok(page.includes('setVaultDocuments('));
  assert.ok(page.includes('setContentFeed('));
  assert.ok(page.includes('documents={vaultDocuments}'));
  assert.ok(page.includes('items={contentFeed}'));

  const vault = readFileSync('app/components/DocumentVault.tsx', 'utf8');
  assert.ok(vault.includes('documents = []'));
  assert.ok(vault.includes('document.fileUrl'));
  assert.ok(vault.includes('documents.filter((document) => document.category === categoryId)'));
  assert.equal(vault.includes('documents: []'), false, 'no shelf is hard-coded with sample files');

  const feed = readFileSync('app/components/HomeFeedViews.tsx', 'utf8');
  assert.ok(feed.includes('filterFeedItems'));
  assert.ok(feed.includes('items: HomeFeedItem[]'));
});

test('the publishing panel covers all three sections and writes to the database', () => {
  const panel = readFileSync('app/admin/publish/page.tsx', 'utf8');
  assert.ok(panel.includes("tab === 'documents'"));
  assert.ok(panel.includes("tab === 'communications'"));
  assert.ok(panel.includes("tab === 'rewards'"));
  assert.ok(panel.includes("fetch('/api/admin/content'"));
  assert.ok(panel.includes("fetch('/api/admin/content/upload'"));
  assert.ok(panel.includes('RewardsManager'));
  assert.ok(panel.includes('type="file"'));
  assert.ok(panel.includes("status: 'published'") || panel.includes('Published — visible in the app'));

  // The rewards editor is shared with its old URL rather than copied.
  const rewardsPage = readFileSync('app/admin/recognitions/page.tsx', 'utf8');
  assert.ok(rewardsPage.includes("import RewardsManager from '@/app/components/admin/RewardsManager'"));
});
