import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Supabase-managed operator sign-in.
 *
 * The password must never reach our database or our own comparison code: Supabase Auth owns
 * it. Our side owns the allowlist. These assertions keep both halves in place.
 */

const accounts = readFileSync('lib/admin-accounts.ts', 'utf8');
const credentials = readFileSync('lib/admin-credentials.ts', 'utf8');
const auth = readFileSync('lib/admin-auth.ts', 'utf8');
const route = readFileSync('app/api/admin/session/route.ts', 'utf8');
const migration = readFileSync('supabase/migrations/202610220001_admin_accounts.sql', 'utf8');

test('the password is verified by Supabase Auth, never stored by this app', () => {
  assert.ok(accounts.includes('/auth/v1/token?grant_type=password'), 'token endpoint must be used');
  assert.equal(/password_hash|passwordhash|scryptSync|bcrypt\.(hash|compare)/i.test(accounts), false, 'no local password storage');
  assert.equal(/^\s*(?:create|alter)[^;]*password/im.test(migration), false, 'no password column may be declared');
});

test('a verified Supabase user still needs an active allowlist row', () => {
  assert.ok(accounts.includes("from('admin_accounts')"), 'allowlist lookup must exist');
  assert.ok(accounts.includes(".eq('active', true)"), 'inactive accounts must not sign in');
  assert.ok(accounts.includes('signInWithSupabase'), 'one entry point combines both checks');
  const body = accounts.slice(accounts.indexOf('export async function signInWithSupabase'));
  const resolveAt = body.indexOf('resolveAdminAccount');
  const verifyAt = body.indexOf('verifySupabasePassword');
  assert.ok(resolveAt > -1 && verifyAt > resolveAt, 'allowlist first, password second');
});

test('the table is server-only', () => {
  assert.ok(migration.includes('enable row level security'));
  assert.ok(migration.includes('revoke all on public.admin_accounts from anon, authenticated'));
  assert.ok(migration.includes('grant all on public.admin_accounts to service_role'));
});

test('the Supabase path needs an explicit cookie secret, not the database key', () => {
  assert.ok(credentials.includes('supabaseAdminConfigured'));
  assert.ok(credentials.includes('MIN_SESSION_SECRET'), 'a short secret must not enable it');
  assert.equal(/SAFEX_ADMIN_SESSION_SECRET[^\n]*SERVICE_ROLE/.test(credentials), false);
});

test('the console gate counts the Supabase path as configured', () => {
  assert.ok(auth.includes('supabaseAdminConfigured()'), 'isAdminApiConfigured must include it');
  assert.ok(auth.includes('sub?: string'), 'the session carries who signed in');
});

test('sign-in falls back to Supabase only after the environment credentials fail', () => {
  const passcodeAt = route.indexOf('passcodeMatches(passcode)');
  const envAt = route.indexOf('verifyAdminCredentials(username, password)');
  const supaAt = route.indexOf('signInWithSupabase(username, password)');
  assert.ok(passcodeAt > -1 && envAt > passcodeAt && supaAt > envAt, 'order must be passcode, env, Supabase');
  assert.ok(route.includes('if (!accepted && !passcode && username && password)'), 'Supabase is a fallback');
  assert.ok(route.includes('issueSessionCookie(subject)'), 'the session must record the account');
});

test('a rejected sign-in keeps the same public shape', () => {
  assert.ok(route.includes("code: passcode ? 'INVALID_PASSCODE' : 'INVALID_CREDENTIALS'"));
  assert.equal(route.includes('ADMIN_ACCOUNT_NOT_FOUND'), false, 'never reveal which half failed');
});

test('the login page offers no account creation and no self-service reset', () => {
  const dialog = readFileSync('app/components/OfficerAccessDialog.tsx', 'utf8');
  const page = dialog.toLowerCase();

  assert.equal(page.includes('forgot'), false, 'no "Forgot password" link');
  assert.equal(page.includes('reset'), false, 'no reset mode, handler or copy');
  assert.equal(page.includes('create account'), false, 'no account creation');
  assert.equal(page.includes('sign up') || page.includes('signup') || page.includes('register'), false);

  // The dialog only ever posts the sign-in payload.
  const posts = [...dialog.matchAll(/fetch\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(posts, ['/api/admin/session']);
  assert.equal(dialog.includes("method: 'POST'"), true);
  assert.equal(dialog.includes("method: 'PUT'"), false);

  // The reset flow's leftovers must not come back through the stylesheet or the catalogs.
  const css = readFileSync('app/globals.css', 'utf8');
  assert.equal(css.includes('account-login-footer'), false, 'dead footer style removed');
  assert.equal(css.includes('account-back-button'), false, 'dead back-button style removed');
  const i18n = readFileSync('lib/i18n.ts', 'utf8') + readFileSync('lib/i18n-extended.ts', 'utf8');
  for (const dead of ['Forgot Password?', 'Send Reset Link', 'Back to Login', 'Password Reset']) {
    assert.equal(i18n.includes(dead), false, `${dead} must not linger in a catalog`);
  }
});
