import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

/**
 * Safety alerts used to be a hard-coded empty array, so the worker app's alert screen could
 * never show a real incident. They are now published from the console into
 * `public.safety_alerts` and read back through `/api/alerts` — draft-proof, site-scoped and
 * validated before a row is written.
 */

/**
 * Load a module as a data: URL. A relative import cannot resolve from a data: URL, so the
 * catalogue is loaded first and its URL is spliced into the validator's import.
 */
async function loadCatalog() {
  const code = stripTypeScriptTypes(readFileSync(new URL('../lib/alerts/catalog.ts', import.meta.url), 'utf8'));
  const url = `data:text/javascript,${encodeURIComponent(code)}`;
  return { module: await import(url), url };
}

const { module: catalog, url: catalogUrl } = await loadCatalog();
const { alertCategoryKey, alertCategoryLabel, ALERT_CATEGORIES } = catalog;

const validation = stripTypeScriptTypes(readFileSync(new URL('../lib/alerts/validation.ts', import.meta.url), 'utf8'))
  .replace("from './catalog'", `from ${JSON.stringify(catalogUrl)}`);
const { validAlertInput } = await import(`data:text/javascript,${encodeURIComponent(validation)}`);

const valid = {
  category: 'First Aid',
  title: 'Hand injury while changing a grinder wheel',
  incidentAt: '2026-10-21T09:30:00+05:30',
  description: 'A fitter cut his hand while changing the wheel without isolating the tool.',
  area: 'Workshop',
  department: 'Mechanical',
  reference: 'ALR-2026-014',
  rootCause: 'Wheel guard removed and not refitted.',
  immediateResponse: 'First aid given\nArea cordoned off',
  correctiveActions: 'Wheel guard refitted',
  lessonsLearned: 'Isolate before changing the wheel',
  status: 'published'
};

test('an alert stores the database keys and one bullet per line', () => {
  const row = validAlertInput(valid);
  assert.ok(row);
  assert.equal(row.category_key, 'first_aid');
  assert.equal(row.headline, valid.title);
  assert.equal(row.status, 'published');
  assert.equal(row.incident_at, new Date(valid.incidentAt).toISOString());
  assert.deepEqual(row.immediate_response, ['First aid given', 'Area cordoned off']);
  assert.deepEqual(row.corrective_actions, ['Wheel guard refitted']);
  assert.deepEqual(row.lessons_learned, ['Isolate before changing the wheel']);
  assert.equal(row.department_name, 'Mechanical');
  assert.ok(row.published_at, 'publishing stamps a publish time');
});

test('a draft is saved without a publish time', () => {
  const row = validAlertInput({ ...valid, status: 'draft' });
  assert.equal(row.status, 'draft');
  assert.equal(row.published_at, null);
});

test('missing or malformed required fields are refused', () => {
  assert.equal(validAlertInput({ ...valid, category: 'Explosion' }), null);
  assert.equal(validAlertInput({ ...valid, title: '   ' }), null);
  assert.equal(validAlertInput({ ...valid, description: '' }), null);
  assert.equal(validAlertInput({ ...valid, incidentAt: 'not a date' }), null);
  assert.equal(validAlertInput({ ...valid, incidentAt: '' }), null);
  assert.equal(validAlertInput({ ...valid, title: 'x'.repeat(161) }), null);
  assert.equal(validAlertInput({ ...valid, immediateResponse: ['x'.repeat(301)] }), null);
  assert.equal(validAlertInput({ ...valid, lessonsLearned: Array.from({ length: 13 }, (_, i) => `point ${i}`) }), null);
  // An unknown status falls back to draft rather than publishing by accident.
  assert.equal(validAlertInput({ ...valid, status: 'live' }).status, 'draft');
});

test('bullets may arrive as an array and blank lines are dropped', () => {
  const row = validAlertInput({ ...valid, immediateResponse: ['First aid', '   ', 'Area cordoned'] });
  assert.deepEqual(row.immediate_response, ['First aid', 'Area cordoned']);
});

