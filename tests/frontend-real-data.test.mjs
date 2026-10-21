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

test('the home feed has nothing invented in it', () => {
  const content = loader()('lib/home-content.ts');
  for (const kind of ['events', 'circulars', 'notices', 'updates']) {
    assert.deepEqual(content.getHomeFeedItems(kind), [], `${kind} must be empty until a feed exists`);
  }
  assert.deepEqual(content.getUpcomingEvents(), []);

  // The helpers still format a real date, so a published item will render correctly.
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
  const source = readFileSync('app/components/DocumentVault.tsx', 'utf8');
  assert.equal((source.match(/documents: \[\]/g) ?? []).length, 4, 'all four shelves start empty');
  // The old rows were real-looking entries; none of their titles or revisions survive.
  assert.equal(source.includes('Lockout / Tagout'), false);
  assert.equal(source.includes("revision: 'Demo'"), false);
  assert.equal(source.includes('updated: \'2026-'), false);
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
