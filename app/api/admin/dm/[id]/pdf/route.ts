import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE } from '@/lib/http/request-guard';
import { createAdminGuard, deny } from '@/lib/http/admin-gate';
import { getCompanyNameFromDatabase } from '@/lib/employee-master/db-source';
import { readDmPdf, siteLabel } from '@/lib/dm/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const guard = createAdminGuard({ windowMs: 60_000, max: 60 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The filed plan as a PDF, named DM-DD-MM-YY.pdf.
 *
 * Served through this session-gated route rather than a signed Storage URL: the file is a
 * safety record, and a URL that keeps working after the operator signs out is the wrong
 * shape for one.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = guard(request, 'Sign in to download DM records.');
  if (blocked) return blocked;

  const { id } = await context.params;
  if (!UUID.test(id)) return deny(400, 'INVALID_ID', 'That DM record id is not valid.');

  const params = request.nextUrl.searchParams;
  const siteSlug = (params.get('siteId') ?? '').trim().slice(0, 96);
  // `inline` is for the in-console viewer; the default stays a download, because the
  // document's filename is its reference and operators file it by that name.
  const disposition = params.get('inline') === '1' ? 'inline' : 'attachment';
  const [companyName, siteName] = await Promise.all([
    getCompanyNameFromDatabase(),
    siteSlug ? siteLabel(siteSlug) : Promise.resolve(null)
  ]);

  const pdf = await readDmPdf(id, { companyName, siteName });
  if (!pdf.ok) {
    return pdf.code === 'NOT_FOUND'
      ? deny(404, 'DM_NOT_FOUND', 'No DM record with that id exists for this tenant.')
      : deny(503, 'DM_UNAVAILABLE', 'The DM PDF could not be produced right now.');
  }

  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/pdf',
      // The file the operator files: DM-21-10-26.pdf
      'Content-Disposition': `${disposition}; filename="${pdf.filename}"`
    }
  });
}
