-- Additive extension for the live SafexNew Supabase project.
-- Reuses the existing tenants/sites/employees/reports/recognitions/push_subscriptions model.
-- Does not drop or rename legacy tables and preserves existing IDs/data.
-- Company/location context is exposed as company_id/company_code/location_id/location_name.

-- -----------------------------------------------------------------------------
-- 1. Add canonical company/site codes to the existing tenant/site masters
-- -----------------------------------------------------------------------------

alter table public.tenants add column if not exists company_code text;
alter table public.tenants add column if not exists timezone text not null default 'Asia/Kolkata';
update public.tenants
set company_code = 'CO-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where company_code is null or length(trim(company_code)) = 0;
alter table public.tenants alter column company_code
  set default ('CO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
alter table public.tenants alter column company_code set not null;
create unique index if not exists tenants_company_code_ci_uidx
  on public.tenants (lower(company_code));

alter table public.sites add column if not exists location_code text;
alter table public.sites add column if not exists is_primary boolean not null default false;
alter table public.sites add column if not exists timezone text not null default 'Asia/Kolkata';
update public.sites
set location_code = 'LOC-' || upper(substr(replace(id::text, '-', ''), 1, 8))
where location_code is null or length(trim(location_code)) = 0;
alter table public.sites alter column location_code
  set default ('LOC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
alter table public.sites alter column location_code set not null;
create unique index if not exists sites_tenant_location_code_ci_uidx
  on public.sites (tenant_id, lower(location_code));
create unique index if not exists sites_one_primary_per_tenant_uidx
  on public.sites (tenant_id) where is_primary;

-- Existing sites get a deterministic primary marker if none has been chosen.
update public.sites s
set is_primary = true
where not exists (
  select 1 from public.sites p where p.tenant_id = s.tenant_id and p.is_primary
)
and s.id = (
  select s2.id from public.sites s2
  where s2.tenant_id = s.tenant_id
  order by s2.created_at, s2.id
  limit 1
);

-- An explicit composite unique index is needed by new site-scoped FKs to employees.
create unique index if not exists employees_tenant_id_id_uk
  on public.employees (tenant_id, id);

-- -----------------------------------------------------------------------------
-- 2. Shared frontend feature catalog and template defaults
-- -----------------------------------------------------------------------------

create table if not exists public.feature_catalog (
  feature_key text primary key,
  display_name text not null,
  section_key text not null,
  section_label text not null,
  description text not null default '',
  route text,
  parent_feature_key text,
  legacy_feature_key text,
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
   parent_feature_key, legacy_feature_key, sort_order, is_core, is_tenant_toggleable, default_enabled)
values
  ('safety_portal', 'Safety Portal', 'safety_home', 'SAFETY HOME', 'Main company safety landing page.', '/', null, null, 10, true, false, true),
  ('safety_reports', 'Report a safety concern', 'take_action', 'TAKE ACTION', 'Safety concern submission entry point.', '/', 'safety_portal', 'voice_reporting', 20, true, false, true),
  ('near_miss', 'Near Miss', 'take_action', 'TAKE ACTION', 'A close call worth reporting.', '/', 'safety_reports', 'voice_reporting', 21, false, true, true),
  ('hazard', 'Hazard', 'take_action', 'TAKE ACTION', 'Report a hazard, accident, property damage or red-risk incident.', '/', 'safety_reports', 'voice_reporting', 22, false, true, true),
  ('safety_observation', 'Safety Observation', 'take_action', 'TAKE ACTION', 'Unsafe condition, unsafe act or positive observation.', '/', 'safety_reports', 'voice_reporting', 23, false, true, true),
  ('feedback', 'Feedback', 'take_action', 'TAKE ACTION', 'Feedback about PPE, tools, training, welfare or closure.', '/', 'safety_reports', 'voice_reporting', 24, false, true, true),
  ('grievance_speak_up', 'Grievance / Speak Up', 'take_action', 'TAKE ACTION', 'Employee grievance and optional anonymous Speak Up.', '/', 'safety_reports', 'voice_reporting', 25, false, true, true),
  ('suggestion', 'Suggestion', 'take_action', 'TAKE ACTION', 'Ideas for safer work.', '/', 'safety_reports', 'voice_reporting', 26, false, true, true),
  ('view_reports', 'View Reports', 'quick_access', 'QUICK ACCESS', 'Track report reference, type, area and status.', '/reports', 'safety_portal', 'voice_reporting', 30, false, true, true),
  ('training_management', 'Training Management', 'quick_access', 'QUICK ACCESS', 'Training videos, modules and employee progress.', '/training', 'safety_portal', 'training_management', 31, false, true, true),
  ('safety_alerts', 'Safety Alerts', 'quick_access', 'QUICK ACCESS', 'Published alerts, controls and lessons learned.', '/alerts', 'safety_portal', null, 32, false, true, true),
  ('circulars_notices', 'Circulars & Notices', 'quick_access', 'QUICK ACCESS', 'Published site circulars and notices.', '/updates', 'safety_portal', 'circulars', 33, false, true, true),
  ('upcoming_events', 'Upcoming Events', 'quick_access', 'QUICK ACCESS', 'Training, awareness and site events.', '/events', 'safety_portal', null, 34, false, true, true),
  ('document_vault', 'Document Vault / Library', 'library', 'DOCUMENT VAULT / LIBRARY', 'SOP / SWP, risk assessments, compliance, policies and MoM.', '/documents', 'safety_portal', 'library', 40, false, true, true),
  ('life_saving_rules', 'LIFE SAVING RULE', 'safety_home', 'SAFETY HOME', 'Location-specific life-saving rules.', '/', 'safety_portal', null, 11, false, true, true),
  ('rewards_recognition', 'Rewards & Recognition Gallery', 'recognition', 'RECOGNITION', 'Published safety awards and recognition.', '/', 'safety_portal', 'reward_wall', 50, false, true, true),
  ('sos_emergency_contact', 'SOS emergency contact', 'header', 'HEADER', 'Location-specific emergency contacts.', '/', 'safety_portal', null, 5, false, true, true),
  ('push_notifications', 'Push notifications', 'device_settings', 'DEVICE SETTINGS', 'Alert, update and report-status preferences.', '/settings/notifications', 'safety_portal', 'push_notifications', 60, false, true, true),
  ('install_app', 'Install App', 'more', 'MORE', 'Install the shared portal as a PWA.', '/more', 'safety_portal', null, 70, false, false, true),
  ('company_profile', 'Vendor / Company About Us', 'more', 'MORE', 'Company services, contacts and support.', '/company', 'safety_portal', null, 71, false, true, true),
  ('employee_directory', 'Search Employee Profile', 'more', 'MORE', 'Restricted lookup by Employee ID.', '/employees', 'safety_portal', null, 72, false, true, true),
  ('account_login', 'Account Login', 'more', 'MORE', 'Login, logout and account settings.', '/account', 'safety_portal', null, 73, false, false, true),
  ('appearance', 'Appearance', 'more', 'MORE', 'Light, dark and system themes.', '/more', 'safety_portal', null, 74, false, false, true),
  ('about_app', 'About App', 'more', 'MORE', 'App version, policies and support.', '/more', 'safety_portal', null, 75, false, false, true),
  -- Legacy keys remain as inactive compatibility aliases for the existing frontend.
  ('voice_reporting', 'Legacy: Voice Reporting', 'legacy', 'LEGACY', 'Compatibility key for existing tenant feature rows.', null, null, null, 900, false, false, true),
  ('library', 'Legacy: Library', 'legacy', 'LEGACY', 'Compatibility key for existing tenant feature rows.', null, null, null, 901, false, false, true),
  ('circulars', 'Legacy: Circulars', 'legacy', 'LEGACY', 'Compatibility key for existing tenant feature rows.', null, null, null, 902, false, false, true),
  ('reward_wall', 'Legacy: Reward Wall', 'legacy', 'LEGACY', 'Compatibility key for existing tenant feature rows.', null, null, null, 903, false, false, true)
on conflict (feature_key) do update set
  display_name = excluded.display_name,
  section_key = excluded.section_key,
  section_label = excluded.section_label,
  description = excluded.description,
  route = excluded.route,
  parent_feature_key = excluded.parent_feature_key,
  legacy_feature_key = excluded.legacy_feature_key,
  sort_order = excluded.sort_order,
  is_core = excluded.is_core,
  is_tenant_toggleable = excluded.is_tenant_toggleable,
  default_enabled = excluded.default_enabled,
  is_active = excluded.is_active;

create table if not exists public.tenant_templates (
  template_key text primary key,
  display_name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.template_features (
  template_key text not null references public.tenant_templates(template_key) on delete cascade,
  feature_key text not null references public.feature_catalog(feature_key) on delete cascade,
  is_enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  primary key (template_key, feature_key)
);

insert into public.tenant_templates (template_key, display_name, description)
values ('standard_safety_portal', 'Standard Safety Portal', 'Default EMVEESS/Safex safety portal feature set.')
on conflict (template_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  is_active = true;

insert into public.template_features (template_key, feature_key, is_enabled, settings)
select 'standard_safety_portal', f.feature_key, f.default_enabled, '{}'::jsonb
from public.feature_catalog f
where f.is_active or f.feature_key in ('voice_reporting','library','circulars','reward_wall')
on conflict (template_key, feature_key) do update set
  is_enabled = excluded.is_enabled,
  settings = excluded.settings;

-- Existing tenant_features only allowed six legacy keys. Keep those, add the UI keys,
-- and attach a catalog FK so future feature keys are centrally controlled.
alter table public.tenant_features drop constraint if exists tenant_features_feature_key_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenant_features'::regclass
      and conname = 'tenant_features_feature_catalog_fk'
  ) then
    alter table public.tenant_features
      add constraint tenant_features_feature_catalog_fk
      foreign key (feature_key) references public.feature_catalog(feature_key) on delete restrict;
  end if;
end;
$$;

insert into public.tenant_features (tenant_id, feature_key, enabled, settings)
select t.id, tf.feature_key, tf.is_enabled, tf.settings
from public.tenants t
cross join public.template_features tf
where tf.template_key = 'standard_safety_portal'
on conflict (tenant_id, feature_key) do nothing;

-- -----------------------------------------------------------------------------
-- 3. Company profiles, site configuration and report form metadata
-- -----------------------------------------------------------------------------

create table if not exists public.company_profiles (
  company_id uuid primary key references public.tenants(id) on delete cascade,
  display_name text,
  introduction text,
  services jsonb not null default '[]'::jsonb check (jsonb_typeof(services) = 'array'),
  contact_address text,
  public_email text,
  public_phone text,
  website_url text,
  support_email text,
  support_phone text,
  logo_path text,
  primary_color text,
  accent_color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_portal_settings (
  company_id uuid not null,
  location_id uuid not null,
  welcome_title text,
  welcome_message text,
  default_language text not null default 'en',
  enabled_languages text[] not null default array['en','hi','or','bn','pa','mr']::text[],
  allow_public_reports boolean not null default true,
  theme_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(theme_overrides) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id),
  constraint site_portal_settings_site_fk
    foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade
);

create table if not exists public.report_type_catalog (
  report_type text primary key,
  feature_key text not null references public.feature_catalog(feature_key) on delete restrict,
  display_name text not null,
  description text not null default '',
  supports_categories boolean not null default false,
  allows_anonymous boolean not null default false,
  default_form_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(default_form_schema) = 'object'),
  is_active boolean not null default true
);

insert into public.report_type_catalog
  (report_type, feature_key, display_name, description, supports_categories, allows_anonymous, default_form_schema)
values
  ('near_miss', 'near_miss', 'Near Miss', 'A close call worth reporting.', false, false,
   '{"fields":[{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"area","label":"Location / area","type":"text","required":true},{"key":"department","label":"Department","type":"text","required":false},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Description of Incident","type":"textarea","required":true},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('hazard', 'hazard', 'Hazard', 'Accident, property damage or red-risk incident.', true, false,
   '{"fields":[{"key":"category","label":"Hazard category","type":"category","required":true},{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"area","label":"Location / area","type":"text","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Description of Hazard","type":"textarea","required":true},{"key":"severity","label":"Severity rating","type":"select","required":true,"options":["Low","Medium","High"]},{"key":"immediate_action","label":"Immediate action taken","type":"textarea","required":false},{"key":"photo","label":"Attach photo","type":"image","required":false,"max_mb":12}]}'::jsonb),
  ('safety_observation', 'safety_observation', 'Safety Observation', 'Unsafe condition, unsafe act or positive observation.', true, false,
   '{"fields":[{"key":"category","label":"Observation category","type":"category","required":true},{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"area","label":"Location / area","type":"text","required":true},{"key":"occurred_at","label":"Date & time","type":"datetime","required":true},{"key":"description","label":"Description of observation","type":"textarea","required":true}]}'::jsonb),
  ('feedback', 'feedback', 'Feedback', 'PPE, tools, training, grievance, welfare or closure feedback.', true, false,
   '{"fields":[{"key":"category","label":"Feedback category","type":"category","required":true},{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"description","label":"Feedback","type":"textarea","required":true}]}'::jsonb),
  ('grievance', 'grievance_speak_up', 'Grievance', 'Employee grievance; identity is required.', true, false,
   '{"fields":[{"key":"category","label":"Grievance category","type":"category","required":true},{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"description","label":"Description of grievance","type":"textarea","required":true}]}'::jsonb),
  ('speak_up', 'grievance_speak_up', 'Speak Up', 'Confidential concern; anonymous submission is the default.', false, true,
   '{"fields":[{"key":"anonymous","label":"Submit anonymously","type":"boolean","required":false,"default":true},{"key":"area","label":"Location / area","type":"text","required":true},{"key":"description","label":"Your Concern / Issue","type":"textarea","required":true}]}'::jsonb),
  ('suggestion', 'suggestion', 'Suggestion', 'Ideas to improve safety.', true, false,
   '{"fields":[{"key":"category","label":"Suggestion category","type":"category","required":true},{"key":"reporter","label":"Employee ID","type":"employee_lookup","required":true},{"key":"description","label":"Suggestion","type":"textarea","required":true}]}'::jsonb),
  ('unsafe_condition', 'safety_observation', 'Unsafe Condition', 'Legacy-compatible observation type.', true, false, '{}'::jsonb),
  ('unsafe_act', 'safety_observation', 'Unsafe Act', 'Legacy-compatible observation type.', true, false, '{}'::jsonb)
on conflict (report_type) do update set
  feature_key = excluded.feature_key,
  display_name = excluded.display_name,
  description = excluded.description,
  supports_categories = excluded.supports_categories,
  allows_anonymous = excluded.allows_anonymous,
  default_form_schema = excluded.default_form_schema,
  is_active = excluded.is_active;

create table if not exists public.report_category_defaults (
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
  ('hazard', 'reporting_accident', 'Reporting Accident', 'An incident or accident that needs to be recorded.', 'warning', 1),
  ('hazard', 'property_damage', 'Property Damage', 'Damage to equipment, tools or site property.', 'building', 2),
  ('hazard', 'red_risk_incident', 'Red Risk Incident', 'A high-potential or critical safety event.', 'fire', 3),
  ('safety_observation', 'unsafe_condition', 'UC · Unsafe Condition', 'Report an unsafe condition.', 'warning', 1),
  ('safety_observation', 'unsafe_act', 'UA · Unsafe Act', 'Report an unsafe act or behaviour.', 'barrier', 2),
  ('safety_observation', 'safe_observation', 'Safe Observation · Good practice', 'Recognize a safe act or practice.', 'check', 3),
  ('feedback', 'ppe', 'PPE · Personal protective equipment', 'Fit, comfort, quality or availability.', 'person', 1),
  ('feedback', 'tools_tackles_equipment', 'Tools, tackles & equipment', 'Condition, suitability or availability.', 'tools', 2),
  ('feedback', 'training_feedback', 'Training feedback', 'Training content or delivery.', 'book', 3),
  ('feedback', 'grievance_feedback', 'Grievance feedback', 'Feedback about an existing concern.', 'chat', 4),
  ('feedback', 'amenities_welfare', 'Amenities & welfare', 'Facilities, canteen or welfare.', 'home', 5),
  ('feedback', 'observation_closure', 'Observation closure', 'Feedback on a report closure.', 'check', 6),
  ('grievance', 'welfare', 'Welfare', 'Welfare services or support.', 'heart', 1),
  ('grievance', 'amenities', 'Amenities', 'Facilities, canteen, water or sanitation.', 'home', 2),
  ('grievance', 'wages_salary', 'Wages / salary', 'A concern about wages or salary.', 'money', 3),
  ('grievance', 'safety_concerns', 'Safety concerns', 'A workplace safety concern.', 'shield', 4),
  ('grievance', 'workplace_issues', 'Workplace issues', 'A concern about work conditions.', 'factory', 5),
  ('grievance', 'other', 'Other', 'Another workplace concern.', 'question', 6),
  ('suggestion', 'ppe_suggestion', 'PPE suggestion', 'Ideas to improve protective equipment.', 'person', 1),
  ('suggestion', 'training_suggestion', 'Training suggestion', 'Ideas to improve training.', 'book', 2),
  ('suggestion', 'tools_equipment_suggestion', 'Tools & equipment suggestion', 'Ideas to improve tools or equipment.', 'tools', 3)
on conflict (report_type, category_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

create table if not exists public.report_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
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
    foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade,
  constraint report_categories_unique_key unique (company_id, location_id, report_type, category_key)
);

create table if not exists public.report_form_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  report_type text not null references public.report_type_catalog(report_type) on delete restrict,
  category_key text not null default '*',
  field_key text not null,
  display_label text not null,
  field_type text not null check (field_type in ('text','textarea','number','select','checkbox','date','datetime','employee_lookup','image')),
  help_text text,
  is_required boolean not null default false,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_form_fields_site_fk
    foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade,
  constraint report_form_fields_unique_key unique (company_id, location_id, report_type, category_key, field_key)
);

-- -----------------------------------------------------------------------------
-- 4. Published site content, library, training and recognition
-- -----------------------------------------------------------------------------

create table if not exists public.safety_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
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
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint safety_alerts_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint safety_alerts_headline_not_blank check (length(trim(headline)) > 0)
);

create table if not exists public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  post_type text not null check (post_type in ('circular','notice')),
  title text not null,
  summary text not null default '',
  body text not null default '',
  priority text not null default 'normal' check (priority in ('normal','important','urgent')),
  published_on date,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  expires_at timestamptz,
  attachment_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_announcements_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint site_announcements_title_not_blank check (length(trim(title)) > 0)
);

