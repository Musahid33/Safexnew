-- Run after the initial Safex migration. Recognition entries belong to a tenant.
-- Only the server (service role) may read/write these records; the public gallery API
-- returns only consented, published names and reasons.
create table if not exists public.recognitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_name text not null check (length(btrim(employee_name)) between 1 and 120),
  reward_for text not null check (length(btrim(reward_for)) between 1 and 300),
  image_url text,
  artwork_index integer not null default 0 check (artwork_index between 0 and 2),
  consent_confirmed boolean not null default false,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognitions_publish_consent check (not is_published or consent_confirmed)
);
create index if not exists recognitions_gallery_idx
  on public.recognitions (tenant_id, is_published, sort_order, created_at desc);
alter table public.recognitions enable row level security;
revoke all on public.recognitions from public, anon, authenticated;
grant all on public.recognitions to service_role;
