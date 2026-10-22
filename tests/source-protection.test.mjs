import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source protection.
 *
 * A browser has to download the HTML, CSS and JavaScript it runs, so "hide the code" can only
 * mean three concrete things, and every one of them is easy to undo by accident:
 *
 *  1. ship no source maps and no comments (the bundle is the interface, not the repo);
 *  2. keep server code and every secret out of the client bundle;
 *  3. keep the origin out of search indexes, caches and archives.
 *
 * These assertions fail the build if a later change re-opens one of those doors.
 */

const nextConfig = readFileSync('next.config.ts', 'utf8');

test('production bundles carry no browser source maps', () => {
  assert.match(nextConfig, /productionBrowserSourceMaps:\s*false/);
  assert.equal(nextConfig.includes('productionBrowserSourceMaps: true'), false);
});

test('production bundles drop console noise', () => {
  assert.match(nextConfig, /removeConsole:/);
  assert.match(nextConfig, /NODE_ENV === 'production'/);
});

test('every response forbids indexing, and robots.txt blocks the whole origin', () => {
  assert.match(nextConfig, /X-Robots-Tag/);
  assert.match(nextConfig, /noindex, nofollow, noarchive/);

  const robots = readFileSync('app/robots.ts', 'utf8');
  assert.ok(robots.includes("disallow: '/'"), 'robots.txt must disallow every path');
  assert.equal(/^\s*allow:/m.test(robots), false, 'no path may be re-allowed');
});

test('the service worker ships without comments', () => {
  const worker = readFileSync('public/sw.js', 'utf8');
  assert.equal(/\/\*/.test(worker), false, 'no block comments in a publicly served asset');
  assert.equal(/^\s*\/\//m.test(worker), false, 'no line comments in a publicly served asset');
});

test('no public asset points at a source map', () => {
  for (const entry of readdirSync('public')) {
    const path = join('public', entry);
    if (!statSync(path).isFile() || !/\.(js|css|map)$/.test(entry)) continue;
    const text = readFileSync(path, 'utf8');
    assert.equal(text.includes('sourceMappingURL'), false, `${path} references a source map`);
  }
});

test('client code never references the service-role key or an admin secret', () => {
  const forbidden = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SAFEX_ADMIN_PASSCODE',
    'ADMIN_PASSWORD',
    'SAFEX_ADMIN_SESSION_SECRET',
    'SERVICE_ROLE'
  ];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry)) files.push(path);
    }
  };
  walk('app');
  walk('lib');

  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    if (!text.startsWith("'use client'")) continue;
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${path} is a client file but mentions ${needle}`);
    }
  }
});

test('the devtools shortcut guard is off outside production and leaves forms usable', () => {
  const guard = readFileSync('app/components/SourceGuard.tsx', 'utf8');
  assert.ok(guard.includes("process.env.NODE_ENV !== 'production'"), 'guard must be production-only');
  assert.ok(guard.includes('contextmenu'), 'context menu handling must exist');
  // Inputs, links, buttons and editable regions keep the native menu.
  assert.ok(guard.includes('input, textarea, select, a, button'), 'form fields must stay unaffected');
  assert.equal(guard.includes('onCopy'), false, 'copying must not be blocked');
  assert.equal(guard.includes('onPaste'), false, 'pasting must not be blocked');
  assert.ok(
    readFileSync('app/layout.tsx', 'utf8').includes('<SourceGuard />'),
    'the guard has to be mounted'
  );
});

test('the admin surface is not reachable without the server session', () => {
  for (const route of [
    'app/api/admin/content/route.ts',
    'app/api/admin/employees/route.ts',
    'app/api/admin/recognitions/route.ts',
    'app/api/admin/reports/route.ts',
    'app/api/admin/dm/route.ts'
  ]) {
    if (!existsSync(route)) continue;
    const text = readFileSync(route, 'utf8');
    assert.ok(text.includes('createAdminGuard('), `${route} must be behind the one admin gate`);
  }
});
