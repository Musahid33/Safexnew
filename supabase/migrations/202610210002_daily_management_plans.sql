-- Daily Management Plans, recorded by the admin console.
--
-- The DM form used to live in a Google Apps Script app; the console now records the same
-- plan itself so the data sits with the rest of the site's safety records. One row per
-- submitted plan, the whole form in `payload`, and a generated PDF archived in Storage.
--
-- `reference` is the document number the operator sees: DM-DD-MM-YY (e.g. DM-21-10-26).
-- It is unique per tenant because two plans filed the same day get a -2, -3 suffix rather
-- than overwriting each other.

create table if not exists public.daily_management_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  site_id uuid not null,
  plan_date date not null,
  reference text not null,
  shift text,
  supervisor_name text,
  supervisor_employee_no text,
  location text,
  payload jsonb not null default '{}'::jsonb,
  -- Counted at save time so DM Records can show progress without reading every payload.
  modules_filled smallint not null default 0,
  status text not null default 'submitted' check (status in ('draft', 'submitted')),
  pdf_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_management_plans_tenant_ref_key unique (tenant_id, reference),
  constraint daily_management_plans_site_fkey foreign key (site_id, tenant_id)
    references public.sites (id, tenant_id) on delete cascade
);

create index if not exists daily_management_plans_site_date_idx
  on public.daily_management_plans (site_id, plan_date desc);

comment on table public.daily_management_plans is
  'Filled Daily Management Plan (11 modules) per site and date. Payload holds the form; the PDF is archived in Storage.';

-- Accessed only through the admin API with the service role; no browser role may read it.
alter table public.daily_management_plans enable row level security;

-- Private bucket for the generated PDFs. Service role writes; downloads go through the
-- session-gated API rather than a signed public URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dm-records', 'dm-records', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
