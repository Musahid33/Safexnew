import { NextRequest, NextResponse } from 'next/server';
import { isAdminPiiEnabled } from '@/lib/admin-auth';
import { createAdminGuard, deny } from '@/lib/http/admin-gate';
import { NO_STORE } from '@/lib/http/request-guard';
import { findEmployeeProfileInDatabase, getCompanyNameFromDatabase } from '@/lib/employee-master/db-source';
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

const guard = createAdminGuard({ windowMs: 60_000, max: 60 });

/**
 * The employee number from the URL, or null when it is not one.
 *
 * Decoded defensively: a malformed escape must be a 400, and the value is never truncated —
 * a 40-character path must not quietly become the 32-character number it starts with.
 */
function readEmployeeNo(raw: string | undefined): string | null {
  try {
    const value = decodeURIComponent(raw ?? '').trim();
    return isEmployeeNo(value) ? value : null;
  } catch {
    return null;
  }
}

function statusFor(code: string): number {
  if (code === 'VALIDATION') return 422;
  if (code === 'DUPLICATE') return 409;
  if (code === 'NOT_FOUND') return 404;
  if (code === 'PII_DISABLED') return 403;
  if (code === 'NO_SITE') return 400;
  return 503;
}

/**
 * One employee, for the admin passport screen.
 *
 * The roster list deliberately never selects the photo — a face per row would be copied
 * into every search response — so the passport loads its record here, one person at a
 * time. Personal fields follow the same rule as the list: only a signed-in operator sees
 * them, and only while PII release is on.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ employeeNo: string }> }) {
  const blocked = guard(request, 'Sign in to change the employee master.');
  if (blocked) {
    // Listing read the passcode but not the write rate limit; keep the same answer shape.
    return blocked;
  }

  const employeeNo = readEmployeeNo((await context.params).employeeNo);
  if (!employeeNo) return deny(400, 'INVALID_EMPLOYEE_NO', 'That employee number is not valid.');

  const found = await findEmployeeProfileInDatabase(employeeNo);
  if (!found) return deny(404, 'NOT_FOUND', 'No employee with that number exists.');

  const record = found.record;
  const includePii = isAdminPiiEnabled();
  const companyName = await getCompanyNameFromDatabase();
  const base = {
    empNo: record.employeeNo,
    name: record.fullName,
    designation: record.designation,
    department: record.department,
    siteId: record.siteId,
    skillGrade: record.skillGrade,
    location: record.workLocation ?? null,
    active: record.active,
    // Not part of the PII release: the passport has to show the person it belongs to.
    photo: record.photo ?? null,
    photoAvailable: found.photoAvailable
  };

  return NextResponse.json(
    {
      ok: true,
      piiIncluded: includePii,
      companyName,
      employee: includePii
        ? {
          ...base,
          safetyPassNo: record.safetyPassNo,
          bloodGroup: record.bloodGroup,
          mobile: record.mobileE164,
          email: record.email ?? null,
          gender: record.gender ?? null,
          dob: record.dob ?? null,
          emergencyName: record.emergencyContactName ?? null,
          emergencyMobile: record.emergencyContactMobile ?? null,
          address: record.homeAddress ?? null,
          notes: record.notes ?? null,
          previousNames: record.previousNames ?? []
        }
        : base
    },
    { headers: NO_STORE }
  );
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ employeeNo: string }> }) {
  const blocked = guard(request, 'Sign in to change the employee master.');
  if (blocked) return blocked;

  const currentNo = readEmployeeNo((await context.params).employeeNo);
  if (!currentNo) return deny(400, 'INVALID_EMPLOYEE_NO', 'That employee number is not valid.');

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
  return NextResponse.json(
    { ok: true, employeeNo: result.employeeNo, photoSaved: !result.photoSkipped },
    { headers: NO_STORE }
  );
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ employeeNo: string }> }) {
  const blocked = guard(request, 'Sign in to change the employee master.');
  if (blocked) return blocked;

  const employeeNo = readEmployeeNo((await context.params).employeeNo);
  if (!employeeNo) return deny(400, 'INVALID_EMPLOYEE_NO', 'That employee number is not valid.');

  const result = await deactivateEmployeeProfile(employeeNo);
  if (!result.ok) return deny(statusFor(result.code), result.code, result.error);
  return NextResponse.json({ ok: true, employeeNo: result.employeeNo, deactivated: true }, { headers: NO_STORE });
}
