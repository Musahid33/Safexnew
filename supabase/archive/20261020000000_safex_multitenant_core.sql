-- ARCHIVED / DO NOT APPLY to the SafexNew project.
-- This was the original greenfield multi-tenant draft. The live SafexNew database already
-- has tenants/sites/employees/reports; applying this file would attempt to create
-- incompatible replacement tables. It is kept only as design history.
-- The applied additive migration is supabase/migrations/20261020171922_safex_existing_schema_extension.sql.
--
-- Safex / EMVEESS Safety Portal: shared-database, multi-tenant Supabase schema
-- Historical draft only: never run this on the live SafexNew project.
-- Tenant/site business rows always carry NOT NULL company_id + location_id.
-- company_code and location_name are canonical in companies/locations and are
-- exposed alongside the IDs through the v_* read views (no denormalized drift).

begin;

-- -----------------------------------------------------------------------------
-- 1. Tenant and identity foundation
-- -----------------------------------------------------------------------------

create table public.companies (
  company_id uuid primary key default gen_random_uuid(),
  company_code text not null,
  company_name text not null,
  slug text not null,
  status text not null default 'provisioning'
    check (status in ('provisioning', 'trial', 'active', 'suspended', 'archived')),
  timezone text not null default 'Asia/Kolkata',
  default_language text not null default 'en',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_code_not_blank check (length(trim(company_code)) > 0),
  constraint companies_name_not_blank check (length(trim(company_name)) > 0),
  constraint companies_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create unique index companies_company_code_ci_uidx on public.companies (lower(company_code));
create unique index companies_slug_ci_uidx on public.companies (lower(slug));

create table public.locations (
  location_id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(company_id) on delete cascade,
  location_code text not null,
  location_name text not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  is_primary boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_code_not_blank check (length(trim(location_code)) > 0),
  constraint locations_name_not_blank check (length(trim(location_name)) > 0),
  -- Composite key is used by site-scoped tables to prevent cross-company links.
  constraint locations_company_location_id_uk unique (company_id, location_id)
);

create unique index locations_company_code_ci_uidx
  on public.locations (company_id, lower(location_code));
create unique index locations_one_primary_per_company_uidx
  on public.locations (company_id) where is_primary;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  employee_code text not null,
  full_name text not null,
  designation text,
  department_name text,
  email text,
  mobile text,
  auth_user_id uuid references auth.users(id) on delete set null,
  employment_status text not null default 'active'
    check (employment_status in ('active', 'inactive', 'left', 'suspended')),
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employees_company_location_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint employees_company_id_id_uk unique (company_id, id),
  constraint employees_code_not_blank check (length(trim(employee_code)) > 0),
  constraint employees_name_not_blank check (length(trim(full_name)) > 0)
);

create unique index employees_company_code_ci_uidx
  on public.employees (company_id, lower(employee_code));
create unique index employees_company_auth_user_uidx
  on public.employees (company_id, auth_user_id) where auth_user_id is not null;
create index employees_company_location_idx on public.employees (company_id, location_id);

create table public.company_memberships (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('company_admin', 'safety_manager', 'auditor', 'billing_admin')),
  employee_id uuid,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id),
  constraint company_memberships_employee_fk
    foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete restrict
);

create table public.location_memberships (
  company_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('site_admin', 'site_manager', 'employee', 'contractor', 'report_viewer')),
  employee_id uuid,
  created_at timestamptz not null default now(),
  primary key (company_id, location_id, user_id),
  constraint location_memberships_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint location_memberships_employee_fk
    foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete restrict
);

create index company_memberships_user_idx on public.company_memberships (user_id, company_id);
create index location_memberships_user_idx on public.location_memberships (user_id, company_id, location_id);

-- These SECURITY DEFINER helpers avoid recursive RLS evaluation on membership tables.
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.has_company_access(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.company_memberships cm
      where cm.company_id = p_company_id and cm.user_id = auth.uid()
    )
    or exists (
      select 1 from public.location_memberships lm
      where lm.company_id = p_company_id and lm.user_id = auth.uid()
    );
$$;

create or replace function public.can_manage_company(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.role = 'company_admin'
    );
$$;

create or replace function public.has_location_access(p_company_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.role in ('company_admin', 'safety_manager', 'auditor')
    )
    or exists (
      select 1 from public.location_memberships lm
      where lm.company_id = p_company_id
        and lm.location_id = p_location_id
        and lm.user_id = auth.uid()
    );
$$;

create or replace function public.can_manage_location(p_company_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_platform_admin()
    or exists (
      select 1 from public.company_memberships cm
      where cm.company_id = p_company_id
        and cm.user_id = auth.uid()
        and cm.role in ('company_admin', 'safety_manager')
    )
    or exists (
      select 1 from public.location_memberships lm
      where lm.company_id = p_company_id
        and lm.location_id = p_location_id
        and lm.user_id = auth.uid()
        and lm.role in ('site_admin', 'site_manager')
    );
$$;

create or replace function public.is_active_company(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.companies c
    where c.company_id = p_company_id and c.status = 'active'
  );
$$;

create or replace function public.is_active_site(p_company_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.locations l
    join public.companies c on c.company_id = l.company_id
    where l.company_id = p_company_id
      and l.location_id = p_location_id
      and l.status = 'active'
      and c.status = 'active'
  );
$$;

-- Policy helpers are callable by API roles only where required; all return booleans.
-- Most must remain executable by anon because published-content RLS includes a manager/access
-- branch that evaluates to false for guests. No helper returns a row or a secret value.
revoke all on function public.is_platform_admin() from public, anon, authenticated;
revoke all on function public.has_company_access(uuid) from public, anon, authenticated;
revoke all on function public.can_manage_company(uuid) from public, anon, authenticated;
revoke all on function public.has_location_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.can_manage_location(uuid, uuid) from public, anon, authenticated;
revoke all on function public.is_active_company(uuid) from public, anon, authenticated;
revoke all on function public.is_active_site(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_company_access(uuid) to anon, authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;
grant execute on function public.has_location_access(uuid, uuid) to anon, authenticated;
grant execute on function public.can_manage_location(uuid, uuid) to anon, authenticated;
grant execute on function public.is_active_company(uuid) to anon, authenticated;
grant execute on function public.is_active_site(uuid, uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Shared frontend / tenant configuration / one-click template
-- -----------------------------------------------------------------------------

create table public.feature_catalog (
  feature_key text primary key,
  display_name text not null,
  section_key text not null,
  section_label text not null,
  description text not null default '',
  route text,
  parent_feature_key text,
  sort_order integer not null default 0,
  is_core boolean not null default false,
  is_tenant_toggleable boolean not null default true,
  default_enabled boolean not null default true,
  is_active boolean not null default true,
  settings_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings_schema) = 'object'),
  created_at timestamptz not null default now()
);

insert into public.feature_catalog
  (feature_key, display_name, section_key, section_label, description, route,
   parent_feature_key, sort_order, is_core, is_tenant_toggleable, default_enabled)
values
  ('safety_portal', 'Safety Portal', 'safety_home', 'SAFETY HOME',
   'Main company safety landing page.', '/', null, 10, true, false, true),
  ('safety_reports', 'Report a safety concern', 'take_action', 'TAKE ACTION',
   'Safety concern submission entry point.', '/', 'safety_portal', 20, true, false, true),
  ('near_miss', 'Near Miss', 'take_action', 'TAKE ACTION',
   'A close call worth reporting.', '/', 'safety_reports', 21, false, true, true),
  ('hazard', 'Hazard', 'take_action', 'TAKE ACTION',
   'Report a hazard, accident, property damage or red-risk incident.', '/', 'safety_reports', 22, false, true, true),
  ('safety_observation', 'Safety Observation', 'take_action', 'TAKE ACTION',
   'Unsafe condition, unsafe act or positive safety observation.', '/', 'safety_reports', 23, false, true, true),
  ('feedback', 'Feedback', 'take_action', 'TAKE ACTION',
   'Share feedback about PPE, tools, training, welfare or closure.', '/', 'safety_reports', 24, false, true, true),
  ('grievance_speak_up', 'Grievance / Speak Up', 'take_action', 'TAKE ACTION',
   'Grievance workflow and optional anonymous Speak Up.', '/', 'safety_reports', 25, false, true, true),
  ('suggestion', 'Suggestion', 'take_action', 'TAKE ACTION',
   'Share a safer-work idea.', '/', 'safety_reports', 26, false, true, true),
  ('view_reports', 'View Reports', 'quick_access', 'QUICK ACCESS',
   'Track report ID, type, area and Open / In Progress / Closed status.', '/reports', 'safety_portal', 30, false, true, true),
  ('training_management', 'Training Management', 'quick_access', 'QUICK ACCESS',
   'Videos, learning modules and employee progress.', '/training', 'safety_portal', 31, false, true, true),
  ('safety_alerts', 'Safety Alerts', 'quick_access', 'QUICK ACCESS',
   'Incident alerts, controls and lessons learned.', '/alerts', 'safety_portal', 32, false, true, true),
  ('circulars_notices', 'Circulars & Notices', 'quick_access', 'QUICK ACCESS',
   'Published site circulars and notices.', '/updates', 'safety_portal', 33, false, true, true),
  ('upcoming_events', 'Upcoming Events', 'quick_access', 'QUICK ACCESS',
   'Upcoming training, awareness and site events.', '/events', 'safety_portal', 34, false, true, true),
  ('document_vault', 'Document Vault / Library', 'library', 'DOCUMENT VAULT / LIBRARY',
   'SOP / SWP, risk assessments, legal compliance, policies and MoM.', '/documents', 'safety_portal', 40, false, true, true),
  ('life_saving_rules', 'LIFE SAVING RULE', 'safety_home', 'SAFETY HOME',
   'Location-specific life-saving rules.', '/', 'safety_portal', 11, false, true, true),
  ('rewards_recognition', 'Rewards & Recognition Gallery', 'recognition', 'RECOGNITION',
   'Published safety awards and recognition images.', '/', 'safety_portal', 50, false, true, true),
  ('sos_emergency_contact', 'SOS emergency contact', 'header', 'HEADER',
   'Verified emergency contact for the selected location.', '/', 'safety_portal', 5, false, true, true),
  ('push_notifications', 'Push notifications', 'device_settings', 'DEVICE SETTINGS',
   'Safety alerts, site updates, report status and privacy preferences.', '/settings/notifications', 'safety_portal', 60, false, true, true),
  ('install_app', 'Install App', 'more', 'MORE',
   'Install the shared portal as a PWA.', '/more', 'safety_portal', 70, false, false, true),
  ('company_profile', 'Vendor / Company About Us', 'more', 'MORE',
   'Company profile, services, contact and support.', '/company', 'safety_portal', 71, false, true, true),
  ('employee_directory', 'Search Employee Profile', 'more', 'MORE',
   'Find an employee using their Employee ID.', '/employees', 'safety_portal', 72, false, true, true),
  ('account_login', 'Account Login', 'more', 'MORE',
   'Login, logout, password and account settings.', '/account', 'safety_portal', 73, false, false, true),
  ('appearance', 'Appearance', 'more', 'MORE',
   'Light Mode, Dark Mode and System Default.', '/more', 'safety_portal', 74, false, false, true),
  ('about_app', 'About App', 'more', 'MORE',
   'App version, policies and support information.', '/more', 'safety_portal', 75, false, false, true);

create table public.tenant_templates (
  template_key text primary key,
  display_name text not null,
  description text not null default '',
  is_active boolean not null default true,
  profile_defaults jsonb not null default '{}'::jsonb
    check (jsonb_typeof(profile_defaults) = 'object'),
  created_at timestamptz not null default now()
);

create table public.template_features (
  template_key text not null references public.tenant_templates(template_key) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  is_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  primary key (template_key, feature_key)
);

insert into public.tenant_templates (template_key, display_name, description)
values ('standard_safety_portal', 'Standard Safety Portal',
        'Baseline template modeled on the public EMVEESS Safety frontend.');

insert into public.template_features (template_key, feature_key, is_enabled)
select 'standard_safety_portal', feature_key, default_enabled
from public.feature_catalog;

create table public.company_features (
  company_id uuid not null references public.companies(company_id) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete restrict,
  is_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, feature_key)
);

