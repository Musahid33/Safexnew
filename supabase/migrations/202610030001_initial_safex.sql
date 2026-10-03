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
