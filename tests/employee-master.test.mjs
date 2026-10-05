import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Load the production TypeScript with a mocked server-only boundary and real pure modules.
// Fixtures are synthetic test data, never shipped in the app or used as a fallback.
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

const csv = 'Employee ID,Name,Designation,Mobile,Blood Group,Status\nTEST-01,Test Worker,Operator,9876543210,O+,Active\nTEST-02,Inactive Worker,Helper,,,Inactive\nTEST-03,,Helper,,,Active';

test('parser keeps active named employees and public projection omits personal fields', () => {
  const { parseEmployeeMaster, toPublicEmployee } = loader()('lib/employee-master/parse.ts');
  const parsed = parseEmployeeMaster(csv, { defaultSiteId: 'west-bokaro' });
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].siteId, 'west-bokaro');
  assert.equal(parsed.records[0].mobileE164, '+919876543210');
  assert.deepEqual(Object.keys(toPublicEmployee(parsed.records[0])).sort(), ['designation', 'empNo', 'id', 'name', 'siteId']);
  assert.equal(parseEmployeeMaster('<html>Unavailable</html>', { defaultSiteId: 'west-bokaro' }).records.length, 0);
});

test('sheet lookup scopes employees and outage never fabricates records', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL;
  const oldFile = process.env.SAFEX_EMPLOYEE_MASTER_FILE;
  process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL = 'https://example.invalid/master.csv';
  delete process.env.SAFEX_EMPLOYEE_MASTER_FILE;
  try {
    const load = loader({ 'node:fs/promises': { readFile: async () => { throw new Error('No file'); } } });
    const source = load('lib/employee-master/source.ts');
    globalThis.fetch = async () => new Response(csv);
    assert.equal((await source.searchEmployeeMaster('west-bokaro', 'Test')).length, 1);
    assert.equal((await source.searchEmployeeMaster('other-site', 'Test')).length, 0);
    assert.equal(await source.findEmployeeByNumber('west-bokaro', 'EMP-DEMO-01'), null);
    assert.equal((await source.findEmployeeByNumber('west-bokaro', 'test-01')).employeeNo, 'TEST-01');
    source.clearEmployeeMasterCache();
    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    assert.equal(await source.getEmployeeMaster(), null);
    assert.deepEqual(await source.searchEmployeeMaster('west-bokaro', 'Test'), []);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL;
    else process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL = oldUrl;
    if (oldFile === undefined) delete process.env.SAFEX_EMPLOYEE_MASTER_FILE;
    else process.env.SAFEX_EMPLOYEE_MASTER_FILE = oldFile;
  }
});

test('directory reports unavailable for all entry points without a real source', async () => {
  const directory = loader({
    './db-source': { isDatabaseDirectoryConfigured: () => false, isDatabaseDirectoryIntended: () => false },
    './config': { getEmployeeMasterConfig: () => ({ enabled: false }) },
    'node:fs/promises': { readFile: async () => { throw new Error('No file'); } }
  })('lib/employee-master/directory.ts');
  const status = await directory.getDirectoryStatus();
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.degraded, true);
  assert.equal(status.employeeCount, 0);
  assert.equal((await directory.searchDirectory('west-bokaro', 'Test')).mode, 'unavailable');
  assert.equal((await directory.findInDirectory('west-bokaro', 'TEST-01')).mode, 'unavailable');
  assert.equal((await directory.listDirectory('west-bokaro', { limit: 50, offset: 0 })).mode, 'unavailable');
});

test('design has no seeded roster, linked history, or fake lookup fallback', () => {
  const design = readFileSync('SafetyOS — Employee Profile Preview (2).html', 'utf8');
  for (const name of ['employeeDirectory', 'employeeTrainingLogs', 'certificateRecords', 'caseReports', 'auditRecords', 'inspectionRecords', 'dailySafetyLogs']) {
    assert.ok(design.includes(`const ${name}=[];`), name);
  }
  assert.ok(!design.includes('Showing demo profile'));
  assert.ok(!design.includes('Smit Singh'));
  assert.ok(!design.includes('Rahul Kumar'));
  const script = loader()('app/components/safetyos/generated/script.ts').DESIGN_SCRIPT;
  assert.ok(script.includes('window.__SAFEX_EMPLOYEES__:[]'));
  new Function(script); // Parse the regenerated standalone script as JavaScript.
});
