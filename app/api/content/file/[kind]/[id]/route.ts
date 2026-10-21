import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { contentStore, resolvePublishedFileAsset } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Downloads or displays a published document or circular attachment.
 *
 * The file itself stays in a private bucket; this route is the stable link the app shows. It
 * re-checks `status = 'published'` on every request, so unpublishing something stops the
 * download immediately and no permanent public URL ever exists.
 *
 *   (no parameter)  302 to a two-minute signed URL — the download link used by the app.
 *   ?download=1     302 to a signed URL that forces a save rather than an inline render.
 *   ?inline=1       streams the bytes from this origin so the document opens inside the app's
 *                   own viewer. A cross-origin redirect cannot be framed, and the signed URL
 *                   must not become the thing the browser remembers.
 *
 * An external https link is always redirected to directly: it was validated when it was saved
 * and it is not ours to stream.
 */

const allowRead = createRateLimiter({ windowMs: 60_000, max: 120 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

function safeFileName(value: string | null, fallback: string): string {
  const cleaned = (value ?? '').replace(/[^\w.\- ]+/g, '_').trim();
  return cleaned || fallback;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  if (!sameOrigin(request)) return new NextResponse('Cross-origin request rejected.', { status: 403, headers: NO_STORE });
  if (!allowRead(clientIp(request))) return new NextResponse('Too many requests.', { status: 429, headers: NO_STORE });

  const { kind, id } = await params;
  if ((kind !== 'document' && kind !== 'announcement') || !uuid.test(id)) {
    return new NextResponse('Not found.', { status: 404, headers: NO_STORE });
  }

  const store = await contentStore();
  if (!store) return new NextResponse('Content storage is not configured.', { status: 503, headers: NO_STORE });

  const inline = request.nextUrl.searchParams.get('inline') === '1';
  const download = request.nextUrl.searchParams.get('download') === '1';

  const asset = await resolvePublishedFileAsset(kind, id, { download: download && !inline });
  if (!asset) return new NextResponse('This file is not published.', { status: 404, headers: NO_STORE });

  // A link, or a plain download: the browser follows the short-lived URL.
  if (!inline || !asset.storagePath) {
    // 302 rather than 307: a browser may cache the target, never the decision.
    return NextResponse.redirect(asset.url, { status: 302, headers: NO_STORE });
  }

  const mimeType = asset.mimeType && INLINE_TYPES.has(asset.mimeType) ? asset.mimeType : 'application/pdf';
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
    'Content-Disposition': `inline; filename="${safeFileName(asset.fileName, kind === 'document' ? 'document' : 'attachment')}"`,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; style-src 'unsafe-inline'; img-src 'self' data:"
  });
  const length = upstream.headers.get('content-length');
  if (length) headers.set('Content-Length', length);

  return new NextResponse(upstream.body, { status: 200, headers });
}
