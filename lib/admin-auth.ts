import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import {
  credentialsConfigured, passcodeConfigured, sessionSigningKey, ADMIN_PASSWORD, ADMIN_USERNAME
} from './admin-credentials';

/**
 * Server-side gate for the admin / safety-officer surfaces.
 *
 * The sign-in dialog in the UI cannot be trusted: anything it checks is shipped to the
 * browser. The employee directory behind it holds real people, so the check happens here —
 * a passcode or shared account that exists only in the server environment, compared in
 * constant time, exchanged for an HMAC-signed, httpOnly, SameSite=Strict cookie.
 *
 * When nothing is configured the gate fails closed: `isAdminApiConfigured()` is false and
 * every admin route answers 503 instead of falling back to a published default login.
 *
 * This remains a single shared operator credential, not per-user identity, and it carries no
 * audit trail of *who* signed in. It is the smallest thing that is honestly safe in front of
 * personal data, and must be replaced by Supabase Auth plus a `staff_memberships` role check.
 */

export const ADMIN_COOKIE = 'safex_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type AdminSession = { issuedAt: number; expiresAt: number; nonce: string };

/**
 * Whether the admin API may be served at all — one usable credential must be set.
 *
 * A signing secret on its own is not enough: it would open the dialog with nothing that can
 * ever match, so the check asks for a passcode or an account.
 */
export function isAdminApiConfigured(): boolean {
  return (passcodeConfigured() || credentialsConfigured()) && sessionSigningKey() !== null;
}

/**
 * Whether verified officers may see mobile numbers, addresses and blood groups.
 *
 * Separate from sign-in on purpose: blood group is health data and a home address can put
 * someone at risk, so reading them is its own explicit operator decision.
 */
export function isAdminPiiEnabled(): boolean {
  return isAdminApiConfigured() && process.env.SAFEX_ADMIN_PII_ENABLED === 'true';
}

function sign(payload: string): string {
  const key = sessionSigningKey();
  if (!key) throw new Error('admin session key is not configured');
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  // timingSafeEqual throws on a length mismatch, which leaks length. Hash both sides first so
  // every comparison costs the same.
  const left = createHmac('sha256', 'compare').update(a, 'utf8').digest();
  const right = createHmac('sha256', 'compare').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** Verify the operator passcode. False when no passcode is configured. */
export function passcodeMatches(candidate: string): boolean {
  if (!passcodeConfigured()) return false;
  return constantTimeEqual(candidate, process.env.SAFEX_ADMIN_PASSCODE ?? '');
}

/**
 * Verify the shared staff username and password in constant time.
 *
 * The username is case-insensitive (people type it in caps); the password is exact. False
 * when the pair is not configured, so an unset environment cannot be matched by an empty
 * submission.
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (!credentialsConfigured()) return false;
  return constantTimeEqual(username.toLowerCase(), ADMIN_USERNAME.toLowerCase())
    && constantTimeEqual(password, ADMIN_PASSWORD);
}

export function issueSessionCookie(): { value: string; maxAge: number } {
  const now = Date.now();
  const session: AdminSession = {
    issuedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    nonce: randomBytes(12).toString('base64url')
  };
  const body = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return { value: `${body}.${sign(body)}`, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

export function readSession(request: NextRequest): AdminSession | null {
  if (!isAdminApiConfigured()) return null;
  const raw = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!raw) return null;
  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;
  const body = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!constantTimeEqual(signature, sign(body))) return null;
  try {
    const session = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AdminSession;
    if (typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true as const,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge
  };
}
