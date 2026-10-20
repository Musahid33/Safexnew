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

const plan = loader()('lib/dm/plan.ts');

const filled = () => {
  const base = plan.emptyPlan('2026-10-21');
  base.shift = 'A';
  base.supervisor = 'Musahid Ansari';
  base.supervisorNo = 'EIPL-1042';
  base.location = 'Stockyard';
  base.modules.tbt.attendees = '18';
  base.modules.tbt.theme = 'Work at height';
  return base;
};

test('the document number is DM-DD-MM-YY', () => {
  assert.equal(plan.referenceFor('2026-10-21'), 'DM-21-10-26');
  assert.equal(plan.referenceFor('2027-01-05'), 'DM-05-01-27');
  // A malformed date must not produce a malformed document number.
  assert.match(plan.referenceFor('21-10-2026'), /^DM-\d{2}-\d{2}-\d{2}$/);
});

test('a plan needs a real date, a supervisor and at least one answer', () => {
  const empty = plan.normalisePlan({ ...filled(), date: '', supervisor: '' });
  assert.equal(empty.ok, false);
  assert.ok(empty.errors.includes('A valid plan date is required.'));
  assert.ok(empty.errors.includes('Supervisor name is required.'));

  const headerOnly = plan.normalisePlan({ ...filled(), modules: {} });
  assert.equal(headerOnly.ok, false);
  assert.deepEqual(headerOnly.errors, ['Fill at least one module before saving the plan.']);

  const onlyDate = plan.normalisePlan({ ...filled(), date: '2026-13-01' });
  assert.equal(onlyDate.ok, false);
  assert.ok(onlyDate.errors.includes('A valid plan date is required.'));
});

test('normalisation keeps only known fields and caps free text', () => {
  const long = 'x'.repeat(2000);
  const result = plan.normalisePlan({
    ...filled(),
    injected: 'drop me',
    modules: {
      tbt: { attendees: '12', topics: long, rogue: 'drop me' },
      ppe: Array.from({ length: 45 }, (_, index) => ({ employee: `Worker ${index}` }))
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.modules.tbt.topics.length, 800);
  // 45 rows in, 30 rows kept — a plan that big is not a plan, it is a spreadsheet.
  assert.equal(result.plan.modules.ppe.length, 30);
  assert.equal(result.plan.modules.tbt.attendees, '12');
  assert.ok(!('injected' in result.plan));
  assert.ok(!('rogue' in result.plan.modules.tbt));
});

test('housekeeping answers are keyed by checklist id, not position', () => {
  const [first, second] = plan.HOUSEKEEPING_ITEMS;
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      housekeeping: {
        // Reversed and with a junk answer: only known ids and known ticks survive.
        checks: { [second.id]: 'no', [first.id]: 'yes', unknown: 'yes', junk: 'maybe' },
        observations: 'Walkways clear'
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.modules.housekeeping.checks, { [first.id]: 'yes', [second.id]: 'no' });
});

test('the housekeeping list covers both 1S and 2S', () => {
  const one = plan.HOUSEKEEPING_ITEMS.filter((item) => item.element.startsWith('1S'));
  const two = plan.HOUSEKEEPING_ITEMS.filter((item) => item.element.startsWith('2S'));
  assert.equal(one.length, 8);
  assert.equal(two.length, 15);
  assert.equal(new Set(plan.HOUSEKEEPING_ITEMS.map((item) => item.id)).size, 23);
  assert.equal(plan.MODULE_TITLES.length, 11);
  assert.equal(plan.PERMIT_CHECKS.length, 5);
});

test('filledModuleCount reports how many of the eleven carry an answer', () => {
  const base = plan.emptyPlan('2026-10-21');
  base.supervisor = 'Musahid Ansari';
  assert.equal(plan.filledModuleCount(base), 0);
  assert.equal(plan.isEmptyPlan(base), true);

  base.modules.tbt.attendees = '18';
  base.modules.ppe = [{ employee: 'Ravi Kumar', issue: 'Missing PPE', item: 'Helmet', remarks: '' }];
  base.modules.housekeeping.checks = { '1s-1': 'yes' };
  base.modules.incident.description = 'Near miss at ramp';
  assert.equal(plan.filledModuleCount(base), 4);
  assert.equal(plan.isEmptyPlan(base), false);

  const everything = plan.normalisePlan({
    ...filled(),
    modules: {
      permits: { permitNo: 'P-7712', checks: [true, false, false, false, false, false] },
      tbt: { attendees: '18', conductedBy: 'Musahid' },
      ppe: [{ employee: 'Ravi', issue: 'Missing PPE', item: 'Helmet' }],
      walkthrough: [{ area: 'Ramp 3', details: 'Oil spill', type: 'Unsafe act / condition' }],
      equipment: [{ name: 'Crane 2', status: 'Deficiency', remarks: 'Brake slack' }],
      tools: [{ name: 'Spanner set', toolId: 'T-19', safe: 'Safe' }],
      housekeeping: { checks: { '1s-1': 'yes' }, observations: 'Clear' },
      interaction: { team: [{ name: 'Ravi' }], topics: ['Work at height'] },
      incident: { categories: ['Near miss'], description: 'Forklift near miss' },
      training: { employee: 'Ravi', observation: 'Anchor point misuse' },
      admin: [{ sopNo: 'SOP-14', compliance: 'Non-compliant' }]
    }
  });
  assert.equal(everything.ok, true);
  assert.equal(plan.filledModuleCount(everything.plan), 11);
});

test("a new plan starts with today's date and the eleven modules present", () => {
  const base = plan.emptyPlan('2026-10-21');
  assert.equal(base.date, '2026-10-21');
  assert.equal(base.shift, 'General');
  assert.equal(Object.keys(base.modules).length, 11);
  assert.equal(base.modules.permits.checks.length, plan.PERMIT_CHECKS.length);
  // Two independently created rows must not share an object.
  assert.notEqual(base.modules.ppe[0], plan.emptyPlan('2026-10-21').modules.ppe[0]);
});
