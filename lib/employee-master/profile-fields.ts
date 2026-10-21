/**
 * Field rules for the admin console's employee profile form.
 *
 * The console's form and the `public.employees` table do not use the same names, and the
 * form accepts a few things the table must not (a future date of birth, a 5 000-character
 * note). Everything here is pure, so the mapping and the validation can be tested without a
 * database — a wrong map writes the mobile number into the blood group and nobody notices
 * until an emergency.
 *
 * `SAFEX_ADMIN_PII_ENABLED` decides the second half: when it is off the roster never sends
 * personal fields to the browser, so the form cannot show them, so writing them back would
 * blank the stored value. Those fields are rejected outright instead.
 */

/** The console's form fields, in its own naming. */
export type EmployeeProfileInput = {
  employeeNo?: string;
  name?: string;
  designation?: string;
  department?: string | null;
  mobile?: string | null;
  bloodGroup?: string | null;
  email?: string | null;
  gender?: string | null;
  dob?: string | null;
  emergencyName?: string | null;
  emergencyMobile?: string | null;
  location?: string | null;
  address?: string | null;
  notes?: string | null;
  previousNames?: string[];
  /** Data URL of the employee's photograph, already shrunk by the browser. */
  photo?: string | null;
};

/** Console field → database column. Anything not listed here is rejected. */
export const EMPLOYEE_FIELD_COLUMNS = {
  employeeNo: 'employee_no',
  name: 'full_name',
  designation: 'designation',
  department: 'department',
  mobile: 'mobile_e164',
  bloodGroup: 'blood_group',
  email: 'email',
  gender: 'gender',
  dob: 'dob',
  emergencyName: 'emergency_contact_name',
  emergencyMobile: 'emergency_contact_mobile',
  location: 'work_location',
  address: 'home_address',
  notes: 'notes',
  previousNames: 'previous_names',
  photo: 'photo'
} as const satisfies Record<keyof EmployeeProfileInput, string>;

/**
 * Fields the console may only see and write when PII release is enabled. Work location is
 * deliberately absent: knowing where someone works is not the same as knowing who they are.
 */
export const PII_EMPLOYEE_FIELDS: readonly (keyof EmployeeProfileInput)[] = [
  'mobile', 'bloodGroup', 'email', 'gender', 'dob',
  'emergencyName', 'emergencyMobile', 'address', 'notes', 'previousNames'
];

// `photo` is intentionally absent above. The release switch exists so that health data and
// a home address are never shown without an explicit decision; a face on the roster is what
// makes the passport a passport, and the user asked for it as part of the profile. It is
// still never selected by the roster query — only for the one person being opened.

/**
 * The largest a stored photograph may be, in characters of base64.
 *
 * The browser has already re-encoded the file (`compressPhoto`: longest edge 1000 px, JPEG
 * quality stepped down until it fits in about 120 000 characters), so a legitimate save
 * lands well under half of this. The ceiling catches a caller that skipped the browser —
 * and anything this large is a phone photo that was never resized, not a record.
 */
export const MAX_PHOTO_CHARS = 200_000;
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export const EMPLOYEE_GENDERS = ['Female', 'Male', 'Other', 'Prefer not to say'] as const;

export type PatchResult =
  | { ok: true; columns: Record<string, string | string[] | null> }
  | { ok: false; code: 'INVALID_FIELD' | 'INVALID_VALUE' | 'PII_DISABLED' | 'EMPTY_PATCH'; error: string };

const EMPLOYEE_NO = /^[A-Za-z0-9._/-]{1,32}$/;
// Same shape the design's own form accepts, so the two never disagree about a number.
const MOBILE = /^\+?[\d\s().-]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isEmployeeNo(value: unknown): value is string {
  return typeof value === 'string' && EMPLOYEE_NO.test(value.trim());
}

