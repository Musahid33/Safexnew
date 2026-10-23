-- Safety alerts can carry the incident file: the report PDF or the photo taken at the spot.
--
-- Same storage as the document vault (the private `safex-content` bucket, 10 MB, PDF/PNG/
-- JPG/WEBP), under an `alerts/` prefix. The bucket is private and the app reads through
-- `/api/alerts/<id>/file`, which re-checks `status = 'published'` before signing a two-minute
-- URL — so unpublishing an alert also stops its file from being reachable.
--
-- The path and the original name are display metadata only; the download URL is never stored.

alter table public.safety_alerts
  add column if not exists attachment_path text;
alter table public.safety_alerts
  add column if not exists attachment_name text;
alter table public.safety_alerts
  add column if not exists attachment_mime text;

-- A stored path must look like `alerts/<uuid>/<uuid>.<ext>`: no scheme, no `..`, no spaces.
alter table public.safety_alerts
  drop constraint if exists safety_alerts_attachment_path_shape;
alter table public.safety_alerts
  add constraint safety_alerts_attachment_path_shape
  check (
    attachment_path is null
    or attachment_path ~ '^alerts/[A-Za-z0-9-]+/[A-Za-z0-9-]+\.(pdf|png|jpg|webp)$'
  );

-- Only the three web formats the viewer knows how to render can be attached.
alter table public.safety_alerts
  drop constraint if exists safety_alerts_attachment_mime_allowed;
alter table public.safety_alerts
  add constraint safety_alerts_attachment_mime_allowed
  check (
    attachment_mime is null
    or attachment_mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')
  );

-- The columns keep the same posture as the rest of the row: service role writes; the public
-- read goes through the app's API, so anon never needs the storage path at all.
comment on column public.safety_alerts.attachment_path is
  'Private bucket path. Resolved to a short-lived URL by /api/alerts/<id>/file; never exposed.';
