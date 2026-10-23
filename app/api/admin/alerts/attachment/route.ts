import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createAdminGuard } from '@/lib/http/admin-gate';
import { json } from '@/lib/http/request-guard';
import { CONTENT_BUCKET, contentStore } from '@/lib/content/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload the incident file for a safety alert: the report PDF or the photo taken at the spot.
 *
 * One step, like the reward photo: the browser posts the file and gets back the storage path
 * plus the original name, and the alert form saves both with the rest of the incident. The
 * bucket is private, so the app can only reach it through `/api/alerts/<id>/file`, which
 * re-checks that the alert is published.
 *
 * Size and MIME type are enforced here *and* by the bucket, because `accept="…"` in the form
 * is a convenience, not a control. SVG is refused: it can carry script.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp']
]);

const guard = createAdminGuard({ windowMs: 60_000, max: 30 });

export async function POST(request: NextRequest) {
  const blocked = guard(request, 'Admin sign-in required.');
  if (blocked) return blocked;

  const store = await contentStore();
  if (!store) return json({ ok: false, error: 'Supabase is not configured for this deployment.' }, 503);

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES + 64 * 1024) {
    return json({ ok: false, error: 'Files must be 10 MB or smaller.' }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Send the file as form data.' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: 'Choose a file to upload.' }, 400);
  if (file.size > MAX_BYTES) return json({ ok: false, error: 'Files must be 10 MB or smaller.' }, 413);

  const extension = ALLOWED.get(file.type);
  if (!extension) return json({ ok: false, error: 'Upload a PDF, PNG, JPG or WEBP file.' }, 415);

  const path = `alerts/${store.tenantId}/${randomUUID()}.${extension}`;
  const upload = await store.admin.storage.from(CONTENT_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (upload.error) {
    console.error('Alert attachment upload failed', upload.error);
    return json({
      ok: false,
      error: 'The content storage bucket is not ready. Apply migration 202610210005_content_publishing.sql, then try again.'
    }, 503);
  }

  // The original name is display metadata only; it never becomes part of the path.
  const fileName = file.name.replace(/[^\w.\- ]+/g, '_').slice(0, 160) || `incident.${extension}`;
  return json({ ok: true, path, fileName, mimeType: file.type }, 201);
}
