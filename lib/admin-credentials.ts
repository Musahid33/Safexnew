/**
 * Staff sign-in credentials, read from the server environment only.
 *
 * There is deliberately no built-in username or password. A fallback pair used to live here,
 * which meant a public repository also published a working admin login — anyone could sign
 * into the console that reads the employee directory. Credentials now exist only in the
 * deployment's encrypted environment, and when they are missing the admin API stays closed.
 *
 * Set either shape:
 *   SAFEX_ADMIN_PASSCODE                     one operator passcode (12+ characters), or
 *   ADMIN_USERNAME + ADMIN_PASSWORD          a shared staff account, or
 *   Supabase Auth + public.admin_accounts    per-person accounts (recommended)
 *
 * `SAFEX_ADMIN_SESSION_SECRET` (32+ random characters) signs the session cookie. Without it
 * the cookie key is derived: from the passcode/password when one is set, otherwise an HKDF
 * subkey of the service-role key, so a working deployment needs no extra variable. Rotating
 * whichever source was used ends every live session.
 */

import { hkdfSync } from 'node:crypto';

const MIN_PASSCODE = 12;
const MIN_SESSION_SECRET = 32;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

export const ADMIN_USERNAME = env('ADMIN_USERNAME');
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
export const ADMIN_PASSCODE = process.env.SAFEX_ADMIN_PASSCODE ?? '';

/** A shared staff account is usable only when both halves are set and the password is long. */
export function credentialsConfigured(): boolean {
  return ADMIN_USERNAME.length >= 3 && ADMIN_PASSWORD.length >= MIN_PASSCODE;
}

export function passcodeConfigured(): boolean {
  return ADMIN_PASSCODE.length >= MIN_PASSCODE;
}

/**
 * The cookie key for the Supabase path when no explicit secret is set.
 *
 * Derived with HKDF from the service-role key under a unique label, so the database key itself
 * is never used to sign a cookie — only a one-way subkey that cannot be turned back into it.
 * This is the same construction the report rate-limit salt uses, and it means the Supabase
 * sign-in works with the three variables a working deployment already has. Rotating the
 * service key ends every admin session, which is the correct blast radius.
 */
function derivedSigningKey(): string | null {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const publishable = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishable || !serviceKey) return null;
  try {
    const bytes = hkdfSync(
      'sha256',
      Buffer.from(serviceKey, 'utf8'),
      Buffer.from(url, 'utf8'),
      Buffer.from('safex-admin-session-v1', 'utf8'),
      32
    );
    return `supabase:${Buffer.from(bytes).toString('base64url')}`;
  } catch {
    return null;
  }
}

/**
 * Supabase-managed operator sign-in: a real auth user (password hashed by Supabase) plus an
 * allowlist row in `public.admin_accounts`.
 *
 * It needs the public key to call the token endpoint, the service key to read the allowlist,
 * and a cookie key — the explicit secret when set, otherwise the HKDF subkey above.
 */
export function supabaseAdminConfigured(): boolean {
  const status = adminRequirementStatus();
  return Boolean(status.url && status.publicKey && status.serviceKey && status.signingKey);
}

/**
 * Which half of the sign-in configuration is present, as booleans only.
 *
 * A closed console is indistinguishable from a misconfigured one over HTTP, which turns every
 * deployment into guesswork. These four flags answer "what is still missing" without ever
 * revealing a value: names of variables, never their contents. They are the same class of
 * information as `configured` itself.
 */
export function adminRequirementStatus(): {
  url: boolean;
  publicKey: boolean;
  serviceKey: boolean;
  sessionSecret: boolean;
  signingKey: boolean;
  passcode: boolean;
  envAccount: boolean;
} {
  return {
    url: Boolean(env('NEXT_PUBLIC_SUPABASE_URL')),
    publicKey: Boolean(env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') || env('NEXT_PUBLIC_SUPABASE_ANON_KEY')),
    serviceKey: Boolean(env('SUPABASE_SERVICE_ROLE_KEY')),
    sessionSecret: (process.env.SAFEX_ADMIN_SESSION_SECRET ?? '').trim().length >= MIN_SESSION_SECRET,
    signingKey: sessionSigningKey() !== null,
    passcode: passcodeConfigured(),
    envAccount: credentialsConfigured()
  };
}

/**
 * The HMAC key for the session cookie.
 *
 * An explicit secret always wins. Otherwise the key is derived from the passcode (preferred)
 * or the account password, which keeps a single-variable deployment working while still
 * binding the cookie to a server-only value. Null means sign-in is not configured at all.
 */
export function sessionSigningKey(): string | null {
  // Trimmed so a value pasted with a trailing newline is measured and used consistently.
  const explicit = (process.env.SAFEX_ADMIN_SESSION_SECRET ?? '').trim();
  if (explicit.length >= MIN_SESSION_SECRET) return explicit;
  if (passcodeConfigured()) return `passcode:${ADMIN_PASSCODE}`;
  if (credentialsConfigured()) return `password:${ADMIN_PASSWORD}`;
  return derivedSigningKey();
}