function text(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * Turn the console's payload into database columns.
 *
 * Only keys the caller actually sent are considered: an absent field means "leave it
 * alone", never "set it to empty". That distinction is what stops a save from wiping the
 * mobile number of an employee because the browser was not allowed to read it.
 */
export function normaliseEmployeePatch(
  input: EmployeeProfileInput,
  options: { includePii: boolean }
): PatchResult {
  const columns: Record<string, string | string[] | null> = {};
  const sent = (Object.keys(EMPLOYEE_FIELD_COLUMNS) as (keyof EmployeeProfileInput)[])
    .filter((key) => input[key] !== undefined);

  if (sent.length === 0) return { ok: false, code: 'EMPTY_PATCH', error: 'No fields to update.' };

  const piiSent = sent.filter((key) => PII_EMPLOYEE_FIELDS.includes(key));
  if (piiSent.length && !options.includePii) {
    return {
      ok: false,
      code: 'PII_DISABLED',
      error: `Personal fields (${piiSent.join(', ')}) cannot be written while SAFEX_ADMIN_PII_ENABLED is off.`
    };
  }

  for (const key of sent) {
    const column = EMPLOYEE_FIELD_COLUMNS[key];
    const raw = input[key];

    if (key === 'employeeNo') {
      if (!isEmployeeNo(raw)) return { ok: false, code: 'INVALID_VALUE', error: 'Employee number is not valid.' };
      columns[column] = (raw as string).trim();
      continue;
    }

    if (key === 'name') {
      const value = text(raw);
      if (!value || value.length > 120) {
        return { ok: false, code: 'INVALID_VALUE', error: 'A name of 1–120 characters is required.' };
      }
      columns[column] = value;
      continue;
    }

    if (key === 'photo') {
      const value = text(raw);
      if (value) {
        if (!PHOTO_DATA_URL.test(value)) {
          return { ok: false, code: 'INVALID_VALUE', error: 'The photo must be a JPEG, PNG or WEBP image.' };
        }
        if (value.length > MAX_PHOTO_CHARS) {
          return { ok: false, code: 'INVALID_VALUE', error: 'That photo is too large — choose a smaller one.' };
        }
      }
      columns[column] = value;
      continue;
    }

    if (key === 'previousNames') {
      const list = Array.isArray(raw) ? raw : [];
      columns[column] = [...new Set(list
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean))]
        .slice(0, 20)
        .map((entry) => entry.slice(0, 120));
      continue;
    }

    if (key === 'mobile' || key === 'emergencyMobile') {
      const value = text(raw);
      if (value && !MOBILE.test(value)) {
        return {
          ok: false,
          code: 'INVALID_VALUE',
          error: key === 'mobile' ? 'Enter a valid mobile number.' : 'Enter a valid emergency mobile number.'
        };
      }
      columns[column] = value;
      continue;
    }

    if (key === 'email') {
      const value = text(raw);
      if (value && (value.length > 160 || !EMAIL.test(value))) {
        return { ok: false, code: 'INVALID_VALUE', error: 'Enter a valid email address.' };
      }
      columns[column] = value;
      continue;
    }

    if (key === 'dob') {
      const value = text(raw);
      if (value) {
        if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
          return { ok: false, code: 'INVALID_VALUE', error: 'Date of birth must be a date (YYYY-MM-DD).' };
        }
        if (value > new Date().toISOString().slice(0, 10)) {
          return { ok: false, code: 'INVALID_VALUE', error: 'Date of birth cannot be in the future.' };
        }
      }
      columns[column] = value;
      continue;
    }

    if (key === 'gender') {
      const value = text(raw);
      if (value && !(EMPLOYEE_GENDERS as readonly string[]).includes(value)) {
        return { ok: false, code: 'INVALID_VALUE', error: 'Choose a listed gender value.' };
      }
      columns[column] = value;
      continue;
    }

    // Everything else is free text with a length ceiling.
    const limit = key === 'notes' ? 2000 : 240;
    const value = text(raw);
    if (value && value.length > limit) {
      return { ok: false, code: 'INVALID_VALUE', error: `${key} is longer than ${limit} characters.` };
    }
    columns[column] = value;
  }

  return { ok: true, columns };
}
