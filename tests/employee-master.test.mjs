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
  // The passport may render work context, but contact and health fields never leave the server.
  assert.deepEqual(
    Object.keys(toPublicEmployee(parsed.records[0])).sort(),
    ['active', 'department', 'designation', 'empNo', 'name', 'skillGrade']
  );
  assert.equal('safetyPassNo' in toPublicEmployee(parsed.records[0]), false);
  assert.equal('mobileE164' in toPublicEmployee(parsed.records[0]), false);
  assert.equal('bloodGroup' in toPublicEmployee(parsed.records[0]), false);
  assert.equal(parseEmployeeMaster('<html>Unavailable</html>', { defaultSiteId: 'west-bokaro' }).records.length, 0);
});

test('safety pass number is released only when the deployment opts in', () => {
  const { parseEmployeeMaster, toPublicEmployee } = loader()('lib/employee-master/parse.ts');
  const source = [
    'Employee ID,Name,Designation,Safety Pass No,Status',
    'PASS-01,Pass Holder,Rigger,SP-WBD-2026-000123,Active'
  ].join('\n');
  const parsed = parseEmployeeMaster(source, { defaultSiteId: 'wbd' });
  assert.equal(parsed.records[0].safetyPassNo, 'SP-WBD-2026-000123');
  assert.equal('safetyPassNo' in toPublicEmployee(parsed.records[0]), false);
  const revealed = toPublicEmployee(parsed.records[0], { revealSafetyPass: true });
  assert.equal(revealed.safetyPassNo, 'SP-WBD-2026-000123');
  // Opting in to the pass number must not widen the rest of the projection.
  assert.equal('mobileE164' in revealed, false);
  assert.equal('bloodGroup' in revealed, false);
});

test('public safety pass flag defaults to off and accepts explicit opt-in values', () => {
  const config = loader()('lib/employee-master/config.ts');
  const previous = process.env.SAFEX_PUBLIC_SAFETY_PASS;
  try {
    delete process.env.SAFEX_PUBLIC_SAFETY_PASS;
    assert.equal(config.isPublicSafetyPassEnabled(), false);
    for (const value of ['false', '0', 'no', '']) {
      process.env.SAFEX_PUBLIC_SAFETY_PASS = value;
      assert.equal(config.isPublicSafetyPassEnabled(), false, value);
    }
    for (const value of ['true', 'YES', 'on', '1']) {
      process.env.SAFEX_PUBLIC_SAFETY_PASS = value;
      assert.equal(config.isPublicSafetyPassEnabled(), true, value);
    }
  } finally {
    if (previous === undefined) delete process.env.SAFEX_PUBLIC_SAFETY_PASS;
    else process.env.SAFEX_PUBLIC_SAFETY_PASS = previous;
  }
});

test('import keeps blank-status rows inactive and withholds shared mobiles', () => {
  const { parseEmployeeMaster } = loader()('lib/employee-master/parse.ts');
  const source = [
    'Employee ID,Name,Designation,Mobile,Status',
    'SHARED-01,Worker One,Operator,9876543210,Active',
    'SHARED-02,Worker Two,Helper,9876543210,Active',
    'BLANK-01,Unconfirmed Worker,Helper,,',
    'INACTIVE-01,Former Worker,Helper,,Inactive'
  ].join('\n');
  const parsed = parseEmployeeMaster(source, { defaultSiteId: 'wbd', activeOnly: false });
  assert.equal(parsed.records.length, 4);
  assert.equal(parsed.records.find((record) => record.employeeNo === 'BLANK-01').active, false);
  assert.equal(parsed.records.find((record) => record.employeeNo === 'INACTIVE-01').active, false);
  assert.equal(parsed.records.find((record) => record.employeeNo === 'SHARED-01').mobileE164, null);
  assert.equal(parsed.records.find((record) => record.employeeNo === 'SHARED-02').mobileE164, null);
  assert.ok(parsed.issues.some((issue) => issue.field === 'mobile' && issue.severity === 'error'));
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
    assert.equal((await source.searchEmployeeMaster('wbd', 'Test')).length, 1);
    assert.equal((await source.searchEmployeeMaster('other-site', 'Test')).length, 0);
    assert.equal(await source.findEmployeeByNumber('wbd', 'EMP-DEMO-01'), null);
    assert.equal((await source.findEmployeeByNumber('wbd', 'test-01')).employeeNo, 'TEST-01');
    source.clearEmployeeMasterCache();
    globalThis.fetch = async () => { throw new Error('Network unavailable'); };
    assert.equal(await source.getEmployeeMaster(), null);
    assert.deepEqual(await source.searchEmployeeMaster('wbd', 'Test'), []);
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
    './config': { getEmployeeMasterConfig: () => ({ enabled: false }), getBrandingCompanyName: () => null },
    'node:fs/promises': { readFile: async () => { throw new Error('No file'); } }
  })('lib/employee-master/directory.ts');
  const status = await directory.getDirectoryStatus();
  assert.equal(status.mode, 'unavailable');
  assert.equal(status.degraded, true);
  assert.equal(status.employeeCount, 0);
  assert.equal((await directory.searchDirectory('west-bokaro', 'Test')).mode, 'unavailable');
  assert.equal((await directory.findInDirectory('west-bokaro', 'TEST-01')).mode, 'unavailable');
  assert.equal((await directory.listDirectory('west-bokaro', { limit: 50, offset: 0 })).mode, 'unavailable');
  assert.equal(status.companyName, null);
});

test('passport company name falls back to the configured public brand', async () => {
  const directory = loader({
    './db-source': { isDatabaseDirectoryConfigured: () => false, isDatabaseDirectoryIntended: () => false },
    './config': {
      getEmployeeMasterConfig: () => ({ enabled: false }),
      getBrandingCompanyName: () => 'Emveess Infraventures Pvt.Ltd'
    },
    'node:fs/promises': { readFile: async () => { throw new Error('No file'); } }
  })('lib/employee-master/directory.ts');
  assert.equal((await directory.getDirectoryStatus()).companyName, 'Emveess Infraventures Pvt.Ltd');
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

test('legacy sheet mode hands off to Supabase when no sheet source remains', () => {
  const names = [
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SAFEX_EMPLOYEE_DIRECTORY_SOURCE', 'SAFEX_EMPLOYEE_MASTER_CSV_URL', 'SAFEX_EMPLOYEE_MASTER_FILE'
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-server-key';
    process.env.SAFEX_EMPLOYEE_DIRECTORY_SOURCE = 'sheet';
    delete process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL;
    delete process.env.SAFEX_EMPLOYEE_MASTER_FILE;
    const source = loader({ '@/lib/supabase/admin': { getAdminSupabase: () => null } })('lib/employee-master/db-source.ts');
    assert.equal(source.isDatabaseDirectoryIntended(), true);
    process.env.SAFEX_EMPLOYEE_MASTER_CSV_URL = 'https://example.com/master.csv';
    assert.equal(source.isDatabaseDirectoryIntended(), false);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
