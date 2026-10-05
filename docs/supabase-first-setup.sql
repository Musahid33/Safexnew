-- SAFEX: FIRST SETUP FOR AN EMPTY SUPABASE PROJECT ONLY.
-- Run as project owner in Supabase SQL Editor, before importing employee data.
-- Generated from the repository migrations and RLS hardening script.
-- Contains no employee roster, passwords or API keys.
-- Do not run on an existing installation; initial policies are not re-runnable.
-- If any statement fails, stop and inspect the error before importing data.
-- After success, run supabase/sql/99_gate_test.sql separately; all checks must PASS.

-- SOURCE: supabase/migrations/202610030001_initial_safex.sql
-- Safex multi-tenant foundation. Review with your actual employee/site schema before applying.
-- No service-role key is needed in SQL. Public browser access to raw employee/report tables is denied.

create extension if not exists pgcrypto;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  slug text not null unique,
  company_address text,
  contact_email text,
  contact_mobile_e164 text,
  logo_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Safex platform administrators are provisioned only by a trusted operator/service role.
-- They are separate from vendor/tenant administrators and alone manage tenant onboarding.
create table if not exists public.safex_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  domain text not null unique,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tenant_domains_domain_lower check (domain = lower(domain))
);

-- Optional modules only. Missing rows mean disabled; shared core UI is not tenant-overridable.
create table if not exists public.tenant_features (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null check (feature_key in (
    'voice_reporting', 'training_management', 'library',
    'circulars', 'reward_wall', 'push_notifications'
  )),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  slug text not null,
  region text,
  active boolean not null default true,
  sos_phone_e164 text,
  sos_backup_phone_e164 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (id, tenant_id)
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  employee_no text not null,
  full_name text not null,
  designation text,
  department text,
  mobile_e164 text,
  active boolean not null default true,
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_no),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade
);
create index if not exists employees_site_search_idx on public.employees (tenant_id, site_id, active, employee_no);
create index if not exists employees_name_search_idx on public.employees (tenant_id, site_id, lower(full_name));

create table if not exists public.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('site_officer', 'vendor_admin', 'tenant_admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade
);
create index if not exists staff_memberships_user_idx on public.staff_memberships (user_id, tenant_id, active);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  reporter_employee_id uuid references public.employees(id) on delete set null,
  report_ref text not null,
  report_type text not null check (report_type in ('near_miss', 'hazard', 'safety_observation', 'unsafe_condition', 'unsafe_act', 'feedback', 'grievance', 'speak_up', 'suggestion')),
  report_category text,
  anonymous boolean not null default false,
  area text,
  department text,
  occurred_at timestamptz,
  severity text check (severity in ('Low', 'Medium', 'High')),
  short_description text not null,
  description text not null,
  immediate_action text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  worker_summary_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, report_ref),
  unique (id, tenant_id, site_id),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade,
  constraint anonymous_has_no_reporter check (not anonymous or reporter_employee_id is null)
);
create index if not exists reports_site_created_idx on public.reports (tenant_id, site_id, created_at desc);
create index if not exists reports_tenant_created_idx on public.reports (tenant_id, created_at desc);

create table if not exists public.report_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  report_id uuid not null,
  original_storage_path text not null,
  reviewed_preview_path text,
  review_state text not null default 'pending' check (review_state in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade,
  foreign key (report_id, tenant_id, site_id) references public.reports(id, tenant_id, site_id) on delete cascade
);

create table if not exists public.report_status_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid not null,
  report_id uuid not null,
  changed_by uuid references auth.users(id) on delete set null,
  old_status text,
  new_status text not null,
  public_note text,
  created_at timestamptz not null default now(),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade,
  foreign key (report_id, tenant_id, site_id) references public.reports(id, tenant_id, site_id) on delete cascade
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid,
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  preferences jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (endpoint),
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete cascade
);

create or replace function public.safex_has_site_access(p_tenant_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.active = true
      and (m.site_id = p_site_id or m.role in ('vendor_admin', 'tenant_admin'))
  );
$$;

create or replace function public.safex_is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.active = true
      and m.role in ('vendor_admin', 'tenant_admin')
  );
$$;

create or replace function public.safex_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.safex_platform_admins a
    where a.user_id = auth.uid() and a.active = true
  );
$$;

revoke all on function public.safex_has_site_access(uuid, uuid) from public;
revoke all on function public.safex_is_tenant_admin(uuid) from public;
revoke all on function public.safex_is_platform_admin() from public;
grant execute on function public.safex_has_site_access(uuid, uuid) to authenticated;
grant execute on function public.safex_is_tenant_admin(uuid) to authenticated;
grant execute on function public.safex_is_platform_admin() to authenticated;