create table if not exists public.site_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  title text not null,
  topic text,
  description text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue text,
  status text not null default 'draft' check (status in ('draft','published','cancelled','completed')),
  published_at timestamptz,
  capacity integer check (capacity is null or capacity > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_events_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint site_events_title_not_blank check (length(trim(title)) > 0),
  constraint site_events_end_after_start check (ends_at is null or ends_at >= starts_at)
);

create table if not exists public.document_category_defaults (
  category_key text primary key,
  display_name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true
);
insert into public.document_category_defaults (category_key,display_name,description,sort_order) values
  ('sop_swp','SOP / SWP','Standard and safe work procedures.',1),
  ('risk_assessments','Risk Assessments','JHA, HIRA and task risk reviews.',2),
  ('legal_statutory_compliance','Legal & Statutory Compliance','Registers, checklists and obligations.',3),
  ('policy_procedures','Policy & Procedures','Safety policy and management process.',4),
  ('minutes_of_meeting','Minutes of Meeting (MoM)','Safety committee and review meetings.',5)
on conflict (category_key) do update set display_name=excluded.display_name, description=excluded.description, sort_order=excluded.sort_order, is_active=true;

create table if not exists public.document_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  category_key text not null,
  display_name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_categories_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade,
  constraint document_categories_unique_key unique (company_id, location_id, category_key),
  constraint document_categories_scope_id_uk unique (company_id, location_id, id)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  category_id uuid not null,
  document_code text,
  document_type text not null default 'document' check (document_type in ('sop','swp','risk_assessment','legal_register','policy','procedure','minutes','document')),
  title text not null,
  summary text,
  revision text,
  effective_date date,
  review_due_date date,
  storage_path text,
  original_filename text,
  mime_type text,
  status text not null default 'draft' check (status in ('draft','review','published','superseded','archived')),
  published_at timestamptz,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint documents_category_fk foreign key (company_id, location_id, category_id) references public.document_categories(company_id, location_id, id) on delete restrict,
  constraint documents_title_not_blank check (length(trim(title)) > 0)
);

