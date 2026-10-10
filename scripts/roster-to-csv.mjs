/**
 * One-off converter: turn the pasted Google-Sheet roster text into a CSV whose headers
 * match the aliases lib/employee-master/parse.ts understands.
 *
 *   node scripts/roster-to-csv.mjs            # .data/raw-roster.txt -> employee-master.csv
 *   node scripts/roster-to-csv.mjs in.txt out.csv
 *
 * The source text has no field separators (a copy-paste artifact), so fields are recovered
 * by anchoring on the tokens that are always present and unambiguous: the Employee ID, the
 * two-letter safety-pass prefix, the blood group, the contractor name, the mobile digit run,
 * the skill grade and the status. Anything the anchors cannot resolve is reported instead of
 * being guessed silently.
 */
import { readFile, writeFile } from 'node:fs/promises';

const CONTRACTOR = 'Emveess Infraventures Pvt.Ltd';
const BLOOD_GROUP = /(AB[+-]|A[+-]|B[+-]|O[+-])/;
const GRADE = /(Platinum|Gold|Silver|Siler|Siver|Sillver)/i;
const THUMB = /https:\/\/drive\.google\.com\/thumbnail\?id=[\w-]+&(?:amp;)?sz=w\d+/;
const FILE_LINK = /https:\/\/drive\.google\.com\/file\/d\/[\w-]+\/view\?usp=sharing/;

/** Rows whose source text has no blood group, so Name/Designation cannot be split by anchor. */
const NAME_DESIGNATION_OVERRIDES = {
  EMP194: ['Abhay Kumar', 'Transport Supervisor'],
  EMP195: ['Rakesh Kisku', 'Security'],
  EMP196: ['Bushara Naaz', 'Office Staff'],
  EMP197: ['Akshay Karmali', 'Security']
};

const HEADERS = [
  'Employee ID',
  'Safety Pass No',
  'Name',
  'Blood Group',
  'Designation',
  'Contractor',
  'Mobile',
  'Address',
  'JNTVTI Skill Grade',
  'Status',
  'Photo Url',
  'Drive Photo Link'
];

const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();

function unescapeUrl(url) {
  return url ? url.replace(/&amp;/g, '&') : '';
}

function parseRow(line) {
  const warnings = [];

  const idMatch = line.match(/^(EMP\d{3})/);
  if (!idMatch) return null;
  const employeeNo = idMatch[1];
  let rest = line.slice(employeeNo.length);

  const safetyPassNo = (rest.match(/^([A-Z]{2}\d{6,})/)?.[1]) ?? '';
  rest = rest.slice(safetyPassNo.length);

  const contractorIndex = rest.indexOf(CONTRACTOR);
  if (contractorIndex === -1) {
    // A row with an Employee ID but no other column: just a name (an unassigned ID).
    const nameOnly = clean(rest);
    return {
      row: {
        'Employee ID': employeeNo,
        'Safety Pass No': safetyPassNo,
        Name: nameOnly,
        'Blood Group': '',
        Designation: '',
        Contractor: '',
        Mobile: '',
        Address: '',
        'JNTVTI Skill Grade': '',
        Status: '',
        'Photo Url': '',
        'Drive Photo Link': ''
      },
      warnings
    };
  }

  const beforeContractor = rest.slice(0, contractorIndex);
  const afterContractor = rest.slice(contractorIndex + CONTRACTOR.length);

  let fullName = '';
  let bloodGroup = '';
  let designation = '';

  const bloodMatch = BLOOD_GROUP.exec(beforeContractor);
  if (bloodMatch) {
    bloodGroup = bloodMatch[1];
    fullName = clean(beforeContractor.slice(0, bloodMatch.index));
    designation = clean(beforeContractor.slice(bloodMatch.index + bloodGroup.length));
  } else {
    const override = NAME_DESIGNATION_OVERRIDES[employeeNo];
    if (override) {
      [fullName, designation] = override;
      warnings.push(`${employeeNo}: no blood group in source; Name/Designation taken from the known row.`);
    } else {
      fullName = clean(beforeContractor);
      warnings.push(`${employeeNo}: no blood group found; whole "${fullName}" used as Name.`);
    }
  }

  const mobile = afterContractor.match(/^\s*(\d+)/)?.[1] ?? '';
  let tail = afterContractor.slice(afterContractor.indexOf(mobile) + mobile.length);
  if (mobile) tail = afterContractor.replace(/^\s*\d+/, '');

  let address = '';
  let skillGrade = '';
  let status = '';

  const gradeMatch = GRADE.exec(tail);
  if (gradeMatch) {
    address = clean(tail.slice(0, gradeMatch.index));
    skillGrade = gradeMatch[1];
    status = clean(tail.slice(gradeMatch.index + gradeMatch[1].length));
  } else {
    // No grade in the source row (e.g. EMP194-197): the trailing status word is the only
    // anchor left, so peel it off before treating what remains as the address.
    const trailingStatus = tail.match(/^(.*?)\s*(Active|Inactive|In-?active)$/i);
    if (trailingStatus) {
      address = clean(trailingStatus[1]);
      status = trailingStatus[2];
    } else {
      address = clean(tail);
    }
    warnings.push(`${employeeNo}: no skill grade found.`);
  }

  const statusMatch = status.match(/^(Active|Inactive|In-?active)/i);
  if (statusMatch) {
    status = statusMatch[1];
  } else if (status) {
    warnings.push(`${employeeNo}: unexpected status text "${status}".`);
  }

  const photoUrl = unescapeUrl(tail.match(THUMB)?.[0] ?? '');
  const driveLink = unescapeUrl(tail.match(FILE_LINK)?.[0] ?? '');

  return {
    row: {
      'Employee ID': employeeNo,
      'Safety Pass No': safetyPassNo,
      Name: fullName,
      'Blood Group': bloodGroup,
      Designation: designation,
      Contractor: CONTRACTOR,
      Mobile: mobile,
      Address: address,
      'JNTVTI Skill Grade': skillGrade,
      Status: status,
      'Photo Url': photoUrl,
      'Drive Photo Link': driveLink
    },
    warnings
  };
}

