/**
 * Employee master parsing/normalisation.
 *
 * Pure functions only — no network, no `server-only` import — so this file can be unit
 * tested and reused by the import script. The real source sheet is hand-maintained, so
 * every normaliser is forgiving but records what it had to correct.
 */

export type MasterEmployeeRecord = {
  employeeNo: string;
  fullName: string;
  designation: string;
  department: string | null;
  skillGrade: string | null;
  safetyPassNo: string | null;
  bloodGroup: string | null;
  /** Server-only. Never include this in an API response to a browser. */
  mobileE164: string | null;
  active: boolean;
  siteId: string;
};

export type MasterIssue = {
  employeeNo: string;
  field: string;
  severity: 'warning' | 'error';
  message: string;
};

export type ParsedEmployeeMaster = {
  records: MasterEmployeeRecord[];
  issues: MasterIssue[];
  skipped: number;
};

/** Split a CSV/TSV document into rows, honouring quoted fields and CRLF line endings. */
export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^\uFEFF/, '');
  const delimiter = sniffDelimiter(body);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"') {
        if (body[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ''));
}

function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

/** Header aliases, lower-cased and stripped of non-alphanumerics. */
const HEADER_ALIASES: Record<string, string> = {
  employeeid: 'employeeNo', employeeno: 'employeeNo', empid: 'employeeNo', empno: 'employeeNo',
  employeecode: 'employeeNo', code: 'employeeNo',
  name: 'fullName', fullname: 'fullName', employeename: 'fullName',
  designation: 'designation', role: 'designation', trade: 'designation',
  department: 'department', dept: 'department',
  safetypassno: 'safetyPassNo', safetypass: 'safetyPassNo', passno: 'safetyPassNo',
  bloodgroup: 'bloodGroup',
  mobile: 'mobile', mobileno: 'mobile', phone: 'mobile', contact: 'mobile', contactno: 'mobile',
  jntvtiskillgrade: 'skillGrade', skillgrade: 'skillGrade', grade: 'skillGrade',
  status: 'status', active: 'status',
  site: 'site', sitename: 'site', location: 'site'
};

const SKILL_GRADES: Record<string, string> = {
  platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze',
  // Observed spellings in the source sheet.
  siler: 'Silver', siver: 'Silver', sillver: 'Silver', slver: 'Silver'
};

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Indian mobile numbers. Returns E.164 (+91XXXXXXXXXX) or null when the value cannot be
 * trusted — an unverifiable number must never be used to send an OTP.
 */
export function normalizeIndianMobile(value: string): { e164: string | null; reason?: string } {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return { e164: null, reason: 'missing' };
  let local = digits;
  if (local.length === 12 && local.startsWith('91')) local = local.slice(2);
  else if (local.length === 11 && local.startsWith('0')) local = local.slice(1);
  if (local.length !== 10) return { e164: null, reason: `expected 10 digits, found ${digits.length}` };
  if (!/^[6-9]/.test(local)) return { e164: null, reason: 'does not start with 6-9' };
  return { e164: `+91${local}` };
}

export function normalizeSkillGrade(value: string): { grade: string | null; corrected: boolean } {
  const key = clean(value).toLowerCase();
  if (!key) return { grade: null, corrected: false };
  const match = SKILL_GRADES[key];
  if (!match) return { grade: clean(value), corrected: false };
  return { grade: match, corrected: match.toLowerCase() !== key };
}

export type NormalizeOptions = {
  /** Site every row belongs to when the sheet has no site column. */
  defaultSiteId: string;
  /** Drop rows whose Status column is not active. Defaults to true. */
  activeOnly?: boolean;
};