create table if not exists public.life_saving_rule_defaults (
  rule_number integer primary key,
  title text not null,
  description text not null,
  sort_order integer not null
);
insert into public.life_saving_rule_defaults (rule_number,title,description,sort_order) values
  (1,'Personal Protective Equipment (PPE)','Do not work without mandatory Personal Protective Equipment.',1),
  (2,'Rail and Road Safety','Do not use mobile phones at the workplace unless authorised. Follow traffic rules and keep a safe distance from moving wagons or mobile equipment.',2),
  (3,'Safety Control','Obtain authorisation from the designated person before overriding any safety control.',3),
  (4,'Confined Space','Obtain authorisation before entry into a confined space.',4),
  (5,'Work Permit and Positive Isolation','Obtain a work permit before starting work. Verify energy isolation and ensure LockOut-TagOut-TryOut (LOTOTO) is in place.',5),
  (6,'HEMM / Blasting / Moving Machinery','Maintain a safe distance from HEMM and moving machines. Enter a blasting danger zone only after authorisation.',6),
  (7,'Material Handling','Follow the standard for material handling and never stand below a suspended load.',7),
  (8,'Flammable and Toxic Substances','Use a gas detector in hazardous gas areas and follow standards for hot work in a flammable environment.',8),
  (9,'Working at Height','Use a full-body harness anchored with a rigid connection while working at a height of 2 metres or more.',9),
  (10,'Alcohol and Drugs','Do not drive or work under the influence of alcohol or drugs.',10)
on conflict (rule_number) do update set title=excluded.title, description=excluded.description, sort_order=excluded.sort_order;

create table if not exists public.life_saving_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  rule_number integer not null check (rule_number > 0),
  title text not null,
  description text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_saving_rules_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade,
  constraint life_saving_rules_number_uk unique (company_id, location_id, rule_number)
);

create table if not exists public.training_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  item_type text not null check (item_type in ('video','module','course','standard')),
  title text not null,
  description text not null default '',
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  resource_url text,
  storage_path text,
  mime_type text,
  sort_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  is_mandatory boolean not null default false,
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_items_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint training_items_scope_id_uk unique (company_id, location_id, id),
  constraint training_items_title_not_blank check (length(trim(title)) > 0)
);

create table if not exists public.training_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  training_item_id uuid not null,
  employee_id uuid,
  department_name text,
  due_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint training_assignments_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint training_assignments_item_fk foreign key (company_id, location_id, training_item_id) references public.training_items(company_id, location_id, id) on delete cascade,
  constraint training_assignments_employee_fk foreign key (company_id, employee_id) references public.employees(tenant_id, id) on delete cascade,
  constraint training_assignments_target_check check (employee_id is not null or department_name is not null)
);

create table if not exists public.training_progress (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  training_item_id uuid not null,
  employee_id uuid not null,
  status text not null default 'pending' check (status in ('pending','in_progress','completed','waived')),
  progress_percent numeric(5,2) not null default 0 check (progress_percent >= 0 and progress_percent <= 100),
  score numeric(5,2) check (score is null or (score >= 0 and score <= 100)),
  started_at timestamptz,
  completed_at timestamptz,
  last_position_seconds integer check (last_position_seconds is null or last_position_seconds >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint training_progress_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete restrict,
  constraint training_progress_item_fk foreign key (company_id, location_id, training_item_id) references public.training_items(company_id, location_id, id) on delete cascade,
  constraint training_progress_employee_fk foreign key (company_id, employee_id) references public.employees(tenant_id, id) on delete cascade,
  constraint training_progress_employee_item_uk unique (company_id, employee_id, training_item_id)
);

-- The existing recognition table is retained; it receives a required site context and a safe view.
alter table public.recognitions add column if not exists site_id uuid;
update public.recognitions r
set site_id = coalesce(
  (select s.id from public.sites s where s.tenant_id = r.tenant_id and s.is_primary order by s.id limit 1),
  (select s.id from public.sites s where s.tenant_id = r.tenant_id order by s.created_at, s.id limit 1)
)
where r.site_id is null;
create or replace function public.safex_set_recognition_site()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.site_id is null then
    select s.id into new.site_id
    from public.sites s
    where s.tenant_id = new.tenant_id and s.active
    order by s.is_primary desc, s.created_at, s.id
    limit 1;
  end if;
  if new.site_id is null then
    raise exception 'Recognition requires an active site for its company.' using errcode = '23502';
  end if;
  return new;
end;
$$;
revoke all on function public.safex_set_recognition_site() from public, anon, authenticated;
create trigger safex_recognitions_set_site
  before insert or update of tenant_id, site_id on public.recognitions
  for each row execute function public.safex_set_recognition_site();
alter table public.recognitions alter column site_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.recognitions'::regclass and conname='recognitions_site_tenant_fk') then
    alter table public.recognitions add constraint recognitions_site_tenant_fk
      foreign key (site_id, tenant_id) references public.sites(id, tenant_id) on delete restrict;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Feature overrides, audit and profile tables
-- -----------------------------------------------------------------------------

create table if not exists public.site_feature_overrides (
  company_id uuid not null references public.tenants(id) on delete cascade,
  location_id uuid not null,
  feature_key text not null references public.feature_catalog(feature_key) on delete restrict,
  enabled boolean,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id, feature_key),
  constraint site_feature_overrides_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete cascade
);

