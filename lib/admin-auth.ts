import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Server-side gate for the admin / safety-officer surfaces.
 *
 * Why this exists: the officer sign-in dialog in the UI is a *demo* login — its username
 * and password are compile-time constants in a client component, so every visitor can
 * read them. That is fine while the dashboard shows synthetic records, but the employee
 * directory now holds ~191 real people. A client-side check cannot protect it: anyone can
 * call the endpoint directly with curl.
 *
 * So the admin API is gated here instead, on the server:
 *   - a passcode that only exists in the server environment,
 *   - compared in constant time,
 *   - exchanged for an HMAC-signed, httpOnly, SameSite=Strict cookie with a short life.
 *
 * This is deliberately modest. It is a single shared operator credential, not per-user
 * identity, and it carries no audit trail of *who* signed in. It is the smallest thing
 * that is honestly safe to put in front of real personal data; it must be replaced by
 * Supabase Auth plus a `staff_memberships` role check before this ships to real users.
 */

export const ADMIN_COOKIE = 'safex_admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MIN_PASSCODE_LENGTH = 12;

export type AdminSession = { issuedAt: number; expiresAt: number; nonce: string };

/** The operator has configured a passcode, so the admin API may be served at all. */
export function isAdminApiConfigured(): boolean {
  const passcode = process.env.SAFEX_ADMIN_PASSCODE ?? '';
  return passcode.length >= MIN_PASSCODE_LENGTH;
}

/**
 * Whether verified officers may see mobile numbers, addresses and blood groups.
 *
 * Separate from sign-in on purpose. Blood group is health data and a home address can put
 * someone at risk, so reading them is its own decision — one an operator has to take
 * explicitly, not something that arrives bundled with "can log in".
 */
export function isAdminPiiEnabled(): boolean {
  return isAdminApiConfigured() && process.env.SAFEX_ADMIN_PII_ENABLED === 'true';
}

function sessionSecret(): string {
  const explicit = process.env.SAFEX_ADMIN_SESSION_SECRET ?? '';
  if (explicit.length >= 16) return explicit;
  // Fall back to deriving from the passcode so a single env var still yields signed
  // cookies. Rotating the passcode then invalidates every existing session, which is the
  // behaviour you want anyway.
  return `derived:${process.env.SAFEX_ADMIN_PASSCODE ?? ''}`;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself leak length. Compare a
  // fixed-size digest of each side instead, so every comparison costs the same.
  const leftDigest = createHmac('sha256', 'compare').update(left).digest();
  const rightDigest = createHmac('sha256', 'compare').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

/** Verify the operator passcode. Returns false when no passcode is configured. */
export function passcodeMatches(candidate: string): boolean {
  if (!isAdminApiConfigured()) return false;
  return constantTimeEqual(candidate, process.env.SAFEX_ADMIN_PASSCODE ?? '');
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