create table public.location_feature_overrides (
  company_id uuid not null,
  location_id uuid not null,
  feature_key text not null references public.feature_catalog(feature_key) on delete restrict,
  -- NULL means inherit company setting; true/false explicitly overrides it.
  is_enabled boolean,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id, feature_key),
  constraint location_feature_overrides_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade
);

create table public.company_profiles (
  company_id uuid primary key references public.companies(company_id) on delete cascade,
  display_name text not null,
  logo_path text,
  primary_color text check (primary_color is null or primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color text check (accent_color is null or accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  introduction text,
  services jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array'),
  address text,
  public_email text,
  public_phone text,
  website_url text,
  support_email text,
  support_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_portal_settings (
  company_id uuid not null,
  location_id uuid not null,
  welcome_title text not null default 'Safety Portal',
  welcome_message text not null default 'Report hazards, find safety updates and learn from reports at your selected site.',
  default_language text not null default 'en',
  enabled_languages text[] not null default array['en', 'hi', 'or', 'bn', 'pa', 'mr']::text[],
  allow_public_reports boolean not null default true,
  theme_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_overrides) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id),
  constraint site_portal_settings_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade
);

create table public.site_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  contact_type text not null default 'emergency'
    check (contact_type in ('emergency', 'security', 'medical', 'safety_officer')),
  display_name text,
  phone text not null,
  instructions text,
  is_primary boolean not null default false,
  is_public boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_emergency_contacts_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint site_emergency_contacts_phone_not_blank check (length(trim(phone)) > 0)
);

create unique index site_emergency_contacts_one_primary_uidx
  on public.site_emergency_contacts (company_id, location_id, contact_type)
  where is_primary;

-- -----------------------------------------------------------------------------
-- 3. Report forms and report workflow
-- -----------------------------------------------------------------------------

create table public.report_type_catalog (
  report_type text primary key,
  feature_key text not null references public.feature_catalog(feature_key) on delete restrict,
  display_name text not null,
  description text not null default '',
  supports_categories boolean not null default false,
  allows_anonymous boolean not null default false,
  default_form_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(default_form_schema) = 'object'),
  is_active boolean not null default true
);

insert into public.report_type_catalog
  (report_type, feature_key, display_name, description, supports_categories,
   allows_anonymous, default_form_schema)
values
  ('near_miss', 'near_miss', 'Near Miss', 'A close call worth reporting.', false, false,
   '{"fields":[{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"area_label","label":"Location / area","type":"text","required":true},{"key":"department_name","label":"Department","type":"text","required":true},{"key":"occurred_at","label":"Date & time of incident","type":"datetime","required":true},{"key":"description","label":"Description of Incident","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('hazard', 'hazard', 'Hazard', 'Hazard, accident, property damage or red-risk incident.', true, false,
   '{"fields":[{"key":"category_id","label":"Hazard category","type":"category","required":true},{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"area_label","label":"Location / area","type":"text","required":true},{"key":"department_name","label":"Department","type":"text","required":false},{"key":"occurred_at","label":"Date & time of incident","type":"datetime","required":true},{"key":"description","label":"Description of Hazard","type":"textarea","required":true},{"key":"severity","label":"Severity rating","type":"select","required":true,"options":["low","medium","high"]},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('safety_observation', 'safety_observation', 'Safety Observation', 'Unsafe condition, unsafe act or positive safety observation.', true, false,
   '{"fields":[{"key":"category_id","label":"Observation category","type":"category","required":true},{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"area_label","label":"Location / area","type":"text","required":true},{"key":"occurred_at","label":"Date & time of incident","type":"datetime","required":true},{"key":"description","label":"Description of observation","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('feedback', 'feedback', 'Feedback', 'Feedback about PPE, tools, training, welfare or report closure.', true, false,
   '{"fields":[{"key":"category_id","label":"Feedback category","type":"category","required":true},{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Feedback","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('grievance', 'grievance_speak_up', 'Grievance', 'Employee grievance; identity is required.', true, false,
   '{"fields":[{"key":"category_id","label":"Grievance category","type":"category","required":true},{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Description of grievance","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('speak_up', 'grievance_speak_up', 'Speak Up', 'Confidential concern with optional anonymous submission.', false, true,
   '{"fields":[{"key":"is_anonymous","label":"Submit anonymously","type":"boolean","required":false,"default":true},{"key":"area_label","label":"Location / area","type":"text","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Your Concern / Issue","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('suggestion', 'suggestion', 'Suggestion', 'Suggestions to improve safety.', true, false,
   '{"fields":[{"key":"category_id","label":"Suggestion category","type":"category","required":true},{"key":"reporter","label":"Your Name / Employee ID","type":"employee_lookup","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Suggestion","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}');

create table public.report_category_defaults (
  report_type text not null references public.report_type_catalog(report_type) on delete cascade,
  category_key text not null,
  display_name text not null,
  description text not null default '',
  icon text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  primary key (report_type, category_key)
);

insert into public.report_category_defaults
  (report_type, category_key, display_name, description, icon, sort_order)
