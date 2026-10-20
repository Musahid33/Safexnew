import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Same minimal TypeScript loader the employee-master tests use: strip types, resolve
// relative imports, no ts-node in the dependency tree.
function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
    const names = [...code.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((match) => match[1]);
    code = code.replace(/^import ['"]server-only['"];?/gm, '')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(source)});`)
      .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '');
    code += `\nObject.assign(exports, {${names.join(',')}});`;
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

const { toCaseReport, CASE_STATUS, CASE_STATUS_DB } = loader()('lib/case-report-view.ts');

const baseRow = {
  reportRef: 'OFFLINE-72138a64-cb38-445d-88c9-7bfa7a328c19',
  type: 'near_miss',
  category: null,
  anonymous: false,
  area: 'Jejjw',
  department: null,
  occurredAt: '2026-10-20T19:00:00.000Z',
  submittedAt: '2026-10-20T19:33:02.000Z',
  severity: 'High',
  shortDescription: 'Hwhhwhwhwhbw',
  description: 'Hwhhwhwhwhbw — full text of the report.',
  immediateAction: null,
  status: 'open',
  reporterName: 'Kamalnath Mahto',
  reporterNumber: 'EMP004'
};

test('a worker report lands in the console with its real values', () => {
  const record = toCaseReport(baseRow);
  assert.equal(record.id, 'OFFLINE-72138a64-cb38-445d-88c9-7bfa7a328c19');
  assert.equal(record.category, 'Near Miss');
  assert.equal(record.status, 'Open');
  assert.equal(record.priority, 'High');
  assert.equal(record.title, 'Hwhhwhwhwhbw');
  assert.equal(record.location, 'Jejjw');
  assert.equal(record.reporter, 'Kamalnath Mahto');
  assert.equal(record.date, '2026-10-20');
  // The console links a report to the employee profile by this key.
  assert.equal(record.employeeId, 'EMP004');
  assert.equal(record.direct, false);
});

test('anonymous Speak Up never carries a reporter or profile link', () => {
  const record = toCaseReport({
    ...baseRow,
    type: 'speak_up',
    anonymous: true,
    // A stored row must not re-attach an identity even if the API leaked one.
    reporterName: 'Someone',
    reporterNumber: 'EMP999',
    area: null,
    severity: null
  });
  assert.equal(record.reporter, 'Anonymous');
  assert.equal(record.department, 'Confidential');
  assert.equal(record.employeeId, undefined);
  assert.equal('employeeId' in record, false);
  assert.equal(record.category, 'Speak Up');
  // Missing data is stated, not invented.
  assert.equal(record.priority, 'Not set');
  assert.equal(record.location, 'Not recorded');
});

test('unsafe condition and unsafe act share the Safety Observations tab', () => {
  for (const type of ['unsafe_condition', 'unsafe_act', 'safety_observation']) {
    assert.equal(toCaseReport({ ...baseRow, type }).category, 'Safety Observations');
  }
  // An unknown type stays visible under "All Reports" instead of being misfiled.
  assert.equal(toCaseReport({ ...baseRow, type: 'new_type' }).category, 'new_type');
});

test('a title falls back to the description, and a missing time never breaks the list', () => {
  const record = toCaseReport({
    ...baseRow,
    shortDescription: null,
    description: '  Long description that becomes the title.  ',
    submittedAt: null,
    occurredAt: null
  });
  assert.equal(record.title, 'Long description that becomes the title.');
  assert.match(record.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('every status the console shows can be saved back', () => {
  for (const label of Object.values(CASE_STATUS)) {
    assert.ok(CASE_STATUS_DB[label], `${label} has no database status`);
  }
  // The design also offers two extra options; they must map too or a saved row silently
  // becomes unsaveable.
  assert.equal(CASE_STATUS_DB['In Review'], 'in_progress');
  assert.equal(CASE_STATUS_DB.Resolved, 'closed');
  for (const db of Object.values(CASE_STATUS_DB)) {
    assert.ok(['open', 'in_progress', 'closed'].includes(db));
  }
});

test('the generated console reads reports from the host seam', () => {
  const script = loader()('app/components/safetyos/generated/script.ts').DESIGN_SCRIPT;
  // Seam: the design's own demo array is replaced by whatever the host injects.
  assert.ok(script.includes('window.__SAFEX_CASE_REPORTS__'));
  assert.ok(script.includes('function notifyCaseChange('));
  assert.ok(script.includes('window.__SAFEX_CASE_CHANGED__'));
  // The previous status travels with the change so the host can put the row back.
  assert.ok(script.includes('notifyCaseChange(record,__previousStatus)'));
  // The host controls the empty state: no demo case records may be seeded.
  assert.equal(script.includes('const caseReports=[];'), false);
});

test('the reports API cannot skip the session or the tenant scope', () => {
  const route = readFileSync('app/api/admin/reports/route.ts', 'utf8');
  // Every handler passes through the gate, which is where the session check lives.
  assert.equal((route.match(/const blocked = gate\(request\);/g) ?? []).length, 2);
  assert.ok(route.includes('readSession(request) === null'));
  assert.ok(route.includes('sameOrigin(request)'));

  const store = readFileSync('lib/admin-reports.ts', 'utf8');
  // The service role bypasses RLS, so tenant scoping has to be explicit on every query.
  assert.ok(store.includes(".eq('tenant_id', tenantId)"));
  assert.equal(store.includes('service_role'), false, 'key must never be referenced here');
});
