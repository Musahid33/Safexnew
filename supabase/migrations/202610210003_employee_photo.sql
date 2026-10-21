-- Employee photo, for the admin passport screen.
--
-- 202610210001 left photo out on purpose: a 2 MB data URL in the roster would have been
-- copied into every list query. The admin passport needs the photo, so it now has a column
-- of its own — readers only select it when they are loading one employee, and the browser
-- re-encodes the file down to a small JPEG before it is ever sent.
--
-- Readers that do not need a face (the roster list, the public lookup) never select this
-- column; `lib/employee-master/db-source.ts` keeps it out of PII_COLUMNS for that reason.
--
-- The photo is deliberately not behind SAFEX_ADMIN_PII_ENABLED (see profile-fields.ts):
-- that switch guards health data and home addresses, not the face on the passport.

alter table public.employees
  add column if not exists photo text;

comment on column public.employees.photo is
  'Employee photograph as a data URL (image/jpeg, image/png or image/webp, <= 200000 chars). Read one employee at a time; never selected by the roster list or the public lookup.';
