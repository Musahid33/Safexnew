import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

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

const TENANT = 'tenant-1';
const SITE = 'site-1';

/**
 * A stand-in for the admin Supabase client that records what the query asked for.
 *
 * The point of the fake is to prove the restriction lives in the query — the whitelist, the
 * anonymous filter, the absence of any contact column — not in a `.filter()` after the rows
 * have already been read.
 */
function fakeAdmin(config = {}) {
  const queries = [];
  function builder(table, result) {
    const entry = { table, select: null, count: null, filters: [], orders: [], range: null };
    queries.push(entry);
    const api = {
      select(columns, options) {
        entry.select = columns;
        entry.count = options?.count ?? null;
        return api;
      },
      eq(column, value) { entry.filters.push([column, value]); return api; },
      in(column, values) { entry.filters.push([column, { in: values }]); return api; },
      order(column, options) { entry.orders.push([column, options]); return api; },
      range(from, to) { entry.range = [from, to]; return api; },
      then(resolvePromise, rejectPromise) {
        return Promise.resolve(typeof result === 'function' ? result() : result).then(resolvePromise, rejectPromise);
      }
    };
    return api;
  }
  return {
    queries,
    from(table) {
      if (table === 'reports') return builder(table, config.reports ?? { data: [], error: null, count: 0 });
      if (table === 'report_attachments') return builder(table, config.attachments ?? { data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function loadFeed(client, siteId = SITE) {
  return loader({
    '@/lib/supabase/admin': { getAdminSupabase: () => client },
    '@/lib/employee-master/db-source': {
      resolveTenantId: async () => TENANT,
      resolveSiteId: async (_admin, _tenant, ref) => (ref === 'wbd' ? siteId : null)
    }
  })('lib/reports/site-feed.ts');
}

function reportRow(overrides = {}) {
  return {
    id: 'report-1',
    report_ref: 'NM-26-001',
    report_type: 'near_miss',
    report_category: 'Slip',
    area: 'Ramp 3',
    department: 'HSE',
    occurred_at: '2026-10-20T06:00:00Z',
    created_at: '2026-10-20T07:00:00Z',
    client_submitted_at: '2026-10-20T06:55:00Z',
    severity: 'Medium',
    short_description: 'Oil spill near the ramp',
    description: 'Oil spill near the ramp, cordoned off.',
    immediate_action: 'Area cordoned and cleaned.',
    status: 'open',
    reporter: { full_name: 'Ravi Kumar' },
    ...overrides
  };
}

function filtersOf(query) {
  return new Map(query.filters.map(([column, value]) => [column, value]));
}

test('the feed reads the tenant and the selected site, newest first', async () => {
  const client = fakeAdmin({ reports: { data: [reportRow()], error: null, count: 1 } });
  const feed = loadFeed(client);
  const result = await feed.listLoggedReports({ siteRef: 'wbd', limit: 25 });

  assert.equal(result.ok, true);
  const query = client.queries.find((entry) => entry.table === 'reports');
  const filters = filtersOf(query);
  assert.equal(filters.get('tenant_id'), TENANT);
  assert.equal(filters.get('site_id'), SITE);
  assert.deepEqual(query.orders[0], ['created_at', { ascending: false }]);
  assert.deepEqual(query.range, [0, 24]);
  assert.equal(query.count, 'exact');
});

test('the four confidential types are excluded inside the query', async () => {
  const client = fakeAdmin();
  const feed = loadFeed(client);
  await feed.listLoggedReports({ siteRef: 'wbd' });

  const query = client.queries.find((entry) => entry.table === 'reports');
  const filters = filtersOf(query);
  assert.deepEqual(filters.get('report_type'), {
    in: ['near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act']
  });
  for (const type of ['speak_up', 'grievance', 'feedback', 'suggestion']) {
    assert.equal(filters.get('report_type').in.includes(type), false, `${type} must never be readable here`);
  }
  // Every report type in the database is either in the whitelist or in the console-only list.
  assert.deepEqual([...feed.CONSOLE_ONLY_DB_TYPES], ['speak_up', 'grievance', 'feedback', 'suggestion']);
});

test('anonymous reports are excluded and no contact column is ever selected', async () => {
  const client = fakeAdmin();
  const feed = loadFeed(client);
  await feed.listLoggedReports({ siteRef: 'wbd' });

  const query = client.queries.find((entry) => entry.table === 'reports');
  assert.equal(filtersOf(query).get('anonymous'), false);

  // The request must not carry an Employee ID or a mobile number, and the projection must not
  // ask for one either. A site feed is not a contact list.
  const projection = query.select;
  assert.equal(projection.includes('full_name'), true, 'the reporter name is joined for display');
  for (const forbidden of ['mobile_e164', 'employee_no', 'address', 'blood_group', 'date_of_birth']) {
    assert.equal(projection.includes(forbidden), false, `${forbidden} must never be selected`);
    assert.equal(projection.includes(`?${forbidden}`), false);
  }
});

test('an unknown site reads nothing instead of every report in the tenant', async () => {
  const client = fakeAdmin();
  const feed = loadFeed(client);
  const result = await feed.listLoggedReports({ siteRef: 'typo-site' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reports, []);
  assert.equal(result.total, 0);
  assert.equal(client.queries.some((entry) => entry.table === 'reports'), false, 'no tenant-wide fallback');
});

test('rows are mapped to the app vocabulary and unknown types are dropped', async () => {
  const client = fakeAdmin({
    reports: {
      count: 4,
      error: null,
      data: [
        reportRow(),
        reportRow({ id: 'r2', report_ref: 'HZ-26-002', report_type: 'hazard', status: 'in_progress' }),
        reportRow({ id: 'r3', report_ref: 'UA-26-003', report_type: 'unsafe_act', status: 'closed' }),
        // Defence in depth: even if a confidential row arrived, it must not be rendered.
        reportRow({ id: 'r4', report_ref: 'SP-26-009', report_type: 'speak_up' })
      ]
    }
  });
  const feed = loadFeed(client);
  const result = await feed.listLoggedReports({ siteRef: 'wbd' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reports.map((report) => report.reference), ['NM-26-001', 'HZ-26-002', 'UA-26-003']);
  assert.deepEqual(result.reports.map((report) => report.status), ['Open', 'In Progress', 'Closed']);
  assert.deepEqual(result.reports.map((report) => report.type), ['Near Miss', 'Hazard', 'Unsafe Act']);
  assert.equal(result.reports[0].reporterName, 'Ravi Kumar');
  assert.equal('employeeNo' in result.reports[0], false);
  assert.equal('mobile' in result.reports[0], false);
});

test('a report with a stored photo is flagged, without fetching the file itself', async () => {
  const client = fakeAdmin({
    reports: { count: 1, error: null, data: [reportRow()] },
    attachments: { data: [{ report_id: 'report-1' }], error: null }
  });
  const feed = loadFeed(client);
  const result = await feed.listLoggedReports({ siteRef: 'wbd' });

  assert.equal(result.reports[0].hasPhoto, true);
  const attachments = client.queries.find((entry) => entry.table === 'report_attachments');
  assert.deepEqual(filtersOf(attachments).get('report_id'), { in: ['report-1'] });
});

test('a missing attachment table only costs the badge', async () => {
  const client = fakeAdmin({
    reports: { count: 1, error: null, data: [reportRow()] },
    attachments: { data: null, error: { message: 'relation does not exist' } }
  });
  const feed = loadFeed(client);
  const result = await feed.listLoggedReports({ siteRef: 'wbd' });

  assert.equal(result.ok, true);
  assert.equal(result.reports[0].hasPhoto, false);
});

test('the page size is bounded and the offset is passed through', async () => {
  const feed = loadFeed(fakeAdmin());
  assert.equal(feed.clampLimit(10), 10);
  assert.equal(feed.clampLimit(9999), 200);
  assert.equal(feed.clampLimit(0), 100);
  assert.equal(feed.clampLimit('nope'), 100);

  const client = fakeAdmin({ reports: { count: 250, error: null, data: [] } });
  const result = await loadFeed(client).listLoggedReports({ siteRef: 'wbd', limit: 50, offset: 100 });
  const query = client.queries.find((entry) => entry.table === 'reports');
  assert.deepEqual(query.range, [100, 149]);
  assert.equal(result.total, 250);
  assert.equal(result.offset, 100);
});

test('a database that is down says so instead of pretending the site has no reports', async () => {
  const client = fakeAdmin({ reports: { data: null, error: { message: 'boom' }, count: null } });
  const result = await loadFeed(client).listLoggedReports({ siteRef: 'wbd' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNAVAILABLE');
});

test('the route asks for no credentials and keeps the guards', () => {
  const route = readFileSync('app/api/reports/site/route.ts', 'utf8');
  const lib = readFileSync('lib/reports/site-feed.ts', 'utf8');

  assert.ok(route.includes('export async function GET'));
  assert.ok(route.includes('sameOrigin(request)'));
  assert.ok(route.includes('createRateLimiter'));
  assert.ok(route.includes('NO_STORE'));
  assert.ok(route.includes('listLoggedReports'));
  assert.equal(route.includes('employeeNo'), false, 'no Employee ID is asked for');
  assert.equal(route.includes("searchParams.get('mobile')"), false, 'no mobile number is asked for');
  assert.equal(route.includes('body.mobile'), false);
  assert.equal(route.includes('export async function POST'), false);

  assert.ok(lib.includes('LOGGED_REPORT_DB_TYPES'));
  assert.ok(lib.includes(".eq('anonymous', false)"));
  assert.ok(lib.includes('reporter:employees!reports_reporter_employee_id_fkey(full_name)'));
});

test('the screen loads by itself, with no Employee ID or mobile form', () => {
  const component = readFileSync('app/components/LoggedReports.tsx', 'utf8');

  assert.ok(component.includes("fetch(`/api/reports/site?${params.toString()}`"));
  assert.ok(component.includes('useEffect('));
  assert.equal(component.includes('type="tel"'), false, 'no mobile number field');
  assert.equal(component.includes('placeholder="e.g. EIPL'), false, 'no Employee ID field');
  assert.equal(component.includes('useState(\'\')'), true);
  assert.equal(component.includes('/api/reports/mine'), false, 'the old gated lookup is gone');
  assert.equal(component.trimStart().startsWith("'use client';"), true);
});

test('the device copy of a report shows no employee number either', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.equal(page.includes('maskEmpNo'), false, 'the masked Employee ID helper is gone');
  assert.ok(page.includes("T(report.anonymous ? 'Anonymous' : 'This device')"));
  assert.ok(page.includes('<LoggedReports siteId={currentSite?.id} siteName={currentSite?.name} />'));
});