test('every filter label maps to a stable database key and back', () => {
  assert.deepEqual(ALERT_CATEGORIES, ['Fatal', 'LTI', 'Medical Case', 'Burn Injury', 'First Aid', 'Red Risk', 'Property Damage', 'Other']);
  for (const label of ALERT_CATEGORIES) {
    const key = alertCategoryKey(label);
    assert.ok(key, label);
    assert.match(key, /^[a-z0-9_]+$/);
    assert.equal(alertCategoryLabel(key), label);
  }
  assert.equal(alertCategoryLabel('something_else'), 'Other', 'an unknown key never reaches a CSS class');
  assert.equal(alertCategoryKey('explosion'), null);
});

test('the app reads real alerts and never falls back to invented ones', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.match(page, /fetch\(`\/api\/alerts\?site=\$\{encodeURIComponent\(siteId\)\}/);
  assert.match(page, /setPublishedAlerts\(data\.alerts as SafetyAlert\[\]\)/);
  assert.match(page, /const \[publishedAlerts, setPublishedAlerts\] = useState<SafetyAlert\[\]>\(SAFETY_ALERTS\)/);

  const builtIn = readFileSync('lib/safety-alerts.ts', 'utf8');
  assert.match(builtIn, /export const SAFETY_ALERTS: SafetyAlert\[\] = \[\];/, 'the built-in list stays empty');
  assert.match(builtIn, /\['All', \.\.\.ALERT_CATEGORIES\]/, 'filters come from the shared catalogue');
});

test('the public read is site-scoped, published-only and rate limited', () => {
  const store = readFileSync('lib/alerts/store.ts', 'utf8');
  assert.match(store, /\.eq\('status', 'published'\)/);
  assert.match(store, /\.lte\('published_at', new Date\(\)\.toISOString\(\)\)/);
  assert.match(store, /\.eq\('company_id', target\.store\.tenantId\)/);
  assert.match(store, /\.eq\('location_id', target\.siteId\)/);
  assert.doesNotMatch(store, /from\('safety_alerts'\)[\s\S]{0,200}public/i, 'no anon path');

  const route = readFileSync('app/api/alerts/route.ts', 'utf8');
  assert.match(route, /sameOrigin\(request\)/);
  assert.match(route, /createRateLimiter/);
  assert.doesNotMatch(route, /searchParams\.get\('status'\)/, 'the public route takes no status parameter');
  assert.match(route, /searchParams\.get\('site'\)/, 'the only input is the site');
});

test('the admin route is gated and scopes every write to the chosen site', () => {
  const route = readFileSync('app/api/admin/alerts/route.ts', 'utf8');
  assert.match(route, /createAdminGuard\(\{ windowMs: 60_000, max: 90 \}\)/);
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    assert.match(route, new RegExp(`export async function ${method}\\(`));
  }
  assert.match(route, /siteOf\(body\)/);
});

test('the console publishes safety alerts as another card in the same workspace', () => {
  const workspace = readFileSync('app/components/safetyos/PublisherWorkspace.tsx', 'utf8');
  assert.match(workspace, /type PublishKind = 'document' \| 'circular' \| 'notice' \| 'event' \| 'alert' \| 'reward';/);
  assert.match(workspace, /\{ kind: 'alert', label: 'Safety Alert'/);
  assert.match(workspace, /\{open === 'alert' && <form className="pub-form"/);
  assert.match(workspace, /\/api\/admin\/alerts/);
  assert.match(workspace, /saveAlert\('published'\)/);
  assert.match(workspace, /toggleAlert/);
  assert.match(workspace, /editAlert/);
  assert.doesNotMatch(workspace, /href=/, 'still no navigation away from the console');
});

test('the migration adds the feed index without creating a second table', () => {
  const sql = readFileSync('supabase/migrations/202610230001_safety_alerts_feed_index.sql', 'utf8');
  assert.match(sql, /create index if not exists safety_alerts_site_feed_idx/);
  assert.doesNotMatch(sql, /create table/i, 'the table already exists in the base schema');
});
