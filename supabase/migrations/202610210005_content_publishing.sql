-- Publishing for the worker app: document vault + circulars / notices / events.
--
-- The tables already exist (20261020171922_safex_existing_schema_extension.sql) and are
-- RLS-protected with service_role grants. This migration only adds what the publishing panel
-- needs on top of them, and seeds the four vault shelves for sites that existed before the
-- site trigger was installed.

-- A published document may be a link instead of an uploaded file (a Google Drive PDF, an
-- intranet page). Both paths are private-checked at read time; a URL must be https.
alter table public.documents
  add column if not exists external_url text;
alter table public.site_announcements
  add column if not exists external_url text;

-- The panel lets the safety team order a shelf; the app sorts on this column.
alter table public.documents
  add column if not exists sort_order integer not null default 0;

alter table public.documents
  drop constraint if exists documents_sort_order_range;
alter table public.documents
  add constraint documents_sort_order_range check (sort_order between 0 and 9999);

alter table public.documents
  drop constraint if exists documents_external_url_https;
alter table public.documents
  add constraint documents_external_url_https
  check (external_url is null or external_url ~* '^https://[^[:space:]]+$');

alter table public.site_announcements
  drop constraint if exists site_announcements_external_url_https;
alter table public.site_announcements
  add constraint site_announcements_external_url_https
  check (external_url is null or external_url ~* '^https://[^[:space:]]+$');

-- The app reads one site's published rows, newest first, on every open.
create index if not exists documents_site_published_idx
  on public.documents (company_id, location_id, status, sort_order, published_at desc);
create index if not exists site_announcements_site_published_idx
  on public.site_announcements (company_id, location_id, status, published_on desc);
create index if not exists site_events_site_published_idx
  on public.site_events (company_id, location_id, status, starts_at);

-- Seed the four shelves the app shows for every existing site. The provisioning trigger only
-- ran for sites created afterwards, so WBD has no rows yet.
insert into public.document_categories (company_id, location_id, category_key, display_name, description, sort_order)
select s.tenant_id, s.id, d.category_key, d.display_name, d.description, d.sort_order
from public.sites s
join public.document_category_defaults d
  on d.category_key in ('sop_swp', 'risk_assessments', 'legal_statutory_compliance', 'policy_procedures')
on conflict (company_id, location_id, category_key) do nothing;

-- Private bucket for published files. Nothing is served from here directly: the app links to
-- /api/content/file/... which checks the row is published and then redirects to a 2-minute
-- signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'safex-content',
  'safex-content',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

-- The trusted server writes with the service role; no anonymous write path is added.
grant select, insert, update, delete on table public.documents, public.document_categories,
  public.site_announcements, public.site_events to service_role;
