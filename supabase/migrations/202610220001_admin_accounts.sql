-- Operator accounts managed from Supabase.
--
-- The password itself is never stored here: it lives in Supabase Auth (Dashboard →
-- Authentication → Users), which hashes it, rate limits it and can reset it. This table is the
-- allowlist that decides which of those auth users may open the admin console.
--
-- Create a login in two steps:
--   1. Authentication → Users → Add user → email + password (tick "Auto Confirm User").
--   2. insert into public.admin_accounts (username, email) values ('musahid', 'that@email');

create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username) and length(username) between 3 and 40),
  email text not null unique check (email = lower(email) and email like '%_@_%._%'),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

comment on table public.admin_accounts is
  'Allowlist for admin console sign-in. Passwords live in Supabase Auth, never here.';

alter table public.admin_accounts enable row level security;

-- Only the server (service role) reads this table. Browser roles get nothing: the allowlist
-- is checked inside `/api/admin/session` after Supabase Auth has verified the password.
revoke all on public.admin_accounts from anon, authenticated;
grant all on public.admin_accounts to service_role;

drop policy if exists admin_accounts_service_only on public.admin_accounts;
create policy admin_accounts_service_only on public.admin_accounts
  for all to service_role using (true) with check (true);

create index if not exists admin_accounts_active_idx on public.admin_accounts (active) where active;
