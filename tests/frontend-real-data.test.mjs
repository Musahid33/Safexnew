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

test('the home feed module holds no invented feed', () => {
  const content = loader()('lib/home-content.ts');

  // There is no static feed at all — the screens receive published rows as props, so a
  // stub list that could silently come back is not kept around.
  assert.equal('getHomeFeedItems' in content, false);
  assert.equal('getUpcomingEvents' in content, false);

  // The date helpers still format a real date, so a published item renders correctly.
  assert.ok(content.formatHomeFeedDate('2026-10-21T09:00:00+05:30').includes('21'));
  assert.equal(content.APP_TIME_ZONE, 'Asia/Kolkata');
});

test('no synthetic safety alerts are published', () => {
  const alerts = loader()('lib/safety-alerts.ts');
  assert.deepEqual(alerts.SAFETY_ALERTS, []);
  // The filter chips are navigation, not data, so they stay.
  assert.ok(alerts.SAFETY_ALERT_FILTERS.includes('Fatal'));
  assert.ok(alerts.SAFETY_ALERT_FILTERS.includes('All'));
});

test('the company SOS number is the one the site operates', () => {
  const emergency = loader()('lib/emergency.ts');
  assert.equal(emergency.SOS_NUMBER, '+91 7070705925');
  assert.equal(emergency.SOS_DIAL, '+917070705925');
  assert.equal(emergency.telHref('+91 7070705925'), 'tel:+917070705925');
  assert.equal(emergency.telHref(null), 'tel:+917070705925');
});

test('a site keeps its own SOS number, and gets the company line only when it has none', () => {
  const siteConfig = loader()('lib/site-config.ts');

  assert.deepEqual(siteConfig.selectableSites([]), [], 'an empty tenant must not invent a site');

  const [withOwn] = siteConfig.selectableSites([
    { id: 'wbd', name: 'West Bokaro (WBD)', region: 'Jharkhand', sosNumber: '+91 11111 22222' }
  ]);
  assert.equal(withOwn.sosNumber, '+91 11111 22222');

  const [withoutOwn] = siteConfig.selectableSites([
    { id: 'wbd', name: 'West Bokaro (WBD)', region: 'Jharkhand', sosNumber: null }
  ]);
  assert.equal(withoutOwn.sosNumber, '+91 7070705925');

  // A single real site is used even when its name is not the one the matcher knows, and the
  // database name is never rewritten.
  const [onlySite] = siteConfig.selectableSites([
    { id: 'site-1', name: 'Bokaro Division', region: 'Jharkhand', sosNumber: null }
  ]);
  assert.equal(onlySite.name, 'Bokaro Division');
  assert.equal(onlySite.sosNumber, '+91 7070705925');
});

test('branding carries the real company name and invents no contact details', () => {
  const config = loader()('lib/app-config.ts');
  const branding = config.brandingFor('  EMVEESS  ');
  assert.equal(branding.companyName, 'EMVEESS');
  assert.equal(branding.companyAddress, null);
  assert.equal(branding.email, null);
  assert.equal(branding.mobile, null);
  assert.equal(branding.logoPath, null);
  assert.equal(config.brandingFor(null).companyName, '');
  // Feature switches are configuration; they do not add sample rows.
  assert.equal(config.APP_FEATURES.library, true);
});

test('the document vault lists no sample files', () => {
  // The four shelves are navigation only; every file comes from /api/content as a prop.
  const sources = [
    readFileSync('app/components/DocumentVault.tsx', 'utf8'),
    readFileSync('app/components/VaultShelf.tsx', 'utf8')
  ];
  for (const source of sources) {
    assert.equal((source.match(/documents: \[\]/g) ?? []).length, 0, 'a shelf carries no rows of its own');
    // The old rows were real-looking entries; none of their titles or revisions survive.
    assert.equal(source.includes('Lockout / Tagout'), false);
    assert.equal(source.includes("revision: 'Demo'"), false);
    assert.equal(source.includes("updated: '2026-"), false);
  }
  assert.ok(sources[0].includes('documents = []'), 'an empty vault is the default');
  assert.ok(sources[1].includes('documents.filter((document) => document.category === categoryId)'));
});

