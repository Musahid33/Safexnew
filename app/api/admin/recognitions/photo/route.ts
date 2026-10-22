import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createAdminGuard } from '@/lib/http/admin-gate';
import { json } from '@/lib/http/request-guard';
import { RECOGNITION_BUCKET, recognitionStore } from '@/lib/recognitions-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Upload the awardee photo shown in the Reward Wall.
 *
 * One step, unlike the document vault: the browser posts the file and gets back the public
 * URL, which the reward form then saves with the name and the reason. The bucket is public
 * on purpose — the gallery is on the public home screen and the photo is the award picture —
 * so nothing private may ever be uploaded here. Writes still go through the service role
 * only; there is no anonymous upload path.
 *
 * Size and MIME type are enforced here *and* by the bucket, because `accept="image/*"` in the
 * form is a convenience, not a control.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

const guard = createAdminGuard({ windowMs: 60_000, max: 20 });

export async function POST(request: NextRequest) {
  const blocked = guard(request, 'Admin sign-in required.');
  if (blocked) return blocked;

  const store = await recognitionStore();
  if (!store) return json({ ok: false, error: 'Configure Supabase and SAFEX_TENANT_SLUG to upload photos.' }, 503);

  if (Number(request.headers.get('content-length') ?? '0') > MAX_BYTES + 64 * 1024) {
    return json({ ok: false, error: 'Photos must be 5 MB or smaller.' }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: 'Send the photo as form data.' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return json({ ok: false, error: 'Choose a photo to upload.' }, 400);
  if (file.size > MAX_BYTES) return json({ ok: false, error: 'Photos must be 5 MB or smaller.' }, 413);

  const extension = ALLOWED.get(file.type);
  if (!extension) return json({ ok: false, error: 'Upload a JPG, PNG or WEBP photo.' }, 415);

  const path = `rewards/${store.tenantId}/${randomUUID()}.${extension}`;
  const upload = await store.admin.storage.from(RECOGNITION_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false
  });
  if (upload.error) {
    console.error('Reward photo upload failed', upload.error);
    return json({
      ok: false,
      error: 'The reward photo bucket is not ready. Apply migration 202610220003_reward_photos.sql, then try again.'
    }, 503);
  }

  const { data } = store.admin.storage.from(RECOGNITION_BUCKET).getPublicUrl(path);
  return json({ ok: true, url: data.publicUrl }, 201);
}
