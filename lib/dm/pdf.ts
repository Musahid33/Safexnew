import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  DECLARATION_TEXT, HOUSEKEEPING_ITEMS, MODULE_TITLES, PPE_ITEMS, displayReference,
  planPhotos, type DmPlan
} from './plan';

/**
 * The DM PDF — a landscape, table-per-module report.
 *
 * It mirrors the printed DMP the sites already file: a letterhead box with the document
 * number, one strip with date / location / supervisor, then each module as a ruled table
 * with a date and location on every row, so a single printed line still says which shift
 * and which site it belongs to. PPE is a tick matrix — one row per observation, one column
 * per PPE item — because that is how the existing form reads at a glance.
 *
 * Everything is generated from the stored plan, so the PDF can always be rebuilt from the
 * record and never drifts from what was submitted.
 */

export type DmPdfMeta = {
  reference: string;
  siteName: string;
  companyName?: string | null;
  generatedAt?: Date;
};

const PAGE = { width: 841.89, height: 595.28 };
const MARGIN = 26;
const CONTENT = PAGE.width - MARGIN * 2;

const INK = rgb(0.07, 0.15, 0.27);
const MUTED = rgb(0.42, 0.48, 0.57);
const RULE = rgb(0.78, 0.83, 0.9);
const BAND = rgb(0.93, 0.95, 0.98);
const ACCENT = rgb(0.07, 0.39, 0.87);
const ALERT = rgb(0.72, 0.16, 0.16);

/**
 * Tick marks are drawn as lines, not typed: the standard fonts are WinAnsi, which has no
 * check mark, and a glyph that throws would take the whole document down. Sentinels are
 * recognised before `sanitize` ever sees the cell.
 */
const YES = '\u2713';
const NO = '\u2717';
const NA = 'N/A';

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
  ctx.page = ctx.pdf.addPage([PAGE.width, PAGE.height]);
  ctx.y = PAGE.height - MARGIN;
  return ctx.page;
}

function ensure(ctx: Ctx, needed: number): void {
  if (ctx.y - needed < MARGIN + 18) newPage(ctx);
}

/* ------------------------------------------------------------------ *
 * Letterhead and header strip
 * ------------------------------------------------------------------ */

function drawLetterhead(ctx: Ctx, plan: DmPlan): void {
  const leftWidth = CONTENT * 0.66;
  const rightWidth = CONTENT - leftWidth;
  const height = 42;
  const top = ctx.y;

  ctx.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT, height, borderColor: INK, borderWidth: 0.7 });
  ctx.page.drawLine({
    start: { x: MARGIN + leftWidth, y: top }, end: { x: MARGIN + leftWidth, y: top - height },
    thickness: 0.7, color: INK
  });

  ctx.page.drawText('DAILY MANAGEMENT PLAN', { x: MARGIN + 9, y: top - 17, size: 13, font: ctx.bold, color: INK });
  ctx.page.drawText(sanitize((ctx.meta.companyName || 'EMVEESS INFRAVENTURES PVT. LTD.').toUpperCase()), {
    x: MARGIN + 9, y: top - 30, size: 7.4, font: ctx.bold, color: MUTED
  });

  const site = sanitize((ctx.meta.siteName || 'Site').toUpperCase());
  ctx.page.drawText(site, {
    x: MARGIN + leftWidth + rightWidth - 9 - ctx.bold.widthOfTextAtSize(site, 9),
    y: top - 17, size: 9, font: ctx.bold, color: INK
  });
  const docNo = sanitize(`Doc No: ${ctx.meta.reference}`);
  ctx.page.drawText(docNo, {
    x: MARGIN + leftWidth + rightWidth - 9 - ctx.regular.widthOfTextAtSize(docNo, 7.4),
    y: top - 30, size: 7.4, font: ctx.regular, color: MUTED
  });

  ctx.y = top - height;
}