test('worker screens carry no implementation footnotes', () => {
  // These lines described the plumbing (this browser, sync, a server that is not configured,
  // demo content) instead of helping the worker. They were removed on request and must not
  // come back.
  const files = [
    'app/page.tsx',
    'app/components/ReportWorkflow.tsx',
    'app/components/DocumentVault.tsx',
    'app/components/TrainingPortal.tsx',
    'app/components/MorePages.tsx',
    'app/components/OfficerAccessDialog.tsx'
  ];
  const banned = [
    'Pending report details',
    'Saved on this device first',
    'not a sample entry',
    'Preferences save on this device',
    'Production push still requires',
    'Blank company fields are shown',
    'Account login is verified by the Safex server',
    'Missing company policy and support details',
    'Password reset and live Supabase authentication',
    'training catalog and training records are not connected'
  ];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const line of banned) {
      assert.equal(source.includes(line), false, `${file} must not show "${line}"`);
    }
  }
});

test('the SOS card is the emergency card: red header, big number, call and cancel', () => {
  const page = readFileSync('app/page.tsx', 'utf8');

  // Structure of the card the worker sees.
  for (const piece of [
    'sos-hero',
    'sos-hero-icon',
    'sos-modal',
    'sos-body',
    'sos-company',
    'sos-number',
    'sos-call-button',
    'sos-cancel-button'
  ]) {
    assert.ok(page.includes(piece), `${piece} is part of the SOS card`);
  }
  assert.ok(page.includes('EMERGENCY HELPLINE'));
  assert.ok(page.includes('Tap to Call'));
  assert.ok(page.includes('href={telHref(sosNumber)}'), 'the big button dials the site number');
  assert.ok(page.includes('onClick={() => setSosOpen(false)}'), 'Cancel closes it');

  // The number reads the way it is dialled in the country: no +91 in the headline.
  assert.ok(page.includes('nationalNumber(sosNumber)'));
  const match = page.match(/function nationalNumber\(value: string\): string \{([\s\S]*?)\n\}/);
  assert.ok(match, 'the helper exists');
  const helper = match[1];
  assert.ok(helper.includes("replace(/^\\+?91[\\s-]?/, '')"), 'a +91 prefix is stripped');

  // The helpline belongs to Tata Steel, so the card carries that name and no tenant branding.
  assert.ok(page.includes("T('Tata Steel Emergency Call')"));
  assert.equal(page.includes('{company} Emergency Call'), false, 'no tenant-branded subtitle');
  assert.equal(page.includes('sos-company">{brandCompanyName'), false);

  // And it says, in English and Hindi, that the number is for emergencies only.
  assert.ok(page.includes("T('This is the Tata Steel emergency number. Use it only in an emergency.')"));
  assert.ok(page.includes('lang="hi"'));
  assert.ok(page.includes('इसका उपयोग केवल आपातकालीन परिस्थिति में करें।'));
  assert.ok(page.includes('className="sos-note"'));

  // The card is themed for emergencies only, so it cannot inherit a light theme by accident.
  const css = readFileSync('app/globals.css', 'utf8');
  assert.ok(css.includes('.sos-modal {'));
  assert.ok(css.includes('background: #0b1f33'), 'navy body');
  assert.ok(css.includes('.sos-hero {'));
  assert.ok(css.includes('background: linear-gradient(180deg, #ec1c1c, #d81818)'), 'red header');
  assert.equal(css.includes('.sos-call-link'), false, 'the old flat link is gone');
});

test('the worker page imports no demo tenant, site or alert set', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.equal(page.includes('DEMO_TENANT'), false);
  assert.equal(page.includes('DEMO_SAFETY_ALERTS'), false);
  assert.equal(page.includes('DEMO_SITES'), false);
  assert.ok(page.includes('brandingFor('));
  assert.ok(page.includes('SAFETY_ALERTS'));
  assert.ok(page.includes('SOS_NUMBER'));
  assert.ok(page.includes('telHref(sosNumber)'));

  const bootstrap = readFileSync('app/components/useSafexBootstrap.ts', 'utf8');
  assert.equal(bootstrap.includes('DEMO_'), false);
  assert.ok(bootstrap.includes('sites: [],'));
  assert.ok(bootstrap.includes('companyName: null,'));
});

test('the rewards and training screens render an empty state instead of artwork', () => {
  const carousel = readFileSync('app/components/RewardCarousel.tsx', 'utf8');
  assert.equal(carousel.includes('DEMO_RECOGNITION_CARDS'), false);
  assert.ok(carousel.includes('reward-gallery-empty'));

  const training = readFileSync('app/components/TrainingPortal.tsx', 'utf8');
  assert.ok(training.includes('const TRAINING_VIDEOS: Material[] = [];'));
  assert.ok(training.includes('const TRAINING_MODULES: Material[] = [];'));
  assert.equal(training.includes('DEMO CATALOG'), false);
  assert.ok(training.includes('No training videos have been published yet.'));
});
