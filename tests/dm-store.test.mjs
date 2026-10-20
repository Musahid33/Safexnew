import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes, createRequire } from 'node:module';

/**
 * The DM store against a fake Supabase.
 *
 * The reference suffix rule is the part of this feature most likely to break silently: a
 * second plan filed on the same day must become DM-21-10-26-2, not overwrite the first.
 * That logic lives in `saveDmPlan`, so the tests drive the real function through a client
 * that answers like PostgREST does — including the 23505 a unique index raises.
 */

const nodeRequire = createRequire('/home/user/Safexnew/package.json');

const TENANT = 'd3d586dd-9f77-4363-b9ef-7e1a75e82bf3';
const SITE = '615470fa-b2d9-4589-82ad-a98e97ccf64a';
const RECORD_ID = '0b6f2f60-1111-4a4a-8b8b-000000000001';

function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
    const names = [...code.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);
    code = code.replace(/^import ['"]server-only['"];?/gm, '')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(source)});`)
      .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '');
    code += `\nObject.assign(exports, {${[...new Set(names)].join(',')}});`;
    const require = (name) => {
      if (name === 'server-only') return {};
      if (name in overrides) return overrides[name];
      const target = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(file), name);
      return load(`${target}.ts`);
    };
    new Function('exports', 'require', code)(exports, require);
    return exports;
  }
  return load;
}

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.state = { op: 'select', filters: [] };
  }
  select(columns, options) { this.state.columns = columns; this.state.count = options?.count; return this; }
  insert(row) { this.state.op = 'insert'; this.state.row = row; return this; }
  update(row) { this.state.op = 'update'; this.state.row = row; return this; }
  eq(column, value) { this.state.filters.push([column, value]); return this; }
  order(column, options) { this.state.order = [...(this.state.order ?? []), [column, options]]; return this; }
  range(from, to) { this.state.range = [from, to]; return this; }
  limit(count) { this.state.limit = count; return this; }
  maybeSingle() { this.state.single = 'maybe'; return this; }
  then(resolve) {
    const { table, state } = this;
    const client = this.client;
    const settle = (value) => resolve(value);
    if (table === 'tenants') {
      return settle({ data: [{ id: TENANT, slug: 'emveess-infraventures', company_name: 'EMVEESS INFRAVENTURES PVT. LTD.' }], error: null });
    }
    if (table === 'sites') {
      return settle(state.single === 'maybe' ? { data: { id: SITE }, error: null } : { data: [{ name: 'West Bokaro' }], error: null });
    }
    if (table !== 'daily_management_plans') return settle({ data: [], error: null });

    if (state.op === 'insert') {
      client.inserts.push(state.row);
      if (client.existing.has(state.row.reference)) {
        return settle({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
      }
      client.existing.add(state.row.reference);
      return settle({
        data: [{
          id: RECORD_ID,
          reference: state.row.reference,
          plan_date: state.row.plan_date,
          shift: state.row.shift,
          supervisor_name: state.row.supervisor_name,
          supervisor_employee_no: state.row.supervisor_employee_no,
          location: state.row.location,
          modules_filled: state.row.modules_filled,
          status: state.row.status,
          pdf_path: null,
          created_at: '2026-10-21T09:30:00.000Z'
        }],
        error: null
      });
    }
    if (state.op === 'update') {
      client.updates.push({ row: state.row, filters: state.filters });
      return settle({ error: null });
    }
    if (state.limit === 1 && state.filters.some(([column]) => column === 'id')) {
      return settle({ data: client.stored, error: null });
    }
    return settle({ data: client.stored, count: client.stored.length, error: null });
  }
}

function fakeClient(options = {}) {
  const client = {
    inserts: [],
    updates: [],
    uploads: [],
    existing: new Set(options.existing ?? []),
    stored: options.stored ?? []
  };
  client.from = (table) => new FakeQuery(client, table);
  client.storage = {
    from: (bucket) => ({
      upload: async (path, bytes, init) => {
        client.uploads.push({ bucket, path, bytes, init });
        return options.uploadError ? { error: options.uploadError } : { error: null };
      },
      download: async (path) => {
        client.downloadPath = path;
        if (!options.downloadBytes) return { error: { message: 'not found' } };
        // A Buffer may share a pooled ArrayBuffer, so copy exactly its bytes.
        const copy = new Uint8Array(options.downloadBytes);
        return { data: { arrayBuffer: async () => copy.buffer }, error: null };
      }
    })
  };
  return client;
}

function loadStore(client) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-for-tests';
  process.env.SAFEX_TENANT_SLUG = 'emveess-infraventures';
  return loader({
    '@supabase/supabase-js': { createClient: () => client },
    'pdf-lib': nodeRequire('pdf-lib')
  })('lib/dm/store.ts');
}

