# Safex / EMVEESS Safety — live Supabase schema

## Implementation status (20 Oct 2026)

The additive schema migration was applied successfully to the existing **SafexNew** Supabase project (`mclrajfcrjdrlmoqwbdw`, `ap-south-1`). Its Supabase migration-history version is `20261020171922`, name `safex_existing_schema_extension`.

This preserves the existing `tenants`, `sites`, `employees`, `reports`, `report_status_events`, `recognitions`, `push_subscriptions`, and other live tables. It does not replace the tenant/site model or import the public website's sample/demo records. After the schema rollout but before the employee-list bootstrap, those legacy tables had zero rows. The user then authorized a one-time database-owner setup and import: the live project now has one company, one site, and 193 employee rows. Existing reports, recognitions, and push subscriptions remain empty.

- Active migration file: `supabase/migrations/20261020171922_safex_existing_schema_extension.sql`
- Incompatible greenfield draft: moved out of the active migration folder to `supabase/archive/20261020000000_safex_multitenant_core.sql`; do **not** apply it to SafexNew.
- Supabase validation: 23/23 new tables have RLS enabled; 49 policies exist on those tables; all 20 expected views exist; no anonymous `INSERT`/`UPDATE`/`DELETE` grants exist on the new tables. Feature catalog: 28 rows; standard template: 28 feature rows; report-type catalog: 9 rows.
- The schema and employee master are live. The public GitHub repository contains the frontend and a Supabase-backed employee API, but the live `/api/bootstrap` still reports `directory: unavailable`; the current Vercel account cannot access the project, so no deployment was made. The existing public site remains <https://safexnew.vercel.app/>.

## Product and tenant model

One shared frontend serves multiple companies. Company setup, enabled features, and site-specific settings are controlled by a Safex platform super-admin. Each company may have multiple locations.

The existing database's canonical masters are:

- `public.tenants`: company ID `id`, name `company_name`, slug, active state, contact/address/logo fields. The migration adds required `company_code` (case-insensitive unique) and `timezone`.
- `public.sites`: location ID `id`, parent company `tenant_id`, location name `name`, slug, active state, region, and SOS phone fields. The migration adds required `location_code` (unique per tenant), `is_primary`, and `timezone`.

The legacy transaction tables keep their established `tenant_id` / `site_id` columns. New tables use required `company_id` and `location_id`, with composite foreign keys to ensure a location belongs to the selected company. Compatibility/read views expose the required four-field context together: **`company_id`, `company_code`, `location_id`, and `location_name`**. The `companies` and `locations` views are aliases over the existing master tables—not replacement tables.

The current provisioned context is:

- Company: **Emveess Infraventures Pvt.Ltd** — code `EMVEESS`, ID `d3d586dd-9f77-4363-b9ef-7e1a75e82bf3`.
- Location: **WEST BOKARO GHATO** — code `WBD`, ID `615470fa-b2d9-4589-82ad-a98e97ccf64a`.

Key live objects include `public.staff_memberships`, `public.safex_platform_admins`, `public.tenant_features`, `public.employees`, `public.reports`, `public.report_status_events`, `public.recognitions`, and `public.push_subscriptions`. The migration retains their existing identifiers and data model, and adds a required `recognitions.site_id` with a composite company/site foreign key.

## Frontend feature catalog

Feature keys and display names follow the existing shared frontend. The catalog covers:

- Safety Portal; LIFE SAVING RULE; Near Miss; Hazard; Safety Observation; Feedback; Grievance / Speak Up; Suggestion; View Reports.
- Training Management; Safety Alerts; Circulars & Notices; Upcoming Events; Document Vault / Library; Rewards & Recognition Gallery.
- SOS emergency contact; Push notifications; Install App; Vendor / Company About Us; Search Employee Profile; Account Login; Appearance; About App.

`feature_catalog` centralizes names, sections, routes, ordering, default/toggle status, and feature settings schema. `tenant_templates` and `template_features` define default entitlements. Existing legacy keys (`voice_reporting`, `training_management`, `library`, `circulars`, `reward_wall`, `push_notifications`) are retained as compatibility keys. `tenant_features` remains the company-level feature state; `site_feature_overrides` can specialize a feature per location. A disabled company feature stays disabled even if a site override requests otherwise.

