import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  HOUSEKEEPING_ITEMS, MODULE_TITLES, PERMIT_CHECKS, displayReference, type DmPlan
} from './plan';

/**
 * The DM PDF.
 *
 * This is the artefact the company files: one controlled document per shift, named
 * DM-DD-MM-YY. It is generated on the server from the stored plan, so the PDF can always be
 * rebuilt from the record and never drifts from what was submitted.
 *
 * Layout is deliberate and plain — A4, one column, ruled module headings, tables with
 * wrapped cells. No charts, no logo: a safety document is read on a phone in the field and
 * printed for a file.
 */

export type DmPdfMeta = {
  reference: string;
  siteName: string;
  companyName?: string | null;
  generatedAt?: Date;
};

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const CONTENT = A4.width - MARGIN * 2;

const INK = rgb(0.07, 0.15, 0.27);
const MUTED = rgb(0.42, 0.48, 0.57);
const RULE = rgb(0.84, 0.88, 0.93);
const BAND = rgb(0.95, 0.97, 1);
const ACCENT = rgb(0.07, 0.39, 0.87);

/**
 * pdf-lib's standard fonts cover WinAnsi only: curly quotes and em dashes throw, and an
 * emoji would take the whole document down. Everything is folded to something printable.
 */
function sanitize(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2022/g, '-')
    .replace(/\u20b9/g, 'Rs.')
    .replace(/\u2192/g, '->')
    .replace(/[^\t\n\x20-\x7E\xA0-\xFF]/g, '');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of sanitize(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) { lines.push(''); continue; }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      // A single word longer than the column is broken, not drawn over the margin.
      if (font.widthOfTextAtSize(word, size) > width) {
        let chunk = '';
        for (const char of word) {
          if (font.widthOfTextAtSize(chunk + char, size) > width) { lines.push(chunk); chunk = char; }
          else chunk += char;
        }
        line = chunk;
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

type Ctx = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  meta: DmPdfMeta;
};

function newPage(ctx: Ctx): PDFPage {
  ctx.page = ctx.pdf.addPage([A4.width, A4.height]);
  ctx.y = A4.height - MARGIN;
  return ctx.page;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 28) newPage(ctx);
}

type PhotoImage = { image: PDFImage; width: number; height: number };

/** Turn a `data:image/jpeg;base64,…` string into image bytes, or nothing if it is not one. */
function dataUrlBytes(data: unknown): { bytes: Uint8Array; jpeg: boolean } | null {
  if (typeof data !== 'string') return null;
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.trim());
  if (!match) return null;
  try {
    const binary = Buffer.from(match[2], 'base64');
    if (binary.length < 64) return null;
    return { bytes: new Uint8Array(binary), jpeg: match[1] === 'jpeg' };
  } catch {
    return null;
  }
}

/** Embed every attached photo once; a photo that cannot be decoded is skipped, not fatal. */
async function embedPhotos(pdf: PDFDocument, plan: DmPlan): Promise<Map<string, PhotoImage>> {
  const embedded = new Map<string, PhotoImage>();
  const rows = [...plan.modules.ppe, ...plan.modules.walkthrough];
  for (const row of rows) {
    if (!row.photo || embedded.has(row.photo)) continue;
    const decoded = dataUrlBytes(row.photo);
    if (!decoded) continue;
    try {
      const image = decoded.jpeg ? await pdf.embedJpg(decoded.bytes) : await pdf.embedPng(decoded.bytes);
      embedded.set(row.photo, { image, width: image.width, height: image.height });
    } catch {
      // A corrupt frame must not cost the operator the whole document.
    }
  }
  return embedded;
}

/**
 * Attached evidence, three to a row, captioned so a printed copy still says what it shows.
 * Photos are shrunk to fit at most 74pt tall, which keeps a shift's evidence on one page.
 */