/** One ruled strip: Execution Date | Site Location | Safety Supervisor | Shift. */
function drawMetaStrip(ctx: Ctx, plan: DmPlan): void {
  const cells: [string, string][] = [
    ['Execution Date', plan.date],
    ['Site Location', plan.location || ctx.meta.siteName || '—'],
    ['Safety Supervisor', [plan.supervisor || '—', plan.supervisorNo && `(${plan.supervisorNo})`]
      .filter(Boolean).join(' ')],
    ['Shift', plan.shift]
  ];
  const height = 18;
  const width = CONTENT / cells.length;
  const top = ctx.y;

  ctx.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT, height, borderColor: RULE, borderWidth: 0.6 });
  cells.forEach(([label, value], index) => {
    const x = MARGIN + index * width;
    if (index > 0) {
      ctx.page.drawLine({ start: { x, y: top }, end: { x, y: top - height }, thickness: 0.5, color: RULE });
    }
    const labelText = sanitize(`${label}: `);
    const labelWidth = ctx.bold.widthOfTextAtSize(labelText, 6.8);
    ctx.page.drawText(labelText, { x: x + 6, y: top - 12, size: 6.8, font: ctx.bold, color: MUTED });
    ctx.page.drawText(sanitize(value).slice(0, 60), {
      x: x + 6 + labelWidth, y: top - 12, size: 7, font: ctx.regular, color: INK
    });
  });

  ctx.y = top - height - 10;
}

/* ------------------------------------------------------------------ *
 * Section band and the table engine
 * ------------------------------------------------------------------ */

type Column = { label: string; weight: number; align?: 'left' | 'center' };

function band(ctx: Ctx, title: string): void {
  ensure(ctx, 40);
  ctx.y -= 4;
  ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - 14, width: CONTENT, height: 14, color: BAND });
  ctx.page.drawText(sanitize(title.toUpperCase()), {
    x: MARGIN + 5, y: ctx.y - 10, size: 7.2, font: ctx.bold, color: INK
  });
  ctx.y -= 18;
}

function section(ctx: Ctx, index: number, title: string): void {
  // Room for the band, its header row and one line of the first row: a heading stranded
  // at the foot of a page reads as an empty module.
  ensure(ctx, 84);
  band(ctx, `${index}. ${title}`);
}

/** A small label inside a section — same keep-with-next rule as a section band. */
function subHeading(ctx: Ctx, title: string): void {
  ensure(ctx, 64);
  textBlock(ctx, title, { size: 6, bold: true, color: MUTED });
}

const isMark = (value: string): boolean => value === YES || value === NO;

function drawMark(ctx: Ctx, mark: string, x: number, top: number, width: number, height: number): void {
  const cx = x + width / 2;
  const cy = top - height / 2;
  if (mark === YES) {
    ctx.page.drawLine({ start: { x: cx - 4, y: cy + 0.4 }, end: { x: cx - 1, y: cy - 3 }, thickness: 1.1, color: ACCENT });
    ctx.page.drawLine({ start: { x: cx - 1, y: cy - 3 }, end: { x: cx + 4.4, y: cy + 3.6 }, thickness: 1.1, color: ACCENT });
  } else {
    ctx.page.drawLine({ start: { x: cx - 3, y: cy + 3 }, end: { x: cx + 3, y: cy - 3 }, thickness: 1, color: ALERT });
    ctx.page.drawLine({ start: { x: cx - 3, y: cy - 3 }, end: { x: cx + 3, y: cy + 3 }, thickness: 1, color: ALERT });
  }
}

/**
 * A ruled table whose columns are proportional weights, so the same renderer draws a
 * four-column inspection and a nineteen-column housekeeping matrix without hand-tuned
 * widths. Headers wrap, rows wrap, and a row that does not fit starts a new page with the
 * header repeated.
 */
