import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { resolvePublishedAlertFile } from '@/lib/alerts/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The incident PDF or photo attached to a published safety alert.
 *
 * The file stays in the private bucket; this is the stable link the app shows. Every request
 * re-checks `status = 'published'` (and that the publish time has passed), so unpublishing an
 * alert stops its file immediately and no permanent public URL exists.
 *
 *   (no parameter)  302 to a two-minute signed URL — the download link.
 *   ?inline=1       streams the bytes from this origin so the app's own viewer can show the
 *                   incident file inside the alert sheet, on the same page.
 *   ?download=1     302 to a signed URL that forces a save instead of an inline render.
 */

const allowRead = createRateLimiter({ windowMs: 60_000, max: 120 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

function safeFileName(value: string, fallback: string): string {
  const cleaned = value.replace(/[^\w.\- ]+/g, '_').trim();
  return cleaned || fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return new NextResponse('Cross-origin request rejected.', { status: 403, headers: NO_STORE });
  if (!allowRead(clientIp(request))) return new NextResponse('Too many requests.', { status: 429, headers: NO_STORE });

  const { id } = await params;
  if (!uuid.test(id)) return new NextResponse('Not found.', { status: 404, headers: NO_STORE });

  const inline = request.nextUrl.searchParams.get('inline') === '1';
  const download = request.nextUrl.searchParams.get('download') === '1';

  const asset = await resolvePublishedAlertFile(id);
  if (!asset) return new NextResponse('This alert is not published.', { status: 404, headers: NO_STORE });

  if (!inline) {
    // 302 rather than 307: a browser may cache the target, never the decision.
    return NextResponse.redirect(
      download ? `${asset.url}${asset.url.includes('?') ? '&' : '?'}download=${encodeURIComponent(safeFileName(asset.fileName, 'incident'))}` : asset.url,
      { status: 302, headers: NO_STORE }
    );
  }

  const mimeType = INLINE_TYPES.has(asset.mimeType) ? asset.mimeType : 'application/pdf';
  let upstream: Response;
  try {
    upstream = await fetch(asset.url, { cache: 'no-store' });
  } catch {
    return new NextResponse('The file could not be read.', { status: 502, headers: NO_STORE });
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse('The file could not be read.', { status: 502, headers: NO_STORE });
  }

  const headers = new Headers({
    'Content-Type': mimeType,
    'Content-Disposition': `inline; filename="${safeFileName(asset.fileName, 'incident')}"`,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    // The viewer is same-origin and framed inside the app's own alert sheet only.
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; style-src 'unsafe-inline'; img-src 'self' data:"
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  return new NextResponse(upstream.body, { status: 200, headers });
}