async function filledPlan() {
  const plan = loader()('lib/dm/plan.ts').emptyPlan('2026-10-21');
  plan.supervisor = 'Musahid Ansari';
  plan.supervisorNo = 'EIPL-1042';
  plan.location = 'Stockyard';
  plan.modules.tbt.attendees = '18';
  plan.modules.tbt.theme = 'Work at height';
  plan.modules.ppe = [{ employee: 'Ravi Kumar', issue: 'Missing PPE', item: 'Helmet', remarks: '' }];
  // Filing requires the declaration and the drawn signature, so the fixture is signed.
  plan.signOff = {
    declared: true,
    signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    signedAt: '2026-10-21T04:12:00.000Z'
  };
  return plan;
}

test('filing a plan stores the reference, the progress and the archived PDF', async () => {
  const client = fakeClient();
  const store = loadStore(client);
  const result = await store.saveDmPlan({ siteSlug: 'wbd', input: await filledPlan(), companyName: 'EMVEESS', siteName: 'West Bokaro' });

  assert.equal(result.ok, true);
  assert.equal(result.record.reference, 'DM-21-10-26');
  assert.equal(result.record.modulesFilled, 2);
  assert.equal(result.record.hasPdf, true);

  const [row] = client.inserts;
  assert.equal(row.tenant_id, TENANT);
  assert.equal(row.site_id, SITE);
  assert.equal(row.plan_date, '2026-10-21');
  assert.equal(row.shift, 'General');
  assert.equal(row.supervisor_name, 'Musahid Ansari');
  assert.equal(row.status, 'submitted');
  assert.equal(row.modules_filled, 2);
  assert.equal(row.payload.modules.tbt.attendees, '18');

  const [upload] = client.uploads;
  assert.equal(upload.bucket, 'dm-records');
  assert.equal(upload.path, `${TENANT}/DM-21-10-26.pdf`);
  assert.equal(upload.init.contentType, 'application/pdf');
  assert.equal(Buffer.from(upload.bytes.subarray(0, 5)).toString(), '%PDF-');

  assert.equal(client.updates.length, 1);
  assert.equal(client.updates[0].row.pdf_path, `${TENANT}/DM-21-10-26.pdf`);
});

test('a second plan on the same date becomes -2, then -3', async () => {
  const client = fakeClient({ existing: ['DM-21-10-26', 'DM-21-10-26-2'] });
  const store = loadStore(client);
  const result = await store.saveDmPlan({ siteSlug: 'wbd', input: await filledPlan() });

  assert.equal(result.ok, true);
  assert.equal(result.record.reference, 'DM-21-10-26-3');
  // Two rejected attempts, then the one that landed.
  assert.deepEqual(client.inserts.map((row) => row.reference), ['DM-21-10-26', 'DM-21-10-26-2', 'DM-21-10-26-3']);
  assert.equal(client.uploads[0].path.endsWith('/DM-21-10-26-3.pdf'), true);
});

