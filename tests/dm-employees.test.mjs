import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// Same minimal TypeScript loader the other tests use.
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

const employees = loader()('lib/dm/employees.ts');

const directory = [
  { empNo: 'EMP004', name: 'Ravi Kumar', designation: 'Rigger' },
  { empNo: 'EMP011', name: 'Sonu Yadav', designation: 'Helper' },
  { empNo: 'EMP014', name: 'Ravi Sharma', designation: 'Welder' },
  { empNo: 'EMP/021', name: 'Anita Devi', designation: 'Safety Steward' }
];

test('an employee number resolves the name', () => {
  assert.equal(employees.findEmployee(directory, 'EMP004', 'empNo').name, 'Ravi Kumar');
  // Case and padding do not matter — the master is typed by hand.
  assert.equal(employees.findEmployee(directory, '  emp011 ', 'empNo').name, 'Sonu Yadav');
  assert.equal(employees.findEmployee(directory, 'EMP/021', 'empNo').designation, 'Safety Steward');
});

test('a name resolves the employee number', () => {
  assert.equal(employees.findEmployee(directory, 'sonu yadav', 'name').empNo, 'EMP011');
  assert.equal(employees.findEmployee(directory, 'Anita Devi', 'name').empNo, 'EMP/021');
});

test('an ambiguous prefix resolves to nobody instead of the wrong person', () => {
  // "Ravi" is two people: picking either one would put the wrong name on a safety record.
  assert.equal(employees.findEmployee(directory, 'Ravi', 'name'), null);
  assert.equal(employees.findEmployee(directory, 'EMP01', 'empNo'), null);
  // Unambiguous prefixes still work.
  assert.equal(employees.findEmployee(directory, 'Sonu', 'name').empNo, 'EMP011');
});

test('a short or empty query never matches', () => {
  assert.equal(employees.findEmployee(directory, '', 'name'), null);
  assert.equal(employees.findEmployee(directory, '  ', 'empNo'), null);
  assert.equal(employees.findEmployee(directory, 'EM', 'empNo'), null);
});

test('employees the master cannot identify are dropped from the picker', () => {
  const list = employees.directoryFromApi([
    { empNo: 'EMP004', name: 'Ravi Kumar', designation: 'Rigger' },
    { empNo: 'EMP004', name: 'Duplicate', designation: 'Rigger' },
    { empNo: '', name: 'No number', designation: '' },
    { empNo: 'EMP005', name: '', designation: '' },
    null,
    'not a row'
  ]);
  assert.deepEqual(list, [{ empNo: 'EMP004', name: 'Ravi Kumar', designation: 'Rigger' }]);
});

test('the directory sorts by employee number, not by insertion order', () => {
  const list = employees.directoryFromApi([
    { empNo: 'EMP010', name: 'B' },
    { empNo: 'EMP002', name: 'A' },
    { empNo: 'EMP100', name: 'C' }
  ]);
  assert.deepEqual(list.map((row) => row.empNo), ['EMP002', 'EMP010', 'EMP100']);
});
