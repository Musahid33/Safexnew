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
 *   ADMIN_USERNAME + ADMIN_PASSWORD          a shared staff account
 *
 * `SAFEX_ADMIN_SESSION_SECRET` (32+ random characters) signs the session cookie. Without it
 * the cookie key is derived from the passcode/password, so rotating that key also ends every
 * existing session.
 */

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
 * The HMAC key for the session cookie.
 *
 * An explicit secret always wins. Otherwise the key is derived from the passcode (preferred)
 * or the account password, which keeps a single-variable deployment working while still
 * binding the cookie to a server-only value. Null means sign-in is not configured at all.
 */
export function sessionSigningKey(): string | null {
  const explicit = process.env.SAFEX_ADMIN_SESSION_SECRET ?? '';
  if (explicit.length >= MIN_SESSION_SECRET) return explicit;
  if (passcodeConfigured()) return `passcode:${ADMIN_PASSCODE}`;
  if (credentialsConfigured()) return `password:${ADMIN_PASSWORD}`;
  return null;
}
