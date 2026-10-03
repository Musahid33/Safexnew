-- Durable offline report sync support. Apply only after reviewing the base Safex schema.
-- Public submissions remain disabled until the server-side flag, verified tenant domain,
-- Supabase service key, and this migration are configured together.

alter table public.reports
  add column if not exists client_submitted_at timestamptz;

-- The current report form accepts one optional photo per report.
create unique index if not exists report_attachments_one_per_report_idx
  on public.report_attachments (report_id);

create table if not exists public.public_report_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);
alter table public.public_report_rate_limits enable row level security;
revoke all on public.public_report_rate_limits from public, anon, authenticated;
grant all on public.public_report_rate_limits to service_role;

create or replace function public.safex_consume_report_limit(
  p_bucket_key text,
  p_window_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean;
begin
  if p_limit < 1 or p_limit > 100 or length(p_bucket_key) < 32 or length(p_bucket_key) > 128 then
    raise exception 'invalid rate limit arguments';
  end if;

  delete from public.public_report_rate_limits
    where window_started_at < now() - interval '48 hours';

  insert into public.public_report_rate_limits (bucket_key, window_started_at, request_count)
    values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key) do update
      set request_count = public.public_report_rate_limits.request_count + 1,
          updated_at = now()
      where public.public_report_rate_limits.request_count < p_limit
    returning request_count <= p_limit into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;
revoke all on function public.safex_consume_report_limit(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.safex_consume_report_limit(text, timestamptz, integer) to service_role;

-- Original evidence remains private; the browser and service worker never cache API responses.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'safex-report-attachments',
  'safex-report-attachments',
  false,
  12582912,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