function grid(
  ctx: Ctx,
  columns: Column[],
  rows: string[][],
  options: { size?: number; headSize?: number } = {}
): void {
  if (rows.length === 0) return;
  const size = options.size ?? 6.5;
  const headSize = options.headSize ?? 6;
  const total = columns.reduce((sum, column) => sum + column.weight, 0);
  const widths = columns.map((column) => (column.weight / total) * CONTENT);
  const pad = 2.6;
  const lineHeight = size + 1.7;
  const headLine = headSize + 1.6;

  // A header like SIGNATURES or ATTENDEES does not fit a narrow column at the shared
  // size, and chunking it mid-word ("SIGNATURE / S") reads like a typo. Shrink just that
  // header until its longest word fits, and keep the rest at the common size.
  const headSizes = columns.map((column, index) => {
    const available = widths[index] - pad * 2;
    const longest = () => Math.max(...column.label.toUpperCase().split(/\s+/)
      .map((word) => ctx.bold.widthOfTextAtSize(word, headSize)));
    if (longest() <= available) return headSize;
    return Math.max(4.2, Math.floor((headSize * available) / longest() * 10) / 10);
  });
  const headerLines = columns.map((column, index) =>
    wrap(column.label.toUpperCase(), ctx.bold, headSizes[index], widths[index] - pad * 2));
  const headerHeights = headerLines.map((lines, index) => lines.length * (headSizes[index] + 1.6) + pad * 2);
  const headHeight = Math.max(...headerHeights);

  const drawHeader = () => {
    ctx.page.drawRectangle({ x: MARGIN, y: ctx.y - headHeight, width: CONTENT, height: headHeight, color: BAND });
    let x = MARGIN;
    headerLines.forEach((lines, index) => {
      const columnSize = headSizes[index];
      lines.forEach((line, lineIndex) => {
        const lineWidth = ctx.bold.widthOfTextAtSize(line, columnSize);
        ctx.page.drawText(line, {
          x: columns[index].align === 'center' ? x + Math.max(pad / 2, (widths[index] - lineWidth) / 2) : x + pad,
          y: ctx.y - pad - columnSize + 0.6 - lineIndex * (columnSize + 1.6),
          size: columnSize, font: ctx.bold, color: MUTED
        });
      });
      x += widths[index];
    });
    let bx = MARGIN;
    columns.forEach((_, index) => {
      ctx.page.drawLine({ start: { x: bx, y: ctx.y }, end: { x: bx, y: ctx.y - headHeight }, thickness: 0.4, color: RULE });
      bx += widths[index];
    });
    ctx.page.drawLine({ start: { x: bx, y: ctx.y }, end: { x: bx, y: ctx.y - headHeight }, thickness: 0.4, color: RULE });
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + CONTENT, y: ctx.y }, thickness: 0.6, color: RULE });
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - headHeight }, end: { x: MARGIN + CONTENT, y: ctx.y - headHeight }, thickness: 0.4, color: RULE });
    ctx.y -= headHeight;
  };

  ensure(ctx, headHeight + 22);
  drawHeader();

  for (const row of rows) {
    const cells = row.map((cell, index) => (isMark(cell) || cell === NA
      ? [cell]
      : wrap(cell ?? '', ctx.regular, size, widths[index] - pad * 2)));
    const lineCount = Math.max(1, ...cells.map((cell) => cell.length));
    const height = lineCount * lineHeight + pad * 2;

    if (ctx.y - height < MARGIN + 18) {
      newPage(ctx);
      drawHeader();
    }

    let x = MARGIN;
    cells.forEach((cell, index) => {
      const raw = cell[0] ?? '';
      if (isMark(raw)) {
        drawMark(ctx, raw, x, ctx.y, widths[index], height);
      } else if (raw === NA) {
        const text = 'N/A';
        ctx.page.drawText(text, {
          x: x + (widths[index] - ctx.regular.widthOfTextAtSize(text, 5.4)) / 2,
          y: ctx.y - height / 2 - 2, size: 5.4, font: ctx.regular, color: MUTED
        });
      } else {
        cell.forEach((line, lineIndex) => {
          const lineWidth = ctx.regular.widthOfTextAtSize(line, size);
          const centred = columns[index].align === 'center' && cell.length === 1;
          ctx.page.drawText(line, {
            x: centred ? x + Math.max(pad / 2, (widths[index] - lineWidth) / 2) : x + pad,
            y: ctx.y - pad - size + 0.8 - lineIndex * lineHeight,
            size, font: ctx.regular, color: INK
          });
        });
      }
      ctx.page.drawLine({
        start: { x, y: ctx.y }, end: { x, y: ctx.y - height }, thickness: 0.4, color: RULE
      });
      x += widths[index];
    });
    ctx.page.drawLine({ start: { x, y: ctx.y }, end: { x, y: ctx.y - height }, thickness: 0.4, color: RULE });
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y - height }, end: { x: MARGIN + CONTENT, y: ctx.y - height },
      thickness: 0.4, color: RULE
    });
    ctx.y -= height;
  }
}

function textBlock(
  ctx: Ctx,
  value: string,
  options: { size?: number; bold?: boolean; color?: typeof INK; indent?: number } = {}
): void {
  const size = options.size ?? 7;
  const font = options.bold ? ctx.bold : ctx.regular;
  const indent = options.indent ?? 0;
  for (const line of wrap(value, font, size, CONTENT - indent)) {
    ensure(ctx, size + 4);
    ctx.page.drawText(line, { x: MARGIN + indent, y: ctx.y - size, size, font, color: options.color ?? INK });
    ctx.y -= size + 3;
  }
}