`v_effective_site_features` combines catalog defaults, legacy/current company feature rows, and location overrides. Its `is_enabled` field is the intended shared-frontend switch for cards, routes, and navigation.

## Employee master import

The published Google Sheet supplied by the user was imported into the existing `public.employees` table for the company/location above. The import was performed as a one-time database-owner operation because the user asked to skip the Auth UUID for now; **no platform super-admin or tenant-admin membership was added**.

- Imported **193** rows with unique Employee IDs; **191** are active and the 2 rows with blank status were set inactive.
- Mapped Employee ID → `employee_no`, Name → `full_name`, Safety Pass No → `safety_pass_no`, Designation → `designation`, and JNTVTI Skill Grade → `skill_grade`. The Contractor column matches the tenant and is represented by `tenant_id`, not duplicated per employee.
- Normalized unique 10-digit Indian mobile numbers to `+91…`. Missing/malformed numbers and numbers shared by multiple employees were left `NULL`: 179 rows have a distinct mobile and 14 do not. Repeated numbers should be individually verified before being enabled for OTP.
- Excluded blood group, home address, and photo/Drive links. No row-level employee export is stored in the workspace.
- `source` is `employee_master_sync`; an audit event records the import.

Post-import checks confirmed all 193 employees reference the company and site, Employee IDs are unique, no imported mobile values are duplicated, RLS is enabled on `employees`, and `anon` has no `SELECT` privilege. The platform-admin allow-list and company staff memberships remain empty, so staff-management workflows require a later authorized admin bootstrap. The narrow public Employee ID lookup does not require a platform-admin UUID; it uses the service role on the server, and production currently reports `directory: unavailable` until Vercel's server-side URL/key/source/tenant configuration is corrected.

## Added data model

The migration adds 23 RLS-protected tables:

- **Platform/features:** `feature_catalog`, `tenant_templates`, `template_features`, `site_feature_overrides`, `tenant_feature_audit`, `safex_audit_events`.
- **Company/site configuration:** `company_profiles`, `site_portal_settings`.
- **Report UI configuration:** `report_type_catalog`, `report_category_defaults`, `report_categories`, `report_form_fields`.
- **Published content:** `safety_alerts`, `site_announcements`, `site_events`.
- **Documents/rules/training:** `document_category_defaults`, `document_categories`, `documents`, `life_saving_rule_defaults`, `life_saving_rules`, `training_items`, `training_assignments`, `training_progress`.

The existing `reports` table remains the report record store. `report_type_catalog` describes form types and `report_categories` / `report_form_fields` configure the site-specific forms. The categories preserve the observed labels: Hazard (Reporting Accident, Property Damage, Red Risk Incident); Safety Observation (Unsafe Condition, Unsafe Act, Safe Observation); Feedback (PPE, tools/equipment, training, grievance feedback, amenities/welfare, closure); Grievance; and Suggestion.

`Speak Up` supports anonymous reports. A database check rejects anonymous rows whose `report_type` is not `speak_up`. Do not store a reporter/user identity in an anonymous submission or in its free-form answers. Other report types should be submitted only after the required employee/site validation.

The site trigger seeds settings, report categories, document categories, and 10 Life Saving Rules when a real site is provisioned. It does **not** create demo alerts, event records, training videos, files, real SOS numbers, or fake companies/employees.

## Context/read views

All expected views were created successfully:

- Tenant/site and feature configuration: `companies`, `locations`, `v_tenant_locations`, `v_effective_site_features`, `v_site_portal_config`.
- Existing report context/status updates: `v_safety_reports_with_tenant_context`, `v_site_report_updates`.
- Site content: `v_site_safety_alerts`, `v_site_announcements`, `v_site_events`, `v_site_documents`, `v_site_training_items`, `v_site_report_categories`, `v_site_report_form_fields`, `v_site_document_categories`, `v_site_life_saving_rules`, `v_site_emergency_contacts`, `v_site_recognition_items`.
- Authenticated, RLS-filtered workflow data: `v_site_training_assignments`, `v_site_training_progress`.

