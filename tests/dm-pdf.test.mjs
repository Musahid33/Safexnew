import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';

// Same minimal TypeScript loader the other tests use. `pdf-lib` is a real package, so it is
// injected from node_modules instead of being resolved as a repository file.
const nodeRequire = createRequire('/home/user/Safexnew/package.json');

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

const planModule = loader()('lib/dm/plan.ts');
const pdfModule = loader({ 'pdf-lib': nodeRequire('pdf-lib') })('lib/dm/pdf.ts');
const { PDFDocument } = nodeRequire('pdf-lib');

// A 1 × 1 PNG standing in for a hand-drawn signature.
const TINY_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function filledPlan(overrides = {}) {
  const base = planModule.emptyPlan('2026-10-21');
  base.shift = 'A';
  base.supervisor = 'Musahid Ansari';
  base.supervisorNo = 'EIPL-1042';
  base.location = 'Stockyard — Ramp 3';
  base.modules.permits = {
    permitNo: 'P-7712',
    takenBy: 'Site contractor',
    reviewedBy: 'Musahid Ansari',
    checks: planModule.PERMIT_CHECKS.map((_, index) => index < 4),
    observations: 'Two workers without harness at height.',
    actions: 'Stopped the job, harnesses issued before restart.'
  };
  base.modules.tbt = {
    attendees: '18',
    topics: 'Work at height, lifting plan, housekeeping',
    previousIncidents: 'One near miss on 20-10-2026 at the ramp.',
    criticalTasks: 'Erection of the second bay.',
    procedures: 'Anchor points inspected before use.',
    theme: 'Stop, look, assess.',
    ppe: 'Helmet, harness, safety shoes.',
    concerns: 'Workers asked for a second water point.',
    takeaways: 'Harness checks at the start of every shift.',
    conductedBy: 'Musahid Ansari'
  };
  base.modules.ppe = [
    { employee: 'Ravi Kumar', employeeNo: 'EIPL-1042', issue: 'Missing PPE', items: ['Safety Helmet', 'Hand Gloves'], remarks: 'Issued from store', photo: '' },
    { employee: 'Sonu Yadav', employeeNo: 'EIPL-1108', issue: 'PPE OK', items: ['Safety Shoe'], remarks: '', photo: '' }
  ];
  base.modules.walkthrough = [
    {
      area: 'Ramp 3', type: 'Unsafe condition', severity: '3', details: 'Oil spill near the ramp.',
      action: 'Area cordoned and spill cleaned before the next pour.', photo: ''
    }
  ];
  base.modules.equipment = [
    { name: 'Crane 2', check: 'Pre-use inspection', devices: 'Limit switch, horn', status: 'Deficiency', remarks: 'Brake slack — tagged out' }
  ];
  base.modules.tools = [
    { name: 'Spanner set', toolId: 'T-19', safe: 'Safe', description: 'No damage', condition: 'Good', remarks: '', action: '', responsible: 'Tool room' }
  ];
  base.modules.housekeeping = {
    checks: { '1s-1': 'yes', '1s-2': 'no', '2s-1': 'yes', '2s-9': 'na' },
    observations: 'Scrap dumped behind the shed.',
    action: 'Cleared during the shift.'
  };
  base.modules.interaction = {
    team: [{ name: 'Ravi Kumar', number: 'EIPL-1042', designation: 'Rigger' }],
    topics: ['Work at height', 'PPE requirement & usage'],
    feedback: 'Workers asked for a second water point.',
    escalated: false,
    followUp: true,
    targetDate: '2026-10-25'
  };
  base.modules.incident = {
    location: 'Ramp 3',
    reportedBy: 'Musahid Ansari',
    reportNo: 'NM-114',
    date: '2026-10-21',
    time: '09:20',
    categories: ['Near miss'],
    persons: [{ name: 'Sonu Yadav', number: 'EIPL-1108', designation: 'Helper' }],
    description: 'Forklift came close to a walking worker.',
    action: 'Walkway marked and barriers placed.',
    investigation: true
  };
  base.modules.training = {
    employeeNo: 'EIPL-1042',
    employee: 'Ravi Kumar',
    action: 'Refresher scheduled',
    observation: 'Anchor point used without inspection.',
    required: true,
    conducted: false,
    records: true,
    needType: 'Work at height'
  };
  base.modules.admin = [
    { sopNo: 'SOP-14', compliance: 'Non-compliant', adequacy: 'Adequate', actionBy: 'Ravi Kumar', remarks: 'SOP copy not at the workface' }
  ];
  return Object.assign(base, overrides);
}