values
  ('hazard', 'reporting_accident', 'Reporting Accident', 'An incident or accident that needs to be recorded.', '⚠️', 1),
  ('hazard', 'property_damage', 'Property Damage', 'Damage to equipment, tools, or site property.', '🏗️', 2),
  ('hazard', 'red_risk_incident', 'Red Risk Incident', 'A high-potential or critical safety event.', '🔥', 3),
  ('safety_observation', 'unsafe_condition', 'UC · Unsafe Condition', 'Report an unsafe condition observed at work.', '⚠️', 1),
  ('safety_observation', 'unsafe_act', 'UA · Unsafe Act', 'Report an unsafe act or behaviour observed.', '🚧', 2),
  ('safety_observation', 'safe_observation', 'Safe Observation · Good practice', 'Recognize a safe act or good safety practice.', '✅', 3),
  ('feedback', 'ppe', 'PPE · Personal protective equipment', 'Fit, comfort, quality, or availability.', '👕', 1),
  ('feedback', 'tools_tackles_equipment', 'Tools, tackles & equipment', 'Condition, suitability, or availability.', '🔧', 2),
  ('feedback', 'training_feedback', 'Training feedback', 'Training content, delivery, or effectiveness.', '📚', 3),
  ('feedback', 'grievance_feedback', 'Grievance feedback', 'Feedback about an existing concern.', '😞', 4),
  ('feedback', 'amenities_welfare', 'Amenities & welfare', 'Canteen, facilities, or welfare services.', '🏢', 5),
  ('feedback', 'observation_closure', 'Observation closure', 'Feedback on an observation or incident closure.', '✅', 6),
  ('grievance', 'welfare', 'Welfare', 'Welfare services or support.', '💝', 1),
  ('grievance', 'amenities', 'Amenities', 'Facilities, canteen, water, or sanitation.', '🏢', 2),
  ('grievance', 'wages_salary', 'Wages / salary', 'A concern about wages or salary.', '💰', 3),
  ('grievance', 'safety_concerns', 'Safety concerns', 'A workplace safety concern.', '🛡️', 4),
  ('grievance', 'workplace_issues', 'Workplace issues', 'A concern about work conditions.', '🏭', 5),
  ('grievance', 'other', 'Other', 'Another workplace concern.', '❓', 6),
  ('suggestion', 'ppe_suggestion', 'PPE suggestion', 'Ideas to improve protective equipment.', '👕', 1),
  ('suggestion', 'training_suggestion', 'Training suggestion', 'Ideas to improve training.', '📚', 2),
  ('suggestion', 'tools_equipment_suggestion', 'Tools & equipment suggestion', 'Ideas to improve tools or equipment.', '🔧', 3);

create table public.report_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_type text not null references public.report_type_catalog(report_type) on delete restrict,
  category_key text not null,
  display_name text not null,
  description text not null default '',
  icon text,
  sort_order integer not null default 0,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_categories_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint report_categories_key_uk unique (company_id, location_id, report_type, category_key),
  constraint report_categories_id_fk_target_uk unique (company_id, location_id, report_type, id)
);

create table public.report_form_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_type text not null references public.report_type_catalog(report_type) on delete restrict,
  category_key text not null default '*',
  field_key text not null,
  display_label text not null,
  field_type text not null
    check (field_type in ('text', 'textarea', 'number', 'select', 'checkbox', 'date', 'datetime', 'employee_lookup', 'image')),
  help_text text,
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_form_fields_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint report_form_fields_options_array check (jsonb_typeof(options) = 'array'),
  constraint report_form_fields_key_uk
    unique (company_id, location_id, report_type, category_key, field_key)
);

create table public.safety_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_reference text not null default (
    'SR-' || to_char(clock_timestamp(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  report_type text not null references public.report_type_catalog(report_type) on delete restrict,
  category_id uuid,
  reporter_employee_id uuid,
  submitted_by uuid references auth.users(id) on delete set null,
  reporter_name_snapshot text,
  reporter_employee_code_snapshot text,
  reporter_designation_snapshot text,
  department_name text,
  area_label text,
  occurred_at timestamptz not null,
  description text not null,
  immediate_action text,
  severity text check (severity is null or severity in ('low', 'medium', 'high')),
  is_anonymous boolean not null default false,
  status text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  assigned_to uuid references auth.users(id) on delete set null,
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  source text not null default 'portal' check (source in ('portal', 'admin', 'import', 'integration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint safety_reports_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint safety_reports_employee_fk
    foreign key (company_id, reporter_employee_id)
    references public.employees(company_id, id) on delete restrict,
  constraint safety_reports_category_fk
    foreign key (company_id, location_id, report_type, category_id)
    references public.report_categories(company_id, location_id, report_type, id) on delete restrict,
  constraint safety_reports_reference_uk unique (company_id, report_reference),
  constraint safety_reports_id_scope_uk unique (company_id, location_id, id),
  constraint safety_reports_anonymous_only_speak_up check (not is_anonymous or report_type = 'speak_up'),
  constraint safety_reports_anonymous_identity_guard check (
    not is_anonymous or (
      submitted_by is null and reporter_employee_id is null
      and reporter_name_snapshot is null
      and reporter_employee_code_snapshot is null
      and reporter_designation_snapshot is null
    )
  ),
  constraint safety_reports_reporter_required check (
    report_type = 'speak_up' or reporter_employee_id is not null
  ),
  constraint safety_reports_category_required check (
    report_type not in ('hazard', 'safety_observation', 'feedback', 'grievance', 'suggestion')
    or category_id is not null
  ),
  constraint safety_reports_description_not_blank check (length(trim(description)) > 0)
);

create index safety_reports_site_status_created_idx
  on public.safety_reports (company_id, location_id, status, created_at desc);
create index safety_reports_site_type_created_idx
  on public.safety_reports (company_id, location_id, report_type, created_at desc);
create index safety_reports_submitter_idx
  on public.safety_reports (submitted_by, created_at desc) where submitted_by is not null;
create index safety_reports_area_idx
  on public.safety_reports (company_id, location_id, lower(area_label)) where area_label is not null;

create table public.safety_report_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_id uuid not null references public.safety_reports(id) on delete cascade,
  status_from text check (status_from is null or status_from in ('open', 'in_progress', 'closed')),
  status_to text check (status_to is null or status_to in ('open', 'in_progress', 'closed')),
  message text not null default '',
  is_internal boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint safety_report_updates_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint safety_report_updates_report_fk
    foreign key (company_id, location_id, report_id)
    references public.safety_reports(company_id, location_id, id) on delete cascade
);

create index safety_report_updates_report_created_idx
  on public.safety_report_updates (report_id, created_at);

create table public.safety_report_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_id uuid not null,
  storage_path text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint safety_report_attachments_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint safety_report_attachments_report_fk
    foreign key (company_id, location_id, report_id)
    references public.safety_reports(company_id, location_id, id) on delete cascade,
  constraint safety_report_attachments_storage_path_uk unique (storage_path)
);

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  report_id uuid not null,
  title text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  completion_notes text,
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corrective_actions_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint corrective_actions_report_fk
    foreign key (company_id, location_id, report_id)
    references public.safety_reports(company_id, location_id, id) on delete cascade,
  constraint corrective_actions_title_not_blank check (length(trim(title)) > 0)
);

create index corrective_actions_due_idx
  on public.corrective_actions (company_id, location_id, status, due_date);

create or replace function public.can_view_safety_report(p_report_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.safety_reports r
    where r.id = p_report_id
      and (
        public.can_manage_location(r.company_id, r.location_id)
        or (r.submitted_by = auth.uid() and not r.is_anonymous)
      )
  );
$$;

create or replace function public.can_manage_safety_report(p_report_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.safety_reports r
    where r.id = p_report_id
      and public.can_manage_location(r.company_id, r.location_id)
  );
$$;

revoke all on function public.can_view_safety_report(uuid) from public, anon;
grant execute on function public.can_view_safety_report(uuid) to authenticated;
revoke all on function public.can_manage_safety_report(uuid) from public, anon;
grant execute on function public.can_manage_safety_report(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Public portal content, library, training and recognition
-- -----------------------------------------------------------------------------

create table public.safety_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  alert_reference text,
  category_key text not null,
  headline text not null,
  incident_at timestamptz not null,
  area_label text,
  department_name text,
  description text not null,
  root_cause text,
  immediate_response jsonb not null default '[]'::jsonb check (jsonb_typeof(immediate_response) = 'array'),
  corrective_actions jsonb not null default '[]'::jsonb check (jsonb_typeof(corrective_actions) = 'array'),
  lessons_learned jsonb not null default '[]'::jsonb check (jsonb_typeof(lessons_learned) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_alerts_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint safety_alerts_headline_not_blank check (length(trim(headline)) > 0)
);

create index safety_alerts_site_published_idx
  on public.safety_alerts (company_id, location_id, incident_at desc)
  where status = 'published';

create table public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  post_type text not null check (post_type in ('circular', 'notice')),
  title text not null,
  summary text not null default '',
  body text not null default '',
  priority text not null default 'normal' check (priority in ('normal', 'important', 'urgent')),
  published_on date,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  expires_at timestamptz,
  attachment_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_announcements_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint site_announcements_title_not_blank check (length(trim(title)) > 0)
);

create index site_announcements_site_published_idx
  on public.site_announcements (company_id, location_id, published_on desc)
  where status = 'published';

create table public.site_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  title text not null,
  topic text,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue text,
  status text not null default 'draft' check (status in ('draft', 'published', 'cancelled', 'completed')),
  published_at timestamptz,
  capacity integer check (capacity is null or capacity > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_events_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint site_events_title_not_blank check (length(trim(title)) > 0),
  constraint site_events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create index site_events_site_start_idx
  on public.site_events (company_id, location_id, starts_at)
  where status = 'published';

create table public.document_category_defaults (
  category_key text primary key,
  display_name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into public.document_category_defaults (category_key, display_name, description, sort_order)
values
  ('sop_swp', 'SOP / SWP', 'Standard & safe work procedures.', 1),
  ('risk_assessments', 'Risk Assessments', 'JHA, HIRA & task risk reviews.', 2),
  ('legal_statutory_compliance', 'Legal & Statutory Compliance', 'Registers, checklists & obligations.', 3),
  ('policy_procedures', 'Policy & Procedures', 'Safety policy and management process.', 4),
  ('minutes_of_meeting', 'Minutes of Meeting (MoM)', 'Safety committee & review meetings.', 5);

create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  category_key text not null,
  display_name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_categories_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint document_categories_key_uk unique (company_id, location_id, category_key),
  constraint document_categories_id_fk_target_uk unique (company_id, location_id, id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  category_id uuid not null,
  document_code text,
  document_type text not null default 'document'
    check (document_type in ('sop', 'swp', 'risk_assessment', 'legal_register', 'policy', 'procedure', 'minutes', 'document')),
  title text not null,
  summary text,
  revision text,
  effective_date date,
  review_due_date date,
  storage_path text,
  original_filename text,
  mime_type text,
  status text not null default 'draft' check (status in ('draft', 'review', 'published', 'superseded', 'archived')),
  published_at timestamptz,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint documents_category_fk
    foreign key (company_id, location_id, category_id)
    references public.document_categories(company_id, location_id, id) on delete restrict,
  constraint documents_title_not_blank check (length(trim(title)) > 0)
);

create index documents_site_category_status_idx
  on public.documents (company_id, location_id, category_id, status, effective_date desc);
create unique index documents_code_ci_uidx
  on public.documents (company_id, location_id, lower(document_code))
  where document_code is not null;

create table public.life_saving_rule_defaults (
  rule_number integer primary key,
  title text not null,
  description text not null,
  sort_order integer not null
);

insert into public.life_saving_rule_defaults (rule_number, title, description, sort_order)
values
  (1, 'Personal Protective Equipment (PPE)', 'Do not work without mandatory Personal Protective Equipment.', 1),
  (2, 'Rail and Road Safety', 'Do not use mobile phones at the workplace unless authorised. Follow traffic rules and keep a safe distance from moving wagons or mobile equipment.', 2),
  (3, 'Safety Control', 'Obtain authorisation from the designated person before overriding any safety control.', 3),
  (4, 'Confined Space', 'Obtain authorisation before entry into a confined space.', 4),
  (5, 'Work Permit and Positive Isolation', 'Obtain a work permit before starting work. Verify energy isolation before work begins and ensure LockOut-TagOut-TryOut (LOTOTO) is in place.', 5),
  (6, 'Heavy Earth Moving Machinery (HEMM) / Blasting / Moving Machinery', 'Maintain a safe distance from HEMM and moving machines. Enter a blasting danger zone only after proper authorisation. Mobile phone use while operating machinery is prohibited.', 6),
  (7, 'Material Handling', 'Follow the standard for material handling and never stand below a suspended load.', 7),
  (8, 'Flammable and Toxic Substances / Ferro Alloy Plant Operation', 'Use a gas detector in hazardous gas areas and follow safety standards when carrying out hot work in a flammable environment.', 8),
  (9, 'Working at Height', 'Use a full-body harness anchored with a rigid connection while working at a height of 2 metres or more.', 9),
  (10, 'Alcohol and Drugs', 'Do not drive or work under the influence of alcohol or drugs.', 10);

create table public.life_saving_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  rule_number integer not null check (rule_number > 0),
  title text not null,
  description text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_saving_rules_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint life_saving_rules_number_uk unique (company_id, location_id, rule_number)
);

create table public.training_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  item_type text not null check (item_type in ('video', 'module', 'course', 'standard')),
  title text not null,
  description text not null default '',
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  resource_url text,
  storage_path text,
  mime_type text,
  sort_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  is_mandatory boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_items_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint training_items_scope_id_uk unique (company_id, location_id, id),
  constraint training_items_title_not_blank check (length(trim(title)) > 0)
);

create index training_items_site_status_idx
  on public.training_items (company_id, location_id, status, sort_order);

create table public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  training_item_id uuid not null references public.training_items(id) on delete cascade,
  employee_id uuid,
  department_name text,
  due_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint training_assignments_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint training_assignments_item_fk
    foreign key (company_id, location_id, training_item_id)
    references public.training_items(company_id, location_id, id) on delete cascade,
  constraint training_assignments_employee_fk
    foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete cascade,
  constraint training_assignments_target_check check (employee_id is not null or department_name is not null)
);

