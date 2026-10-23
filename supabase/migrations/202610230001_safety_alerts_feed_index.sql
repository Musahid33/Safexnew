-- Safety alerts are published from the console now.
--
-- The table itself ships with the base schema (20261020171922_safex_existing_schema_extension).
-- This only adds the index the reader actually uses — one site's published alerts, newest
-- incident first — and the updated_at trigger the other published tables already have, so an
-- edit is visible to the console without the writer having to remember the column.

create index if not exists safety_alerts_site_feed_idx
  on public.safety_alerts (company_id, location_id, status, incident_at desc);

create index if not exists safety_alerts_published_at_idx
  on public.safety_alerts (company_id, location_id, published_at desc)
  where status = 'published';

-- Keep updated_at honest even if a row is touched outside the app.
create or replace function public.safety_alerts_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists safety_alerts_touch_updated_at on public.safety_alerts;
create trigger safety_alerts_touch_updated_at
  before update on public.safety_alerts
  for each row execute function public.safety_alerts_touch_updated_at();

-- Same posture as the other publishing tables: service role writes, RLS decides who reads.
alter table public.safety_alerts enable row level security;
revoke insert, update, delete on public.safety_alerts from anon, authenticated;
grant select (id, company_id, location_id, alert_reference, category_key, headline, incident_at,
  area_label, department_name, description, root_cause, immediate_response, corrective_actions,
  lessons_learned, status, published_at, created_at, updated_at) on table public.safety_alerts to anon;
grant all on public.safety_alerts to service_role;