create table if not exists public.safex_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.tenants(id) on delete set null,
  location_id uuid,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  constraint safex_audit_events_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete set null
);

create table if not exists public.tenant_feature_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.tenants(id) on delete set null,
  location_id uuid,
  feature_key text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  before_state jsonb,
  after_state jsonb,
  changed_at timestamptz not null default now(),
  constraint tenant_feature_audit_site_fk foreign key (location_id, company_id) references public.sites(id, tenant_id) on delete set null
);

-- Compatibility views expose the requested names without replacing live tenant/site tables.
create or replace view public.companies with (security_invoker = true) as
select t.id as company_id, t.company_code, t.company_name, t.slug as company_slug,
       case when t.active then 'active' else 'inactive' end as status, t.timezone,
       t.created_at, t.updated_at
from public.tenants t;

create or replace view public.locations with (security_invoker = true) as
select s.id as location_id, s.tenant_id as company_id, s.location_code,
       s.name as location_name, s.region, s.active as is_active, s.is_primary,
       s.timezone, s.created_at, s.updated_at
from public.sites s;

-- -----------------------------------------------------------------------------
-- 6. Safe access helpers, trigger defaults and audit
-- -----------------------------------------------------------------------------

create or replace function public.safex_is_active_tenant(p_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.tenants t where t.id = p_company_id and t.active);
$$;

create or replace function public.safex_is_active_site(p_company_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.sites s join public.tenants t on t.id = s.tenant_id
    where s.tenant_id = p_company_id and s.id = p_location_id and s.active and t.active
  );
$$;

create or replace function public.safex_can_manage_site(p_company_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.safex_is_platform_admin()
    or exists (
      select 1 from public.staff_memberships m
      where m.user_id = auth.uid() and m.tenant_id = p_company_id and m.active
        and (
          (m.site_id = p_location_id and m.role in ('site_officer','vendor_admin','tenant_admin'))
          or (m.site_id is null and m.role in ('vendor_admin','tenant_admin'))
        )
    );
$$;

revoke all on function public.safex_is_active_tenant(uuid) from public;
revoke all on function public.safex_is_active_site(uuid, uuid) from public;
revoke all on function public.safex_can_manage_site(uuid, uuid) from public;
grant execute on function public.safex_is_active_tenant(uuid) to anon, authenticated, service_role;
grant execute on function public.safex_is_active_site(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.safex_can_manage_site(uuid, uuid) to authenticated, service_role;

create or replace function public.safex_is_linked_employee(p_company_id uuid, p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.employees e
    where e.tenant_id = p_company_id and e.id = p_employee_id
      and e.auth_user_id = auth.uid() and e.active
  );
$$;
revoke all on function public.safex_is_linked_employee(uuid, uuid) from public, anon, authenticated;
grant execute on function public.safex_is_linked_employee(uuid, uuid) to authenticated, service_role;

create or replace function public.safex_audit_feature_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_feature_key text;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_table_name = 'tenant_features' then
    if tg_op = 'DELETE' then
      v_company_id := old.tenant_id;
      v_feature_key := old.feature_key;
      v_before := jsonb_build_object('enabled', old.enabled, 'settings', old.settings);
    else
      v_company_id := new.tenant_id;
      v_feature_key := new.feature_key;
    end if;
  else
    if tg_op = 'DELETE' then
      v_company_id := old.company_id;
      v_location_id := old.location_id;
      v_feature_key := old.feature_key;
      v_before := jsonb_build_object('enabled', old.enabled, 'settings', old.settings);
    else
      v_company_id := new.company_id;
      v_location_id := new.location_id;
      v_feature_key := new.feature_key;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_after := jsonb_build_object('enabled', new.enabled, 'settings', new.settings);
  end if;
  insert into public.tenant_feature_audit
    (company_id, location_id, feature_key, actor_user_id, before_state, after_state)
  values (v_company_id, v_location_id, v_feature_key, auth.uid(), v_before, v_after);
  insert into public.safex_audit_events
    (company_id, location_id, actor_user_id, action, resource_type, resource_id, details)
  values (v_company_id, v_location_id, auth.uid(), 'feature.changed', tg_table_name,
          v_feature_key, jsonb_build_object('before', v_before, 'after', v_after));
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.safex_audit_feature_change() from public, anon, authenticated;
create trigger safex_tenant_features_audit
  after insert or update or delete on public.tenant_features
  for each row execute function public.safex_audit_feature_change();
create trigger safex_site_feature_overrides_audit
  after insert or update or delete on public.site_feature_overrides
  for each row execute function public.safex_audit_feature_change();

create or replace function public.safex_seed_tenant_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.company_profiles (company_id, display_name, services)
  values (new.id, new.company_name, '[]'::jsonb)
  on conflict (company_id) do nothing;
  insert into public.tenant_features (tenant_id, feature_key, enabled, settings)
  select new.id, tf.feature_key, tf.is_enabled, tf.settings
  from public.template_features tf
  where tf.template_key = 'standard_safety_portal'
  on conflict (tenant_id, feature_key) do nothing;
  return new;
end;
$$;
revoke all on function public.safex_seed_tenant_defaults() from public, anon, authenticated;
create trigger safex_tenants_seed_defaults
  after insert on public.tenants
  for each row execute function public.safex_seed_tenant_defaults();

create or replace function public.safex_seed_site_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.sites s where s.tenant_id = new.tenant_id and s.is_primary) then
    update public.sites set is_primary = true where id = new.id;
  end if;
  insert into public.site_portal_settings (company_id, location_id)
  values (new.tenant_id, new.id) on conflict do nothing;
  insert into public.report_categories
    (company_id, location_id, report_type, category_key, display_name, description, icon, sort_order)
  select new.tenant_id, new.id, d.report_type, d.category_key, d.display_name, d.description, d.icon, d.sort_order
  from public.report_category_defaults d where d.is_active
  on conflict (company_id, location_id, report_type, category_key) do nothing;
  insert into public.document_categories (company_id, location_id, category_key, display_name, description, sort_order)
  select new.tenant_id, new.id, d.category_key, d.display_name, d.description, d.sort_order
  from public.document_category_defaults d where d.is_active
  on conflict (company_id, location_id, category_key) do nothing;
  insert into public.life_saving_rules (company_id, location_id, rule_number, title, description, sort_order)
  select new.tenant_id, new.id, d.rule_number, d.title, d.description, d.sort_order
  from public.life_saving_rule_defaults d
  on conflict (company_id, location_id, rule_number) do nothing;
  return new;
end;
$$;
revoke all on function public.safex_seed_site_defaults() from public, anon, authenticated;
create trigger safex_sites_seed_defaults
  after insert on public.sites
  for each row execute function public.safex_seed_site_defaults();

create or replace function public.safex_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.safex_set_updated_at() from public, anon, authenticated;

-- Backfill profile/settings/catalog rows for any existing tenant/site without overwriting data.
insert into public.company_profiles (company_id, display_name, services)
select t.id, t.company_name, '[]'::jsonb from public.tenants t
on conflict (company_id) do nothing;
insert into public.site_portal_settings (company_id, location_id)
select s.tenant_id, s.id from public.sites s
on conflict (company_id, location_id) do nothing;
insert into public.report_categories
  (company_id, location_id, report_type, category_key, display_name, description, icon, sort_order)
select s.tenant_id, s.id, d.report_type, d.category_key, d.display_name, d.description, d.icon, d.sort_order
from public.sites s cross join public.report_category_defaults d where d.is_active
on conflict (company_id, location_id, report_type, category_key) do nothing;
insert into public.document_categories (company_id, location_id, category_key, display_name, description, sort_order)
select s.tenant_id, s.id, d.category_key, d.display_name, d.description, d.sort_order
from public.sites s cross join public.document_category_defaults d where d.is_active
on conflict (company_id, location_id, category_key) do nothing;
insert into public.life_saving_rules (company_id, location_id, rule_number, title, description, sort_order)
select s.tenant_id, s.id, d.rule_number, d.title, d.description, d.sort_order
from public.sites s cross join public.life_saving_rule_defaults d
on conflict (company_id, location_id, rule_number) do nothing;

-- -----------------------------------------------------------------------------
-- 7. Row-level security for new and extended objects
-- -----------------------------------------------------------------------------

alter table public.feature_catalog enable row level security;
alter table public.tenant_templates enable row level security;
alter table public.template_features enable row level security;
alter table public.site_feature_overrides enable row level security;
alter table public.company_profiles enable row level security;
alter table public.site_portal_settings enable row level security;
alter table public.report_type_catalog enable row level security;
alter table public.report_category_defaults enable row level security;
alter table public.report_categories enable row level security;
alter table public.report_form_fields enable row level security;
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
alter table public.tenant_feature_audit enable row level security;
alter table public.safex_audit_events enable row level security;

-- Public tenant/site directory is restricted to active rows; grants below are column-limited.
drop policy if exists safex_company_directory_active_read on public.tenants;
create policy safex_company_directory_active_read on public.tenants
  for select to anon, authenticated using (active);
drop policy if exists safex_location_directory_active_read on public.sites;
create policy safex_location_directory_active_read on public.sites
  for select to anon
  using (active and exists (select 1 from public.tenants t where t.id = sites.tenant_id and t.active));

drop policy if exists safex_feature_catalog_public_read on public.feature_catalog;
create policy safex_feature_catalog_public_read on public.feature_catalog
  for select to anon, authenticated using (is_active);
drop policy if exists safex_feature_catalog_platform_manage on public.feature_catalog;
create policy safex_feature_catalog_platform_manage on public.feature_catalog
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_tenant_templates_platform_only on public.tenant_templates;
create policy safex_tenant_templates_platform_only on public.tenant_templates
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());
drop policy if exists safex_template_features_platform_only on public.template_features;
create policy safex_template_features_platform_only on public.template_features
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_tenant_features_public_read on public.tenant_features;
create policy safex_tenant_features_public_read on public.tenant_features
  for select to anon using (public.safex_is_active_tenant(tenant_id));