alter table public.tenants enable row level security;
alter table public.safex_platform_admins enable row level security;
alter table public.tenant_domains enable row level security;
alter table public.tenant_features enable row level security;
alter table public.sites enable row level security;
alter table public.employees enable row level security;
alter table public.staff_memberships enable row level security;
alter table public.reports enable row level security;
alter table public.report_attachments enable row level security;
alter table public.report_status_events enable row level security;
alter table public.push_subscriptions enable row level security;

-- Start from deny. Safe site directories/worker summaries are served via validated server APIs,
-- not direct anonymous table access or a view that could bypass RLS.
revoke all on public.tenants, public.safex_platform_admins, public.tenant_domains,
  public.tenant_features, public.sites, public.employees, public.staff_memberships,
  public.reports, public.report_attachments, public.report_status_events,
  public.push_subscriptions from anon, authenticated;

-- Trusted server code only. Never expose the service-role key to a browser/client bundle.
grant all on public.tenants, public.safex_platform_admins, public.tenant_domains,
  public.tenant_features, public.sites, public.employees, public.staff_memberships,
  public.reports, public.report_attachments, public.report_status_events,
  public.push_subscriptions to service_role;

-- Staff browser access (RLS still applies). Sensitive employee phone fields are not granted.
grant select on public.sites to authenticated;
grant select (id, tenant_id, site_id, employee_no, full_name, designation, department, active) on public.employees to authenticated;
grant select on public.staff_memberships to authenticated;
grant select, insert, update on public.reports to authenticated;
grant select, insert, update on public.report_attachments to authenticated;
grant select, insert on public.report_status_events to authenticated;

-- Safex Super Admin policies. Direct tenant/profile/feature table grants remain revoked from
-- authenticated clients; trusted server routes may use the service role only after checking this
-- membership. There is intentionally no authenticated policy on tenant_features: feature flags
-- are server-resolved and only trusted backend code may read or write them.
create policy safex_platform_manage_tenants on public.tenants for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());
create policy safex_platform_manage_domains on public.tenant_domains for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());
create policy safex_platform_manage_sites on public.sites for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

create policy staff_sites_read on public.sites for select to authenticated
  using (public.safex_has_site_access(tenant_id, id));

create policy staff_employee_directory_read on public.employees for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));

create policy staff_memberships_read_self on public.staff_memberships for select to authenticated
  using (user_id = auth.uid() or public.safex_is_tenant_admin(tenant_id));

create policy staff_reports_read on public.reports for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));
create policy staff_reports_insert on public.reports for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));
create policy staff_reports_update on public.reports for update to authenticated
  using (public.safex_has_site_access(tenant_id, site_id))
  with check (public.safex_has_site_access(tenant_id, site_id));

create policy staff_attachments_read on public.report_attachments for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));
create policy staff_attachments_write on public.report_attachments for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));
create policy staff_attachments_update on public.report_attachments for update to authenticated
  using (public.safex_has_site_access(tenant_id, site_id))
  with check (public.safex_has_site_access(tenant_id, site_id));

create policy staff_report_status_read on public.report_status_events for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));
create policy staff_report_status_insert on public.report_status_events for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));

-- Push subscription storage is deliberately server-managed until employee/tenant ownership is verified.

-- IMPORTANT: Anonymous report submission, employee lookup, site directory, public summaries,
-- OTP-protected all-site summaries, and signed attachment previews must go through server-side
-- endpoints/Edge Functions that validate the tenant derived from the request host, selected site,
-- payload, rate limits and OTP/session. Never expose SUPABASE_SERVICE_ROLE_KEY in a browser.


-- SOURCE: supabase/migrations/202610030002_offline_report_sync.sql
-- Durable offline report sync support. Apply only after reviewing the base Safex schema.
-- Public submissions remain disabled until the server-side flag, verified tenant domain,
-- Supabase service key, and this migration are configured together.

alter table public.reports
  add column if not exists client_submitted_at timestamptz;

-- The current report form accepts one optional photo per report.
create unique index if not exists report_attachments_one_per_report_idx
  on public.report_attachments (report_id);

create table if not exists public.public_report_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.public_report_rate_limits enable row level security;
revoke all on public.public_report_rate_limits from public, anon, authenticated;
grant all on public.public_report_rate_limits to service_role;