/* ------------------------------------------------------------------ *
 * Photos and signature
 * ------------------------------------------------------------------ */

type PhotoImage = { image: PDFImage; width: number; height: number };

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

async function embedPhotos(pdf: PDFDocument, plan: DmPlan): Promise<Map<string, PhotoImage>> {
  const embedded = new Map<string, PhotoImage>();
  for (const data of planPhotos(plan)) {
    if (embedded.has(data)) continue;
    const decoded = dataUrlBytes(data);
    if (!decoded) continue;
    try {
      const image = decoded.jpeg ? await pdf.embedJpg(decoded.bytes) : await pdf.embedPng(decoded.bytes);
      embedded.set(data, { image, width: image.width, height: image.height });
    } catch {
      // A corrupt frame must not cost the operator the whole document.
    }
  }
  return embedded;
}

async function embedSignature(pdf: PDFDocument, data: unknown): Promise<PhotoImage | null> {
  const decoded = dataUrlBytes(data);
  if (!decoded || decoded.jpeg) return null;
  try {
    const image = await pdf.embedPng(decoded.bytes);
    return { image, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

/** Every attached photo, in module order, captioned with what it shows. */
function photoEntries(plan: DmPlan, photos: Map<string, PhotoImage>): { label: string; photo: PhotoImage }[] {
  const m = plan.modules;
  const entries: { label: string; photo: PhotoImage }[] = [];
  const push = (data: string, label: string) => {
    const photo = data ? photos.get(data) : undefined;
    if (photo) entries.push({ label, photo });
  };

  m.ppe.forEach((row, index) => push(row.photo,
    `PPE ${index + 1} — ${row.scope === 'all' ? 'All employees' : row.employee || row.employeeNo || 'observation'}`));
  m.walkthrough.forEach((row, index) => push(row.photo, `Site inspection ${index + 1} — ${row.area || row.type}`));
  m.equipment.forEach((row, index) => push(row.photo, `Equipment ${index + 1} — ${row.name || row.status || 'check'}`));
  m.tools.forEach((row, index) => push(row.photo, `Tool ${index + 1} — ${row.name || row.toolId || 'condition'}`));
  push(m.housekeeping.photo, `Housekeeping — ${m.housekeeping.observations || 'shift condition'}`);
  push(m.interaction.photo, `Safety interaction — ${m.interaction.feedback || 'session'}`);
  push(m.incident.photo, `Incident / near miss — ${m.incident.location || m.incident.categories.join(', ') || 'spot'}`);
  push(m.training.photo, `Training — ${m.training.employee || m.training.needType || 'session'}`);
  return entries;
}

function photoGrid(ctx: Ctx, photos: { label: string; photo: PhotoImage }[]): void {
  if (photos.length === 0) return;
  const gap = 10;
  const cell = (CONTENT - gap * 2) / 3;
  for (let start = 0; start < photos.length; start += 3) {
    const row = photos.slice(start, start + 3);
    const heights = row.map(({ photo }) => Math.min(96, (cell / photo.width) * photo.height));
    const rowHeight = Math.max(...heights) + 18;
    ensure(ctx, rowHeight + 6);
    row.forEach(({ label, photo }, index) => {
      const height = heights[index];
      const x = MARGIN + index * (cell + gap);
      const y = ctx.y - height - 6;
      ctx.page.drawImage(photo.image, { x, y, width: Math.min(cell, (height / photo.height) * photo.width), height });
      ctx.page.drawText(sanitize(label).slice(0, 56), { x, y: y - 7, size: 6.2, font: ctx.regular, color: MUTED });
    });
    ctx.y -= rowHeight;
  }
  ctx.y -= 4;
}

const SIGNATURE_WIDTH = 190;
const SIGNATURE_HEIGHT = 52;

/**
 * The attestation block at the foot of the report: the declaration, the hand-drawn
 * signature, and the name and time it was signed. A plan filed before the pad existed
 * prints the block marked "not on record" — the document never claims a signature it does
 * not have.
 */
function drawSignOff(ctx: Ctx, plan: DmPlan, signature: PhotoImage | null): void {
  const signOff = plan.signOff ?? { declared: false, signature: '', signedAt: '' };
  ensure(ctx, 158);
  ctx.y -= 12;
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y }, end: { x: MARGIN + CONTENT, y: ctx.y }, thickness: 0.6, color: RULE
  });
  ctx.y -= 12;

  ctx.page.drawText('DECLARATION', { x: MARGIN, y: ctx.y - 6, size: 6.6, font: ctx.bold, color: MUTED });
  ctx.y -= 12;
  textBlock(ctx, DECLARATION_TEXT, { size: 7.2, color: MUTED });
  ctx.y -= 4;

  const top = ctx.y;
  if (signature) {
    const scale = Math.min(SIGNATURE_WIDTH / signature.width, SIGNATURE_HEIGHT / signature.height);
    ctx.page.drawImage(signature.image, {
      x: MARGIN,
      y: top - signature.height * scale,
      width: signature.width * scale,
      height: signature.height * scale
    });
  }
  ctx.page.drawLine({
    start: { x: MARGIN, y: top - SIGNATURE_HEIGHT - 4 },
    end: { x: MARGIN + SIGNATURE_WIDTH, y: top - SIGNATURE_HEIGHT - 4 },
    thickness: 0.7, color: INK
  });
  ctx.page.drawText(sanitize(signature ? 'Signature of supervisor' : 'Signature (not on record)'), {
    x: MARGIN, y: top - SIGNATURE_HEIGHT - 14, size: 6.4, font: ctx.regular, color: MUTED
  });

  const columnX = MARGIN + 240;
  const rows: [string, string][] = [
    ['Name', plan.supervisor || '—'],
    ['Employee no.', plan.supervisorNo || '—'],
    ['Signed on', signOff.signedAt
      ? `${signOff.signedAt.slice(0, 16).replace('T', ' ')} UTC`
      : 'Not on record'],
    ['Declaration', signOff.declared ? 'Accepted' : 'Not accepted']
  ];
  rows.forEach(([label, value], index) => {
    const y = top - 10 - index * 13;
    ctx.page.drawText(sanitize(`${label}:`), { x: columnX, y, size: 6.8, font: ctx.bold, color: MUTED });
    ctx.page.drawText(sanitize(value), { x: columnX + 70, y, size: 7.2, font: ctx.regular, color: INK });
  });

  const signColumnX = MARGIN + 500;
  ctx.page.drawText('Date:', { x: signColumnX, y: top - 10, size: 6.8, font: ctx.bold, color: MUTED });
  ctx.page.drawText(sanitize(dmy(plan.date)), { x: signColumnX + 40, y: top - 10, size: 7.2, font: ctx.regular, color: INK });

  ctx.y = top - SIGNATURE_HEIGHT - 26;
}

