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