create index training_assignments_employee_due_idx
  on public.training_assignments (company_id, location_id, employee_id, due_at);

create table public.training_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  training_item_id uuid not null,
  employee_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'waived')),
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  started_at timestamptz,
  completed_at timestamptz,
  last_position_seconds integer check (last_position_seconds is null or last_position_seconds >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_progress_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint training_progress_item_fk
    foreign key (company_id, location_id, training_item_id)
    references public.training_items(company_id, location_id, id) on delete cascade,
  constraint training_progress_employee_fk
    foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete cascade,
  constraint training_progress_employee_item_uk unique (company_id, employee_id, training_item_id)
);

create table public.recognition_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  employee_id uuid,
  title text not null,
  caption text,
  award_date date,
  image_path text,
  image_alt text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognition_items_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete restrict,
  constraint recognition_items_employee_fk
    foreign key (company_id, employee_id)
    references public.employees(company_id, id) on delete restrict,
  constraint recognition_items_title_not_blank check (length(trim(title)) > 0)
);

-- -----------------------------------------------------------------------------
-- 5. User settings, notifications and platform audit
-- -----------------------------------------------------------------------------

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  language_code text not null default 'en',
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  notify_safety_alerts boolean not null default true,
  notify_site_updates boolean not null default true,
  notify_report_status boolean not null default true,
  all_vendor_site_updates boolean not null default false,
  hide_lock_screen_details boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint notification_preferences_user_site_uk unique (user_id, company_id, location_id)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  subscription_keys jsonb not null check (jsonb_typeof(subscription_keys) = 'object'),
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete cascade,
  constraint push_subscriptions_endpoint_uk unique (endpoint)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(company_id) on delete set null,
  location_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  constraint audit_events_site_fk
    foreign key (company_id, location_id)
    references public.locations(company_id, location_id) on delete set null
);

create index audit_events_company_created_idx
  on public.audit_events (company_id, created_at desc);

create or replace function public.audit_feature_flag_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_feature_key text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_company_id := old.company_id;
    v_feature_key := old.feature_key;
    v_before := jsonb_build_object('is_enabled', old.is_enabled, 'settings', old.settings);
  else
    v_company_id := new.company_id;
    v_feature_key := new.feature_key;
  end if;

  if tg_table_name = 'location_feature_overrides' then
    if tg_op = 'DELETE' then
      v_location_id := old.location_id;
    else
      v_location_id := new.location_id;
    end if;
  end if;

  if tg_op <> 'DELETE' then
    v_after := jsonb_build_object('is_enabled', new.is_enabled, 'settings', new.settings);
  end if;

  insert into public.audit_events
    (company_id, location_id, actor_user_id, action, resource_type, resource_id, details)
  values
    (v_company_id, v_location_id, auth.uid(), 'feature_flag.changed', tg_table_name,
     v_feature_key, jsonb_build_object('before', v_before, 'after', v_after));

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.audit_feature_flag_change() from public, anon, authenticated;

create trigger company_features_audit
  after insert or update or delete on public.company_features
  for each row execute function public.audit_feature_flag_change();
create trigger location_feature_overrides_audit
  after insert or update or delete on public.location_feature_overrides
  for each row execute function public.audit_feature_flag_change();

-- -----------------------------------------------------------------------------
-- 6. Common updated_at trigger and indexes
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
create trigger locations_set_updated_at before update on public.locations
  for each row execute function public.set_updated_at();