/* ------------------------------------------------------------------ *
 * The eleven modules, one table each
 * ------------------------------------------------------------------ */

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** 2026-10-21 -> 21-10-26: the reference's own date form, and it fits a narrow column. */
function dmy(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? '').trim());
  return match ? `${match[3]}-${match[2]}-${match[1].slice(2)}` : value ?? '';
}
const mark = (value: boolean) => (value ? YES : NO);
const tick = (value: string) => (value === 'yes' ? YES : value === 'no' ? NO : value === 'na' ? NA : '');

/** Column widths that dress like the filed form, minus the fields this app does not record. */
function renderSections(ctx: Ctx, plan: DmPlan, meta: DmPdfMeta): number[] {
  const m = plan.modules;
  const date = dmy(plan.date);
  const where = plan.location || meta.siteName;
  const empty: number[] = [];

  // 1 — permits: the five checks become five Y/N columns, as on the printed form.
  const permits = m.permits;
  const permitAny = Boolean(permits.permitNo || permits.takenBy || permits.reviewedBy
    || permits.checks.some(Boolean) || permits.observations || permits.actions);
  if (permitAny) {
    section(ctx, 1, MODULE_TITLES[0]);
    grid(ctx, [
      { label: 'Date', weight: 4.6 }, { label: 'Location', weight: 7 },
      { label: 'Permit No', weight: 7.5 }, { label: 'Taken By', weight: 8.5 }, { label: 'Review By', weight: 8.5 },
      { label: 'Scope', weight: 3.9, align: 'center' }, { label: 'Hazards', weight: 3.9, align: 'center' },
      { label: 'Control', weight: 3.9, align: 'center' }, { label: 'Aware', weight: 3.9, align: 'center' },
      { label: 'Signatures', weight: 4.6, align: 'center' },
      { label: 'Observations', weight: 15 }, { label: 'Actions', weight: 15 }
    ], [[
      date, where, permits.permitNo, permits.takenBy, permits.reviewedBy,
      ...permits.checks.slice(0, 5).map((check) => mark(check)),
      permits.observations, permits.actions
    ]]);
  } else empty.push(1);

  // 2 — tool box talk: one row, one column per topic the form asks about.
  const tbt = m.tbt;
  const tbtAny = Object.values(tbt).some((value) => Boolean(value && value.trim()));
  if (tbtAny) {
    section(ctx, 2, MODULE_TITLES[1]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 9 },
      { label: 'Attendees', weight: 4.4 }, { label: 'Topics', weight: 13 },
      { label: 'Prev Incidents', weight: 10 }, { label: 'Critical Tasks', weight: 10 },
      { label: 'Procedures', weight: 10 }, { label: 'Theme', weight: 8 },
      { label: 'PPE Reminders', weight: 8 }, { label: 'Forum', weight: 8 },
      { label: 'Takeaways', weight: 9 }, { label: 'Conducted By', weight: 8 }
    ], [[
      date, where, tbt.attendees, tbt.topics, tbt.previousIncidents, tbt.criticalTasks,
      tbt.procedures, tbt.theme, tbt.ppe, tbt.concerns, tbt.takeaways, tbt.conductedBy
    ]]);
  } else empty.push(2);

  // 3 — PPE checking: the matrix. One row per observation, one column per PPE item.
  const ppe = m.ppe.filter((row) => row.employee || row.employeeNo || row.items?.length || row.remarks || row.photo
    || row.issue);
  if (ppe.length) {
    section(ctx, 3, MODULE_TITLES[2]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Observed', weight: 8 }, { label: 'Emp No', weight: 5.6 },
      ...PPE_ITEMS.map((item) => ({ label: ppeLabel(item), weight: 3.3, align: 'center' as const })),
      { label: 'Remarks', weight: 12 }
    ], ppe.map((row) => {
      // "Missing / not wearing / damaged" turns an observed item into a cross, so the
      // matrix reads like the paper form: tick = in use, cross = the defect itself.
      const defective = /missing|not wearing|not used|damaged|dirty/i.test(row.issue);
      const marks = PPE_ITEMS.map((item) => {
        if (!(row.items ?? []).includes(item)) return NA;
        return defective ? NO : YES;
      });
      return [
        date, where,
        row.scope === 'all' ? 'All employees' : (row.employee || row.employeeNo || '—'),
        row.scope === 'all' ? '—' : row.employeeNo || '—',
        ...marks,
        [row.issue, row.remarks].filter(Boolean).join(' — ')
      ];
    }), { size: 6, headSize: 5.6 });
  } else empty.push(3);

  // 4 — site walk-through / inspection.
  const walk = m.walkthrough.filter((row) => row.area || row.details || row.action || row.photo);
  if (walk.length) {
    section(ctx, 4, MODULE_TITLES[3]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Inspection Location', weight: 10 }, { label: 'Type', weight: 8 },
      { label: 'Severity', weight: 5, align: 'center' }, { label: 'Description', weight: 24 },
      { label: 'Photo', weight: 4, align: 'center' }, { label: 'Immediate Action', weight: 22 }
    ], walk.map((row) => [
      date, where, row.area, row.type, row.severity ? `${row.severity} / 5` : '—',
      row.details, row.photo ? YES : NO, row.action
    ]));
  } else empty.push(4);

  // 5 — equipment / machinery.
  const equipment = m.equipment.filter((row) => row.name || row.devices || row.remarks || row.photo);
  if (equipment.length) {
    section(ctx, 5, MODULE_TITLES[4]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Vehicle / Asset', weight: 15 }, { label: 'Check Type', weight: 9 },
      { label: 'Safety Devices', weight: 20 }, { label: 'Status', weight: 7, align: 'center' },
      { label: 'Remarks', weight: 20 }
    ], equipment.map((row) => [date, where, row.name, row.check, row.devices, row.status, row.remarks]));
  } else empty.push(5);

  // 6 — tools & tackles.
  const tools = m.tools.filter((row) => row.name || row.toolId || row.remarks || row.photo);
  if (tools.length) {
    section(ctx, 6, MODULE_TITLES[5]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Tool Name', weight: 13 }, { label: 'ID / Serial', weight: 8 },
      { label: 'Safe / Unsafe', weight: 6.5, align: 'center' }, { label: 'Condition', weight: 6.5, align: 'center' },
      { label: 'Description', weight: 17 }, { label: 'Action', weight: 15 }, { label: 'Responsible', weight: 9 }
    ], tools.map((row) => [
      date, where, row.name, row.toolId, row.safe, row.condition, row.description, row.action, row.responsible
    ]));
  } else empty.push(6);

  // 7 — housekeeping: two matrices, one per S, because eight and fifteen columns do not fit side by side.
  const items1s = HOUSEKEEPING_ITEMS.filter((item) => item.element.startsWith('1S'));
  const items2s = HOUSEKEEPING_ITEMS.filter((item) => item.element.startsWith('2S'));
  const anyCheck = Object.keys(m.housekeeping.checks).length > 0;
  if (anyCheck || m.housekeeping.observations || m.housekeeping.action || m.housekeeping.photo) {
    section(ctx, 7, MODULE_TITLES[6]);
    const housekeepingRow = (items: typeof HOUSEKEEPING_ITEMS) => [
      date, where,
      ...items.map((item) => tick(m.housekeeping.checks[item.id] ?? '')),
      m.housekeeping.observations, m.housekeeping.action
    ];
    const columns = (items: typeof HOUSEKEEPING_ITEMS): Column[] => [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      ...items.map((_, index) => ({ label: `C${index + 1}`, weight: 3.1, align: 'center' as const })),
      { label: 'Observations', weight: 15 }, { label: 'Actions Taken', weight: 14 }
    ];
    if (anyCheck) {
      subHeading(ctx, '1S - Seiri (Sort out)');
      grid(ctx, columns(items1s), [housekeepingRow(items1s)], { size: 6, headSize: 5.6 });
      ctx.y -= 4;
      subHeading(ctx, '2S - Seiton (Set in order)');
      grid(ctx, columns(items2s), [housekeepingRow(items2s)], { size: 6, headSize: 5.6 });
      textBlock(ctx, 'C1, C2, C3 ... are the criteria in form order.', { size: 5.8, color: MUTED });
    } else {
      textBlock(ctx, `Observations: ${m.housekeeping.observations || '-'}`, { size: 6.4 });
      textBlock(ctx, `Action taken: ${m.housekeeping.action || '-'}`, { size: 6.4 });
    }
  } else empty.push(7);

  // 8 — safety interaction.
  const interaction = m.interaction;
  const interactionAny = interaction.team.some((row) => row.name) || interaction.topics.length > 0
    || interaction.feedback || interaction.photo;
  if (interactionAny) {
    section(ctx, 8, MODULE_TITLES[7]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Employee(s)', weight: 16 }, { label: 'Discussion Points', weight: 18 },
      { label: 'Feedback', weight: 18 }, { label: 'Escalated', weight: 6, align: 'center' },
      { label: 'Follow-up', weight: 6, align: 'center' }, { label: 'Target', weight: 6.5 }
    ], [[
      date, where,
      interaction.team.filter((row) => row.name).map((row) => row.name).join(', '),
      interaction.topics.join('; '), interaction.feedback,
      yesNo(interaction.escalated), yesNo(interaction.followUp), dmy(interaction.targetDate)
    ]]);
  } else empty.push(8);

  // 9 — incident / near miss / hazard.
  const incident = m.incident;
  const incidentAny = Boolean(incident.description || incident.reportNo || incident.location
    || incident.categories.length || incident.persons.some((row) => row.name) || incident.photo);
  if (incidentAny) {
    section(ctx, 9, MODULE_TITLES[8]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Reported By', weight: 8 }, { label: 'Report No', weight: 6 },
      { label: 'Category', weight: 10 }, { label: 'Persons', weight: 10 },
      { label: 'Description', weight: 20 }, { label: 'Immediate Action', weight: 18 },
      { label: 'Investigation', weight: 6, align: 'center' }
    ], [[
      dmy(incident.date) || date, incident.location || where, incident.reportedBy, incident.reportNo,
      incident.categories.join(', '),
      incident.persons.filter((row) => row.name).map((row) => row.name).join(', '),
      incident.description, incident.action, yesNo(incident.investigation)
    ]]);
  } else empty.push(9);

  // 10 — training.
  const training = m.training;
  const trainingAny = Boolean(training.employee || training.employeeNo || training.observation
    || training.action || training.photo);
  if (trainingAny) {
    section(ctx, 10, MODULE_TITLES[9]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'Employee', weight: 11 }, { label: 'Emp No', weight: 6 },
      { label: 'Observation', weight: 20 }, { label: 'Action Taken', weight: 18 },
      { label: 'Need Identified', weight: 9 }, { label: 'Conducted', weight: 6, align: 'center' },
      { label: 'Records', weight: 6, align: 'center' }
    ], [[
      date, where, training.employee, training.employeeNo, training.observation, training.action,
      training.needType, yesNo(training.conducted), yesNo(training.records)
    ]]);
  } else empty.push(10);

  // 11 — administrative & documentation.
  const admin = m.admin.filter((row) => row.sopNo || row.remarks);
  if (admin.length) {
    section(ctx, 11, MODULE_TITLES[10]);
    grid(ctx, [
      { label: 'Date', weight: 4.4 }, { label: 'Location', weight: 7.4 },
      { label: 'SOP / JHA No', weight: 9 }, { label: 'Compliance', weight: 9 },
      { label: 'Adequacy', weight: 8 }, { label: 'Action By', weight: 10 }, { label: 'Remarks', weight: 24 }
    ], admin.map((row) => [date, where, row.sopNo, row.compliance, row.adequacy, row.actionBy, row.remarks]));
  } else empty.push(11);

  return empty;
}

