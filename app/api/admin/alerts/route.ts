import { NextRequest } from 'next/server';
import { createAdminGuard } from '@/lib/http/admin-gate';
import { json } from '@/lib/http/request-guard';
import { deleteAlert, readAdminAlerts, saveAlert } from '@/lib/alerts/store';
import { validAlertInput } from '@/lib/alerts/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The console's safety-alert editor: list every alert for a site (drafts included) and
 * create, update or delete one.
 *
 * Signed-in staff only, through the same session as the rest of the console, and every write
 * is scoped to the tenant and the chosen site — the id in the body alone is never enough.
 */

const guard = createAdminGuard({ windowMs: 60_000, max: 90 });

async function bodyOf(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text || text.length > 64 * 1024) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function siteOf(body: Record<string, unknown> | null): string {
  return typeof body?.site === 'string' ? body.site.trim().slice(0, 64) : '';
}

function statusFor(code: 'INVALID' | 'NOT_FOUND' | 'UNAVAILABLE'): number {
  return code === 'INVALID' ? 400 : code === 'NOT_FOUND' ? 404 : 503;
}

export async function GET(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const siteRef = (request.nextUrl.searchParams.get('site') ?? '').trim().slice(0, 64);
  if (!siteRef) return json({ ok: true, alerts: [] });
  try {
    return json({ ok: true, alerts: await readAdminAlerts(siteRef) });
  } catch (error) {
    console.error('Safety alert list unavailable', error);
    return json({ ok: false, error: 'Safety alerts could not be read.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before publishing.' }, 400);
  const input = body && validAlertInput(body);
  if (!input) {
    return json({ ok: false, error: 'An alert needs a category, a headline, the incident date and a description.' }, 400);
  }
  const result = await saveAlert(site, input, null);
  return result.ok ? json({ ok: true, id: result.id }, 201) : json({ ok: false, error: result.error }, statusFor(result.code));
}

export async function PUT(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before saving.' }, 400);
  if (!body || typeof body.id !== 'string') return json({ ok: false, error: 'Send the alert id to update.' }, 400);
  const input = validAlertInput(body);
  if (!input) {
    return json({ ok: false, error: 'An alert needs a category, a headline, the incident date and a description.' }, 400);
  }
  const result = await saveAlert(site, input, body.id);
  return result.ok ? json({ ok: true, id: result.id }) : json({ ok: false, error: result.error }, statusFor(result.code));
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request, 'Admin sign-in required.');
  if (denied) return denied;
  const body = await bodyOf(request);
  const site = siteOf(body);
  if (!site) return json({ ok: false, error: 'Choose a site before deleting.' }, 400);
  if (!body || typeof body.id !== 'string') return json({ ok: false, error: 'Send the alert id to delete.' }, 400);
  const result = await deleteAlert(site, body.id);
  return result.ok ? json({ ok: true }) : json({ ok: false, error: result.error }, statusFor(result.code));
}