create trigger employees_set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();
create trigger company_features_set_updated_at before update on public.company_features
  for each row execute function public.set_updated_at();
create trigger location_feature_overrides_set_updated_at before update on public.location_feature_overrides
  for each row execute function public.set_updated_at();
create trigger company_profiles_set_updated_at before update on public.company_profiles
  for each row execute function public.set_updated_at();
create trigger site_portal_settings_set_updated_at before update on public.site_portal_settings
  for each row execute function public.set_updated_at();
create trigger site_emergency_contacts_set_updated_at before update on public.site_emergency_contacts
  for each row execute function public.set_updated_at();
create trigger report_categories_set_updated_at before update on public.report_categories
  for each row execute function public.set_updated_at();
create trigger report_form_fields_set_updated_at before update on public.report_form_fields
  for each row execute function public.set_updated_at();
create trigger safety_reports_set_updated_at before update on public.safety_reports
  for each row execute function public.set_updated_at();
create trigger corrective_actions_set_updated_at before update on public.corrective_actions
  for each row execute function public.set_updated_at();
create trigger safety_alerts_set_updated_at before update on public.safety_alerts
  for each row execute function public.set_updated_at();
create trigger site_announcements_set_updated_at before update on public.site_announcements
  for each row execute function public.set_updated_at();
create trigger site_events_set_updated_at before update on public.site_events
  for each row execute function public.set_updated_at();
create trigger document_categories_set_updated_at before update on public.document_categories
  for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger life_saving_rules_set_updated_at before update on public.life_saving_rules
  for each row execute function public.set_updated_at();
create trigger training_items_set_updated_at before update on public.training_items
  for each row execute function public.set_updated_at();
create trigger training_progress_set_updated_at before update on public.training_progress
  for each row execute function public.set_updated_at();
create trigger recognition_items_set_updated_at before update on public.recognition_items
  for each row execute function public.set_updated_at();
create trigger notification_preferences_set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();
create trigger user_preferences_set_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 7. Row Level Security (tenant isolation)
-- -----------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.locations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.employees enable row level security;
alter table public.company_memberships enable row level security;
alter table public.location_memberships enable row level security;
alter table public.feature_catalog enable row level security;
alter table public.tenant_templates enable row level security;
alter table public.template_features enable row level security;
alter table public.company_features enable row level security;
alter table public.location_feature_overrides enable row level security;
alter table public.company_profiles enable row level security;
alter table public.site_portal_settings enable row level security;
alter table public.site_emergency_contacts enable row level security;
alter table public.report_type_catalog enable row level security;
alter table public.report_category_defaults enable row level security;
alter table public.report_categories enable row level security;
alter table public.report_form_fields enable row level security;
alter table public.safety_reports enable row level security;
alter table public.safety_report_updates enable row level security;
alter table public.safety_report_attachments enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.safety_alerts enable row level security;
alter table public.site_announcements enable row level security;
alter table public.site_events enable row level security;
alter table public.document_category_defaults enable row level security;
alter table public.document_categories enable row level security;
alter table public.documents enable row level security;
alter table public.life_saving_rule_defaults enable row level security;
alter table public.life_saving_rules enable row level security;
alter table public.training_items enable row level security;
alter table public.training_assignments enable row level security;
alter table public.training_progress enable row level security;
alter table public.recognition_items enable row level security;
alter table public.user_preferences enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_events enable row level security;

-- Public tenant/site directory is intentionally limited to active tenants.
create policy companies_read_active_or_member on public.companies
  for select to anon, authenticated
  using (status = 'active' or public.has_company_access(company_id));
create policy companies_platform_admin_all on public.companies
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create policy companies_company_admin_update on public.companies
  for update to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy locations_read_active_or_member on public.locations
  for select to anon, authenticated
  using (
    public.is_active_site(company_id, location_id)
    or public.has_location_access(company_id, location_id)
  );
create policy locations_platform_admin_all on public.locations
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create policy locations_company_admin_manage on public.locations
  for all to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy platform_admins_read_admins on public.platform_admins
  for select to authenticated using (public.is_platform_admin());
create policy platform_admins_manage_admins on public.platform_admins
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy employees_read_self_or_manager on public.employees
  for select to authenticated
  using (auth_user_id = auth.uid() or public.can_manage_location(company_id, location_id));
create policy employees_managers_manage on public.employees
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy company_memberships_read_self_or_admin on public.company_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_company(company_id));
create policy company_memberships_admin_manage on public.company_memberships
  for all to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy location_memberships_read_self_or_manager on public.location_memberships
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_location(company_id, location_id));
create policy location_memberships_manager_manage on public.location_memberships
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy feature_catalog_public_read on public.feature_catalog
  for select to anon, authenticated using (is_active);
create policy feature_catalog_platform_manage on public.feature_catalog
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy tenant_templates_platform_only on public.tenant_templates
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create policy template_features_platform_only on public.template_features
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy company_features_public_read on public.company_features
  for select to anon, authenticated
  using (
    public.has_company_access(company_id)
    or public.is_active_company(company_id)
  );
-- Paid/tenant feature entitlements are controlled by the Safex platform admin,
-- not by a tenant admin. Site overrides can only operate inside an enabled tenant feature.
create policy company_features_platform_manage on public.company_features
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy location_feature_overrides_public_read on public.location_feature_overrides
  for select to anon, authenticated
  using (
    public.has_location_access(company_id, location_id)
    or public.is_active_site(company_id, location_id)
  );
create policy location_feature_overrides_manager_manage on public.location_feature_overrides
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy company_profiles_public_read on public.company_profiles
  for select to anon, authenticated
  using (
    public.has_company_access(company_id)
    or public.is_active_company(company_id)
  );
create policy company_profiles_admin_manage on public.company_profiles
  for all to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

create policy site_portal_settings_public_read on public.site_portal_settings
  for select to anon, authenticated
  using (
    public.has_location_access(company_id, location_id)
    or public.is_active_site(company_id, location_id)
  );
create policy site_portal_settings_manager_manage on public.site_portal_settings
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy emergency_contacts_public_verified_read on public.site_emergency_contacts
  for select to anon, authenticated
  using (
    (is_public and verified_at is not null and public.is_active_site(company_id, location_id))
    or public.has_location_access(company_id, location_id)
  );
create policy emergency_contacts_manager_manage on public.site_emergency_contacts
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy report_type_catalog_read on public.report_type_catalog
  for select to anon, authenticated using (is_active);
create policy report_type_catalog_platform_manage on public.report_type_catalog
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy report_category_defaults_platform_only on public.report_category_defaults
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy report_categories_public_read on public.report_categories
  for select to anon, authenticated
  using (
    (is_enabled and public.is_active_site(company_id, location_id))
    or public.has_location_access(company_id, location_id)
  );
create policy report_categories_manager_manage on public.report_categories
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy report_form_fields_public_read on public.report_form_fields
  for select to anon, authenticated
  using (
    (is_active and public.is_active_site(company_id, location_id))
    or public.has_location_access(company_id, location_id)
  );
create policy report_form_fields_manager_manage on public.report_form_fields
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

-- Reports are deliberately NOT directly insertable by anon. Route guest forms through
-- a rate-limited Supabase Edge Function / trusted server, as described in the guide.
create policy safety_reports_read_own_or_manager on public.safety_reports
  for select to authenticated
  using (
    public.can_manage_location(company_id, location_id)
    or (submitted_by = auth.uid() and not is_anonymous)
  );
create policy safety_reports_manager_manage on public.safety_reports
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy report_updates_read_authorized on public.safety_report_updates
  for select to authenticated
  using (
    public.can_manage_safety_report(report_id)
    or (not is_internal and public.can_view_safety_report(report_id))
  );
create policy report_updates_managers_insert on public.safety_report_updates
  for insert to authenticated
  with check (public.can_manage_safety_report(report_id));

create policy report_attachments_read_authorized on public.safety_report_attachments
  for select to authenticated
  using (public.can_view_safety_report(report_id));
create policy report_attachments_managers_manage on public.safety_report_attachments
  for all to authenticated
  using (public.can_manage_safety_report(report_id))
  with check (public.can_manage_safety_report(report_id));

create policy corrective_actions_read_authorized on public.corrective_actions
  for select to authenticated
  using (
    public.can_manage_location(company_id, location_id)
    or owner_user_id = auth.uid()
  );
create policy corrective_actions_manager_manage on public.corrective_actions
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy safety_alerts_public_published_read on public.safety_alerts
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy safety_alerts_managers_manage on public.safety_alerts
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy announcements_public_published_read on public.site_announcements
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and (expires_at is null or expires_at > now())
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy announcements_managers_manage on public.site_announcements
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy events_public_published_read on public.site_events
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy events_managers_manage on public.site_events
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy document_category_defaults_platform_only on public.document_category_defaults
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy document_categories_public_read on public.document_categories
  for select to anon, authenticated
  using (
    (is_active and public.is_active_site(company_id, location_id))
    or public.has_location_access(company_id, location_id)
  );