/**
 * The document's text, read back out of the compressed content streams.
 *
 * pdf-lib draws text as hex strings inside a Flate-compressed content stream, so the bytes
 * of the file say nothing on their own. Decoding the streams is how this test can assert
 * that the reference — the thing an operator quotes in an audit — is actually printed.
 */
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  const chunks = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const buffer = Buffer.from(match[1], 'latin1');
    let stream;
    try {
      stream = inflateSync(buffer).toString('latin1');
    } catch {
      stream = buffer.toString('latin1');
    }
    for (const hex of stream.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      chunks.push(Buffer.from(hex[1].replace(/\s+/g, ''), 'hex').toString('latin1'));
    }
    for (const literal of stream.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      chunks.push(literal[1].replace(/\\([()\\])/g, '$1'));
    }
  }
  return chunks.join('\n');
}

test('a filled plan renders a real PDF with the reference on it', async () => {
  const bytes = await pdfModule.renderDmPdf(filledPlan(), {
    reference: 'DM-21-10-26',
    siteName: 'West Bokaro',
    companyName: 'EMVEESS INFRAVENTURES PVT. LTD.'
  });

  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length > 4000);
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');

  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
  assert.ok(document.getPageCount() <= 8);

  const text = pdfText(bytes);
  assert.ok(text.includes('DM-21-10-26'), 'the document number is printed');
  assert.ok(text.includes('DAILY MANAGEMENT PLAN'));
  assert.ok(text.includes('Musahid Ansari'));
  assert.ok(text.includes('Ramp 3'));
  // Severity and the multi-item PPE list are what the new columns exist for.
  assert.ok(text.includes('3 / 5'));
  assert.ok(text.includes('Area cordoned and spill cleaned'), 'the immediate action is printed');
  assert.ok(text.includes('Safety Helmet, Hand Gloves'));
  assert.ok(text.includes('EIPL-1042'));
  // Every module band is printed, in order.
  planModule.MODULE_TITLES.forEach((title, index) => {
    assert.ok(text.includes(title.replace(/[&]/g, '&').slice(0, 18)), `module ${index + 1} is printed`);
  });
});

test('the PDF survives curly quotes, emoji and Devanagari instead of throwing', async () => {
  const plan = filledPlan();
  plan.modules.tbt.theme = '“Stop, look, assess” — 5S 🚧 सुरक्षा first';
  plan.modules.permits.actions = 'Paid ₹500 for the harness; checked → restarted.';
  plan.supervisor = 'Musahid “M” Ansari';

  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  assert.ok(bytes.length > 4000);
  const text = pdfText(bytes);
  // WinAnsi has no emoji or Devanagari, so they are dropped; the ASCII around them stays.
  assert.ok(text.includes('Stop, look, assess'));
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(text));
});

test('a very long plan stays readable: cells wrap and pages get footers', async () => {
  const plan = filledPlan();
  plan.modules.ppe = Array.from({ length: 30 }, (_, index) => ({
    employee: `Worker ${index + 1} with a long designation that keeps going and going`,
    issue: 'Missing PPE',
    item: 'Full body harness',
    remarks: 'Issued from the store after the toolbox talk and the supervisor verified the fit.'
  }));

  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 2);
  const text = pdfText(bytes);
  assert.ok(/Page 1 of \d+/.test(text), 'footers carry the page count');
  assert.ok(text.includes('DM-21-10-26'));
});