create or replace function public.safex_consume_report_limit(
  p_bucket_key text,
  p_window_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if p_limit < 1 or p_limit > 100 or length(p_bucket_key) < 32 or length(p_bucket_key) > 128 then
    raise exception 'invalid rate limit arguments';
  end if;

  delete from public.public_report_rate_limits
    where window_started_at < now() - interval '48 hours';

  insert into public.public_report_rate_limits (bucket_key, window_started_at, request_count)
    values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key) do update
      set request_count = public.public_report_rate_limits.request_count + 1,
          updated_at = now()
      where public.public_report_rate_limits.request_count < p_limit
    returning request_count <= p_limit into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;
revoke all on function public.safex_consume_report_limit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.safex_consume_report_limit(text, timestamptz, integer) to service_role;

-- Original evidence remains private; the browser and service worker never cache API responses.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'safex-report-attachments',
  'safex-report-attachments',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- SOURCE: supabase/migrations/202610050003_employee_master_sync.sql
-- Employee master synchronisation support.
-- Apply after 202610030001_initial_safex.sql. Safe to re-run.
--
-- The roster carries personal data. These columns stay server-side: none of them are
-- granted to anon/authenticated, so a browser can never select them even with a session.
-- blood_group in particular is health data and must only ever reach an authorised
-- first-aid/SOS flow, never the public directory.

alter table public.employees
  add column if not exists safety_pass_no text,
  add column if not exists skill_grade    text,
  add column if not exists blood_group    text,
  add column if not exists home_address   text,
  -- Where the row came from, so a hand-edited record is not silently overwritten.
  add column if not exists source         text not null default 'manual',
  add column if not exists synced_at      timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'employees_source_check'
  ) then
    alter table public.employees
      add constraint employees_source_check
      check (source in ('manual', 'employee_master_sync'));
  end if;
end $$;

-- Case-insensitive Employee ID lookup, which is how every lookup actually arrives.
create index if not exists employees_employee_no_lower_idx
  on public.employees (tenant_id, upper(employee_no));

-- Audit trail for every import run. Service-role only.
create table if not exists public.employee_master_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  site_id uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_label text,
  rows_read integer not null default 0,
  rows_upserted integer not null default 0,
  rows_deactivated integer not null default 0,
  rows_skipped integer not null default 0,
  issue_count integer not null default 0,
  ok boolean not null default false,
  error_text text,
  foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete set null
);

alter table public.employee_master_sync_runs enable row level security;
revoke all on public.employee_master_sync_runs from public, anon, authenticated;
grant all  on public.employee_master_sync_runs to service_role;

-- Re-assert the narrow browser grant. The new columns are deliberately absent.
revoke all on public.employees from anon, authenticated;
grant select (id, tenant_id, site_id, employee_no, full_name, designation, department, active)
  on public.employees to authenticated;
grant all on public.employees to service_role;


-- SOURCE: supabase/sql/02_rls.sql
-- =====================================================================================
-- Safex · 02_rls.sql · RESUMABLE / RE-RUNNABLE row-level-security hardening
-- =====================================================================================
-- Why this file exists
--   The Supabase SQL editor aborts long scripts, and a half-applied security script is
--   worse than none. Every PART below is INDEPENDENTLY RUNNABLE and IDEMPOTENT, and each
--   one records itself in public.safex_sql_apply_log when it finishes. If a run dies in
--   the middle, re-run the whole file (or just the remaining PARTs) — finished PARTs are
--   cheap no-ops.
--
-- Order of operations
--   1. supabase/migrations/202610030001_initial_safex.sql   (tables / schema)
--   2. supabase/migrations/202610030002_offline_report_sync.sql (offline sync additions)
--   3. THIS FILE                                            (grants + RLS + policies)
--   4. supabase/sql/99_gate_test.sql                        (pass/fail gate; must be all PASS)
--
-- Where did I stop?  Run PART 0 on its own; the final SELECT lists applied PARTs.
--
-- This script needs no service-role key. Run it as the project owner in the SQL editor.
-- =====================================================================================


-- =====================================================================================
-- PART 0 · Apply ledger + preflight. Safe to run at any time; run alone to see progress.
-- =====================================================================================
create table if not exists public.safex_sql_apply_log (
  script_name text not null,
  part_name   text not null,
  applied_at  timestamptz not null default now(),
  primary key (script_name, part_name)
);

alter table public.safex_sql_apply_log enable row level security;
revoke all on public.safex_sql_apply_log from public, anon, authenticated;
grant all on public.safex_sql_apply_log to service_role;

