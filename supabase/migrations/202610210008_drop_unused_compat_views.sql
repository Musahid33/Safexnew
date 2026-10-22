-- Remove the unused compatibility/read views.
--
-- The schema extension created 20 views (`companies`, `locations`, `v_tenant_locations`, the
-- `v_site_*` family and `v_safety_reports_with_tenant_context`) for a browser-facing PostgREST
-- read path. That path was never built: every read in the app goes through a server route that
-- holds the service-role key and queries the base tables directly, and `02_rls.sql` deliberately
-- denies browser roles every direct grant. An unused view is therefore an unauthenticated read
-- surface with no consumer.
--
-- Verified before dropping: 0 call sites in app/, lib/, scripts/ and tests/; no policy, function,
-- index or default privilege references any view name; the only dependency between views was each
-- `v_site_*` selecting the `companies`/`locations` views, so they are dropped first.
--
-- The definitions remain in 20261020171922_safex_existing_schema_extension.sql and can be
-- restored from git if a future feature wants one. No base table is touched.

drop view if exists public.v_effective_site_features;
drop view if exists public.v_safety_reports_with_tenant_context;
drop view if exists public.v_site_announcements;
drop view if exists public.v_site_document_categories;
drop view if exists public.v_site_documents;
drop view if exists public.v_site_emergency_contacts;
drop view if exists public.v_site_events;
drop view if exists public.v_site_life_saving_rules;
drop view if exists public.v_site_portal_config;
drop view if exists public.v_site_recognition_items;
drop view if exists public.v_site_report_categories;
drop view if exists public.v_site_report_form_fields;
drop view if exists public.v_site_report_updates;
drop view if exists public.v_site_safety_alerts;
drop view if exists public.v_site_training_assignments;
drop view if exists public.v_site_training_items;
drop view if exists public.v_site_training_progress;
drop view if exists public.v_tenant_locations;

-- These two are selected by most of the views above, so they go last.
drop view if exists public.companies;
drop view if exists public.locations;