/** "Safety Helmet" -> "Helmet": the matrix header has room for the item, not the phrase. */
function ppeLabel(item: string): string {
  const short: Record<string, string> = {
    'Safety Shoe': 'Shoe',
    'Safety Helmet': 'Helmet',
    'Nose Mask': 'Mask',
    'Fire-resistant Jacket': 'FR Jacket',
    'Hand Gloves': 'Gloves',
    'Safety Goggles': 'Goggles',
    'Ear Plug': 'Ear Plug',
    'Leather Apron': 'Apron',
    'Leg Guard': 'Leg Guard',
    'Face Shield': 'Face Shield',
    Other: 'Other'
  };
  return short[item] ?? item;
}

/** Render the plan to PDF bytes. Deterministic for a given plan and metadata. */
export async function renderDmPdf(plan: DmPlan, meta: DmPdfMeta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`${displayReference(meta.reference)} — Daily Management Plan`);
  pdf.setAuthor('Safex');
  pdf.setSubject(`Daily Management Plan · ${meta.siteName}`);

  const ctx: Ctx = {
    pdf, page: pdf.addPage([PAGE.width, PAGE.height]), y: PAGE.height - MARGIN, regular, bold, meta
  };

  drawLetterhead(ctx, plan);
  drawMetaStrip(ctx, plan);

  const photos = await embedPhotos(pdf, plan);
  const empty = renderSections(ctx, plan, meta);

  if (empty.length) {
    textBlock(ctx, `No entry recorded for module${empty.length === 1 ? '' : 's'} ${empty.join(', ')}.`, {
      size: 6.2, color: MUTED
    });
  }

  // Declaration + hand-drawn signature, then the evidence appendix.
  drawSignOff(ctx, plan, await embedSignature(pdf, plan.signOff?.signature));

  const entries = photoEntries(plan, photos);
  if (entries.length) {
    newPage(ctx);
    band(ctx, 'Photographs');
    textBlock(ctx, `Annexure — ${entries.length} photograph${entries.length === 1 ? '' : 's'} attached to this plan.`, {
      size: 6.2, color: MUTED
    });
    photoGrid(ctx, entries);
  }

  const pages = pdf.getPages();
  const generated = meta.generatedAt ?? new Date();
  pages.forEach((page, index) => {
    page.drawText(sanitize(`${meta.reference} · Safex · generated ${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC`), {
      x: MARGIN, y: 13, size: 6, font: regular, color: MUTED
    });
    const label = `Page ${index + 1} of ${pages.length}`;
    page.drawText(label, {
      x: PAGE.width - MARGIN - regular.widthOfTextAtSize(label, 6), y: 13, size: 6, font: regular, color: MUTED
    });
  });

  return pdf.save();
}
