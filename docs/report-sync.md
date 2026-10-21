# Report sync & live directory — activation guide

This is the operator checklist for the two switches behind the banner
*"employee master uses real data · report sync is not configured"*. Everything that can be
prepared in the database is already prepared; what remains are deployment environment
variables and one verified-domain row per host.

## 1. What is already provisioned in the SafexNew project

Verified against `mclrajfcrjdrlmoqwbdw` on 21 Oct 2026:

| Piece | State |
| --- | --- |
| `202610030001_initial_safex` … `20261020171922_safex_existing_schema_extension` | applied |
| `public.employees` roster | 193 rows · 191 active · 179 with a mobile |
| `public.reports` + status/attachment tables | present, inserts verified |
| `public.report_attachments` | present |
| Storage bucket `safex-report-attachments` | present, **private** |
| `public_report_rate_limits` + `safex_consume_report_limit(text, timestamptz, int)` | present, call verified |
| `public.tenant_domains` | verified rows for `safexnew.vercel.app` and the e2b preview host |
| RLS on `employees` / `reports` | enabled; `anon` has no `SELECT` |

The route itself (`app/api/reports/route.ts`) enforces, in order: same-origin, body size
and `Content-Length`, the `SAFEX_REPORT_SUBMISSIONS_ENABLED` gate, host → verified tenant,
database-backed hourly rate limit (24/host/tenant/IP), payload validation, active-site
check, active-employee check, idempotent insert on `(tenant_id, report_ref)`, then the
optional private attachment upload.

## 2. Environment variables

Set these in the deployment (Vercel → Project → Settings → Environment Variables, or the
Antideploy equivalent). Only the first two are public.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://mclrajfcrjdrlmoqwbdw.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>

SUPABASE_SERVICE_ROLE_KEY=<service-role key — server only, never NEXT_PUBLIC_>
SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto
SAFEX_TENANT_SLUG=emveess-infraventures
SAFEX_TENANT_COMPANY_NAME=Emveess Infraventures Pvt.Ltd
SAFEX_REPORT_SUBMISSIONS_ENABLED=true
SAFEX_REPORT_RATE_LIMIT_SALT=<32+ random characters, server only>
```

Optional:

```dotenv
SAFEX_PUBLIC_SAFETY_PASS=true     # show the safety pass number in the public passport
SAFEX_ADMIN_PASSCODE=<12+ chars>  # operator console / admin roster
SAFEX_HEALTH_DETAIL=true          # expose backend connectivity flags on /api/health
```

`SUPABASE_SERVICE_ROLE_KEY` must never be prefixed with `NEXT_PUBLIC_`, committed, pasted in
chat or shipped to the browser. It is what makes `/api/employees` and report submission work
while the browser holds no grant on either table.

## 3. Verified host rows

Report submission resolves the tenant from the **request host**. A host with no verified
row is rejected — by design, so one deployment cannot write into another tenant.

```sql
-- Run in the Supabase SQL editor. Replace the host(s) with your real public hostnames.
insert into public.tenant_domains (tenant_id, domain, verified_at)
select t.id, d.domain, now()
from public.tenants t
cross join (values
  ('safexnew.vercel.app'),
  ('www.example-safex.com')
) as d(domain)
where t.slug = 'emveess-infraventures'
on conflict (domain) do update
  set tenant_id = excluded.tenant_id,
      verified_at = coalesce(public.tenant_domains.verified_at, excluded.verified_at);
```

Notes:

- Use the hostname only — no `https://`, no path, no trailing dot, lower case.
- `localhost` is rejected by the route on purpose; test the deployed host instead.
- Verify ownership out-of-band before inserting a domain.

## 4. Verify the deployment

```bash
node scripts/check-deployment.mjs https://safexnew.vercel.app --empNo=EMP004
```

Expected output:

```
✓ App responds — HTTP 200
✓ Report sync enabled — mode=report-sync-enabled
✓ Employee directory source — supabase · 191 active employees
✓ Site list — West Bokaro (WBD)
✓ Company branding — Emveess Infraventures Pvt.Ltd
✓ Employee lookup EMP004 — Kamalnath Mahto · Rigger
All checks passed.
```

A direct API check, useful when the app looks right but nothing saves:

```bash
curl -s https://safexnew.vercel.app/api/health
curl -s https://safexnew.vercel.app/api/bootstrap
curl -s 'https://safexnew.vercel.app/api/employees?siteId=wbd&empNo=EMP004'
```

## 4b. When the directory says "unavailable"

`/api/bootstrap` now returns a machine-readable `directoryReason`. Match it to the fix
instead of guessing:

| `directoryReason` | Meaning | Fix |
| --- | --- | --- |
| `keys_missing` | `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` absent | add both, redeploy |
| `database_unreachable` | server could not query the project (wrong URL, paused/outage, blocked egress) | verify the URL and the service key with the curl below |
| `tenant_unresolved` | no active tenant, or several and `SAFEX_TENANT_SLUG` unset | set `SAFEX_TENANT_SLUG=emveess-infraventures` |
| `no_sites` | tenant has no active `public.sites` row | activate the site or fix `tenant_id` |
| `empty_directory` | tenant has zero active employees | check the import wrote the right `tenant_id` |
| `snapshot_unreadable` | sheet/file source configured but unreadable | fix `SAFEX_EMPLOYEE_MASTER_FILE` / `SAFEX_EMPLOYEE_MASTER_CSV_URL` |

Definitive key test (a service-role key from another project returns `[]` or `401`):

```bash
curl -s "https://mclrajfcrjdrlmoqwbdw.supabase.co/rest/v1/sites?select=slug,name&active=eq.true" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
# expected: [{"slug":"wbd","name":"WEST BOKARO GHATO"}]
```

## 5. Testing a real submission

1. Pick the site, submit a report from the app on the deployed host.
2. The app saves to IndexedDB first, then posts to `/api/reports`.
3. A `201` returns `{ reportRef: "OFFLINE-<clientSubmissionId>" }`; retries return `200`
   with `duplicate: true`, so a flaky connection cannot create two reports.
4. Confirm the row:

```sql
select report_ref, report_type, status, created_at
from public.reports order by created_at desc limit 5;
```

If the app keeps showing *"This report remains queued on this device"*, the server refused
the write. The response code tells you why:

| Code | Meaning | Fix |
| --- | --- | --- |
| 503 `REPORT_BACKEND_DISABLED` | feature flag or service key missing | set both env vars, redeploy |
| 404 `TENANT_NOT_FOUND` | no verified domain row for the host | add the `tenant_domains` row |
| 503 `TENANT_LOOKUP_UNAVAILABLE` | database/network unreachable | check project status and URL |
| 503 `REPORT_RATE_LIMIT_UNAVAILABLE` | rate-limit function/key missing | `SAFEX_REPORT_RATE_LIMIT_SALT` + migration |
| 429 `REPORT_RATE_LIMITED` | 24/hour budget used | wait for the next hour |
| 422 `EMPLOYEE_NOT_AVAILABLE` | Employee ID not active at that site | correct the Employee ID/site |
| 422 `SITE_NOT_AVAILABLE` | site slug/id inactive for tenant | align site with `sites.slug` |

## 6. Reading a report back in the app ("My logged reports")

`app/api/reports/mine` is the only path by which a worker can read a report out of the
database. It is a `POST` so the registered mobile number stays out of URLs, proxy logs and
`Referer`; it is same-origin, rate limited to 12 lookups per minute per IP, and answers
`Cache-Control: no-store`.

- **Own reports only**: the employee row is looked up by employee number **and** the mobile
  number registered in the master (compared on the last ten digits, so `+91 98765 43210`,
  `098765 43210` and `9876543210` are the same number). A wrong number reads nothing.
- **Same answer for "no such employee" and "wrong number"**: both are `404 NOT_FOUND`, so the
  endpoint cannot be used to test which Employee IDs exist.
- **The four confidential types are excluded in the query**, not in the UI:
  `reporter_employee_id = <the employee> AND anonymous = false AND report_type IN
  (near_miss, hazard, safety_observation, unsafe_condition, unsafe_act)`. Speak Up, Grievance,
  Feedback and Suggestion therefore never leave the server through this path, and a report
  type added to the database later stays hidden until the whitelist is changed deliberately.
- **Anonymous rows can never match**, because an anonymous report is stored without a
  reporter (enforced by the `anonymous_has_no_reporter` check constraint).
- The worker screen (`app/components/MyLoggedReports.tsx`) shows the reference, type, area,
  filled date and status (Open / In Progress / Closed) for each report, with the description
  and immediate action behind a tap.

The reports page no longer seeds `DEMO_REPORTS`: the list under "Saved on this device" is
only ever what this browser actually saved, and the database history comes from the verified
lookup above.

## 7. Still required before public production

Report sync stores data safely, but these are separate controls and are **not** implemented:
malware scanning for uploads, moderation/redaction review, attachment preview for officers,
OTP-based All Site Reports, per-user staff authentication (the shared admin passcode is not
an audit trail), backups and retention policy. Do not enable public reporting for real
incidents until the company has signed off on those workflows.

## 8. Sandbox limitation

The Arena sandbox this repository is developed in has no outbound access to
`*.supabase.co`, so the preview there serves the directory from a local snapshot
(`SAFEX_EMPLOYEE_DIRECTORY_SOURCE=sheet` + `SAFEX_EMPLOYEE_MASTER_FILE`) and cannot write
reports. That is a limitation of the sandbox, not of the configuration: the deployed app
reaches Supabase normally, which is what `scripts/check-deployment.mjs` verifies.