Example frontend reads, after resolving a real company and location:

```sql
select *
from public.v_site_portal_config
where company_id = '<COMPANY_UUID>'
  and location_id = '<LOCATION_UUID>';

select feature_key, display_name, section_key, sort_order, is_enabled, settings
from public.v_effective_site_features
where company_id = '<COMPANY_UUID>'
  and location_id = '<LOCATION_UUID>'
order by sort_order;

select *
from public.v_safety_reports_with_tenant_context
where company_id = '<COMPANY_UUID>'
  and location_id = '<LOCATION_UUID>';
```

## One-click company/location provisioning

The live RPC names are:

- `public.safex_provision_company_with_location(...)` — platform-super-admin only; creates the tenant and first location, company profile, template feature rows, site defaults, optional first `tenant_admin`, and an audit event.
- `public.safex_add_company_location(...)` — adds a location for a company admin or platform super-admin and seeds the site defaults.

Example call (replace placeholders with approved production values):

```sql
select * from public.safex_provision_company_with_location(
  p_company_name          => 'Example Company',
  p_company_code          => 'EXAMPLE01',
  p_company_slug          => 'example-company',
  p_location_name         => 'Main Site',
  p_location_code         => 'MAIN',
  p_template_key          => 'standard_safety_portal',
  p_initial_admin_user_id => '<AUTH_USER_UUID>'::uuid
);
```

**Super-admin bootstrap is still pending.** The user asked to skip the Auth UUID for now, so the confirmed company/location and employee import were performed as a one-time database-owner SQL operation instead of the super-admin-only provisioning RPC. No platform admin or company staff membership was created. The live allow-list is `public.safex_platform_admins(user_id, active, created_at)`, not `platform_admins`; it still has zero rows, so authenticated users cannot yet call the company-provisioning RPC or manage this tenant. To enable that workflow later, a project owner should create/confirm the intended admin in Supabase Auth, then add that exact user UUID through the Supabase SQL Editor:

```sql
insert into public.safex_platform_admins (user_id)
values ('<APPROVED_AUTH_USER_UUID>'::uuid);
```

Do not put the service-role key in the browser. The provisioning functions are not executable by `anon` and perform their own role checks.

## Security and remaining application work

- RLS is enabled on every new table. The new tables have no anonymous DML grants. Anonymous reads are limited to active public configuration/published content and selected columns. The employee and report base tables have no anonymous `SELECT` grant.
- Use server-side endpoints for public report submission, employee lookup, All Site Reports verification, and uploads. The repository already implements `/api/employees` with same-origin checks, no-store responses, rate limiting, and an exact public projection of Employee ID, name, and designation. It scopes lookups to the selected site and configured tenant; the Vercel server key and tenant settings still need to be verified. Do not expose direct report writes, employee PII, OTP values, or Storage service credentials to the browser.
- The All Site Reports flow must verify Employee ID + registered mobile + OTP on the server and scope results to the correct company/location.
- Anonymous Speak Up should not carry employee/user identifiers. Rate-limit public submission and add abuse controls (for example CAPTCHA). The migration does not create a public insert policy for reports.
- Store uploaded files in private Supabase Storage and issue short-lived authorized URLs. Seed verified SOS numbers and real content only after the company supplies them.
- Review policies with separate platform-admin, company-admin, site-staff, and employee test accounts across at least two real test tenants. The live project currently has one tenant/site and no second tenant, so cross-tenant runtime tests have not yet been performed.
- The migration provides database structures and RPCs, and the initial employee master has now been imported. The repository contains the narrow employee lookup API, Supabase adapter, and an import/sync script. OTP provider integration, push-notification sending, Storage buckets, and production deployment remain separate work.

## Vercel status / next dependency

The Vercel connector currently cannot access a project matching `SafexNew`; the user-supplied project ID returned 404 for the connected account. The public app's `/api/bootstrap` currently reports the employee directory as unavailable, while `/api/health` reports report sync disabled. No deployment was attempted. Restore access to the Vercel project, configure the Supabase URL, server-only service-role key, `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto`, and tenant slug `emveess-infraventures`, then verify the project/domain before redeploying.
