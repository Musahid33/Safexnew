import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { contentStore, readPublishedContent } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Published content for one site: the document vault and the circulars / notices / events
 * feed, in a single read.
 *
 * The worker app calls this when it opens and whenever the site changes. Only `published` rows
 * are selected, so this route cannot leak a draft even if a client asks for it — there is no
 * parameter that widens the scope.
 */

const allowRead = createRateLimiter({ windowMs: 60_000, max: 90 });

export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ ok: false, code: 'CROSS_ORIGIN_REJECTED' }, { status: 403, headers: NO_STORE });
  }
  if (!allowRead(clientIp(request))) {
    return NextResponse.json({ ok: false, code: 'CONTENT_RATE_LIMITED', error: 'Too many refreshes. Wait a minute.' }, { status: 429, headers: NO_STORE });
  }

  const store = await contentStore();
  if (!store) {
    return NextResponse.json(
      { ok: false, code: 'UNAVAILABLE', error: 'Published content is not reachable from this deployment yet.' },
      { status: 503, headers: NO_STORE }
    );
  }

  const siteRef = (request.nextUrl.searchParams.get('site') ?? '').trim().slice(0, 64);
  if (!siteRef) {
    return NextResponse.json({ ok: true, site: null, documents: [], feed: [] }, { headers: NO_STORE });
  }

  const content = await readPublishedContent(siteRef);
  if (!content) {
    // An unknown site is an empty answer, not an error: the client shows "no content yet".
    return NextResponse.json({ ok: true, site: null, documents: [], feed: [] }, { headers: NO_STORE });
  }

  return NextResponse.json({
    ok: true,
    site: { id: content.site.id, slug: content.site.slug, name: content.site.name },
    documents: content.documents,
    feed: content.feed
  }, { headers: NO_STORE });
}
