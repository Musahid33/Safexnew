import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/admin-auth';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { mapRecognition, recognitionStore, type RecognitionDb } from '@/lib/recognitions-server';
import { validRecognitionInput } from '@/lib/recognitions-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowRequest = createRateLimiter({ windowMs: 60_000, max: 60 });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function response(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}
function guard(request: NextRequest) {
  if (!sameOrigin(request)) return response({ ok: false, error: 'Cross-origin request rejected.' }, 403);
  if (!readSession(request)) return response({ ok: false, error: 'Admin sign-in required.' }, 401);
  if (!allowRequest(clientIp(request))) return response({ ok: false, error: 'Too many requests.' }, 429);
  return null;
}
function dbError(error: unknown) {
  console.error('Recognition management unavailable', error);
  return response({ ok: false, error: 'Recognition database unavailable. Check the migration and server configuration.' }, 503);
}

async function bodyOf(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const store = await recognitionStore();
    if (!store) return response({ ok: false, error: 'Configure Supabase and SAFEX_TENANT_SLUG to manage rewards.' }, 503);
    const { data, error } = await store.admin.from('recognitions')
      .select('id, employee_name, reward_for, image_url, artwork_index, consent_confirmed, is_published, sort_order')
      .eq('tenant_id', store.tenantId).order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return response({ ok: true, items: (data as RecognitionDb[]).map((row) => ({
      ...mapRecognition(row), consentConfirmed: row.consent_confirmed,
      isPublished: row.is_published, sortOrder: row.sort_order
    })) });
  } catch (error) { return dbError(error); }
}

export async function POST(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await bodyOf(request);
  const input = body && validRecognitionInput(body);
  if (!input) return response({ ok: false, error: 'Enter a name, reward reason and valid options. Publishing requires confirmed consent.' }, 400);
  try {
    const store = await recognitionStore();
    if (!store) return response({ ok: false, error: 'Recognition database is not configured.' }, 503);
    const { error } = await store.admin.from('recognitions').insert({ ...input, tenant_id: store.tenantId });
    if (error) throw error;
    return response({ ok: true }, 201);
  } catch (error) { return dbError(error); }
}

export async function PUT(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await bodyOf(request);
  const input = body && validRecognitionInput(body);
  if (!body || typeof body.id !== 'string' || !uuid.test(body.id) || !input) {
    return response({ ok: false, error: 'Enter a valid name, reason and consent before publishing.' }, 400);
  }
  try {
    const store = await recognitionStore();
    if (!store) return response({ ok: false, error: 'Recognition database is not configured.' }, 503);
    const { data, error } = await store.admin.from('recognitions').update(input)
      .eq('id', body.id).eq('tenant_id', store.tenantId).select('id').maybeSingle();
    if (error) throw error;
    return data ? response({ ok: true }) : response({ ok: false, error: 'Entry not found.' }, 404);
  } catch (error) { return dbError(error); }
}

export async function DELETE(request: NextRequest) {
  const denied = guard(request);
  if (denied) return denied;
  const body = await bodyOf(request);
  if (!body || typeof body.id !== 'string' || !uuid.test(body.id)) return response({ ok: false, error: 'Invalid entry ID.' }, 400);
  try {
    const store = await recognitionStore();
    if (!store) return response({ ok: false, error: 'Recognition database is not configured.' }, 503);
    const { data, error } = await store.admin.from('recognitions').delete()
      .eq('id', body.id).eq('tenant_id', store.tenantId).select('id').maybeSingle();
    if (error) throw error;
    return data ? response({ ok: true }) : response({ ok: false, error: 'Entry not found.' }, 404);
  } catch (error) { return dbError(error); }
}
