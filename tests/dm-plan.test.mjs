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

// A 1x1 JPEG, small enough to sit in a payload and real enough for pdf-lib.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('the walk-through types are the four the site uses', () => {
  assert.deepEqual(plan.WALKTHROUGH_TYPES, ['Safe act', 'Good Practices', 'Unsafe act', 'Unsafe condition']);
  assert.equal(plan.severityApplies('Unsafe act'), true);
  assert.equal(plan.severityApplies('Unsafe condition'), true);
  assert.equal(plan.severityApplies('Safe act'), false);
  assert.equal(plan.severityApplies('Good Practices'), false);
});

test('severity survives only on unsafe observations', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      walkthrough: [
        { area: 'Ramp 3', type: 'Unsafe act', severity: '4', details: 'No harness at height' },
        { area: 'Store', type: 'Safe act', severity: '2', details: 'Cordon respected' },
        { area: 'Gate', type: 'Good Practices', severity: '5', details: 'Walkway freshly painted' }
      ]
    }
  });

  assert.equal(result.ok, true);
  const rows = result.plan.modules.walkthrough;
  assert.equal(rows[0].severity, '4');
  // A stray number on a safe act is removed, not printed as if the act were a risk.
  assert.equal(rows[1].severity, '');
  assert.equal(rows[2].severity, '');
});

test('an unsafe observation without severity is refused', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      walkthrough: [{ area: 'Ramp 3', type: 'Unsafe condition', severity: '', details: 'Oil spill' }]
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('severity')));

  // A severity outside 1–5 is the same as none.
  const invalid = plan.normalisePlan({
    ...filled(),
    modules: {
      walkthrough: [{ area: 'Ramp 3', type: 'Unsafe condition', severity: '9', details: 'Oil spill' }]
    }
  });
  assert.equal(invalid.ok, false);
});

test('a row that is still being typed does not block the plan', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      // The rest of the plan is filled; only this row is still blank.
      tbt: { attendees: '18' },
      walkthrough: [{ area: '', type: 'Unsafe act', severity: '', details: '' }]
    }
  });
  assert.equal(result.ok, true);
});

test('PPE observations keep every item, and read the old single item', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      ppe: [
        { employee: 'Ravi Kumar', employeeNo: 'EMP004', items: ['Safety Helmet', 'Hand Gloves'], issue: 'Missing PPE' },
        { employee: 'Sonu Yadav', item: 'Safety Shoe', issue: 'PPE OK' }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.modules.ppe[0].items, ['Safety Helmet', 'Hand Gloves']);
  // The field used to be a single `item`; an older payload still prints its PPE.
  assert.deepEqual(result.plan.modules.ppe[1].items, ['Safety Shoe']);
  assert.equal(result.plan.modules.ppe[0].employeeNo, 'EMP004');
});

test('photos must be real images and stay inside the payload budget', () => {
  const accepted = plan.normalisePlan({
    ...filled(),
    modules: { walkthrough: [{ area: 'Ramp', type: 'Safe act', details: 'Good', photo: TINY_JPEG }] }
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.plan.modules.walkthrough[0].photo, TINY_JPEG);

  const rejected = plan.normalisePlan({
    ...filled(),
    modules: {
      walkthrough: [
        { area: 'A', type: 'Safe act', photo: 'https://example.com/a.jpg' },
        { area: 'B', type: 'Safe act', photo: 'data:text/html;base64,PHNjcmlwdD4=' },
        { area: 'C', type: 'Safe act', photo: `data:image/jpeg;base64,${'A'.repeat(200_000)}` }
      ]
    }
  });
  assert.equal(rejected.ok, true);
  // Fake, wrong-typed and oversized images are all dropped rather than stored.
  assert.deepEqual(rejected.plan.modules.walkthrough.map((row) => row.photo), ['', '', '']);
});

test('more photos than a shift can attach is a clear refusal', () => {
  // 24 photos is the budget for a shift; the 25th is refused.
  const rows = Array.from({ length: 25 }, (_, index) => ({
    area: `Area ${index}`,
    type: 'Safe act',
    details: '',
    photo: TINY_JPEG
  }));
  const result = plan.normalisePlan({ ...filled(), modules: { walkthrough: rows } });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('photos')));
});