function photoGrid(ctx: Ctx, photos: { label: string; photo: PhotoImage }[]): void {
  if (photos.length === 0) return;
  const gap = 10;
  const cell = (CONTENT - gap * 2) / 3;
  textBlock(ctx, 'Photographs', { size: 7.5, bold: true, color: MUTED });
  for (let start = 0; start < photos.length; start += 3) {
    const row = photos.slice(start, start + 3);
    const heights = row.map(({ photo }) => Math.min(74, (cell / photo.width) * photo.height));
    const rowHeight = Math.max(...heights) + 14;
    ensure(ctx, rowHeight + 6);
    row.forEach(({ label, photo }, index) => {
      const height = heights[index];
      const x = MARGIN + index * (cell + gap);
      const y = ctx.y - height - 10;
      ctx.page.drawImage(photo.image, { x, y, width: Math.min(cell, (height / photo.height) * photo.width), height });
      ctx.page.drawText(sanitize(label).slice(0, 46), { x, y: ctx.y - 8, size: 6.5, font: ctx.regular, color: MUTED });
    });
    ctx.y -= rowHeight;
  }
  ctx.y -= 4;
}

function textBlock(
  ctx: Ctx,
  value: string,
  options: { size?: number; bold?: boolean; color?: typeof INK; indent?: number; gap?: number } = {}
): void {
  const size = options.size ?? 9;
  const font = options.bold ? ctx.bold : ctx.regular;
  const indent = options.indent ?? 0;
  for (const line of wrap(value, font, size, CONTENT - indent)) {
    ensure(ctx, size + 4);
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y - size, size, font, color: options.color ?? INK });
    ctx.y -= size + 3;
  }
  ctx.y -= options.gap ?? 0;
}

function moduleHeading(ctx: Ctx, index: number, title: string): void {
  ensure(ctx, 42);
  ctx.y -= 10;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: CONTENT, height: 18, color: BAND });
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 18, width: 3, height: 18, color: ACCENT });
  ctx.page.drawText(`${index}. ${sanitize(title)}`, {
    x: MARGIN + 9, y: ctx.y - 13, size: 10, font: ctx.bold, color: INK
  });
  ctx.y -= 26;
}

function keyValues(ctx: Ctx, pairs: [string, string][]): void {
  const filled = pairs.filter(([, value]) => value && value.trim());
  if (filled.length === 0) return;
  const column = CONTENT / 2 - 8;

  for (let index = 0; index < filled.length; index += 2) {
    // Both cells are measured before either is drawn: a value that wraps must not push the
    // right-hand cell up or down, or the two columns drift apart on the page.
    const row = filled.slice(index, index + 2).map(([label, value]) => {
      const labelText = sanitize(`${label}: `);
      const labelWidth = ctx.bold.widthOfTextAtSize(labelText, 7.5);
      return { labelText, labelWidth, lines: wrap(value, ctx.regular, 8.5, column - labelWidth) };
    });
    const height = Math.max(1, ...row.map((cell) => cell.lines.length)) * 10 + 6;
    ensure(ctx, height);

    row.forEach((cell, columnIndex) => {
      const x = MARGIN + columnIndex * (column + 16);
      ctx.page.drawText(cell.labelText, { x, y: ctx.y - 8, size: 7.5, font: ctx.bold, color: MUTED });
      cell.lines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, {
          x: x + cell.labelWidth, y: ctx.y - 8 - lineIndex * 10, size: 8.5, font: ctx.regular, color: INK
        });
      });
    });
    ctx.y -= height;
  }
}