create policy document_categories_managers_manage on public.document_categories
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy documents_public_published_read on public.documents
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy documents_managers_manage on public.documents
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy life_saving_rule_defaults_platform_only on public.life_saving_rule_defaults
  for all to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create policy life_saving_rules_public_read on public.life_saving_rules
  for select to anon, authenticated
  using (
    (is_active and public.is_active_site(company_id, location_id))
    or public.has_location_access(company_id, location_id)
  );
create policy life_saving_rules_managers_manage on public.life_saving_rules
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy training_items_public_published_read on public.training_items
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy training_items_managers_manage on public.training_items
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy training_assignments_read_assigned_or_manager on public.training_assignments
  for select to authenticated
  using (
    public.can_manage_location(company_id, location_id)
    or exists (
      select 1 from public.employees e
      where e.company_id = training_assignments.company_id
        and e.id = training_assignments.employee_id
        and e.auth_user_id = auth.uid()
    )
  );
create policy training_assignments_managers_manage on public.training_assignments
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy training_progress_read_self_or_manager on public.training_progress
  for select to authenticated
  using (
    public.can_manage_location(company_id, location_id)
    or exists (
      select 1 from public.employees e
      where e.company_id = training_progress.company_id
        and e.id = training_progress.employee_id
        and e.auth_user_id = auth.uid()
    )
  );
create policy training_progress_self_or_manager_write on public.training_progress
  for all to authenticated
  using (
    public.can_manage_location(company_id, location_id)
    or exists (
      select 1 from public.employees e
      where e.company_id = training_progress.company_id
        and e.id = training_progress.employee_id
        and e.auth_user_id = auth.uid()
    )
  )
  with check (
    public.can_manage_location(company_id, location_id)
    or exists (
      select 1 from public.employees e
      where e.company_id = training_progress.company_id
        and e.id = training_progress.employee_id
        and e.auth_user_id = auth.uid()
    )
  );

create policy recognition_items_public_published_read on public.recognition_items
  for select to anon, authenticated
  using (
    (status = 'published' and published_at is not null and published_at <= now()
      and public.is_active_site(company_id, location_id))
    or public.can_manage_location(company_id, location_id)
  );
create policy recognition_items_managers_manage on public.recognition_items
  for all to authenticated
  using (public.can_manage_location(company_id, location_id))
  with check (public.can_manage_location(company_id, location_id));

create policy user_preferences_self_manage on public.user_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_preferences_self_manage on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid() and public.has_location_access(company_id, location_id))
  with check (user_id = auth.uid() and public.has_location_access(company_id, location_id));

create policy push_subscriptions_self_manage on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid() and public.has_location_access(company_id, location_id))
  with check (user_id = auth.uid() and public.has_location_access(company_id, location_id));

create policy audit_events_read_platform_or_company_admin on public.audit_events
  for select to authenticated
  using (
    public.is_platform_admin()
    or (company_id is not null and public.can_manage_company(company_id))
  );

-- -----------------------------------------------------------------------------
-- 8. Read models: each site view returns the four requested tenant fields
-- -----------------------------------------------------------------------------

create view public.v_tenant_locations
with (security_invoker = true) as
select
  c.company_id as company_id,
  c.company_code,
  c.company_name,
  c.slug as company_slug,
  l.location_id as location_id,
  l.location_code,
  l.location_name,
  l.timezone,
  l.status as location_status,
  l.is_primary
from public.companies c
join public.locations l on l.company_id = c.company_id;

create view public.v_effective_site_features
with (security_invoker = true) as
select
  c.company_id as company_id,
  c.company_code,
  l.location_id as location_id,
  l.location_name,
  f.feature_key,
  f.display_name,
  f.section_key,
  f.section_label,
  f.description,
  f.route,
  f.parent_feature_key,
  f.sort_order,
  case
    when cf.is_enabled is false then false
    else coalesce(lfo.is_enabled, cf.is_enabled, f.default_enabled)
  end as is_enabled,
  coalesce(cf.settings, '{}'::jsonb) || coalesce(lfo.settings, '{}'::jsonb) as settings
from public.companies c
join public.locations l on l.company_id = c.company_id
cross join public.feature_catalog f
left join public.company_features cf
  on cf.company_id = c.company_id and cf.feature_key = f.feature_key
left join public.location_feature_overrides lfo
  on lfo.company_id = c.company_id and lfo.location_id = l.location_id and lfo.feature_key = f.feature_key
where c.status = 'active' and l.status = 'active' and f.is_active;

create view public.v_site_portal_config
with (security_invoker = true) as
select
  c.company_id as company_id,
  c.company_code,
  c.company_name,
  c.slug as company_slug,
  l.location_id as location_id,
  l.location_name,
  l.location_code,
  l.timezone as location_timezone,
  s.welcome_title,
  s.welcome_message,
  s.default_language,
  s.enabled_languages,
  s.allow_public_reports,
  s.theme_overrides,
  p.display_name as company_display_name,
  p.logo_path,
  p.primary_color,
  p.accent_color,
  p.introduction,
  p.services,
  p.address as company_address,
  p.public_email,
  p.public_phone,
  p.website_url,
  p.support_email,
  p.support_phone
from public.companies c
join public.locations l on l.company_id = c.company_id
left join public.site_portal_settings s on s.company_id = c.company_id and s.location_id = l.location_id
left join public.company_profiles p on p.company_id = c.company_id
where c.status = 'active' and l.status = 'active';

create view public.v_safety_reports_with_tenant_context
with (security_invoker = true) as
select
  r.id,
  r.company_id,
  c.company_code,
  r.location_id,
  l.location_name,
  r.report_reference,
  r.report_type,
  r.category_id,
  r.reporter_employee_id,
  r.reporter_name_snapshot,
  r.reporter_employee_code_snapshot,
  r.reporter_designation_snapshot,
  r.department_name,
  r.area_label,
  r.occurred_at,
  r.description,
  r.immediate_action,
  r.severity,
  r.is_anonymous,
  r.status,
  r.assigned_to,
  r.answers,
  r.created_at,
  r.updated_at,
  r.closed_at
from public.safety_reports r
join public.companies c on c.company_id = r.company_id
join public.locations l on l.location_id = r.location_id and l.company_id = r.company_id;

create view public.v_site_safety_alerts
with (security_invoker = true) as
select
  a.id, a.company_id, c.company_code, a.location_id, l.location_name,
  a.alert_reference, a.category_key, a.headline, a.incident_at, a.area_label,
  a.department_name, a.description, a.root_cause, a.immediate_response,
  a.corrective_actions, a.lessons_learned, a.status, a.published_at,
  a.created_at, a.updated_at
from public.safety_alerts a
join public.companies c on c.company_id = a.company_id
join public.locations l on l.location_id = a.location_id and l.company_id = a.company_id;

create view public.v_site_announcements
with (security_invoker = true) as
select
  a.id, a.company_id, c.company_code, a.location_id, l.location_name,
  a.post_type, a.title, a.summary, a.body, a.priority, a.published_on,
  a.status, a.published_at, a.expires_at, a.attachment_path, a.created_at, a.updated_at
from public.site_announcements a
join public.companies c on c.company_id = a.company_id
join public.locations l on l.location_id = a.location_id and l.company_id = a.company_id;

create view public.v_site_events
with (security_invoker = true) as
select
  e.id, e.company_id, c.company_code, e.location_id, l.location_name,
  e.title, e.topic, e.description, e.starts_at, e.ends_at, e.venue,
  e.status, e.published_at, e.capacity, e.created_at, e.updated_at
from public.site_events e
join public.companies c on c.company_id = e.company_id
join public.locations l on l.location_id = e.location_id and l.company_id = e.company_id;

create view public.v_site_documents
with (security_invoker = true) as
select
  d.id, d.company_id, c.company_code, d.location_id, l.location_name,
  d.category_id, dc.category_key, dc.display_name as category_name,
  d.document_code, d.document_type, d.title, d.summary, d.revision,
  d.effective_date, d.review_due_date, d.storage_path, d.original_filename,
  d.mime_type, d.status, d.published_at, d.created_at, d.updated_at
from public.documents d
join public.companies c on c.company_id = d.company_id
join public.locations l on l.location_id = d.location_id and l.company_id = d.company_id
join public.document_categories dc
  on dc.company_id = d.company_id and dc.location_id = d.location_id and dc.id = d.category_id;

create view public.v_site_training_items
with (security_invoker = true) as
select
  t.id, t.company_id, c.company_code, t.location_id, l.location_name,
  t.item_type, t.title, t.description, t.duration_minutes, t.resource_url,
  t.storage_path, t.mime_type, t.sort_order, t.status, t.is_mandatory,
  t.published_at, t.created_at, t.updated_at
