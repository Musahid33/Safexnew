import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the reward wall prints the caption on the photo, not in a table under it', () => {
  const carousel = read('app/components/RewardCarousel.tsx');
  assert.equal(carousel.includes('reward-recognition-table'), false, 'the Name / Reward For table is gone');
  assert.equal(carousel.includes('<table'), false, 'no table in the recognition gallery');
  assert.match(carousel, /<figcaption className="reward-gallery-overlay">/);
  // Name and reason live inside the same figure as the photo.
  const figure = carousel.slice(carousel.indexOf('<figure className="reward-gallery-card"'));
  const caption = figure.slice(0, figure.indexOf('</figure>'));
  assert.match(caption, /\{name && <b title=\{name\}>\{name\}<\/b>\}/);
  assert.match(caption, /\{reward && <span>\{reward\}<\/span>\}/);
  assert.match(caption, /<img className="reward-gallery-image" src=\{item\.imageUrl\}/);
});

test('the gallery styles no longer ship the removed table', () => {
  const css = read('app/globals.css');
  assert.equal(css.includes('reward-recognition-table'), false);
  assert.match(css, /\.reward-gallery-overlay \{/);
  assert.match(css, /\.reward-gallery-card \{[^}]*aspect-ratio: 4 \/ 5;/);
});

test('admin photo upload is admin-gated, image-only, size-capped and lands in the public bucket', () => {
  const route = read('app/api/admin/recognitions/photo/route.ts');
  assert.match(route, /createAdminGuard\(\{ windowMs: 60_000, max: 20 \}\)/);
  assert.match(route, /const MAX_BYTES = 5 \* 1024 \* 1024;/);
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) assert.ok(route.includes(type), type);
  assert.equal(route.includes('image/svg'), false, 'SVG can carry script and is refused');
  assert.match(route, /storage\.from\(RECOGNITION_BUCKET\)\.upload/);
  assert.match(route, /getPublicUrl\(path\)/);
});

test('the reward photo bucket exists, is public and web-image only', () => {
  const migration = 'supabase/migrations/202610220003_reward_photos.sql';
  assert.ok(existsSync(new URL(`../${migration}`, import.meta.url)));
  const sql = read(migration);
  assert.match(sql, /values \('safex-rewards', 'safex-rewards', true, 5242880/);
  assert.equal(sql.includes("'image/svg+xml'"), false);
});

test('an uploaded reward photo URL passes recognition validation', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const code = stripTypeScriptTypes(read('lib/recognitions-validation.ts'));
  const { validRecognitionInput } = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  try {
    const url = 'https://project.supabase.co/storage/v1/object/public/safex-rewards/rewards/tenant/photo.jpg';
    const valid = { employeeName: 'Test Worker', rewardFor: 'Best supervisor', consentConfirmed: true, isPublished: true, imageUrl: url };
    assert.equal(validRecognitionInput(valid)?.image_url, url);
    assert.equal(validRecognitionInput({ ...valid, imageUrl: url.replace('https:', 'http:') }), null, 'https only');
  } finally {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
});
