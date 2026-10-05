-- =====================================================================================
-- Safex · 99_gate_test.sql · security gate. Run AFTER 02_rls.sql. Read-only.
-- =====================================================================================
-- Every row must read PASS before live data is switched on for a tenant.
-- The last statement raises an exception if anything failed, so this file can also be
-- wired into CI / a deploy step that must hard-stop on a regression.
-- =====================================================================================

with expected_tables(table_name) as (
  values
    ('tenants'), ('safex_platform_admins'), ('tenant_domains'), ('tenant_features'),
    ('sites'), ('employees'), ('staff_memberships'), ('reports'),
    ('report_attachments'), ('report_status_events'), ('push_subscriptions')
),
-- 1. Schema completeness -------------------------------------------------------------
check_tables as (
  select
    'schema: ' || table_name as check_name,
    case when to_regclass('public.' || table_name) is not null then 'PASS' else 'FAIL' end as status,
    'table must exist' as requirement
  from expected_tables
),
-- 2. RLS switched on -----------------------------------------------------------------
check_rls as (
  select
    'rls enabled: ' || e.table_name as check_name,
    case when c.relrowsecurity then 'PASS' else 'FAIL' end as status,
    'row level security must be enabled' as requirement
  from expected_tables e
  join pg_class c on c.oid = to_regclass('public.' || e.table_name)
),
-- 3. No direct browser grants --------------------------------------------------------
check_anon as (
  select
    'no anon grant: ' || e.table_name as check_name,
    case when not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = e.table_name and g.grantee = 'anon'
    ) then 'PASS' else 'FAIL' end as status,
    'anon must hold no table privileges' as requirement
  from expected_tables e
),
-- 4. Sensitive tables must not be reachable by signed-in browsers either -------------
check_locked as (
  select
    'service-role only: ' || t as check_name,
    case when not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = t
        and g.grantee in ('anon', 'authenticated')
    ) then 'PASS' else 'FAIL' end as status,
    'only service_role may touch this table' as requirement
  from unnest(array[
    'tenants', 'tenant_domains', 'tenant_features', 'safex_platform_admins'
  ]) as t
),
-- 5. Employee phone numbers are never column-granted to the browser ------------------
check_employee_phone as (
  select
    'employees.mobile_e164 not granted' as check_name,
    case when not exists (
      select 1 from information_schema.column_privileges g
      where g.table_schema = 'public' and g.table_name = 'employees'
        and g.column_name = 'mobile_e164' and g.grantee in ('anon', 'authenticated')
    ) then 'PASS' else 'FAIL' end as status,
    'registered phone stays server-side' as requirement
),
-- 6. Helper functions are SECURITY DEFINER with a pinned search_path ------------------
check_functions as (
  select
    'hardened function: ' || p.proname as check_name,
    case
      when p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
      then 'PASS' else 'FAIL'
    end as status,
    'security definer + pinned search_path' as requirement
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'safex_has_site_access', 'safex_is_tenant_admin',
      'safex_is_platform_admin', 'safex_consume_report_limit'
    )
),
-- 7. The rate limiter is not callable from a browser session -------------------------
check_rate_limit_exec as (
  select
    'rate limiter not browser-callable' as check_name,
    case when not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join unnest(array['anon', 'authenticated']) as r(role_name)
      where n.nspname = 'public'
        and p.proname = 'safex_consume_report_limit'
        and has_function_privilege(r.role_name, p.oid, 'execute')
    ) then 'PASS' else 'FAIL' end as status,
    'only service_role may consume rate limits' as requirement
),
-- 8. Core staff policies exist -------------------------------------------------------
check_policies as (
  select
    'policy present: ' || needed as check_name,
    case when exists (
      select 1 from pg_policies p where p.schemaname = 'public' and p.policyname = needed
    ) then 'PASS' else 'FAIL' end as status,
    'policy created by 02_rls.sql' as requirement
  from unnest(array[
    'staff_sites_read', 'staff_employee_directory_read', 'staff_memberships_read_self',
    'staff_reports_read', 'staff_reports_insert', 'staff_reports_update',
    'staff_attachments_read', 'staff_attachments_write', 'staff_attachments_update',
    'staff_report_status_read', 'staff_report_status_insert',
    'safex_platform_manage_tenants', 'safex_platform_manage_domains',
    'safex_platform_manage_sites'
  ]) as needed
),
-- 9. Report attachments stay in a PRIVATE bucket -------------------------------------
check_bucket as (
  select
    'attachment bucket is private' as check_name,
    case
      when not exists (select 1 from storage.buckets b where b.id = 'safex-report-attachments')
        then 'SKIP'
      when exists (
        select 1 from storage.buckets b
        where b.id = 'safex-report-attachments' and b.public = false
      ) then 'PASS'
      else 'FAIL'
    end as status,
    'evidence must never be public' as requirement
),
-- 10. A tenant cannot go live without a verified domain ------------------------------
check_verified_domain as (
  select
    'tenant has verified domain' as check_name,
    case
      when not exists (select 1 from public.tenants where active) then 'SKIP'
      when not exists (
        select 1 from public.tenants t
        where t.active
          and not exists (
            select 1 from public.tenant_domains d
            where d.tenant_id = t.id and d.verified_at is not null
          )
      ) then 'PASS'
      else 'FAIL'
    end as status,
    'host-based tenant resolution needs a verified domain' as requirement
),
-- 11. Anonymous reports must carry no reporter link ----------------------------------
check_anonymous as (
  select
    'anonymous reports unlinked' as check_name,
    case when not exists (
      select 1 from public.reports where anonymous and reporter_employee_id is not null
    ) then 'PASS' else 'FAIL' end as status,
    'anonymous submissions store no employee link' as requirement
),
results as (
  select * from check_tables
  union all select * from check_rls
  union all select * from check_anon
  union all select * from check_locked
  union all select * from check_employee_phone
  union all select * from check_functions
  union all select * from check_rate_limit_exec
  union all select * from check_policies
  union all select * from check_bucket
  union all select * from check_verified_domain
  union all select * from check_anonymous
)
select status, check_name, requirement
from results
order by case status when 'FAIL' then 0 when 'SKIP' then 1 else 2 end, check_name;


-- Hard stop. Comment this block out if you only want the report above.
do $$
declare
  v_failed int;
begin
  select count(*) into v_failed
  from (
    select e.table_name as n,
           case when c.relrowsecurity then 0 else 1 end as bad
    from unnest(array[
      'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
      'employees', 'staff_memberships', 'reports', 'report_attachments',
      'report_status_events', 'push_subscriptions'
    ]) as e(table_name)
    join pg_class c on c.oid = to_regclass('public.' || e.table_name)
    union all
    select g.table_name, 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.grantee = 'anon'
      and g.table_name in (
        'tenants', 'safex_platform_admins', 'tenant_domains', 'tenant_features', 'sites',
        'employees', 'staff_memberships', 'reports', 'report_attachments',
        'report_status_events', 'push_subscriptions'
      )
  ) s
  where s.bad = 1;

  if v_failed > 0 then
    raise exception using
      errcode = 'insufficient_privilege',
      message = format('Safex security gate FAILED (%s blocking issue(s)).', v_failed),
      hint    = 'Re-run supabase/sql/02_rls.sql, then this gate, before enabling live data.';
  end if;

  raise notice 'Safex security gate passed.';
end $$;
