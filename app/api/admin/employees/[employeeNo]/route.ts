import { NextRequest, NextResponse } from 'next/server';
import { isAdminApiConfigured, isAdminPiiEnabled, readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { deactivateEmployeeProfile, updateEmployeeProfile } from '@/lib/employee-master/writes';
import { isEmployeeNo, type EmployeeProfileInput } from '@/lib/employee-master/profile-fields';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One employee, from the admin console's profile screen.
 *
 * PATCH edits the person; DELETE takes them out of the roster (the row is deactivated, not
 * erased, so reports and training history keep pointing at something). Both need the same
 * verified session as the roster itself — this is the employee master, not a public form.
 */

const allowWrite = createRateLimiter({ windowMs: 60_000, max: 60 });

function deny(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status, headers: NO_STORE });
}

function gate(request: NextRequest): NextResponse | null {
  if (!sameOrigin(request)) return deny(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin requests are not accepted.');
  if (!isAdminApiConfigured()) return deny(503, 'ADMIN_API_NOT_CONFIGURED', 'The admin API is disabled.');
  if (readSession(request) === null) return deny(401, 'ADMIN_SESSION_REQUIRED', 'Sign in to change the employee master.');
  if (!allowWrite(clientIp(request))) return deny(429, 'RATE_LIMITED', 'Too many requests. Slow down.');
  return null;
}

function statusFor(code: string): number {
  if (code === 'VALIDATION') return 422;
  if (code === 'DUPLICATE') return 409;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'PII_DISABLED') return 403;
  if (code === 'NO_SITE') return 400;
  return 503;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ employeeNo: string }> }) {
  const blocked = gate(request);
  if (blocked) return blocked;

  const { employeeNo: rawNo } = await context.params;
  const currentNo = decodeURIComponent(rawNo ?? '').trim().slice(0, 64);
  if (!isEmployeeNo(currentNo)) return deny(400, 'INVALID_EMPLOYEE_NO', 'That employee number is not valid.');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return deny(400, 'BAD_REQUEST', 'Send a JSON body.');
  }

  const fields = typeof body.fields === 'object' && body.fields !== null
    ? body.fields as EmployeeProfileInput
    : null;
  if (!fields) return deny(400, 'BAD_REQUEST', 'Send the fields to update.');

  const result = await updateEmployeeProfile({ currentNo, patch: fields, includePii: isAdminPiiEnabled() });
  if (!result.ok) return deny(statusFor(result.code), result.code, result.error);
  return NextResponse.json({ ok: true, employeeNo: result.employeeNo }, { headers: NO_STORE });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ employeeNo: string }> }) {
  const blocked = gate(request);
  if (blocked) return blocked;

  const { employeeNo: rawNo } = await context.params;
  const employeeNo = decodeURIComponent(rawNo ?? '').trim().slice(0, 64);
  if (!isEmployeeNo(employeeNo)) return deny(400, 'INVALID_EMPLOYEE_NO', 'That employee number is not valid.');

  const result = await deactivateEmployeeProfile(employeeNo);
  if (!result.ok) return deny(statusFor(result.code), result.code, result.error);
  return NextResponse.json({ ok: true, employeeNo: result.employeeNo, deactivated: true }, { headers: NO_STORE });
}