function table(
  ctx: Ctx,
  headers: string[],
  rows: string[][],
  widths: number[],
  options: { size?: number } = {}
): void {
  const size = options.size ?? 7.5;
  const total = widths.reduce((sum, width) => sum + width, 0);
  const columns = widths.map((width) => (width / total) * CONTENT);
  const padding = 4;

  const drawHeader = () => {
    ensure(ctx, 18);
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 15, width: CONTENT, height: 15, color: BAND });
    let x = MARGIN;
    headers.forEach((header, index) => {
      ctx.page.drawText(sanitize(header), { x: x + padding, y: ctx.y - 10.5, size: 7, font: ctx.bold, color: MUTED });
      x += columns[index];
    });
    ctx.y -= 15;
  };

  drawHeader();
  for (const row of rows) {
    const cells = row.map((cell, index) => wrap(cell ?? '', ctx.regular, size, columns[index] - padding * 2));
    const lineCount = Math.max(1, ...cells.map((cell) => cell.length));
    const height = lineCount * (size + 2.4) + 4;
    if (ctx.y - height < MARGIN + 28) { newPage(ctx); drawHeader(); }
    let x = MARGIN;
    cells.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        ctx.page.drawText(line, {
          x: x + padding, y: ctx.y - 10 - lineIndex * (size + 2.4), size, font: ctx.regular, color: INK
        });
      });
      x += columns[index];
    });
    ctx.y -= height;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + CONTENT, y: ctx.y }, thickness: 0.5, color: RULE
    });
  }
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