export function normalizeEmployeeMaster(rows: string[][], options: NormalizeOptions): ParsedEmployeeMaster {
  const issues: MasterIssue[] = [];
  const records: MasterEmployeeRecord[] = [];
  let skipped = 0;

  if (rows.length === 0) return { records, issues, skipped };

  const header = rows[0].map((cell) => HEADER_ALIASES[headerKey(cell)] ?? '');
  if (!header.includes('employeeNo') || !header.includes('fullName')) {
    issues.push({
      employeeNo: '-', field: 'header', severity: 'error',
      message: 'Sheet must expose an Employee ID column and a Name column.'
    });
    return { records, issues, skipped: rows.length - 1 };
  }

  const pick = (row: string[], key: string): string => {
    const index = header.indexOf(key);
    return index === -1 ? '' : clean(row[index]);
  };

  const seen = new Map<string, number>();
  const phones = new Map<string, string[]>();

  for (let r = 1; r < rows.length; r += 1) {
    const row = rows[r];
    const employeeNo = pick(row, 'employeeNo').toUpperCase();
    const fullName = pick(row, 'fullName');

    if (!employeeNo) { skipped += 1; continue; }
    if (!fullName) {
      // Reserved/unassigned ID in the sheet — not a person, so it must not be searchable.
      issues.push({ employeeNo, field: 'fullName', severity: 'warning', message: 'Row has no name; treated as an unassigned Employee ID.' });
      skipped += 1;
      continue;
    }

    const statusRaw = pick(row, 'status');
    const active = statusRaw === '' ? true : /^(active|yes|y|true|1)$/i.test(statusRaw);
    if (options.activeOnly !== false && !active) { skipped += 1; continue; }

    const designation = pick(row, 'designation');
    if (!designation) issues.push({ employeeNo, field: 'designation', severity: 'warning', message: 'Designation is blank; the report form will show no role.' });

    const { grade, corrected } = normalizeSkillGrade(pick(row, 'skillGrade'));
    if (corrected) issues.push({ employeeNo, field: 'skillGrade', severity: 'warning', message: `Skill grade spelling corrected to "${grade}".` });

    const mobileCell = pick(row, 'mobile');
    const { e164, reason } = normalizeIndianMobile(mobileCell);
    if (!e164 && mobileCell) {
      issues.push({ employeeNo, field: 'mobile', severity: 'warning', message: `Mobile unusable for OTP (${reason}).` });
    } else if (!e164) {
      issues.push({ employeeNo, field: 'mobile', severity: 'warning', message: 'No mobile recorded; OTP sign-in will not work for this employee.' });
    }
    if (e164) phones.set(e164, [...(phones.get(e164) ?? []), employeeNo]);

    const duplicateAt = seen.get(employeeNo);
    if (duplicateAt !== undefined) {
      issues.push({ employeeNo, field: 'employeeNo', severity: 'error', message: `Duplicate Employee ID (also row ${duplicateAt}); the later row was dropped.` });
      skipped += 1;
      continue;
    }
    seen.set(employeeNo, r + 1);

    records.push({
      employeeNo,
      fullName,
      designation,
      department: pick(row, 'department') || null,
      skillGrade: grade,
      safetyPassNo: pick(row, 'safetyPassNo') || null,
      bloodGroup: pick(row, 'bloodGroup') || null,
      mobileE164: e164,
      active: true,
      siteId: pick(row, 'site') || options.defaultSiteId
    });
  }

  for (const [phone, ids] of phones) {
    if (ids.length > 1) {
      issues.push({
        employeeNo: ids.join(', '), field: 'mobile', severity: 'error',
        message: `Shared mobile ${phone.slice(0, 5)}*****${phone.slice(-2)} — OTP cannot identify a single employee.`
      });
    }
  }

  return { records, issues, skipped };
}

export function parseEmployeeMaster(text: string, options: NormalizeOptions): ParsedEmployeeMaster {
  return normalizeEmployeeMaster(parseDelimited(text), options);
}

/** The only employee shape a browser is ever allowed to receive. */
export function toPublicEmployee(record: MasterEmployeeRecord) {
  return {
    id: `emp-${record.employeeNo.toLowerCase()}`,
    empNo: record.employeeNo,
    name: record.fullName,
    designation: record.designation,
    siteId: record.siteId
  };
}
