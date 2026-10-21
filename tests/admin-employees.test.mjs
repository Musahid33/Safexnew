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

const fields = loader()('lib/employee-master/profile-fields.ts');

test('console fields land on the right database columns', () => {
  const result = fields.normaliseEmployeePatch({
    name: 'Musahid Ansari',
    designation: 'Safety Officer',
    department: 'HSE',
    mobile: '+91 98765 43210',
    bloodGroup: 'O+',
    email: 'musahid@example.com',
    gender: 'Male',
    dob: '1990-04-17',
    emergencyName: 'Kin',
    emergencyMobile: '9876500000',
    location: 'West Bokaro',
    address: 'Patna',
    notes: 'Worked at WBD'
  }, { includePii: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, {
    full_name: 'Musahid Ansari',
    designation: 'Safety Officer',
    department: 'HSE',
    mobile_e164: '+91 98765 43210',
    blood_group: 'O+',
    email: 'musahid@example.com',
    gender: 'Male',
    dob: '1990-04-17',
    emergency_contact_name: 'Kin',
    emergency_contact_mobile: '9876500000',
    work_location: 'West Bokaro',
    home_address: 'Patna',
    notes: 'Worked at WBD'
  });
});

test('a field that was not sent is never written', () => {
  // This is the difference between "rename" and "rename and blank the mobile number",
  // and it is the whole reason the patch is keyed on presence rather than on value.
  const result = fields.normaliseEmployeePatch({ name: 'Renamed' }, { includePii: true });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.columns), ['full_name']);
});

test('empty strings clear a field, absent keys leave it alone', () => {
  const result = fields.normaliseEmployeePatch({ department: '   ', mobile: '' }, { includePii: true });
  assert.equal(result.ok, true);
  assert.equal(result.columns.department, null);
  assert.equal(result.columns.mobile_e164, null);
});

test('personal fields are refused while PII release is off', () => {
  const result = fields.normaliseEmployeePatch({ mobile: '9876543210' }, { includePii: false });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PII_DISABLED');

  // Non-personal fields still save, which is what keeps the console useful with the flag off.
  const nameOnly = fields.normaliseEmployeePatch({ name: 'New name', location: 'WBD' }, { includePii: false });
  assert.equal(nameOnly.ok, true);
  assert.deepEqual(Object.keys(nameOnly.columns).sort(), ['full_name', 'work_location']);
});

test('bad values are rejected with a message, not written half-way', () => {
  const cases = [
    [{ email: 'not-an-email' }, 'email'],
    [{ dob: '31-12-1990' }, 'date'],
    [{ dob: '2999-01-01' }, 'future'],
    [{ gender: 'Robot' }, 'gender'],
    [{ mobile: '123' }, 'mobile'],
    [{ notes: 'x'.repeat(2001) }, 'longer'],
    [{ name: '   ' }, 'name']
  ];
  for (const [patch, expected] of cases) {
    const result = fields.normaliseEmployeePatch(patch, { includePii: true });
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.code, 'INVALID_VALUE');
    assert.ok(result.error.toLowerCase().includes(expected), `${result.error} should mention ${expected}`);
  }
});

test('an employee number must be usable in a URL and in the roster', () => {
  assert.equal(fields.isEmployeeNo('EMP004'), true);
  assert.equal(fields.isEmployeeNo('EMP/004'), true);
  assert.equal(fields.isEmployeeNo(''), false);
  assert.equal(fields.isEmployeeNo('EMP 004'), false);
  assert.equal(fields.isEmployeeNo('x'.repeat(33)), false);
  // The console sends the old number in the path, so a number with a slash is encoded and
  // still has to survive the round trip.
  assert.equal(fields.isEmployeeNo(decodeURIComponent(encodeURIComponent('EMP/004'))), true);
});

test('an empty patch is an error rather than a no-op write', () => {
  const result = fields.normaliseEmployeePatch({}, { includePii: true });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'EMPTY_PATCH');
});

test('every write route is behind the same session gate', () => {
  const collection = readFileSync('app/api/admin/employees/route.ts', 'utf8');
  const single = readFileSync('app/api/admin/employees/[employeeNo]/route.ts', 'utf8');

  // Both routes use the one shared gate; the checks themselves live in lib/http/admin-gate.ts,
  // so a route cannot be written that remembers the session but forgets the origin.
  const gate = readFileSync('lib/http/admin-gate.ts', 'utf8');
  assert.ok(gate.includes('readSession(request) === null'));
  assert.ok(gate.includes('sameOrigin(request)'));
  assert.ok(gate.includes('isAdminApiConfigured()'));
  for (const source of [collection, single]) {
    assert.ok(source.includes('createAdminGuard('), 'the route must use the shared gate');
  }

  // The update path matches the tenant as well as the employee number: the service role
  // bypasses RLS, so the tenant filter is the only thing separating two companies.
  const writes = readFileSync('lib/employee-master/writes.ts', 'utf8');
  // Update and deactivate filter by tenant; create writes it into the row.
  assert.equal((writes.match(/\.eq\('tenant_id', tenantId\)/g) ?? []).length, 2);
  assert.ok(writes.includes('tenant_id: tenantId'));
  assert.ok(writes.includes(".eq('employee_no', options.currentNo)"));
  // Removing a person from the roster must not erase the row their reports point at.
  assert.ok(writes.includes('active: false'));
  assert.equal(writes.includes('.delete('), false, 'employees must be deactivated, not deleted');
});