test('a photo on its own makes an observation count', () => {
  const empty = plan.emptyPlan('2026-10-21');
  assert.equal(plan.filledModuleCount(empty), 0);

  empty.modules.walkthrough = [{ area: '', type: 'Unsafe act', severity: '2', details: '', photo: TINY_JPEG }];
  assert.equal(plan.filledModuleCount(empty), 1);
  assert.equal(plan.isEmptyPlan(empty), false);
});

test('a PPE observation covers the team unless one employee is named', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      ppe: [
        // Nothing named: the team was observed, so the row stays scope "all".
        { issue: 'Missing PPE', items: ['Safety Helmet'] },
        // A name with no explicit scope is an individual observation (older payloads).
        { employee: 'Ravi Kumar', employeeNo: 'EMP004', issue: 'PPE OK' },
        // Explicit "all" clears whatever name was typed before the operator switched.
        { scope: 'all', employee: 'Ravi Kumar', employeeNo: 'EMP004', items: ['Hand Gloves'] }
      ]
    }
  });

  assert.equal(result.ok, true);
  const rows = result.plan.modules.ppe;
  assert.equal(rows[0].scope, 'all');
  assert.equal(rows[0].employee, '');
  assert.equal(rows[1].scope, 'individual');
  assert.equal(rows[1].employee, 'Ravi Kumar');
  assert.equal(rows[2].scope, 'all');
  assert.equal(rows[2].employee, '');
  assert.equal(rows[2].employeeNo, '');
  assert.deepEqual(rows[2].items, ['Hand Gloves']);
});

test('an individual PPE row keeps the employee number the master filled', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: { ppe: [{ scope: 'individual', employeeNo: 'EMP004', employee: 'Ravi Kumar', items: ['Safety Shoe'] }] }
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.modules.ppe[0].employeeNo, 'EMP004');
});

test('a walk-through observation records the immediate action taken', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      walkthrough: [{
        area: 'Ramp 3', type: 'Unsafe condition', severity: '3',
        details: 'Oil spill', action: 'Area cordoned and spill cleaned'
      }]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.modules.walkthrough[0].action, 'Area cordoned and spill cleaned');

  // The action alone is an answer, even with no area or details typed yet.
  const actionOnly = plan.normalisePlan({
    ...filled(),
    modules: { walkthrough: [{ type: 'Safe act', action: 'Housekeeping praised at the gate' }] }
  });
  assert.equal(actionOnly.ok, true);
  assert.equal(plan.filledModuleCount(actionOnly.plan), 1);
});


// A 1 × 1 PNG: enough to prove a drawn signature is carried and embedded.
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('filing needs the declaration ticked and a drawn signature', () => {
  const unsigned = plan.normalisePlan(filled(), { requireSignOff: true });
  assert.equal(unsigned.ok, false);
  assert.equal(unsigned.errors.length, 2);
  assert.match(unsigned.errors.join(' '), /Tick the declaration/);
  assert.match(unsigned.errors.join(' '), /Sign the plan/);

  // Ticking the box alone is not a signature.
  const declaredOnly = plan.normalisePlan({ ...filled(), signOff: { declared: true } }, { requireSignOff: true });
  assert.equal(declaredOnly.ok, false);
  assert.equal(declaredOnly.errors.length, 1);

  const signed = plan.normalisePlan(
    { ...filled(), signOff: { declared: true, signature: TINY_PNG } },
    { requireSignOff: true }
  );
  assert.equal(signed.ok, true);
  assert.equal(signed.plan.signOff.declared, true);
  assert.equal(signed.plan.signOff.signature, TINY_PNG);
  // The browser stamps the signing time; if it did not, the server does.
  assert.ok(signed.plan.signOff.signedAt);
});

test('the archive still reads plans filed before the declaration existed', () => {
  const archived = plan.normalisePlan(filled());
  assert.equal(archived.ok, true);
  assert.deepEqual(archived.plan.signOff, { declared: false, signature: '', signedAt: '' });
  assert.ok(plan.normalisePlan(filled()).ok, 'reading never demands a signature');
});

