import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { contentStore, resolvePublishedFile } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Downloads a published document or circular attachment.
 *
 * The file itself stays in a private bucket; this route is the stable link the app shows. It
 * re-checks `status = 'published'` on every request and then redirects to a two-minute signed
 * URL, so unpublishing something stops the download immediately and no permanent public URL
 * ever exists. An external link is redirected to directly — it was validated as https when it
 * was saved.
 */

const allowRead = createRateLimiter({ windowMs: 60_000, max: 120 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const target = await resolvePublishedFile(kind, id);
  if (!target) return new NextResponse('This file is not published.', { status: 404, headers: NO_STORE });

  // 302 rather than 307: a browser may cache the target, never the decision.
  return NextResponse.redirect(target, { status: 302, headers: NO_STORE });
}