test('an empty plan still produces a document rather than an error', async () => {
  const plan = planModule.emptyPlan('2026-11-02');
  plan.supervisor = 'Musahid Ansari';
  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-02-11-26', siteName: 'Site' });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  assert.ok(pdfText(bytes).includes('DM-02-11-26'));
});

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

test('attached photos are printed with the observations', async () => {
  const plan = filledPlan();
  plan.modules.walkthrough = [{
    area: 'Ramp 3', type: 'Unsafe condition', severity: '3', details: 'Oil spill near the ramp.', photo: TINY_JPEG
  }];
  plan.modules.ppe = [{
    scope: 'individual', employee: 'Ravi Kumar', employeeNo: 'EMP004', issue: 'Missing PPE',
    items: ['Safety Helmet'], remarks: 'Issued from store', photo: TINY_JPEG
  }];

  const withPhotos = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const text = pdfText(withPhotos);
  assert.ok(text.includes('Photographs'), 'evidence gets its own caption');
  assert.ok(text.includes('PPE 1'));

  // The same image bytes are embedded once, not once per occurrence.
  const withoutPhotos = filledPlan();
  withoutPhotos.modules.walkthrough = plan.modules.walkthrough.map((row) => ({ ...row, photo: '' }));
  withoutPhotos.modules.ppe = plan.modules.ppe.map((row) => ({ ...row, photo: '' }));
  const plain = await pdfModule.renderDmPdf(withoutPhotos, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  assert.ok(withPhotos.length > plain.length, 'a photo adds bytes to the document');
});

test('a damaged photo is skipped, not fatal', async () => {
  const plan = filledPlan();
  plan.modules.walkthrough = [{
    // Correctly shaped data URL, unusable bytes inside.
    area: 'Ramp 3', type: 'Unsafe act', severity: '2', details: 'Blocked walkway',
    photo: `data:image/jpeg;base64,${'A'.repeat(400)}`
  }];

  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  assert.ok(pdfText(bytes).includes('DM-21-10-26'));
});

test('an archived plan from before photos and severity still renders', async () => {
  const legacy = filledPlan();
  // The shape stored by the first release of the form.
  legacy.modules.walkthrough = [{ time: '09:15', area: 'Ramp 3', type: 'Unsafe act / condition', details: 'Oil spill', photo: true }];
  legacy.modules.ppe = [{ employee: 'Ravi Kumar', issue: 'Missing PPE', item: 'Helmet', remarks: '' }];

  const bytes = await pdfModule.renderDmPdf(legacy, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  assert.ok(pdfText(bytes).includes('Helmet'));
});

test('a team-wide PPE observation prints as "All employees"', async () => {
  const plan = filledPlan();
  plan.modules.ppe = [{
    scope: 'all', employee: '', employeeNo: '', issue: 'Missing PPE',
    items: ['Safety Helmet', 'Hand Gloves'], remarks: 'Issued at the gate', photo: ''
  }];

  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const text = pdfText(bytes);
  assert.ok(text.includes('All employees'));
  assert.ok(text.includes('Safety Helmet, Hand Gloves'));
});


test('the declaration and the hand-drawn signature are printed', async () => {
  const plan = filledPlan();
  const plain = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });

  plan.signOff = { declared: true, signature: TINY_SIGNATURE, signedAt: '2026-10-21T04:12:00.000Z' };
  const signed = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const text = pdfText(signed);

  assert.ok(text.includes('DECLARATION'), 'the declaration is printed');
  assert.ok(text.includes('Signature of supervisor'), 'the signature is captioned');
  assert.ok(text.includes('2026-10-21 04:12 UTC'), 'the signing time is printed');
  assert.ok(signed.length > plain.length, 'the drawn signature adds bytes to the document');
});

test('an archived plan without a signature prints "not on record", not a blank claim', async () => {
  const plan = filledPlan();
  plan.signOff = { declared: false, signature: '', signedAt: '' };
  const bytes = await pdfModule.renderDmPdf(plan, { reference: 'DM-21-10-26', siteName: 'West Bokaro' });
  const text = pdfText(bytes);
  assert.ok(text.includes('Signature (not on record)'));
  assert.ok(text.includes('Not accepted'));
});
