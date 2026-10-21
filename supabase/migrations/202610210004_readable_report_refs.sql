-- Readable report references.
--
-- Reports created before this change are stored as `OFFLINE-<submission uuid>`, e.g.
-- `OFFLINE-72138a64-cb38-445d-88c9-7bfa7a328c19`. The app already renders those as the new
-- type-prefixed form (`UA-72138A64`), so this migration only aligns the stored value that the
-- safety console, exports and printed reports read.
--
-- The rule matches lib/reports/report-ref.ts exactly: type prefix, hyphen, the first eight
-- alphanumerics of the submission uuid in upper case. Rows whose new reference would collide
-- with an existing one (or with another row in the same tenant) are left untouched — never
-- guess, never overwrite a reference somebody may already have quoted.

with candidates as (
  select
    id,
    tenant_id,
    case report_type
      when 'near_miss' then 'NM'
      when 'hazard' then 'HZ'
      when 'safety_observation' then 'SO'
      when 'unsafe_condition' then 'UC'
      when 'unsafe_act' then 'UA'
      when 'speak_up' then 'SU'
      when 'grievance' then 'GR'
      when 'feedback' then 'FB'
      when 'suggestion' then 'SG'
      else 'RP'
    end || '-' || upper(substr(replace(report_ref, 'OFFLINE-', ''), 1, 8)) as new_ref
  from public.reports
  where report_ref like 'OFFLINE-%'
),
unique_targets as (
  select tenant_id, new_ref
  from candidates
  group by tenant_id, new_ref
  having count(*) = 1
),
safe as (
  select c.id, c.new_ref
  from candidates c
  join unique_targets u on u.tenant_id = c.tenant_id and u.new_ref = c.new_ref
  where not exists (
    select 1 from public.reports existing
    where existing.tenant_id = c.tenant_id and existing.report_ref = c.new_ref
  )
)
update public.reports target
set report_ref = safe.new_ref
from safe
where target.id = safe.id;