drop policy if exists safex_tenant_features_member_read on public.tenant_features;
create policy safex_tenant_features_member_read on public.tenant_features
  for select to authenticated using (public.safex_is_active_tenant(tenant_id) or public.safex_is_platform_admin());
drop policy if exists safex_tenant_features_platform_manage on public.tenant_features;
create policy safex_tenant_features_platform_manage on public.tenant_features
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_site_feature_overrides_public_read on public.site_feature_overrides;
create policy safex_site_feature_overrides_public_read on public.site_feature_overrides
  for select to anon using (public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_site_feature_overrides_member_read on public.site_feature_overrides;
create policy safex_site_feature_overrides_member_read on public.site_feature_overrides
  for select to authenticated using (public.safex_is_active_site(company_id, location_id) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_site_feature_overrides_manager_manage on public.site_feature_overrides;
create policy safex_site_feature_overrides_manager_manage on public.site_feature_overrides
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_company_profiles_public_read on public.company_profiles;
create policy safex_company_profiles_public_read on public.company_profiles
  for select to anon, authenticated using (public.safex_is_active_tenant(company_id));
drop policy if exists safex_company_profiles_manager_manage on public.company_profiles;
create policy safex_company_profiles_manager_manage on public.company_profiles
  for all to authenticated using (public.safex_is_platform_admin() or public.safex_is_tenant_admin(company_id))
  with check (public.safex_is_platform_admin() or public.safex_is_tenant_admin(company_id));

drop policy if exists safex_site_portal_settings_public_read on public.site_portal_settings;
create policy safex_site_portal_settings_public_read on public.site_portal_settings
  for select to anon, authenticated using (public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_site_portal_settings_manager_manage on public.site_portal_settings;
create policy safex_site_portal_settings_manager_manage on public.site_portal_settings
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_report_type_catalog_public_read on public.report_type_catalog;
create policy safex_report_type_catalog_public_read on public.report_type_catalog
  for select to anon, authenticated using (is_active);
drop policy if exists safex_report_type_catalog_platform_manage on public.report_type_catalog;
create policy safex_report_type_catalog_platform_manage on public.report_type_catalog
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());
drop policy if exists safex_report_category_defaults_platform_only on public.report_category_defaults;
create policy safex_report_category_defaults_platform_only on public.report_category_defaults
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());
drop policy if exists safex_report_categories_public_read on public.report_categories;
create policy safex_report_categories_public_read on public.report_categories
  for select to anon using (is_enabled and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_report_categories_member_read on public.report_categories;
create policy safex_report_categories_member_read on public.report_categories
  for select to authenticated using (public.safex_is_active_site(company_id, location_id) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_report_categories_manager_manage on public.report_categories;
create policy safex_report_categories_manager_manage on public.report_categories
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));
drop policy if exists safex_report_form_fields_public_read on public.report_form_fields;
create policy safex_report_form_fields_public_read on public.report_form_fields
  for select to anon using (is_active and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_report_form_fields_member_read on public.report_form_fields;
create policy safex_report_form_fields_member_read on public.report_form_fields
  for select to authenticated using (public.safex_is_active_site(company_id, location_id) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_report_form_fields_manager_manage on public.report_form_fields;
create policy safex_report_form_fields_manager_manage on public.report_form_fields
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

-- Published content has separate anon and authenticated policies so guests need no manager RPC.
drop policy if exists safex_alerts_public_published_read on public.safety_alerts;
create policy safex_alerts_public_published_read on public.safety_alerts
  for select to anon using (status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_alerts_members_read on public.safety_alerts;
create policy safex_alerts_members_read on public.safety_alerts
  for select to authenticated using ((status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_alerts_manager_manage on public.safety_alerts;
create policy safex_alerts_manager_manage on public.safety_alerts
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_announcements_public_published_read on public.site_announcements;
create policy safex_announcements_public_published_read on public.site_announcements
  for select to anon using (status='published' and published_at is not null and published_at <= now() and (expires_at is null or expires_at > now()) and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_announcements_members_read on public.site_announcements;
create policy safex_announcements_members_read on public.site_announcements
  for select to authenticated using ((status='published' and published_at is not null and published_at <= now() and (expires_at is null or expires_at > now()) and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_announcements_manager_manage on public.site_announcements;
create policy safex_announcements_manager_manage on public.site_announcements
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_events_public_published_read on public.site_events;
create policy safex_events_public_published_read on public.site_events
  for select to anon using (status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_events_members_read on public.site_events;
create policy safex_events_members_read on public.site_events
  for select to authenticated using ((status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_events_manager_manage on public.site_events;
create policy safex_events_manager_manage on public.site_events
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_document_categories_public_read on public.document_categories;
create policy safex_document_categories_public_read on public.document_categories
  for select to anon using (is_active and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_document_categories_member_read on public.document_categories;
create policy safex_document_categories_member_read on public.document_categories
  for select to authenticated using (is_active and public.safex_is_active_site(company_id, location_id) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_document_categories_manager_manage on public.document_categories;
create policy safex_document_categories_manager_manage on public.document_categories
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));
drop policy if exists safex_document_category_defaults_platform_only on public.document_category_defaults;
create policy safex_document_category_defaults_platform_only on public.document_category_defaults
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_documents_public_published_read on public.documents;
create policy safex_documents_public_published_read on public.documents
  for select to anon using (status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_documents_members_read on public.documents;
create policy safex_documents_members_read on public.documents
  for select to authenticated using ((status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_documents_manager_manage on public.documents;
create policy safex_documents_manager_manage on public.documents
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_life_saving_rules_public_read on public.life_saving_rules;
create policy safex_life_saving_rules_public_read on public.life_saving_rules
  for select to anon using (is_active and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_life_saving_rules_member_read on public.life_saving_rules;
create policy safex_life_saving_rules_member_read on public.life_saving_rules
  for select to authenticated using ((is_active and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_life_saving_rules_manager_manage on public.life_saving_rules;
create policy safex_life_saving_rules_manager_manage on public.life_saving_rules
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));
drop policy if exists safex_life_saving_rule_defaults_platform_only on public.life_saving_rule_defaults;
create policy safex_life_saving_rule_defaults_platform_only on public.life_saving_rule_defaults
  for all to authenticated using (public.safex_is_platform_admin())
  with check (public.safex_is_platform_admin());

drop policy if exists safex_training_items_public_read on public.training_items;
create policy safex_training_items_public_read on public.training_items
  for select to anon using (status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id));
drop policy if exists safex_training_items_member_read on public.training_items;
create policy safex_training_items_member_read on public.training_items
  for select to authenticated using ((status='published' and published_at is not null and published_at <= now() and public.safex_is_active_site(company_id, location_id)) or public.safex_has_site_access(company_id, location_id));
drop policy if exists safex_training_items_manager_manage on public.training_items;
create policy safex_training_items_manager_manage on public.training_items
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));

drop policy if exists safex_training_assignments_read on public.training_assignments;
create policy safex_training_assignments_read on public.training_assignments
  for select to authenticated using (
    public.safex_can_manage_site(company_id, location_id)
    or public.safex_is_linked_employee(company_id, employee_id)
  );
drop policy if exists safex_training_assignments_manager_manage on public.training_assignments;
create policy safex_training_assignments_manager_manage on public.training_assignments
  for all to authenticated using (public.safex_can_manage_site(company_id, location_id))
  with check (public.safex_can_manage_site(company_id, location_id));
drop policy if exists safex_training_progress_read on public.training_progress;
create policy safex_training_progress_read on public.training_progress
  for select to authenticated using (
    public.safex_can_manage_site(company_id, location_id)
    or public.safex_is_linked_employee(company_id, employee_id)
  );
drop policy if exists safex_training_progress_self_or_manager_write on public.training_progress;
create policy safex_training_progress_self_or_manager_write on public.training_progress
  for all to authenticated using (
    public.safex_can_manage_site(company_id, location_id)
    or public.safex_is_linked_employee(company_id, employee_id)
  ) with check (
    public.safex_can_manage_site(company_id, location_id)
    or public.safex_is_linked_employee(company_id, employee_id)
  );

drop policy if exists safex_recognitions_public_read on public.recognitions;
create policy safex_recognitions_public_read on public.recognitions
  for select to anon using (is_published and consent_confirmed and public.safex_is_active_site(tenant_id, site_id));
drop policy if exists safex_recognitions_member_read on public.recognitions;
create policy safex_recognitions_member_read on public.recognitions
  for select to authenticated using ((is_published and consent_confirmed and public.safex_is_active_site(tenant_id, site_id)) or public.safex_has_site_access(tenant_id, site_id));
drop policy if exists safex_recognitions_manager_manage on public.recognitions;
create policy safex_recognitions_manager_manage on public.recognitions
  for all to authenticated using (public.safex_can_manage_site(tenant_id, site_id))
  with check (public.safex_can_manage_site(tenant_id, site_id));

drop policy if exists safex_tenant_feature_audit_platform_read on public.tenant_feature_audit;
create policy safex_tenant_feature_audit_platform_read on public.tenant_feature_audit
  for select to authenticated using (public.safex_is_platform_admin() or public.safex_is_tenant_admin(company_id));
drop policy if exists safex_audit_events_platform_read on public.safex_audit_events;
create policy safex_audit_events_platform_read on public.safex_audit_events
  for select to authenticated using (public.safex_is_platform_admin() or (company_id is not null and public.safex_is_tenant_admin(company_id)));

-- Enforce the existing report model's anonymous-report rule without replacing the table.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.reports'::regclass and conname='reports_anonymous_only_speak_up') then
    alter table public.reports add constraint reports_anonymous_only_speak_up
      check (not anonymous or report_type='speak_up');
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Updated-at triggers and read models with the required four context fields
-- -----------------------------------------------------------------------------

-- Attach lightweight updated_at triggers to the new mutable tables.
do $$
declare t text;
begin
  foreach t in array array[
    'company_profiles','site_portal_settings','report_categories','report_form_fields',
    'safety_alerts','site_announcements','site_events','document_categories','documents',
    'life_saving_rules','training_items','training_progress','site_feature_overrides'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'safex_' || t || '_touch_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.safex_set_updated_at()', 'safex_' || t || '_touch_updated_at', t);
  end loop;
end;
$$;

create or replace view public.v_tenant_locations with (security_invoker = true) as
select c.company_id, c.company_code, l.location_id, l.location_name,
       c.company_name, c.company_slug, l.location_code, l.region, l.is_active, l.is_primary, l.timezone
from public.companies c join public.locations l on l.company_id=c.company_id;

create or replace view public.v_effective_site_features with (security_invoker = true) as
select c.company_id, c.company_code, l.location_id, l.location_name,
       f.feature_key, f.display_name, f.section_key, f.section_label, f.description, f.route,
       f.parent_feature_key, f.sort_order, f.is_core, f.is_tenant_toggleable,
       case when tf_new.enabled is false or tf_legacy.enabled is false then false
            else coalesce(sfo.enabled, tf_new.enabled, tf_legacy.enabled, f.default_enabled) end as is_enabled,
       coalesce(tf_legacy.settings, '{}'::jsonb) || coalesce(tf_new.settings, '{}'::jsonb) || coalesce(sfo.settings, '{}'::jsonb) as settings
from public.companies c
join public.locations l on l.company_id=c.company_id
cross join public.feature_catalog f
left join public.tenant_features tf_new on tf_new.tenant_id=c.company_id and tf_new.feature_key=f.feature_key
left join public.tenant_features tf_legacy on tf_legacy.tenant_id=c.company_id and tf_legacy.feature_key=f.legacy_feature_key
left join public.site_feature_overrides sfo on sfo.company_id=c.company_id and sfo.location_id=l.location_id and sfo.feature_key=f.feature_key
where c.status='active' and l.is_active and f.is_active;

create or replace view public.v_site_portal_config with (security_invoker = true) as
select c.company_id, c.company_code, c.company_name, c.company_slug,
       l.location_id, l.location_name, l.location_code, l.region, l.timezone as location_timezone,
       ps.welcome_title, ps.welcome_message, ps.default_language, ps.enabled_languages,
       ps.allow_public_reports, ps.theme_overrides,
       coalesce(cp.display_name, c.company_name) as company_display_name,
       cp.logo_path, cp.primary_color, cp.accent_color, cp.introduction, cp.services,
       coalesce(cp.contact_address, t.company_address) as company_address,
       coalesce(cp.public_email, t.contact_email) as public_email,
       coalesce(cp.public_phone, t.contact_mobile_e164) as public_phone,
       cp.website_url, cp.support_email, cp.support_phone
from public.companies c
join public.locations l on l.company_id=c.company_id
join public.tenants t on t.id=c.company_id
left join public.site_portal_settings ps on ps.company_id=c.company_id and ps.location_id=l.location_id
left join public.company_profiles cp on cp.company_id=c.company_id
where c.status='active' and l.is_active;

create or replace view public.v_safety_reports_with_tenant_context with (security_invoker = true) as
select r.id, r.tenant_id as company_id, t.company_code, r.site_id as location_id, s.name as location_name,
       r.report_ref, r.report_type, r.report_category, r.reporter_employee_id, r.anonymous,
       r.area, r.department, r.occurred_at, r.severity, r.short_description, r.description,
       r.immediate_action, r.status, r.worker_summary_approved, r.created_at, r.updated_at, r.client_submitted_at
from public.reports r
join public.tenants t on t.id=r.tenant_id
join public.sites s on s.id=r.site_id and s.tenant_id=r.tenant_id;

create or replace view public.v_site_safety_alerts with (security_invoker = true) as
select a.id, a.company_id, c.company_code, a.location_id, l.location_name,
       a.alert_reference, a.category_key, a.headline, a.incident_at, a.area_label, a.department_name,
       a.description, a.root_cause, a.immediate_response, a.corrective_actions, a.lessons_learned,
       a.status, a.published_at, a.created_at, a.updated_at
from public.safety_alerts a join public.companies c on c.company_id=a.company_id
join public.locations l on l.location_id=a.location_id and l.company_id=a.company_id;

create or replace view public.v_site_announcements with (security_invoker = true) as
select a.id, a.company_id, c.company_code, a.location_id, l.location_name,
       a.post_type, a.title, a.summary, a.body, a.priority, a.published_on, a.status,
       a.published_at, a.expires_at, a.attachment_path, a.created_at, a.updated_at
from public.site_announcements a join public.companies c on c.company_id=a.company_id
join public.locations l on l.location_id=a.location_id and l.company_id=a.company_id;

create or replace view public.v_site_events with (security_invoker = true) as
select e.id, e.company_id, c.company_code, e.location_id, l.location_name,
       e.title, e.topic, e.description, e.starts_at, e.ends_at, e.venue, e.status,
       e.published_at, e.capacity, e.created_at, e.updated_at
from public.site_events e join public.companies c on c.company_id=e.company_id
join public.locations l on l.location_id=e.location_id and l.company_id=e.company_id;

create or replace view public.v_site_documents with (security_invoker = true) as
select d.id, d.company_id, c.company_code, d.location_id, l.location_name,
       d.category_id, dc.category_key, dc.display_name as category_name,
       d.document_code, d.document_type, d.title, d.summary, d.revision, d.effective_date,
       d.review_due_date, d.storage_path, d.original_filename, d.mime_type, d.status,
       d.published_at, d.created_at, d.updated_at
from public.documents d join public.companies c on c.company_id=d.company_id
join public.locations l on l.location_id=d.location_id and l.company_id=d.company_id
join public.document_categories dc on dc.company_id=d.company_id and dc.location_id=d.location_id and dc.id=d.category_id;

create or replace view public.v_site_training_items with (security_invoker = true) as
select t.id, t.company_id, c.company_code, t.location_id, l.location_name,
       t.item_type, t.title, t.description, t.duration_minutes, t.resource_url, t.storage_path,
       t.mime_type, t.sort_order, t.status, t.is_mandatory, t.published_at, t.created_at, t.updated_at
from public.training_items t join public.companies c on c.company_id=t.company_id
join public.locations l on l.location_id=t.location_id and l.company_id=t.company_id;

create or replace view public.v_site_report_categories with (security_invoker = true) as
select rc.id, rc.company_id, c.company_code, rc.location_id, l.location_name,
       rc.report_type, rc.category_key, rc.display_name, rc.description, rc.icon,
       rc.sort_order, rc.is_enabled, rc.created_at, rc.updated_at
from public.report_categories rc join public.companies c on c.company_id=rc.company_id
join public.locations l on l.location_id=rc.location_id and l.company_id=rc.company_id;

create or replace view public.v_site_report_form_fields with (security_invoker = true) as
select rf.id, rf.company_id, c.company_code, rf.location_id, l.location_name,
       rf.report_type, rf.category_key, rf.field_key, rf.display_label, rf.field_type,
       rf.help_text, rf.is_required, rf.options, rf.sort_order, rf.is_active, rf.created_at, rf.updated_at
from public.report_form_fields rf join public.companies c on c.company_id=rf.company_id
join public.locations l on l.location_id=rf.location_id and l.company_id=rf.company_id;

create or replace view public.v_site_document_categories with (security_invoker = true) as
select dc.id, dc.company_id, c.company_code, dc.location_id, l.location_name,
       dc.category_key, dc.display_name, dc.description, dc.sort_order, dc.is_active
from public.document_categories dc join public.companies c on c.company_id=dc.company_id
join public.locations l on l.location_id=dc.location_id and l.company_id=dc.company_id;

create or replace view public.v_site_life_saving_rules with (security_invoker = true) as
select r.id, r.company_id, c.company_code, r.location_id, l.location_name,
       r.rule_number, r.title, r.description, r.is_active, r.sort_order, r.created_at, r.updated_at
from public.life_saving_rules r join public.companies c on c.company_id=r.company_id
join public.locations l on l.location_id=r.location_id and l.company_id=r.company_id;

create or replace view public.v_site_emergency_contacts with (security_invoker = true) as
select s.tenant_id as company_id, t.company_code, s.id as location_id, s.name as location_name,
       'emergency'::text as contact_type, 'primary'::text as contact_label, s.sos_phone_e164 as phone, true as is_primary
from public.sites s join public.tenants t on t.id=s.tenant_id
where s.active and t.active and s.sos_phone_e164 is not null
union all
select s.tenant_id as company_id, t.company_code, s.id as location_id, s.name as location_name,
       'emergency'::text as contact_type, 'backup'::text as contact_label, s.sos_backup_phone_e164 as phone, false as is_primary
from public.sites s join public.tenants t on t.id=s.tenant_id
where s.active and t.active and s.sos_backup_phone_e164 is not null;

create or replace view public.v_site_recognition_items with (security_invoker = true) as
select r.id, r.tenant_id as company_id, t.company_code, r.site_id as location_id, s.name as location_name,
       r.employee_name, r.reward_for as title, r.image_url as image_path,
       r.artwork_index, r.sort_order, r.is_published, r.created_at, r.updated_at
from public.recognitions r join public.tenants t on t.id=r.tenant_id
join public.sites s on s.id=r.site_id and s.tenant_id=r.tenant_id;

create or replace view public.v_site_training_assignments with (security_invoker = true) as
select ta.id, ta.company_id, c.company_code, ta.location_id, l.location_name,
       ta.training_item_id, ta.employee_id, ta.department_name, ta.due_at, ta.created_at
from public.training_assignments ta join public.companies c on c.company_id=ta.company_id
join public.locations l on l.location_id=ta.location_id and l.company_id=ta.company_id;

create or replace view public.v_site_training_progress with (security_invoker = true) as
select tp.id, tp.company_id, c.company_code, tp.location_id, l.location_name,
       tp.training_item_id, tp.employee_id, tp.status, tp.progress_percent, tp.score,
       tp.started_at, tp.completed_at, tp.last_position_seconds, tp.updated_at
from public.training_progress tp join public.companies c on c.company_id=tp.company_id
join public.locations l on l.location_id=tp.location_id and l.company_id=tp.company_id;

create or replace view public.v_site_report_updates with (security_invoker = true) as
select e.id, e.tenant_id as company_id, t.company_code, e.site_id as location_id, s.name as location_name,
       e.report_id, e.old_status as status_from, e.new_status as status_to,
       e.public_note as message, e.created_at
from public.report_status_events e join public.tenants t on t.id=e.tenant_id
join public.sites s on s.id=e.site_id and s.tenant_id=e.tenant_id;

-- -----------------------------------------------------------------------------
-- 9. One-click tenant/site provisioning RPCs using the live legacy master tables
-- -----------------------------------------------------------------------------

create or replace function public.safex_provision_company_with_location(
  p_company_name text,
  p_company_code text,
  p_company_slug text,
  p_location_name text,
  p_location_code text,
  p_template_key text default 'standard_safety_portal',
  p_initial_admin_user_id uuid default null
)
returns table (company_id uuid, location_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_location_slug text;
begin
  if not public.safex_is_platform_admin() then
    raise exception 'Only a Safex platform super admin can provision a company.' using errcode='42501';
  end if;
  if p_company_name is null or length(trim(p_company_name))=0 then
    raise exception 'Company name is required.' using errcode='22023';
  end if;
  if p_company_code is null or p_company_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Company code must be 1-32 letters, numbers, underscore or hyphen.' using errcode='22023';
  end if;
  if p_company_slug is null or lower(trim(p_company_slug)) !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Company slug must be lowercase URL-safe text.' using errcode='22023';
  end if;
  if p_location_name is null or length(trim(p_location_name))=0 then
    raise exception 'Location name is required.' using errcode='22023';
  end if;
  if p_location_code is null or p_location_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Location code must be 1-32 letters, numbers, underscore or hyphen.' using errcode='22023';
  end if;
  if not exists (select 1 from public.tenant_templates t where t.template_key=p_template_key and t.is_active) then
    raise exception 'Unknown or inactive template: %', p_template_key using errcode='22023';
  end if;
  v_location_slug := lower(regexp_replace(trim(p_location_code), '[^A-Za-z0-9]+', '-', 'g'));

  insert into public.tenants (company_name, company_code, slug, active)
  values (trim(p_company_name), upper(trim(p_company_code)), lower(trim(p_company_slug)), true)
  returning id into v_company_id;

  insert into public.sites (tenant_id, name, slug, location_code, active, is_primary)
  values (v_company_id, trim(p_location_name), v_location_slug, upper(trim(p_location_code)), true, true)
  returning id into v_location_id;

  -- The tenant trigger seeds the standard template; replace with the selected template atomically.
  delete from public.tenant_features where tenant_id=v_company_id;
  insert into public.tenant_features (tenant_id, feature_key, enabled, settings)
  select v_company_id, f.feature_key,
         case when not f.is_tenant_toggleable then f.default_enabled else coalesce(tf.is_enabled, false) end,
         coalesce(tf.settings, '{}'::jsonb)
  from public.feature_catalog f
  left join public.template_features tf on tf.template_key=p_template_key and tf.feature_key=f.feature_key
  where f.is_active or f.feature_key in ('voice_reporting','library','circulars','reward_wall')
  on conflict (tenant_id, feature_key) do update
    set enabled=excluded.enabled, settings=excluded.settings, updated_by=auth.uid(), updated_at=now();

  if p_initial_admin_user_id is not null then
    insert into public.staff_memberships (tenant_id, site_id, user_id, role, active)
    values (v_company_id, null, p_initial_admin_user_id, 'tenant_admin', true);
  end if;

  insert into public.safex_audit_events
    (company_id, location_id, actor_user_id, action, resource_type, resource_id, details)
  values (v_company_id, v_location_id, auth.uid(), 'company.provisioned', 'company', v_company_id::text,
          jsonb_build_object('company_code',upper(trim(p_company_code)),'template_key',p_template_key));

  return query select v_company_id, v_location_id;
end;
$$;

create or replace function public.safex_add_company_location(
  p_company_id uuid,
  p_location_name text,
  p_location_code text,
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_location_id uuid;
  v_location_slug text;
begin
  if not (public.safex_is_platform_admin() or public.safex_is_tenant_admin(p_company_id)) then
    raise exception 'Only a company admin or platform super admin can add a location.' using errcode='42501';
  end if;
  if p_location_name is null or length(trim(p_location_name))=0 then
    raise exception 'Location name is required.' using errcode='22023';
  end if;
  if p_location_code is null or p_location_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$' then
    raise exception 'Location code must be 1-32 letters, numbers, underscore or hyphen.' using errcode='22023';
  end if;
  v_location_slug := lower(regexp_replace(trim(p_location_code), '[^A-Za-z0-9]+', '-', 'g'));
  if p_is_primary then
    update public.sites set is_primary=false where tenant_id=p_company_id and is_primary;
  end if;
  insert into public.sites (tenant_id,name,slug,location_code,active,is_primary)
  values (p_company_id,trim(p_location_name),v_location_slug,upper(trim(p_location_code)),true,p_is_primary)
  returning id into v_location_id;
  insert into public.safex_audit_events
    (company_id,location_id,actor_user_id,action,resource_type,resource_id,details)
  values (p_company_id,v_location_id,auth.uid(),'location.created','location',v_location_id::text,
          jsonb_build_object('location_code',upper(trim(p_location_code))));
  return v_location_id;
end;
$$;

revoke all on function public.safex_provision_company_with_location(text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.safex_provision_company_with_location(text,text,text,text,text,text,uuid) to authenticated;
revoke all on function public.safex_add_company_location(uuid,text,text,boolean) from public, anon;
grant execute on function public.safex_add_company_location(uuid,text,text,boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Explicit grants. RLS applies to anon/authenticated; service_role remains server-only.
-- -----------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- Remove any permissive default grants only from the new objects created here.
revoke all privileges on table
  public.feature_catalog, public.tenant_templates, public.template_features, public.site_feature_overrides,
  public.company_profiles, public.site_portal_settings, public.report_type_catalog, public.report_category_defaults,
  public.report_categories, public.report_form_fields, public.safety_alerts, public.site_announcements,
  public.site_events, public.document_category_defaults, public.document_categories, public.documents,
  public.life_saving_rule_defaults, public.life_saving_rules, public.training_items,
  public.training_assignments, public.training_progress, public.tenant_feature_audit, public.safex_audit_events,
  public.companies, public.locations, public.v_tenant_locations, public.v_effective_site_features,
  public.v_site_portal_config, public.v_safety_reports_with_tenant_context, public.v_site_safety_alerts,
  public.v_site_announcements, public.v_site_events, public.v_site_documents, public.v_site_training_items,
  public.v_site_report_categories, public.v_site_report_form_fields, public.v_site_document_categories,
  public.v_site_life_saving_rules, public.v_site_emergency_contacts, public.v_site_recognition_items,
  public.v_site_training_assignments, public.v_site_training_progress, public.v_site_report_updates
from public, anon;

-- Public company/location directory and public contact/context columns.
grant select (id, company_code, company_name, slug, active, timezone, company_address, contact_email, contact_mobile_e164, logo_path, created_at, updated_at)
  on table public.tenants to anon, authenticated;
grant select (id, tenant_id, location_code, name, region, active, is_primary, timezone, sos_phone_e164, sos_backup_phone_e164, created_at, updated_at)
  on table public.sites to anon, authenticated;

grant select on table public.feature_catalog, public.report_type_catalog,
  public.report_categories, public.report_form_fields, public.document_categories,
  public.life_saving_rules, public.site_portal_settings to anon, authenticated;
grant select (tenant_id, feature_key, enabled, settings)
  on table public.tenant_features to anon, authenticated;
grant select, insert, update, delete on table public.tenant_features to authenticated;
grant select on table public.report_status_events to authenticated;
grant select (company_id, location_id, feature_key, enabled, settings)
  on table public.site_feature_overrides to anon, authenticated;
grant select (company_id, display_name, introduction, services, contact_address, public_email, public_phone,
  website_url, support_email, support_phone, logo_path, primary_color, accent_color)
  on table public.company_profiles to anon, authenticated;

grant select (id, company_id, location_id, alert_reference, category_key, headline, incident_at,
  area_label, department_name, description, root_cause, immediate_response, corrective_actions,
  lessons_learned, status, published_at, created_at, updated_at) on table public.safety_alerts to anon;
grant select (id, company_id, location_id, post_type, title, summary, body, priority, published_on,
  status, published_at, expires_at, attachment_path, created_at, updated_at) on table public.site_announcements to anon;
grant select (id, company_id, location_id, title, topic, description, starts_at, ends_at, venue,
  status, published_at, capacity, created_at, updated_at) on table public.site_events to anon;
grant select (id, company_id, location_id, category_id, document_code, document_type, title, summary,
  revision, effective_date, review_due_date, storage_path, original_filename, mime_type, status,
  published_at, created_at, updated_at) on table public.documents to anon;
grant select (id, company_id, location_id, item_type, title, description, duration_minutes, resource_url,
  storage_path, mime_type, sort_order, status, is_mandatory, published_at, created_at, updated_at)
  on table public.training_items to anon;
grant select (id, tenant_id, site_id, employee_name, reward_for, image_url, artwork_index, consent_confirmed,
  is_published, sort_order, created_at, updated_at) on table public.recognitions to anon;

-- Authenticated staff and the trusted server can operate on app tables; RLS is the boundary.
grant select, insert, update, delete on table
  public.feature_catalog, public.tenant_templates, public.template_features, public.site_feature_overrides,
  public.company_profiles, public.site_portal_settings, public.report_type_catalog, public.report_category_defaults,
  public.report_categories, public.report_form_fields, public.safety_alerts, public.site_announcements,
  public.site_events, public.document_category_defaults, public.document_categories, public.documents,
  public.life_saving_rule_defaults, public.life_saving_rules, public.training_items,
  public.training_assignments, public.training_progress, public.tenant_feature_audit, public.safex_audit_events,
  public.recognitions to authenticated;
grant select, insert, update, delete on table
  public.feature_catalog, public.tenant_templates, public.template_features, public.site_feature_overrides,
  public.company_profiles, public.site_portal_settings, public.report_type_catalog, public.report_category_defaults,
  public.report_categories, public.report_form_fields, public.safety_alerts, public.site_announcements,
  public.site_events, public.document_category_defaults, public.document_categories, public.documents,
  public.life_saving_rule_defaults, public.life_saving_rules, public.training_items,
  public.training_assignments, public.training_progress, public.tenant_feature_audit, public.safex_audit_events,
  public.recognitions to service_role;

-- Employees may advance only their own progress fields; scores/admin changes stay server-side.
revoke insert, update, delete on table public.training_progress from authenticated;
grant select on table public.training_progress to authenticated;
grant insert (company_id, location_id, training_item_id, employee_id, status, progress_percent, started_at, last_position_seconds)
  on table public.training_progress to authenticated;
grant update (status, progress_percent, started_at, completed_at, last_position_seconds, updated_at)
  on table public.training_progress to authenticated;

grant select on public.companies, public.locations, public.v_tenant_locations,
  public.v_effective_site_features, public.v_site_portal_config,
  public.v_site_safety_alerts, public.v_site_announcements, public.v_site_events,
  public.v_site_documents, public.v_site_training_items, public.v_site_report_categories,
  public.v_site_report_form_fields, public.v_site_document_categories,
  public.v_site_life_saving_rules, public.v_site_emergency_contacts,
  public.v_site_recognition_items to anon, authenticated, service_role;
grant select on public.v_safety_reports_with_tenant_context, public.v_site_training_assignments,
  public.v_site_training_progress, public.v_site_report_updates to authenticated, service_role;

-- Trusted server writes use existing service_role grants on legacy tables; no anon DML is granted.
