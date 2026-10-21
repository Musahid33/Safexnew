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

const TENANT = 'tenant-1';

/**
 * A stand-in for the admin Supabase client that records what the query asked for.
 *
 * Each table gets its own builder; `queries` keeps the table plus every filter so a test can
 * prove the restriction was applied in the query rather than after the fact.
 */
function fakeAdmin(config) {
  const queries = [];
  function builder(table, result) {
    const entry = { table, filters: [], orders: [], limit: null, maybe: false };
    queries.push(entry);
    const api = {
      select() { return api; },
      eq(column, value) { entry.filters.push([column, value]); return api; },
      in(column, values) { entry.filters.push([column, { in: values }]); return api; },
      order(column, options) { entry.orders.push([column, options]); return api; },
      limit(value) { entry.limit = value; return api; },
      maybeSingle() { entry.maybe = true; return Promise.resolve(result); },
      then(resolvePromise) { return Promise.resolve(result).then(resolvePromise); }
    };
    return api;
  }
  return {
    queries,
    from(table) {
      if (table === 'employees') return builder(table, config.employee);
      if (table === 'reports') return builder(table, config.reports);
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function loadMine(client) {
  return loader({
    '@/lib/supabase/admin': { getAdminSupabase: () => client },
    '@/lib/employee-master/db-source': { resolveTenantId: async () => TENANT }
  })('lib/reports/mine.ts');
}

const EMPLOYEE = {
  data: { id: 'emp-1', full_name: 'Ravi Kumar', employee_no: 'EIPL-1042', mobile_e164: '+919876543210' },
  error: null
};

function reportRow(overrides = {}) {
  return {
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
    ...overrides
  };
}

test('a phone number is compared by its national digits', () => {
  const mine = loadMine(fakeAdmin({ employee: EMPLOYEE, reports: { data: [], error: null } }));
  assert.equal(mine.mobileDigits('+91 98765 43210'), '9876543210');
  assert.equal(mine.mobileDigits('098765 43210'), '9876543210');
  assert.equal(mine.mobileDigits('9876543210'), '9876543210');
  assert.equal(mine.mobileDigits('98765'), null);
  assert.equal(mine.mobileDigits('0000000000'), null);
  assert.equal(mine.mobileDigits(null), null);

  assert.equal(mine.mobileMatches('+919876543210', '98765 43210'), true);
  assert.equal(mine.mobileMatches('+919876543210', '+91-98765-43210'), true);
  assert.equal(mine.mobileMatches('+919876543210', '9876543211'), false);
  // A master row with no mobile can never match, which is the point of leaving duplicates null.
  assert.equal(mine.mobileMatches(null, '9876543210'), false);
});

test('the four confidential types are outside the worker whitelist', () => {
  const mine = loadMine(fakeAdmin({ employee: EMPLOYEE, reports: { data: [], error: null } }));
  const allowed = [...mine.WORKER_VISIBLE_DB_TYPES];
  assert.deepEqual(allowed, ['near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act']);
  for (const type of ['speak_up', 'grievance', 'feedback', 'suggestion']) {
    assert.equal(allowed.includes(type), false, `${type} must never be readable from the app`);
  }
  assert.deepEqual([...mine.CONSOLE_ONLY_DB_TYPES], ['speak_up', 'grievance', 'feedback', 'suggestion']);
});

test('the restriction is applied in the query, before any row is read', async () => {
  const client = fakeAdmin({ employee: EMPLOYEE, reports: { data: [reportRow()], error: null } });
  const mine = loadMine(client);
  const result = await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '98765 43210' });
  assert.equal(result.ok, true);

  const reportsQuery = client.queries.find((query) => query.table === 'reports');
  assert.ok(reportsQuery, 'reports were queried');
  const filters = new Map(reportsQuery.filters.map(([column, value]) => [column, value]));
  assert.equal(filters.get('tenant_id'), TENANT);
  assert.equal(filters.get('reporter_employee_id'), 'emp-1');
  assert.equal(filters.get('anonymous'), false);
  // A whitelist, so a type added to the database later stays hidden by default.
  assert.deepEqual(filters.get('report_type'), {
    in: ['near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act']
  });
  assert.deepEqual(reportsQuery.orders[0], ['created_at', { ascending: false }]);
  assert.equal(reportsQuery.limit, 50);
});

test('the employee is matched on the number, the tenant and being active', async () => {
  const client = fakeAdmin({ employee: EMPLOYEE, reports: { data: [], error: null } });
  const mine = loadMine(client);
  await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '9876543210' });

  const employeeQuery = client.queries.find((query) => query.table === 'employees');
  const filters = new Map(employeeQuery.filters.map(([column, value]) => [column, value]));
  assert.equal(filters.get('tenant_id'), TENANT);
  assert.equal(filters.get('employee_no'), 'EIPL-1042');
  assert.equal(filters.get('active'), true);
});

