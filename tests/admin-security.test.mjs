import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { stripTypeScriptTypes, createRequire } from 'node:module';

/**
 * The admin console reads the employee directory, so its sign-in has to fail closed.
 *
 * These checks exist because the repository used to ship a working default login
 * (`safety.officer.demo` / `SafetyDemo2026!`) plus a fixed cookie-signing secret. A public
 * repository that contains a credential publishes it to everyone who can read the source,
 * so the rules below are enforced by tests rather than by a comment asking nicely.
 */

const nodeRequire = createRequire(import.meta.url);

function loader(overrides = {}) {
  const cache = new Map();
  function load(path) {
    const file = resolve(path);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    let code = stripTypeScriptTypes(readFileSync(file, 'utf8'));
    const names = [...code.matchAll(/^export (?:async )?(?:function|const|let|class) (\w+)/gm)].map((m) => m[1]);
    code = code
      .replace(/^import ['"]server-only['"];?/gm, '')
      .replace(/^import type [^;]+;?/gm, '')
      .replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
        (_, bindings, source) => `const {${bindings.replace(/\bas\b/g, ':')}} = require(${JSON.stringify(source)});`)
      .replace(/^export (?=(?:async )?(?:function|const|let|class) )/gm, '');
    code += `\nObject.assign(exports, {${[...new Set(names)].join(',')}});`;
    const require = (name) => {
      if (name === 'server-only') return {};
      if (name in overrides) return overrides[name];
      if (name.startsWith('node:') || name === 'crypto') return nodeRequire(name);
      const target = name.startsWith('@/') ? resolve(name.slice(2)) : resolve(dirname(file), name);
      return load(`${target}.ts`);
    };
    new Function('exports', 'require', code)(exports, require);
    return exports;
  }
  return load;
}

function sourcesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourcesUnder(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

test('no default admin credential or fixed cookie secret is committed', () => {
  const files = [...sourcesUnder('app'), ...sourcesUnder('lib')];
  for (const banned of [
    'safety.officer.demo',
    'SafetyDemo2026',
    'safex-demo-admin-session-secret',
    'DEMO_SESSION_SECRET',
    'FALLBACK_PASSWORD',
    'FALLBACK_USERNAME'
  ]) {
    for (const file of files) {
      assert.equal(readFileSync(file, 'utf8').includes(banned), false, `${banned} in ${file}`);
    }
  }
});

test('the admin API stays closed when nothing is configured', () => {
  const saved = { ...process.env };
  try {
    for (const key of ['SAFEX_ADMIN_PASSCODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SAFEX_ADMIN_SESSION_SECRET']) {
      delete process.env[key];
    }
    const credentials = loader()('lib/admin-credentials.ts');
    assert.equal(credentials.sessionSigningKey(), null);
    assert.equal(credentials.passcodeConfigured(), false);
    assert.equal(credentials.credentialsConfigured(), false);

    const auth = loader()('lib/admin-auth.ts');
    assert.equal(auth.isAdminApiConfigured(), false, 'the console must not open without a credential');
    assert.equal(auth.isAdminPiiEnabled(), false);
    assert.equal(auth.passcodeMatches(''), false, 'an empty passcode can never match');
    assert.equal(auth.verifyAdminCredentials('', ''), false, 'an empty pair can never match');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('a short passcode or password does not count as configured', () => {
  const saved = { ...process.env };
  try {
    for (const key of ['SAFEX_ADMIN_PASSCODE', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SAFEX_ADMIN_SESSION_SECRET']) {
      delete process.env[key];
    }
    process.env.SAFEX_ADMIN_PASSCODE = 'short';
    let credentials = loader()('lib/admin-credentials.ts');
    assert.equal(credentials.passcodeConfigured(), false);
    assert.equal(credentials.sessionSigningKey(), null);

    delete process.env.SAFEX_ADMIN_PASSCODE;
    process.env.ADMIN_USERNAME = 'operator';
    process.env.ADMIN_PASSWORD = 'elevenchars';
    credentials = loader()('lib/admin-credentials.ts');
    assert.equal(credentials.credentialsConfigured(), false);
    assert.equal(credentials.sessionSigningKey(), null);

    // A signing secret alone must not open the console: nothing could ever match it.
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    process.env.SAFEX_ADMIN_SESSION_SECRET = 'x'.repeat(48);
    const auth = loader()('lib/admin-auth.ts');
    assert.equal(auth.isAdminApiConfigured(), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('a long passcode signs the session and never travels to the browser', () => {
  const saved = { ...process.env };
  try {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SAFEX_ADMIN_SESSION_SECRET;
    process.env.SAFEX_ADMIN_PASSCODE = 'a-long-operator-passcode';
    const credentials = loader()('lib/admin-credentials.ts');
    assert.equal(credentials.passcodeConfigured(), true);
    assert.equal(credentials.sessionSigningKey(), 'passcode:a-long-operator-passcode');

    const auth = loader()('lib/admin-auth.ts');
    assert.equal(auth.isAdminApiConfigured(), true);
    assert.equal(auth.passcodeMatches('a-long-operator-passcode'), true);
    assert.equal(auth.passcodeMatches('wrong-passcode-here'), false);
    const { value, maxAge } = auth.issueSessionCookie();
    assert.ok(value.includes('.'));
    assert.equal(maxAge, 8 * 60 * 60);
    const cookie = auth.cookieOptions(maxAge);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'strict');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('the rate-limit salt never uses the service-role key unwrapped', () => {
  const route = readFileSync('app/api/reports/route.ts', 'utf8');
  assert.equal(
    /process\.env\.SAFEX_REPORT_RATE_LIMIT_SALT\s*\|\|\s*process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(route),
    false,
    'the service-role key must not be used directly as an HMAC salt'
  );
  assert.ok(route.includes('hkdfSync'), 'the fallback derives a separate key with HKDF');
});