from public.training_items t
join public.companies c on c.company_id = t.company_id
join public.locations l on l.location_id = t.location_id and l.company_id = t.company_id;

create view public.v_site_report_categories
with (security_invoker = true) as
select
  rc.id, rc.company_id, c.company_code, rc.location_id, l.location_name,
  rc.report_type, rc.category_key, rc.display_name, rc.description, rc.icon,
  rc.sort_order, rc.is_enabled, rc.created_at, rc.updated_at
from public.report_categories rc
join public.companies c on c.company_id = rc.company_id
join public.locations l on l.location_id = rc.location_id and l.company_id = rc.company_id;

create view public.v_site_report_form_fields
with (security_invoker = true) as
select
  rf.id, rf.company_id, c.company_code, rf.location_id, l.location_name,
  rf.report_type, rf.category_key, rf.field_key, rf.display_label, rf.field_type,
  rf.help_text, rf.is_required, rf.options, rf.sort_order, rf.is_active,
  rf.created_at, rf.updated_at
from public.report_form_fields rf
join public.companies c on c.company_id = rf.company_id
join public.locations l on l.location_id = rf.location_id and l.company_id = rf.company_id;

create view public.v_site_emergency_contacts
with (security_invoker = true) as
select
  ec.id, ec.company_id, c.company_code, ec.location_id, l.location_name,
  ec.contact_type, ec.display_name, ec.phone, ec.instructions, ec.is_primary,
  ec.is_public, ec.verified_at
from public.site_emergency_contacts ec
join public.companies c on c.company_id = ec.company_id
join public.locations l on l.location_id = ec.location_id and l.company_id = ec.company_id;

create view public.v_site_document_categories
with (security_invoker = true) as
select
  dc.id, dc.company_id, c.company_code, dc.location_id, l.location_name,
  dc.category_key, dc.display_name, dc.description, dc.sort_order, dc.is_active
from public.document_categories dc
join public.companies c on c.company_id = dc.company_id
join public.locations l on l.location_id = dc.location_id and l.company_id = dc.company_id;

create view public.v_site_life_saving_rules
with (security_invoker = true) as
select
  r.id, r.company_id, c.company_code, r.location_id, l.location_name,
  r.rule_number, r.title, r.description, r.is_active, r.sort_order, r.created_at, r.updated_at
from public.life_saving_rules r
join public.companies c on c.company_id = r.company_id
join public.locations l on l.location_id = r.location_id and l.company_id = r.company_id;

create view public.v_site_recognition_items
with (security_invoker = true) as
select
  ri.id, ri.company_id, c.company_code, ri.location_id, l.location_name,
  ri.title, ri.caption, ri.award_date, ri.image_path, ri.image_alt,
  ri.status, ri.published_at, ri.sort_order, ri.created_at, ri.updated_at
from public.recognition_items ri
join public.companies c on c.company_id = ri.company_id
join public.locations l on l.location_id = ri.location_id and l.company_id = ri.company_id;

create view public.v_site_training_assignments
with (security_invoker = true) as
select
  ta.id, ta.company_id, c.company_code, ta.location_id, l.location_name,
  ta.training_item_id, ta.employee_id, ta.department_name, ta.due_at, ta.created_at
from public.training_assignments ta
join public.companies c on c.company_id = ta.company_id
join public.locations l on l.location_id = ta.location_id and l.company_id = ta.company_id;

create view public.v_site_training_progress
with (security_invoker = true) as
select
  tp.id, tp.company_id, c.company_code, tp.location_id, l.location_name,
  tp.training_item_id, tp.employee_id, tp.status, tp.progress_percent, tp.score,
  tp.started_at, tp.completed_at, tp.last_position_seconds, tp.updated_at
from public.training_progress tp
join public.companies c on c.company_id = tp.company_id
join public.locations l on l.location_id = tp.location_id and l.company_id = tp.company_id;

create view public.v_site_report_updates
with (security_invoker = true) as
select
  u.id, u.company_id, c.company_code, u.location_id, l.location_name,
  u.report_id, u.status_from, u.status_to, u.message, u.is_internal, u.created_by, u.created_at
from public.safety_report_updates u
join public.companies c on c.company_id = u.company_id
join public.locations l on l.location_id = u.location_id and l.company_id = u.company_id;

create view public.v_site_corrective_actions
with (security_invoker = true) as
select
  ca.id, ca.company_id, c.company_code, ca.location_id, l.location_name,
  ca.report_id, ca.title, ca.owner_user_id, ca.due_date, ca.status,
  ca.completion_notes, ca.completed_at, ca.created_at, ca.updated_at
from public.corrective_actions ca
join public.companies c on c.company_id = ca.company_id
join public.locations l on l.location_id = ca.location_id and l.company_id = ca.company_id;

-- -----------------------------------------------------------------------------
-- 9. One-click tenant provisioning and adding locations
-- -----------------------------------------------------------------------------

create or replace function public.provision_company_with_location(
  p_company_name text,
  p_company_code text,
  p_company_slug text,
  p_location_name text,
  p_location_code text,
  p_template_key text default 'standard_safety_portal',
  p_initial_admin_user_id uuid default null
)
returns table (created_company_id uuid, created_location_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_profile_defaults jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a Safex platform super admin can provision a company.' using errcode = '42501';
  end if;

  if p_company_name is null or length(trim(p_company_name)) = 0 then
    raise exception 'Company name is required.' using errcode = '22023';
  end if;
  if p_company_code is null or p_company_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Company code must be 1-32 letters, numbers, underscore or hyphen.' using errcode = '22023';
  end if;
  if p_company_slug is null or lower(trim(p_company_slug)) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Company slug must be lowercase URL-safe text.' using errcode = '22023';
  end if;
  if p_location_name is null or length(trim(p_location_name)) = 0 then
    raise exception 'First location name is required.' using errcode = '22023';
  end if;
  if p_location_code is null or p_location_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Location code must be 1-32 letters, numbers, underscore or hyphen.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenant_templates t
    where t.template_key = p_template_key and t.is_active
  ) then
    raise exception 'Unknown or inactive template: %', p_template_key using errcode = '22023';
  end if;

  select t.profile_defaults into v_profile_defaults
  from public.tenant_templates t where t.template_key = p_template_key;

  insert into public.companies
    (company_code, company_name, slug, status, created_by)
  values
    (upper(trim(p_company_code)), trim(p_company_name), lower(trim(p_company_slug)), 'active', auth.uid())
  returning company_id into v_company_id;

  insert into public.locations
    (company_id, location_code, location_name, status, is_primary)
  values
    (v_company_id, upper(trim(p_location_code)), trim(p_location_name), 'active', true)
  returning location_id into v_location_id;

  insert into public.company_profiles
    (company_id, display_name, introduction, services)
  values
    (
      v_company_id,
      coalesce(nullif(v_profile_defaults ->> 'display_name', ''), trim(p_company_name)),
      nullif(v_profile_defaults ->> 'introduction', ''),
      coalesce(v_profile_defaults -> 'services', '[]'::jsonb)
    );

  insert into public.site_portal_settings (company_id, location_id)
  values (v_company_id, v_location_id);

  insert into public.company_features (company_id, feature_key, is_enabled, settings)
  select v_company_id, tf.feature_key, tf.is_enabled, tf.settings
  from public.template_features tf
  where tf.template_key = p_template_key
  on conflict (company_id, feature_key) do nothing;

  -- Copy baseline form choices/categories into this tenant's first location.
  insert into public.report_categories
    (company_id, location_id, report_type, category_key, display_name, description, icon, sort_order)
  select v_company_id, v_location_id, d.report_type, d.category_key,
         d.display_name, d.description, d.icon, d.sort_order
  from public.report_category_defaults d
  where d.is_active;

  insert into public.document_categories
    (company_id, location_id, category_key, display_name, description, sort_order)
  select v_company_id, v_location_id, d.category_key, d.display_name, d.description, d.sort_order
  from public.document_category_defaults d
  where d.is_active;

  insert into public.life_saving_rules
    (company_id, location_id, rule_number, title, description, sort_order)
  select v_company_id, v_location_id, d.rule_number, d.title, d.description, d.sort_order
  from public.life_saving_rule_defaults d;

  if p_initial_admin_user_id is not null then
    insert into public.company_memberships (company_id, user_id, role, invited_by)
    values (v_company_id, p_initial_admin_user_id, 'company_admin', auth.uid());
  end if;

  insert into public.audit_events
    (company_id, location_id, actor_user_id, action, resource_type, resource_id, details)
  values
    (v_company_id, v_location_id, auth.uid(), 'company.provisioned', 'company', v_company_id::text,
     jsonb_build_object('template_key', p_template_key, 'company_code', upper(trim(p_company_code))));

  return query select v_company_id, v_location_id;
