-- Awardee photos for the Reward Wall.
--
-- Public on purpose: the Reward Wall sits on the public home screen and the photo *is* the
-- award artwork. Writes go through the service role only (the admin API); anonymous uploads
-- are never exposed, and the bucket refuses anything that is not a web image under 5 MB.
-- Nothing private may be stored here.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('safex-rewards', 'safex-rewards', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
