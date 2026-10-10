import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE, cookieOptions, isAdminApiConfigured, isAdminPiiEnabled,
  issueSessionCookie, passcodeMatches, readSession, verifyAdminCredentials
} from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign-in for the admin / safety-officer console.
 *
 * Two ways in, either accepted:
 *   - { passcode } — the operator's SAFEX_ADMIN_PASSCODE, which lives only in the server
 *     environment (kept for the console's workspace gate and for tooling);
 *   - { username, password } — the dummy demo credentials in lib/admin-credentials.ts,
 *     which the login dialog sends. The check happens here, on the server, in constant
 *     time; the browser never decides for itself.
 *
 * A wrong guess is rate limited hard (10 attempts per 10 minutes per IP) because a
 * single shared credential is exactly the kind of thing that gets brute forced.
 */

const allowAttempt = createRateLimiter({ windowMs: 600_000, max: 10 });

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      configured: isAdminApiConfigured(),
      signedIn: readSession(request) !== null,
      piiEnabled: isAdminPiiEnabled()
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }

  if (!isAdminApiConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        code: 'ADMIN_API_NOT_CONFIGURED',
        error: 'Set SAFEX_ADMIN_PASSCODE (12+ characters) on the server to enable the admin console.'
      },
      { status: 503, headers: NO_STORE }
    );
  }

  if (!allowAttempt(clientIp(request))) {
    return NextResponse.json(
      { ok: false, code: 'TOO_MANY_ATTEMPTS', error: 'Too many sign-in attempts. Try again later.' },
      { status: 429, headers: NO_STORE }
    );
  }

  let passcode = '';
  let username = '';
  let password = '';
  try {
    const body = await request.json();
    passcode = typeof body?.passcode === 'string' ? body.passcode.slice(0, 200) : '';
    username = typeof body?.username === 'string' ? body.username.trim().slice(0, 100) : '';
    password = typeof body?.password === 'string' ? body.password.slice(0, 200) : '';
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400, headers: NO_STORE });
  }

  // A passcode field takes precedence; otherwise the username/password pair is checked.
  const accepted = passcode
    ? passcodeMatches(passcode)
    : verifyAdminCredentials(username, password);

  if (!accepted) {
    // Same shape and status for "wrong passcode" and "wrong username/password": nothing
    // here should help an attacker tell the two apart.
    return NextResponse.json(
      {
        ok: false,
        code: passcode ? 'INVALID_PASSCODE' : 'INVALID_CREDENTIALS',
        error: passcode ? 'That passcode was not accepted.' : 'That username and password were not accepted.'
      },
      { status: 401, headers: NO_STORE }
    );
  }

  const { value, maxAge } = issueSessionCookie();
  const response = NextResponse.json(
    { ok: true, piiEnabled: isAdminPiiEnabled() },
    { headers: NO_STORE }
  );
  response.cookies.set(ADMIN_COOKIE, value, cookieOptions(maxAge));
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
  response.cookies.set(ADMIN_COOKIE, '', cookieOptions(0));
  return response;
}