test('only a PNG drawn signature is carried into the record', () => {
  assert.equal(plan.signatureData('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(plan.signatureData('data:image/jpeg;base64,AAAA'), '');
  assert.equal(plan.signatureData('javascript:alert(1)'), '');
  assert.equal(plan.signatureData(42), '');
  assert.equal(plan.signatureData('data:image/png;base64,' + 'A'.repeat(plan.MAX_SIGNATURE_CHARS)), '');

  const asJpeg = plan.normalisePlan(
    { ...filled(), signOff: { declared: true, signature: 'data:image/jpeg;base64,AAAA' } },
    { requireSignOff: true }
  );
  assert.equal(asJpeg.ok, false);
});

test('the thank-you line names the supervisor', () => {
  assert.equal(plan.thankYouLine('Musahid Ansari'), 'Thank you Mr Musahid Ansari for submitting the DM.');
  assert.equal(plan.thankYouLine('  '), 'Thank you for submitting the DM.');
  // A name that already carries a title is not given a second one.
  assert.equal(plan.thankYouLine('Mr Ravi Kumar'), 'Thank you Mr Ravi Kumar for submitting the DM.');
  assert.equal(plan.thankYouLine('Ms. Neha Singh'), 'Thank you Ms. Neha Singh for submitting the DM.');
});


test('every module that asks for a photo keeps it', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      equipment: [{ name: 'EOT crane', photo: TINY_JPEG }],
      tools: [{ name: 'Torque wrench', photo: TINY_JPEG }],
      housekeeping: { checks: {}, observations: 'Scrap near bay 2', photo: TINY_JPEG },
      interaction: { team: [], topics: [], feedback: 'Crew asked for gloves', photo: TINY_JPEG },
      incident: { categories: ['Near miss'], photo: TINY_JPEG },
      training: { employee: 'Ravi Kumar', photo: TINY_JPEG }
    }
  });

  assert.equal(result.ok, true);
  const m = result.plan.modules;
  assert.equal(m.equipment[0].photo, TINY_JPEG);
  assert.equal(m.tools[0].photo, TINY_JPEG);
  assert.equal(m.housekeeping.photo, TINY_JPEG);
  assert.equal(m.interaction.photo, TINY_JPEG);
  assert.equal(m.incident.photo, TINY_JPEG);
  assert.equal(m.training.photo, TINY_JPEG);
  assert.equal(plan.planPhotos(result.plan).length, 6);
});

test('a fake image is dropped in every module, not just the two it used to check', () => {
  const result = plan.normalisePlan({
    ...filled(),
    modules: {
      equipment: [{ name: 'Crane', photo: 'https://example.com/crane.jpg' }],
      tools: [{ name: 'Spanner', photo: 'data:text/html;base64,PHNjcmlwdD4=' }],
      housekeeping: { photo: `data:image/png;base64,${'A'.repeat(200_000)}` },
      incident: { photo: true }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.modules.equipment[0].photo, '');
  assert.equal(result.plan.modules.tools[0].photo, '');
  assert.equal(result.plan.modules.housekeeping.photo, '');
  assert.equal(result.plan.modules.incident.photo, '');
  assert.equal(plan.planPhotos(result.plan).length, 0);
});

test('a photo on its own fills the module it belongs to', () => {
  const photoOnly = plan.emptyPlan('2026-10-21');
  photoOnly.modules.training.photo = TINY_JPEG;
  assert.equal(plan.filledModuleCount(photoOnly), 1);
  assert.equal(plan.isEmptyPlan(photoOnly), false);

  const housekeepingOnly = plan.emptyPlan('2026-10-21');
  housekeepingOnly.modules.housekeeping.photo = TINY_JPEG;
  assert.equal(plan.filledModuleCount(housekeepingOnly), 1);
  assert.equal(plan.isEmptyPlan(housekeepingOnly), false);

  // And a photo is enough to file, even with nothing typed anywhere.
  assert.equal(plan.normalisePlan({
    ...filled(),
    modules: { incident: { photo: TINY_JPEG } }
  }).ok, true);
});