test('a record survives an upload failure and its PDF is rebuilt on download', async () => {
  const client = fakeClient({ uploadError: { message: 'bucket unavailable' } });
  const store = loadStore(client);

  const saved = await store.saveDmPlan({ siteSlug: 'wbd', input: await filledPlan() });
  assert.equal(saved.ok, true);
  // The row exists; only the archived copy failed.
  assert.equal(saved.record.hasPdf, false);
  assert.equal(client.updates.length, 0);

  client.stored = [{
    id: RECORD_ID,
    reference: 'DM-21-10-26',
    plan_date: '2026-10-21',
    shift: 'General',
    supervisor_name: 'Musahid Ansari',
    supervisor_employee_no: 'EIPL-1042',
    location: 'Stockyard',
    modules_filled: 2,
    status: 'submitted',
    pdf_path: null,
    created_at: '2026-10-21T09:30:00.000Z',
    payload: await filledPlan()
  }];

  const pdf = await store.readDmPdf(RECORD_ID, { siteName: 'West Bokaro', companyName: 'EMVEESS' });
  assert.equal(pdf.ok, true);
  assert.equal(pdf.filename, 'DM-21-10-26.pdf');
  assert.equal(Buffer.from(pdf.bytes.subarray(0, 5)).toString(), '%PDF-');
});

test('an invalid plan never reaches the database', async () => {
  const client = fakeClient();
  const store = loadStore(client);

  const rejected = await store.saveDmPlan({ siteSlug: 'wbd', input: { date: '', supervisor: '' } });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'VALIDATION');
  assert.match(rejected.error, /plan date/);
  assert.equal(client.inserts.length, 0);
});

test('a plan cannot be filed without a site', async () => {
  const client = fakeClient();
  const store = loadStore(client);
  const result = await store.saveDmPlan({ siteSlug: '', input: await filledPlan() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_SITE');
  assert.equal(client.inserts.length, 0);
});

test('the archive lists filed plans newest first with their progress', async () => {
  const client = fakeClient({
    stored: [
      {
        id: RECORD_ID,
        reference: 'DM-21-10-26',
        plan_date: '2026-10-21',
        shift: 'A',
        supervisor_name: 'Musahid Ansari',
        supervisor_employee_no: 'EIPL-1042',
        location: 'Stockyard',
        modules_filled: 11,
        status: 'submitted',
        pdf_path: `${TENANT}/DM-21-10-26.pdf`,
        created_at: '2026-10-21T09:30:00.000Z'
      }
    ]
  });
  const store = loadStore(client);
  const page = await store.listDmPlans({ siteSlug: 'all', limit: 50, offset: 0 });

  assert.ok(page);
  assert.equal(page.total, 1);
  assert.deepEqual(page.records.map((record) => record.reference), ['DM-21-10-26']);
  assert.equal(page.records[0].modulesFilled, 11);
  assert.equal(page.records[0].hasPdf, true);
});

test('the archived PDF is served from the bucket when it is there', async () => {
  const archived = Buffer.from('%PDF-1.7 archived copy');
  const client = fakeClient({
    downloadBytes: archived,
    stored: [{
      id: RECORD_ID,
      reference: 'DM-21-10-26',
      plan_date: '2026-10-21',
      shift: 'General',
      supervisor_name: 'Musahid Ansari',
      supervisor_employee_no: 'EIPL-1042',
      location: 'Stockyard',
      modules_filled: 2,
      status: 'submitted',
      pdf_path: `${TENANT}/DM-21-10-26.pdf`,
      created_at: '2026-10-21T09:30:00.000Z',
      payload: await filledPlan()
    }]
  });
  const store = loadStore(client);
  const pdf = await store.readDmPdf(RECORD_ID);

  assert.equal(pdf.ok, true);
  assert.equal(client.downloadPath, `${TENANT}/DM-21-10-26.pdf`);
  // The stored bytes come back untouched, not re-rendered.
  assert.equal(Buffer.from(pdf.bytes).toString(), archived.toString());
});

test('an unknown record is a 404, not an empty document', async () => {
  const client = fakeClient({ stored: [] });
  const store = loadStore(client);
  const pdf = await store.readDmPdf(RECORD_ID);
  assert.equal(pdf.ok, false);
  assert.equal(pdf.code, 'NOT_FOUND');
  assert.ok(nodeRequire('pdf-lib'));
});


test('an unsigned plan never reaches the database', async () => {
  const client = fakeClient();
  const store = loadStore(client);
  const plan = await filledPlan();
  plan.signOff = { declared: false, signature: '', signedAt: '' };

  const result = await store.saveDmPlan({ siteSlug: 'wbd', input: plan });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION');
  assert.match(result.error, /declaration/i);
  assert.equal(client.inserts.length, 0);
});
