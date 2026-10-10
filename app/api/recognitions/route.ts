import { NextRequest, NextResponse } from 'next/server';
import { NO_STORE, clientIp, createRateLimiter, sameOrigin } from '@/lib/http/request-guard';
import { mapRecognition, recognitionStore, type RecognitionDb } from '@/lib/recognitions-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const allowRead = createRateLimiter({ windowMs: 60_000, max: 120 });

/** Public, read-only gallery. Never return draft or unconsented records. */
export async function GET(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  if (!allowRead(clientIp(request))) return NextResponse.json({ ok: false }, { status: 429, headers: NO_STORE });
  try {
    const store = await recognitionStore();
    if (!store) return NextResponse.json({ ok: true, items: [] }, { headers: NO_STORE });
    const { data, error } = await store.admin.from('recognitions')
      .select('id, employee_name, reward_for, image_url, artwork_index, consent_confirmed, is_published, sort_order')
      .eq('tenant_id', store.tenantId).eq('is_published', true).eq('consent_confirmed', true)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return NextResponse.json({ ok: true, items: (data as RecognitionDb[]).map(mapRecognition) }, { headers: NO_STORE });
  } catch (error) {
    console.error('Recognition gallery unavailable', error);
    return NextResponse.json({ ok: false, items: [] }, { status: 503, headers: NO_STORE });
  }
}