create or replace function public.safex_mark_sql_part(p_script text, p_part text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.safex_sql_apply_log (script_name, part_name)
  values (p_script, p_part)
  on conflict (script_name, part_name) do update set applied_at = now();
$$;
revoke all on function public.safex_mark_sql_part(text, text) from public, anon, authenticated;

-- Preflight: fail loudly and early if the schema migration was never applied, instead of
-- erroring halfway through the grant/policy parts.
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ' order by t) into v_missing
  from unnest(array[
    'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
    'employees', 'staff_memberships', 'reports', 'report_attachments',
    'report_status_events', 'push_subscriptions'
  ]) as t
  where to_regclass('public.' || t) is null;

  if v_missing is not null then
    raise exception using
      errcode = 'undefined_table',
      message = format('Safex schema is incomplete; missing table(s): %s', v_missing),
      hint    = 'Apply supabase/migrations/202610030001_initial_safex.sql before running 02_rls.sql.';
  end if;
end $$;

select public.safex_mark_sql_part('02_rls.sql', 'PART 0 · ledger + preflight');

-- Progress report. Re-run PART 0 alone whenever you want to know where a run stopped.
select part_name, applied_at
from public.safex_sql_apply_log
where script_name = '02_rls.sql'
order by part_name;


-- =====================================================================================
-- PART 1 · Access-check helper functions (SECURITY DEFINER, pinned search_path)
-- =====================================================================================
create or replace function public.safex_has_site_access(p_tenant_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.active = true
      and (m.site_id = p_site_id or m.role in ('vendor_admin', 'tenant_admin'))
  );
$$;

create or replace function public.safex_is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.staff_memberships m
    where m.user_id = auth.uid()
      and m.tenant_id = p_tenant_id
      and m.active = true
      and m.role in ('vendor_admin', 'tenant_admin')
  );
$$;

create or replace function public.safex_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.safex_platform_admins a
    where a.user_id = auth.uid() and a.active = true
  );
$$;

revoke all on function public.safex_has_site_access(uuid, uuid) from public, anon;
revoke all on function public.safex_is_tenant_admin(uuid)       from public, anon;
revoke all on function public.safex_is_platform_admin()         from public, anon;
grant execute on function public.safex_has_site_access(uuid, uuid) to authenticated;
grant execute on function public.safex_is_tenant_admin(uuid)       to authenticated;
grant execute on function public.safex_is_platform_admin()         to authenticated;

select public.safex_mark_sql_part('02_rls.sql', 'PART 1 · helper functions');


-- =====================================================================================
-- PART 2 · Enable RLS on every Safex table (idempotent)
-- =====================================================================================
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
    'employees', 'staff_memberships', 'reports', 'report_attachments',
    'report_status_events', 'push_subscriptions', 'public_report_rate_limits',
    'safex_sql_apply_log', 'employee_master_sync_runs'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable row level security', v_table);
    end if;
  end loop;
end $$;

select public.safex_mark_sql_part('02_rls.sql', 'PART 2 · enable RLS');


-- =====================================================================================
-- PART 3 · Deny by default. Browser roles lose every direct table grant.
-- =====================================================================================
-- Nothing below relies on "anon can read a safe view". Public site directories, worker
-- summaries and employee lookups are served by validated server routes instead.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
    'employees', 'staff_memberships', 'reports', 'report_attachments',
    'report_status_events', 'push_subscriptions', 'public_report_rate_limits',
    'safex_sql_apply_log', 'employee_master_sync_runs'
  ]
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('revoke all on public.%I from anon, authenticated', v_table);
      execute format('grant all on public.%I to service_role', v_table);
    end if;
  end loop;
end $$;

select public.safex_mark_sql_part('02_rls.sql', 'PART 3 · revoke browser grants');


-- =====================================================================================
-- PART 4 · Narrow grants back to signed-in staff. RLS still filters every row.
-- =====================================================================================
-- employees: the registered mobile number is deliberately NOT column-granted.
grant select on public.sites            to authenticated;
grant select (id, tenant_id, site_id, employee_no, full_name, designation, department, active)
  on public.employees                   to authenticated;
grant select on public.staff_memberships to authenticated;
grant select, insert, update on public.reports              to authenticated;
grant select, insert, update on public.report_attachments   to authenticated;
grant select, insert         on public.report_status_events to authenticated;

select public.safex_mark_sql_part('02_rls.sql', 'PART 4 · staff grants');