function csvCell(value) {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function main() {
  const [inputPath = '.data/raw-roster.txt', outputPath = 'employee-master.csv'] = process.argv.slice(2);
  const source = await readFile(inputPath, 'utf8');
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);

  const rows = [];
  const warnings = [];
  for (const line of lines) {
    const parsed = parseRow(line);
    if (!parsed) {
      if (!/^Remarks/.test(line)) warnings.push(`Ignored line: ${line.slice(0, 60)}`);
      continue;
    }
    rows.push(parsed.row);
    warnings.push(...parsed.warnings);
  }

  // ---- validation -----------------------------------------------------------
  const problems = [];
  const seenIds = new Set();
  for (const row of rows) {
    const id = row['Employee ID'];
    if (seenIds.has(id)) problems.push(`Duplicate Employee ID ${id}`);
    seenIds.add(id);

    if (!/^EMP\d{3}$/.test(id)) problems.push(`${id}: malformed Employee ID`);
    if (row.Name && !/^[A-Za-z][A-Za-z .'\d-]*$/.test(row.Name)) problems.push(`${id}: suspicious Name "${row.Name}"`);
    if (row['Safety Pass No'] && !/^[A-Z]{2}\d{8,}$/.test(row['Safety Pass No'])) {
      problems.push(`${id}: suspicious Safety Pass No "${row['Safety Pass No']}"`);
    }
    if (row.Mobile && !/^\d{10,12}$/.test(row.Mobile)) problems.push(`${id}: Mobile "${row.Mobile}" is not 10-12 digits`);
    if (row['Blood Group'] && !/^(AB|A|B|O)[+-]$/.test(row['Blood Group'])) {
      problems.push(`${id}: suspicious Blood Group "${row['Blood Group']}"`);
    }
    if (row['Photo Url']) {
      const fileId = row['Photo Url'].match(/id=([\w-]+)/)?.[1] ?? '';
      if (fileId.length < 28) problems.push(`${id}: photo id "${fileId}" looks truncated (${fileId.length} chars)`);
    }
    if (/https?:\/\//.test(row.Address)) problems.push(`${id}: a URL leaked into Address`);
    if (row.Status && !/^(Active|Inactive|In-?active)$/i.test(row.Status)) problems.push(`${id}: Status "${row.Status}"`);
  }

  const csv = [HEADERS.map(csvCell).join(','), ...rows.map((row) => HEADERS.map((h) => csvCell(row[h])).join(','))].join('\n');
  await writeFile(outputPath, `${csv}\n`, 'utf8');

  const withPhoto = rows.filter((row) => row['Photo Url']).length;
  const withMobile = rows.filter((row) => row.Mobile).length;
  const grades = {};
  for (const row of rows) grades[row['JNTVTI Skill Grade'] || '(blank)'] = (grades[row['JNTVTI Skill Grade'] || '(blank)'] ?? 0) + 1;
  const designations = new Set(rows.map((row) => row.Designation).filter(Boolean));

  console.log(`input   : ${inputPath}`);
  console.log(`output  : ${outputPath}`);
  console.log(`rows    : ${rows.length}  (with photo: ${withPhoto}, with mobile: ${withMobile})`);
  console.log(`grades  : ${JSON.stringify(grades)}`);
  console.log(`designations: ${designations.size}`);
  if (warnings.length) {
    console.log('\nwarnings:');
    for (const warning of warnings) console.log(`  · ${warning}`);
  }
  if (problems.length) {
    console.log('\nVALIDATION PROBLEMS:');
    for (const problem of problems) console.log(`  ! ${problem}`);
  } else {
    console.log('\nvalidation: clean');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