function renderModules(ctx: Ctx, plan: DmPlan, photos: Map<string, PhotoImage>): void {
  const m = plan.modules;

  // 1 — permits
  moduleHeading(ctx, 1, MODULE_TITLES[0]);
  keyValues(ctx, [['Permit no.', m.permits.permitNo], ['Taken by', m.permits.takenBy], ['Reviewed by', m.permits.reviewedBy]]);
  table(ctx, ['#', 'Verification point', 'Yes', 'Remarks'], PERMIT_CHECKS.map((check, index) => [
    String(index + 1), check, m.permits.checks[index] ? 'Y' : '', ''
  ]), [6, 62, 10, 40]);
  keyValues(ctx, [['Observations', m.permits.observations], ['Immediate action', m.permits.actions]]);

  // 2 — TBT
  moduleHeading(ctx, 2, MODULE_TITLES[1]);
  keyValues(ctx, [
    ['Attendees', m.tbt.attendees], ['Conducted by', m.tbt.conductedBy],
    ['Topics discussed', m.tbt.topics], ['Previous day incidents', m.tbt.previousIncidents],
    ["Today's critical tasks", m.tbt.criticalTasks], ['Procedures for new tasks', m.tbt.procedures],
    ['Safety theme', m.tbt.theme], ['PPE reminders', m.tbt.ppe],
    ['Worker concerns', m.tbt.concerns], ['Key takeaways', m.tbt.takeaways]
  ]);

  // 3 — PPE
  moduleHeading(ctx, 3, MODULE_TITLES[2]);
  const ppe = m.ppe.filter((row) => row.employee || row.remarks || row.items?.length || row.photo);
  if (ppe.length) {
    table(ctx, ['Observed', 'Observation', 'PPE observed', 'Remarks'], ppe.map((row) => [
      // A team-wide observation says so, instead of leaving the name columns blank.
      row.scope === 'all'
        ? 'All employees'
        : [row.employee, row.employeeNo].filter(Boolean).join(' · '),
      row.issue, (row.items ?? []).join(', '), row.remarks
    ]), [26, 18, 26, 30]);
    photoGrid(ctx, ppe.filter((row) => row.photo && photos.has(row.photo))
      .map((row, index) => ({ label: `PPE ${index + 1} — ${row.employee || (row.items ?? []).join(', ') || 'observation'}`, photo: photos.get(row.photo)! })));
  } else textBlock(ctx, 'No PPE observations recorded.', { size: 8, color: MUTED });

  // 4 — walk-through
  moduleHeading(ctx, 4, MODULE_TITLES[3]);
  const walk = m.walkthrough.filter((row) => row.area || row.details || row.photo);
  if (walk.length) {
    table(ctx, ['Area', 'Observation type', 'Severity', 'Details', 'Immediate action'], walk.map((row) => [
      row.area, row.type, row.severity ? `${row.severity} / 5` : '—', row.details, row.action
    ]), [16, 16, 9, 33, 26]);
    photoGrid(ctx, walk.filter((row) => row.photo && photos.has(row.photo))
      .map((row, index) => ({ label: `Photo ${index + 1} — ${row.area || row.type}`, photo: photos.get(row.photo)! })));
  } else textBlock(ctx, 'No walk-through observations recorded.', { size: 8, color: MUTED });

  // 5 — equipment
  moduleHeading(ctx, 5, MODULE_TITLES[4]);
  const equipment = m.equipment.filter((row) => row.name || row.devices || row.remarks);
  if (equipment.length) {
    table(ctx, ['Equipment', 'Check', 'Devices checked', 'Status', 'Remarks'], equipment.map((row) => [
      row.name, row.check, row.devices, row.status, row.remarks
    ]), [24, 20, 24, 12, 20]);
  } else textBlock(ctx, 'No equipment checks recorded.', { size: 8, color: MUTED });

  // 6 — tools
  moduleHeading(ctx, 6, MODULE_TITLES[5]);
  const tools = m.tools.filter((row) => row.name || row.toolId || row.remarks);
  if (tools.length) {
    table(ctx, ['Tool', 'ID', 'Safe / Unsafe', 'Condition', 'Action', 'Responsible'], tools.map((row) => [
      row.name, row.toolId, row.safe, row.condition, row.action || row.remarks, row.responsible
    ]), [20, 12, 14, 12, 24, 18]);
  } else textBlock(ctx, 'No tools & tackles checks recorded.', { size: 8, color: MUTED });

  // 7 — housekeeping
  moduleHeading(ctx, 7, MODULE_TITLES[6]);
  const housekeepingRows = HOUSEKEEPING_ITEMS.map((item, index) => {
    const value = m.housekeeping.checks[item.id] ?? '';
    return [
      String(index + 1),
      item.text,
      value === 'yes' ? 'Y' : value === 'no' ? 'N' : value === 'na' ? 'N/A' : ''
    ];
  });
  const answered = housekeepingRows.some((row) => row[2]);
  if (answered) {
    table(ctx, ['#', 'Checking criteria', 'Y / N / N/A'], housekeepingRows, [6, 76, 18], { size: 7 });
    keyValues(ctx, [['Observations', m.housekeeping.observations], ['Action taken', m.housekeeping.action]]);
  } else {
    textBlock(ctx, 'Housekeeping checklist not filled for this shift.', { size: 8, color: MUTED });
  }

  // 8 — safety interaction
  moduleHeading(ctx, 8, MODULE_TITLES[7]);
  const team = m.interaction.team.filter((row) => row.name);
  if (team.length) {
    table(ctx, ['Employee', 'Emp. no.', 'Designation'], team.map((row) => [row.name, row.number, row.designation]), [34, 16, 30]);
  }
  if (m.interaction.topics.length) textBlock(ctx, `Key discussions: ${m.interaction.topics.join('; ')}`, { size: 8 });
  keyValues(ctx, [
    ['Employee feedback', m.interaction.feedback],
    ['Escalated', yesNo(m.interaction.escalated)],
    ['Follow-up required', yesNo(m.interaction.followUp)],
    ['Target date', m.interaction.targetDate]
  ]);

  // 9 — incident
  moduleHeading(ctx, 9, MODULE_TITLES[8]);
  keyValues(ctx, [
    ['Location', m.incident.location], ['Reported by', m.incident.reportedBy],
    ['Report no.', m.incident.reportNo], ['Date / time', [m.incident.date, m.incident.time].filter(Boolean).join(' ')],
    ['Categories', m.incident.categories.join(', ')],
    ['Investigation initiated', yesNo(m.incident.investigation)]
  ]);
  const persons = m.incident.persons.filter((row) => row.name);
  if (persons.length) {
    table(ctx, ['Person', 'SP / Emp no.', 'Designation'], persons.map((row) => [row.name, row.number, row.designation]), [34, 18, 30]);
  }
  keyValues(ctx, [['Description', m.incident.description], ['Immediate action', m.incident.action]]);

  // 10 — training
  moduleHeading(ctx, 10, MODULE_TITLES[9]);
  keyValues(ctx, [
    ['Employee', [m.training.employee, m.training.employeeNo && `(${m.training.employeeNo})`].filter(Boolean).join(' ')],
    ['Observation', m.training.observation],
    ['Action taken', m.training.action], ['Training need', m.training.needType],
    ['Need identified', yesNo(m.training.required)],
    ['Conducted as per plan', yesNo(m.training.conducted)],
    ['Records available', yesNo(m.training.records)]
  ]);

  // 11 — admin
  moduleHeading(ctx, 11, MODULE_TITLES[10]);
  const admin = m.admin.filter((row) => row.sopNo || row.remarks);
  if (admin.length) {
    table(ctx, ['SOP / JHA', 'Compliance', 'Adequacy', 'Action by', 'Remarks'], admin.map((row) => [
      row.sopNo, row.compliance, row.adequacy, row.actionBy, row.remarks
    ]), [18, 18, 14, 18, 32]);
  } else textBlock(ctx, 'No administrative observations recorded.', { size: 8, color: MUTED });
}