test('the generated console hands profile edits to the host', () => {
  const script = loader()('app/components/safetyos/generated/script.ts').DESIGN_SCRIPT;

  assert.ok(script.includes('window.__SAFEX_EMPLOYEE_CHANGED__'));
  assert.ok(script.includes('function notifyEmployeeChange('));
  assert.ok(script.includes("notifyEmployeeChange(existing?'update':'create'"));
  assert.ok(script.includes("notifyEmployeeChange('delete'"));
  // The roster's values must survive the design's own defaults.
  assert.ok(script.includes('if(emp[key]===undefined||emp[key]===null)emp[key]=__employeeDefaults[key]'));
  assert.equal(script.includes("Object.assign(emp,{mobile:'',email:''"), false);
  // A withheld mobile number must not block saving the fields that are visible.
  assert.ok(script.includes("if(mobile&&!mobilePattern.test(mobile))"));
  // No more optimistic "updated" toast before the server has answered.
  assert.equal(script.includes("toast(existing?'Employee profile updated.'"), false);
});

test('a photograph is saved as a data URL on its own column', () => {
  const jpeg = `data:image/jpeg;base64,${'A'.repeat(64)}`;
  const result = fields.normaliseEmployeePatch({ photo: jpeg }, { includePii: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.columns, { photo: jpeg });

  // Removing a face is a clear, not an omission.
  const cleared = fields.normaliseEmployeePatch({ photo: '' }, { includePii: true });
  assert.equal(cleared.ok, true);
  assert.deepEqual(cleared.columns, { photo: null });
});

test('a photograph is not held hostage by the personal-data switch', () => {
  // The release flag exists for health data and home addresses. The passport has to show
  // the person it belongs to even when that flag is off, so a photo saves on its own.
  const result = fields.normaliseEmployeePatch(
    { photo: `data:image/png;base64,${'B'.repeat(32)}`, name: 'Ravi Kumar' },
    { includePii: false }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.columns).sort(), ['full_name', 'photo']);
});

test('only an image data URL of a sane size is accepted as a photo', () => {
  const rejected = [
    'https://example.com/face.jpg',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    `data:image/jpeg;base64,${'-'.repeat(16)}`,
    `data:image/jpeg;base64,${'A'.repeat(fields.MAX_PHOTO_CHARS)}`
  ];
  for (const photo of rejected) {
    const result = fields.normaliseEmployeePatch({ photo }, { includePii: true });
    assert.equal(result.ok, false, `${photo.slice(0, 40)} must be refused`);
    assert.equal(result.code, 'INVALID_VALUE');
  }

  // WEBP comes out of some Android cameras; it is a face like any other.
  const webp = fields.normaliseEmployeePatch({ photo: `data:image/webp;base64,${'C'.repeat(48)}` }, { includePii: true });
  assert.equal(webp.ok, true);
});

test('the roster never carries a face, only the opened employee does', () => {
  const source = readFileSync('lib/employee-master/db-source.ts', 'utf8');
  const roster = /const SELECT_COLUMNS\s*=([\s\S]*?);\n/.exec(source)?.[1] ?? '';
  const passport = /const PASSPORT_COLUMNS\s*=([\s\S]*?);\n/.exec(source)?.[1] ?? '';
  const pii = /const PII_COLUMNS\s*=([\s\S]*?);\n/.exec(source)?.[1] ?? '';

  for (const [name, block] of [['SELECT_COLUMNS', roster], ['PASSPORT_COLUMNS', passport], ['PII_COLUMNS', pii]]) {
    assert.equal(block.includes('photo'), false, `${name} must not select the photo`);
  }
  // ...and the one query that does ask for it is the single-employee read.
  assert.ok(source.includes('PROFILE_COLUMNS = `${PII_COLUMNS}, photo`'));
  assert.ok(source.includes('findEmployeeProfileInDatabase'));
});

test('the console has one passport screen, opened from the design page', () => {
  const app = readFileSync('app/components/safetyos/SafetyOsApp.tsx', 'utf8');
  const screen = readFileSync('app/components/safetyos/EmployeePassportAdmin.tsx', 'utf8');

  // Portalled the same way as the DM workspace: the design keeps its own nodes.
  assert.ok(app.includes("container.querySelector<HTMLElement>('#employeeProfilePage')"));
  assert.ok(app.includes('<EmployeePassportAdmin'));
  // The design's script binds the form's buttons without a null check, so the nodes stay
  // in place and are hidden by CSS instead of being removed.
  assert.ok(app.includes("epPage.classList.add('is-hosted')"));
  assert.ok(screen.includes('compressPhoto'));

  // One button opens the picker, and it must not pin the phone to the camera.
  assert.equal((screen.match(/type="file"/g) ?? []).length, 1);
  assert.equal(screen.includes('capture='), false);

  // A missing migration must not look like "your edits were not saved".
  assert.ok(screen.includes('photoSaved === false'));
});

test('the console can read one employee with a face, and only one', () => {
  const single = readFileSync('app/api/admin/employees/[employeeNo]/route.ts', 'utf8');
  assert.ok(single.includes('export async function GET'));
  assert.ok(single.includes('findEmployeeProfileInDatabase(employeeNo)'));
  // The same gate as the writes, and no caching of a personal record.
  assert.ok(single.includes('createAdminGuard('));
  assert.ok(single.includes('isAdminPiiEnabled()'));
  assert.ok(single.includes('NO_STORE'));
});
