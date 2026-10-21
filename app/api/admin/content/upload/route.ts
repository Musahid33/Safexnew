import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminGuard } from '@/lib/http/admin-gate';
import { NO_STORE } from '@/lib/http/request-guard';
import { CONTENT_BUCKET, contentStore, findContentSite } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload one file for a vault document or a circular attachment.
 *
 * Two-step on purpose: this returns the storage path, and the publish call saves it with a
 * title. That way a half-filled form never leaves an unreferenced row, and the file is only
 * readable through `/api/content/file/...` once its row is published.
 *
 * The bucket is private; size and MIME type are enforced here *and* by the bucket, because a
 * client-side `accept` attribute is a convenience, not a control.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

const guard = createAdminGuard({ windowMs: 60_000, max: 20 });

export async function POST(request: NextRequest) {
  const blocked = guard(request, 'Admin sign-in required.');
  if (blocked) return blocked;

  const store = await contentStore();
  if (!store) return NextResponse.json({ ok: false, error: 'Supabase is not configured for this deployment.' }, { status: 503, headers: NO_STORE });

  // Check the declared size before buffering the multipart body.
  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, error: 'Files must be 10 MB or smaller.' }, { status: 413, headers: NO_STORE });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Send the file as form data.' }, { status: 400, headers: NO_STORE });
  }

  const siteRef = String(form.get('site') ?? '').trim().slice(0, 64);
  const site = siteRef ? await findContentSite(store, siteRef) : null;
  if (!site) return NextResponse.json({ ok: false, error: 'Choose an active site before uploading.' }, { status: 400, headers: NO_STORE });

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Choose a file to upload.' }, { status: 400, headers: NO_STORE });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'Files must be 10 MB or smaller.' }, { status: 413, headers: NO_STORE });
  }
  const extension = ALLOWED.get(file.type);
  if (!extension) {
    return NextResponse.json({ ok: false, error: 'Upload a PDF, PNG, JPG or WEBP file.' }, { status: 415, headers: NO_STORE });
  }

  const path = `content/${store.tenantId}/${site.id}/${randomUUID()}.${extension}`;
  const upload = await store.admin.storage.from(CONTENT_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (upload.error) {
    console.error('Content upload failed', upload.error);
    return NextResponse.json({
      ok: false,
      error: 'The private content bucket is not ready. Apply migration 202610210005_content_publishing.sql, then try again.'
    }, { status: 503, headers: NO_STORE });
  }

  // The original name is display metadata only; it never becomes part of the path.
  const fileName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 160) || `file.${extension}`;
  return NextResponse.json({ ok: true, path, fileName }, { status: 201, headers: NO_STORE });
}
