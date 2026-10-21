import { NextRequest } from 'next/server';
import { createAdminGuard } from '@/lib/http/admin-gate';
import { json } from '@/lib/http/request-guard';
import { contentStore, listContentSites, readAdminContent } from '@/lib/content/store';
import { validAnnouncementInput, validDocumentInput, validEventInput } from '@/lib/content/validation';
import { deleteContent, saveAnnouncement, saveDocument, saveEvent } from '@/lib/content/writes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The publishing panel's API: list everything for a site (drafts included), and create,
 * update or delete a vault document, a circular/notice or an event.
 *
 * Signed-in staff only. The session cookie is the same one the console and the rewards editor
 * use, so an operator signs in once. Every write is scoped to the tenant and the chosen site.
 */

const MAX_BODY = 64 * 1024;
const guard = createAdminGuard({ windowMs: 60_000, max: 90 });

async function bodyOf(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text || text.length > MAX_BODY) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function siteOf(body: Record<string, unknown> | null): string {
  return typeof body?.site === 'string' ? body.site.trim().slice(0, 64) : '';
}

function statusFor(code: 'UNAVAILABLE' | 'INVALID' | 'NOT_FOUND'): number {
  return code === 'INVALID' ? 400 : code === 'NOT_FOUND' ? 404 : 503;
}

/** List everything for one site (drafts included), plus the site selector's options. */
export async function GET(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;

  const store = await contentStore();
  if (!store) return json({ ok: false, error: 'Supabase is not configured for this deployment.' }, 503);

  const sites = await listContentSites(store);
  const siteRef = (request.nextUrl.searchParams.get('site') ?? '').trim().slice(0, 64);
  const empty = { site: null, documents: [], announcements: [], events: [] };
  if (!siteRef) return json({ ok: true, sites, ...empty });

  const listing = await readAdminContent(siteRef);
  if (!listing) return json({ ok: true, sites, ...empty });

  return json({
    ok: true,
    sites,
    site: { id: listing.site.id, slug: listing.site.slug, name: listing.site.name },
    ...listing.content
  });
}

export async function POST(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  if (!body) return json({ ok: false, error: 'Send a JSON body.' }, 400);

  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before publishing.' }, 400);

  if (body.kind === 'document') {
    const input = validDocumentInput(body);
    if (!input) return json({ ok: false, error: 'A document needs a title and a valid shelf.' }, 400);
    const result = await saveDocument(site, input, null);
    return result.ok ? json({ ok: true, id: result.id }, 201) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  if (body.kind === 'announcement') {
    const input = validAnnouncementInput(body);
    if (!input) return json({ ok: false, error: 'A circular or notice needs a title and a valid date.' }, 400);
    const result = await saveAnnouncement(site, input, null);
    return result.ok ? json({ ok: true, id: result.id }, 201) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  if (body.kind === 'event') {
    const input = validEventInput(body);
    if (!input) return json({ ok: false, error: 'An event needs a title and a start date.' }, 400);
    const result = await saveEvent(site, input, null);
    return result.ok ? json({ ok: true, id: result.id }, 201) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  return json({ ok: false, error: 'Unknown content kind.' }, 400);
}

export async function PUT(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  if (!body || typeof body.id !== 'string') return json({ ok: false, error: 'Send the entry id to update.' }, 400);

  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before saving.' }, 400);

  if (body.kind === 'document') {
    const input = validDocumentInput(body);
    if (!input) return json({ ok: false, error: 'A document needs a title and a valid shelf.' }, 400);
    const result = await saveDocument(site, input, body.id);
    return result.ok ? json({ ok: true, id: result.id }) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  if (body.kind === 'announcement') {
    const input = validAnnouncementInput(body);
    if (!input) return json({ ok: false, error: 'A circular or notice needs a title and a valid date.' }, 400);
    const result = await saveAnnouncement(site, input, body.id);
    return result.ok ? json({ ok: true, id: result.id }) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  if (body.kind === 'event') {
    const input = validEventInput(body);
    if (!input) return json({ ok: false, error: 'An event needs a title and a start date.' }, 400);
    const result = await saveEvent(site, input, body.id);
    return result.ok ? json({ ok: true, id: result.id }) : json({ ok: false, error: result.error }, statusFor(result.code));
  }

  return json({ ok: false, error: 'Unknown content kind.' }, 400);
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  if (!body || typeof body.id !== 'string') return json({ ok: false, error: 'Send the entry id to delete.' }, 400);

  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before deleting.' }, 400);
  if (body.kind !== 'document' && body.kind !== 'announcement' && body.kind !== 'event') {
    return json({ ok: false, error: 'Unknown content kind.' }, 400);
  }

  const result = await deleteContent(body.kind, site, body.id);
  return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, statusFor(result.code));
}
