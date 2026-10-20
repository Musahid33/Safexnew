-- Employee profile fields the admin console's profile form edits.
--
-- The roster table was built for the synced employee master (number, name, trade,
-- department, pass, blood group, mobile). The console's profile screen also edits contact
-- and emergency details, and those had nowhere to go — so an edit looked saved and was
-- gone on reload. Everything here is nullable: existing rows keep working untouched, and
-- the sync job does not have to supply them.
--
-- Photo is deliberately not a column: the design stores a 2 MB data URL and says on screen
-- that it is a preview only. Writing that into the roster would bloat every list query.

alter table public.employees
  add column if not exists email text,
  add column if not exists gender text,
  add column if not exists dob date,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_mobile text,
  add column if not exists work_location text,
  add column if not exists notes text,
  add column if not exists previous_names text[];

comment on column public.employees.email is 'Work email from the admin console profile form.';
comment on column public.employees.dob is 'Date of birth. Released to the console only when SAFEX_ADMIN_PII_ENABLED=true.';
comment on column public.employees.work_location is 'Work location / area within the site (not personal data).';
comment on column public.employees.previous_names is 'Earlier names, so a renamed employee stays findable in history.';
