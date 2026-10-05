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