-- =====================================================================================
-- PART 5 · Policies. Dropped-then-created so a re-run always converges on this file.
-- =====================================================================================
drop policy if exists safex_platform_manage_tenants on public.tenants;
create policy safex_platform_manage_tenants on public.tenants for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_platform_manage_domains on public.tenant_domains;
create policy safex_platform_manage_domains on public.tenant_domains for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_platform_manage_sites on public.sites;
create policy safex_platform_manage_sites on public.sites for all to authenticated
  using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists staff_sites_read on public.sites;
create policy staff_sites_read on public.sites for select to authenticated
  using (public.safex_has_site_access(tenant_id, id));

drop policy if exists staff_employee_directory_read on public.employees;
create policy staff_employee_directory_read on public.employees for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_memberships_read_self on public.staff_memberships;
create policy staff_memberships_read_self on public.staff_memberships for select to authenticated
  using (user_id = auth.uid() or public.safex_is_tenant_admin(tenant_id));

drop policy if exists staff_reports_read on public.reports;
create policy staff_reports_read on public.reports for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_reports_insert on public.reports;
create policy staff_reports_insert on public.reports for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_reports_update on public.reports;
create policy staff_reports_update on public.reports for update to authenticated
  using (public.safex_has_site_access(tenant_id, site_id))
  with check (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_attachments_read on public.report_attachments;
create policy staff_attachments_read on public.report_attachments for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_attachments_write on public.report_attachments;
create policy staff_attachments_write on public.report_attachments for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_attachments_update on public.report_attachments;
create policy staff_attachments_update on public.report_attachments for update to authenticated
  using (public.safex_has_site_access(tenant_id, site_id))
  with check (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_report_status_read on public.report_status_events;
create policy staff_report_status_read on public.report_status_events for select to authenticated
  using (public.safex_has_site_access(tenant_id, site_id));

drop policy if exists staff_report_status_insert on public.report_status_events;
create policy staff_report_status_insert on public.report_status_events for insert to authenticated
  with check (public.safex_has_site_access(tenant_id, site_id));

-- Intentionally NO authenticated policy on: tenant_features, push_subscriptions,
-- safex_platform_admins, public_report_rate_limits, safex_sql_apply_log,
-- employee_master_sync_runs.
-- Those stay service-role-only until ownership and audit trails are designed.

select public.safex_mark_sql_part('02_rls.sql', 'PART 5 · policies');


-- =====================================================================================
-- PART 6 · Rate-limit routine stays server-only (no-op if 0002 was not applied yet)
-- =====================================================================================
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'safex_consume_report_limit'
  ) then
    execute 'revoke all on function public.safex_consume_report_limit(text, timestamptz, integer) from public, anon, authenticated';
    execute 'grant execute on function public.safex_consume_report_limit(text, timestamptz, integer) to service_role';
  else
    raise notice 'safex_consume_report_limit() not found - apply 202610030002_offline_report_sync.sql before enabling report sync.';
  end if;
end $$;

select public.safex_mark_sql_part('02_rls.sql', 'PART 6 · rate-limit grants');


-- =====================================================================================
-- PART 7 · Summary. Read this before you call the hardening done.
-- =====================================================================================
select public.safex_mark_sql_part('02_rls.sql', 'PART 7 · complete');

select
  c.relname                                                as table_name,
  c.relrowsecurity                                         as rls_enabled,
  coalesce((select count(*) from pg_policies p
            where p.schemaname = 'public' and p.tablename = c.relname), 0) as policy_count,
  coalesce(array_to_string(array(
    select distinct a.privilege_type
    from information_schema.role_table_grants a
    where a.table_schema = 'public' and a.table_name = c.relname and a.grantee = 'anon'
    order by 1
  ), ','), '') as anon_grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
    'employees', 'staff_memberships', 'reports', 'report_attachments',
    'report_status_events', 'push_subscriptions', 'public_report_rate_limits',
    'safex_sql_apply_log', 'employee_master_sync_runs'
  )
order by c.relname;


-- Company and the only operational site. Company name matches current app branding.
insert into public.tenants (company_name, slug)
values ('EMVEESS Safety', 'emveess')
on conflict (slug) do nothing;

insert into public.sites (tenant_id, slug, name, region, active)
select id, 'west-bokaro', 'West Bokaro (WBD)', 'Ghatotand, Ramgarh', true
from public.tenants where slug = 'emveess'
on conflict (tenant_id, slug) do nothing;

select t.company_name, s.name as site_name, s.slug as site_slug
from public.tenants t join public.sites s on s.tenant_id = t.id
where t.slug = 'emveess' and s.slug = 'west-bokaro';