end;
$$;

create or replace function public.add_company_location(
  p_company_id uuid,
  p_location_name text,
  p_location_code text,
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location_id uuid;
begin
  if not public.can_manage_company(p_company_id) then
    raise exception 'Only a company admin or platform super admin can add a location.' using errcode = '42501';
  end if;
  if p_location_name is null or length(trim(p_location_name)) = 0 then
    raise exception 'Location name is required.' using errcode = '22023';
  end if;
  if p_location_code is null or p_location_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Location code must be 1-32 letters, numbers, underscore or hyphen.' using errcode = '22023';
  end if;

  if p_is_primary then
    update public.locations set is_primary = false where company_id = p_company_id and is_primary;
  end if;

  insert into public.locations
    (company_id, location_code, location_name, status, is_primary)
  values
    (p_company_id, upper(trim(p_location_code)), trim(p_location_name), 'active', p_is_primary)
  returning location_id into v_location_id;

  insert into public.site_portal_settings (company_id, location_id)
  values (p_company_id, v_location_id);

  insert into public.report_categories
    (company_id, location_id, report_type, category_key, display_name, description, icon, sort_order)
  select p_company_id, v_location_id, d.report_type, d.category_key,
         d.display_name, d.description, d.icon, d.sort_order
  from public.report_category_defaults d where d.is_active;

  insert into public.document_categories
    (company_id, location_id, category_key, display_name, description, sort_order)
  select p_company_id, v_location_id, d.category_key, d.display_name, d.description, d.sort_order
  from public.document_category_defaults d where d.is_active;

  insert into public.life_saving_rules
    (company_id, location_id, rule_number, title, description, sort_order)
  select p_company_id, v_location_id, d.rule_number, d.title, d.description, d.sort_order
  from public.life_saving_rule_defaults d;

  insert into public.audit_events
    (company_id, location_id, actor_user_id, action, resource_type, resource_id, details)
  values
    (p_company_id, v_location_id, auth.uid(), 'location.created', 'location', v_location_id::text,
     jsonb_build_object('location_code', upper(trim(p_location_code))));

  return v_location_id;
end;
$$;

revoke all on function public.provision_company_with_location(text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.provision_company_with_location(text, text, text, text, text, text, uuid) to authenticated;
revoke all on function public.add_company_location(uuid, text, text, boolean) from public, anon;
grant execute on function public.add_company_location(uuid, text, text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. API grants. RLS remains the security boundary for every app table.
-- Keep grants explicit so this migration does not expose unrelated public-schema tables.
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- Undo any permissive default grants on the objects created here; grant only what follows.
revoke all privileges on table
  public.companies, public.locations, public.platform_admins, public.employees,
  public.company_memberships, public.location_memberships, public.feature_catalog,
  public.tenant_templates, public.template_features, public.company_features,
  public.location_feature_overrides, public.company_profiles, public.site_portal_settings,
  public.site_emergency_contacts, public.report_type_catalog, public.report_category_defaults,
  public.report_categories, public.report_form_fields, public.safety_reports,
  public.safety_report_updates, public.safety_report_attachments, public.corrective_actions,
  public.safety_alerts, public.site_announcements, public.site_events, public.document_category_defaults,
  public.document_categories, public.documents, public.life_saving_rule_defaults,
  public.life_saving_rules, public.training_items, public.training_assignments,
  public.training_progress, public.recognition_items, public.user_preferences,
  public.notification_preferences, public.push_subscriptions, public.audit_events,
  public.v_tenant_locations, public.v_effective_site_features, public.v_site_portal_config,
  public.v_safety_reports_with_tenant_context, public.v_site_safety_alerts,
  public.v_site_announcements, public.v_site_events, public.v_site_documents,
  public.v_site_training_items, public.v_site_report_categories, public.v_site_report_form_fields,
  public.v_site_emergency_contacts, public.v_site_document_categories,
  public.v_site_life_saving_rules, public.v_site_recognition_items,
  public.v_site_training_assignments, public.v_site_training_progress,
  public.v_site_report_updates, public.v_site_corrective_actions
from public, anon;

-- Public tenant lookup is column-limited: do not expose created_by or raw site address JSON.
grant select (company_id, company_code, company_name, slug, status)
  on table public.companies to anon;
grant select (location_id, company_id, location_code, location_name, status, is_primary, timezone)
  on table public.locations to anon;

grant select on table
  public.feature_catalog,
  public.company_features,
  public.location_feature_overrides,
  public.company_profiles,
  public.site_portal_settings,
  public.site_emergency_contacts,
  public.report_type_catalog,
  public.report_categories,
  public.report_form_fields,
  public.document_categories,
  public.life_saving_rules
to anon;

-- Publicly published content is available through the public read views, without creator IDs
-- or employee IDs. RLS still filters each base row to published/verified active-site content.
grant select (id, company_id, location_id, alert_reference, category_key, headline, incident_at,
  area_label, department_name, description, root_cause, immediate_response, corrective_actions,
  lessons_learned, status, published_at, created_at, updated_at)
  on table public.safety_alerts to anon;
grant select (id, company_id, location_id, post_type, title, summary, body, priority, published_on,
  status, published_at, expires_at, attachment_path, created_at, updated_at)
  on table public.site_announcements to anon;
grant select (id, company_id, location_id, title, topic, description, starts_at, ends_at, venue,
  status, published_at, capacity, created_at, updated_at)
  on table public.site_events to anon;
grant select (id, company_id, location_id, category_id, document_code, document_type, title,
  summary, revision, effective_date, review_due_date, storage_path, original_filename, mime_type,
  status, published_at, created_at, updated_at)
  on table public.documents to anon;
grant select (id, company_id, location_id, item_type, title, description, duration_minutes,
  resource_url, storage_path, mime_type, sort_order, status, is_mandatory, published_at, created_at, updated_at)
  on table public.training_items to anon;
grant select (id, company_id, location_id, title, caption, award_date, image_path, image_alt,
  status, published_at, sort_order, created_at, updated_at)
  on table public.recognition_items to anon;

grant select, insert, update, delete on table
  public.companies,
  public.locations,
  public.platform_admins,
  public.employees,
  public.company_memberships,
  public.location_memberships,
  public.feature_catalog,
  public.tenant_templates,
  public.template_features,
  public.company_features,
  public.location_feature_overrides,
  public.company_profiles,
  public.site_portal_settings,
  public.site_emergency_contacts,
  public.report_type_catalog,
  public.report_category_defaults,
  public.report_categories,
  public.report_form_fields,
  public.safety_reports,
  public.safety_report_updates,
  public.safety_report_attachments,
  public.corrective_actions,
  public.safety_alerts,
  public.site_announcements,
  public.site_events,
  public.document_category_defaults,
  public.document_categories,
  public.documents,
  public.life_saving_rule_defaults,
  public.life_saving_rules,
  public.training_items,
  public.training_assignments,
  public.training_progress,
  public.recognition_items,
  public.user_preferences,
  public.notification_preferences,
  public.push_subscriptions,
  public.audit_events
to authenticated;

grant select, insert, update, delete on table
  public.companies,
  public.locations,
  public.platform_admins,
  public.employees,
  public.company_memberships,
  public.location_memberships,
  public.feature_catalog,
  public.tenant_templates,
  public.template_features,
  public.company_features,
  public.location_feature_overrides,
  public.company_profiles,
  public.site_portal_settings,
  public.site_emergency_contacts,
  public.report_type_catalog,
  public.report_category_defaults,
  public.report_categories,
  public.report_form_fields,
  public.safety_reports,
  public.safety_report_updates,
  public.safety_report_attachments,
  public.corrective_actions,
  public.safety_alerts,
  public.site_announcements,
  public.site_events,
  public.document_category_defaults,
  public.document_categories,
  public.documents,
  public.life_saving_rule_defaults,
  public.life_saving_rules,
  public.training_items,
  public.training_assignments,
  public.training_progress,
  public.recognition_items,
  public.user_preferences,
  public.notification_preferences,
  public.push_subscriptions,
  public.audit_events
to service_role;

grant select on public.v_tenant_locations,
  public.v_effective_site_features,
  public.v_site_portal_config,
  public.v_site_safety_alerts,
  public.v_site_announcements,
  public.v_site_events,
  public.v_site_documents,
  public.v_site_training_items,
  public.v_site_report_categories,
  public.v_site_report_form_fields,
  public.v_site_emergency_contacts,
  public.v_site_document_categories,
  public.v_site_life_saving_rules,
  public.v_site_recognition_items to anon, authenticated, service_role;
grant select on public.v_safety_reports_with_tenant_context,
  public.v_site_training_assignments,
  public.v_site_training_progress,
  public.v_site_report_updates,
  public.v_site_corrective_actions to authenticated, service_role;

commit;