/** Render the plan to PDF bytes. Deterministic for a given plan and metadata. */
export async function renderDmPdf(plan: DmPlan, meta: DmPdfMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`${displayReference(meta.reference)} — Daily Management Plan`);
  pdf.setAuthor('Safex');
  pdf.setSubject(`Daily Management Plan · ${meta.siteName}`);

  const ctx: Ctx = { pdf, page: pdf.addPage([A4.width, A4.height]), y: A4.height - MARGIN, regular, bold, meta };

  // Letterhead
  ctx.page.drawText(sanitize((meta.companyName || 'EMVEESS INFRAVENTURES PVT. LTD.').toUpperCase()), {
    x: MARGIN, y: ctx.y - 9, size: 9, font: bold, color: MUTED
  });
  ctx.y -= 30;
  ctx.page.drawText('DAILY MANAGEMENT PLAN', { x: MARGIN, y: ctx.y, size: 20, font: bold, color: INK });
  const refWidth = bold.widthOfTextAtSize(sanitize(meta.reference), 12) + 18;
  ctx.page.drawRectangle({
    x: A4.width - MARGIN - refWidth, y: ctx.y - 4, width: refWidth, height: 24,
    color: rgb(0.93, 0.96, 1), borderColor: ACCENT, borderWidth: 0.8
  });
  ctx.page.drawText(sanitize(meta.reference), {
    x: A4.width - MARGIN - refWidth + 9, y: ctx.y + 3, size: 12, font: bold, color: ACCENT
  });
  ctx.y -= 18;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4.width - MARGIN, y: ctx.y }, thickness: 1.2, color: ACCENT });
  ctx.y -= 22;

  keyValues(ctx, [
    ['Site', meta.siteName], ['Date', plan.date],
    ['Shift', plan.shift], ['Supervisor', [plan.supervisor, plan.supervisorNo].filter(Boolean).join(' · ')],
    ['Work location', plan.location]
  ]);
  ctx.y -= 2;

  renderModules(ctx, plan, await embedPhotos(pdf, plan));

  // Signature block + footer
  ensure(ctx, 70);
  ctx.y -= 26;
  ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: A4.width - MARGIN, y: ctx.y }, thickness: 0.6, color: RULE });
  ctx.y -= 14;
  textBlock(ctx, 'Declaration: I hereby declare that the information recorded above is correct to the best of my knowledge.', { size: 8, color: MUTED });
  textBlock(ctx, `Signed: ${plan.supervisor || '—'}`, { size: 9, bold: true });

  const pages = pdf.getPages();
  const generated = meta.generatedAt ?? new Date();
  pages.forEach((page, index) => {
    page.drawText(sanitize(`${meta.reference} · Safex · generated ${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC`), {
      x: MARGIN, y: 24, size: 7, font: regular, color: MUTED
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    page.drawText(label, {
      x: A4.width - MARGIN - regular.widthOfTextAtSize(label, 7), y: 24, size: 7, font: regular, color: MUTED
    });
  });

  return pdf.save();
}