test('a wrong registered mobile reads no reports at all', async () => {
  const client = fakeAdmin({ employee: EMPLOYEE, reports: { data: [reportRow()], error: null } });
  const mine = loadMine(client);
  const result = await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '9999999999' });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_FOUND');
  assert.equal(client.queries.some((query) => query.table === 'reports'), false);
});

test('an unknown employee and a wrong number answer the same way', async () => {
  const missing = fakeAdmin({ employee: { data: null, error: null }, reports: { data: [], error: null } });
  const unknown = await loadMine(missing).listReportsForEmployee({ employeeNo: 'EIPL-9999', mobile: '9876543210' });

  const wrong = fakeAdmin({ employee: EMPLOYEE, reports: { data: [], error: null } });
  const mismatch = await loadMine(wrong).listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '9999999999' });

  // Same code and the same status: the API must not become a way to test which IDs exist.
  assert.equal(unknown.code, mismatch.code);
  assert.equal(unknown.code, 'NOT_FOUND');
});

test('incomplete input is refused before the database is touched', async () => {
  const client = fakeAdmin({ employee: EMPLOYEE, reports: { data: [], error: null } });
  const mine = loadMine(client);

  const noMobile = await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '' });
  const badNumber = await mine.listReportsForEmployee({ employeeNo: 'EIPL 1042', mobile: '9876543210' });
  assert.equal(noMobile.code, 'INVALID_INPUT');
  assert.equal(badNumber.code, 'INVALID_INPUT');
  assert.deepEqual(client.queries, []);
});

test('rows are mapped to the app vocabulary and unknown types are dropped', async () => {
  const client = fakeAdmin({
    employee: EMPLOYEE,
    reports: {
      data: [
        reportRow(),
        reportRow({ report_ref: 'HZ-26-002', report_type: 'hazard', status: 'in_progress' }),
        reportRow({ report_ref: 'UA-26-003', report_type: 'unsafe_act', status: 'closed' }),
        // Defence in depth: even if a confidential row arrived, it must not be rendered.
        reportRow({ report_ref: 'SP-26-009', report_type: 'speak_up' })
      ],
      error: null
    }
  });
  const mine = loadMine(client);
  const result = await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '9876543210' });

  assert.equal(result.ok, true);
  assert.equal(result.employeeName, 'Ravi Kumar');
  assert.deepEqual(result.reports.map((report) => report.reference), ['NM-26-001', 'HZ-26-002', 'UA-26-003']);
  assert.deepEqual(result.reports.map((report) => report.status), ['Open', 'In Progress', 'Closed']);
  assert.deepEqual(result.reports.map((report) => report.type), ['Near Miss', 'Hazard', 'Unsafe Act']);
});

test('a database that is down says so instead of pretending there is no history', async () => {
  const client = fakeAdmin({ employee: EMPLOYEE, reports: { data: null, error: { message: 'boom' } } });
  const mine = loadMine(client);
  const result = await mine.listReportsForEmployee({ employeeNo: 'EIPL-1042', mobile: '9876543210' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNAVAILABLE');
});

test('the route is a guarded POST that keeps the mobile out of the URL', () => {
  const route = readFileSync('app/api/reports/mine/route.ts', 'utf8');
  const lib = readFileSync('lib/reports/mine.ts', 'utf8');

  assert.ok(route.includes('export async function POST'));
  assert.equal(route.includes('export async function GET'), false, 'the mobile number must not travel in a query string');
  assert.ok(route.includes('sameOrigin(request)'));
  assert.ok(route.includes('createRateLimiter'));
  assert.ok(route.includes('NO_STORE'));
  assert.ok(route.includes('listReportsForEmployee'));

  assert.ok(lib.includes('WORKER_VISIBLE_DB_TYPES'));
  assert.ok(lib.includes(".eq('anonymous', false)"));
  assert.ok(lib.includes('reporter_employee_id'));
});
