# Employee master

The app uses real employee-master records only. No demo employee fallback is available. This document explains how that is wired, what the browser is allowed to see, and
what needs fixing in the source sheet.

---

## 1. Read this before connecting a real roster

**This repository is public.** The roster that prompted this feature contains, for roughly
190 workers: full name, registered mobile number, home address, blood group and a photo
link. That is personal data under India's DPDP Act, 2023.

Consequences baked into the design:

- **No roster file is committed.** The employee master is loaded at runtime from an
  environment-configured source. `.gitignore` additionally blocks `.data/` and any
  `employee-master*.csv`.
- **Worker browsers never receive the full roster.** Worker lookups return only
  `{ id, empNo, name, designation, siteId }`, with query and rate limits.
- The full roster is available only through the authenticated admin endpoint. Contact and
  health fields require the separate `SAFEX_ADMIN_PII_ENABLED=true` setting; the console
  does not consume those private fields even when enabled.
- **A "published to the web" Google Sheet is readable by anyone who has the link** — there
  is no authentication on it. Treat the link itself as a secret, and unpublish the sheet
  once the roster has been imported into Supabase.

---

## 2. How it is wired

```
Google Sheet / CSV ──┐
                     ├─► lib/employee-master/directory.ts ─► /api/employees ─► report form
Supabase employees ──┘        (Supabase → sheet → unavailable)       (scoped, capped)   profile search
                                                                                 training check
```

Resolution order is **Supabase → published sheet/CSV → unavailable**. The sheet is a migration
bridge: once the roster is imported, the database wins automatically and the sheet can be
unpublished. A source that is configured but unreachable degrades to the next one *and
says so in the UI*, rather than presenting an empty directory as if the site had no
workers. A failing database also trips a 30-second circuit breaker so the fallback stays
fast instead of paying a network timeout on every request.

| Variable | Purpose |
| --- | --- |
| `SAFEX_EMPLOYEE_DIRECTORY_SOURCE` | `auto` (default), or force `sheet`. |
| `SAFEX_TENANT_SLUG` | Which tenant the roster belongs to. Required for Supabase reads and for the importer. |
| `SAFEX_EMPLOYEE_MASTER_CSV_URL` | Published CSV/TSV endpoint. |
| `SAFEX_EMPLOYEE_MASTER_FILE` | Local CSV path, for offline dev / no-egress sandboxes. |
| `SAFEX_EMPLOYEE_MASTER_SITE_ID` | Site every row maps to when the sheet has no Site column. |
| `SAFEX_EMPLOYEE_MASTER_SITE_NAME` | Display name for that site. |
| `SAFEX_EMPLOYEE_MASTER_SITE_REGION` | Display region for that site. |
| `SAFEX_EMPLOYEE_MASTER_TTL_SECONDS` | Sheet cache lifetime in server memory (default 600). |

### What the lookup endpoint enforces

`GET /api/employees?siteId=…&q=…` (or `&empNo=…`)

- same-origin only, `Cache-Control: no-store`
- minimum 2-character query — the directory cannot be walked with an empty search
- maximum 8 results per request
- 40 lookups per minute per IP
- results restricted to the requested site; an unknown site returns nothing
- response contains Employee ID, name, designation and site only

Supabase reads use the service role, because the browser holds **no** grant on these
tables (see `supabase/sql/02_rls.sql`). That makes `lib/employee-master/db-source.ts` the
security boundary: RLS is bypassed there, so it applies tenant and site scoping itself.

### Column names understood

`Employee ID` / `Employee No` / `Emp ID` / `Employee Code`, `Name` / `Full Name`,
`Designation` / `Role` / `Trade`, `Department`, `Safety Pass No`, `Blood Group`,
`Mobile` / `Phone` / `Contact`, `JNTVTI Skill Grade` / `Skill Grade` / `Grade`, `Status`,
`Site` / `Location`. Matching ignores case, spaces and punctuation.

---

## 3. Importing the roster into Supabase

### Before you start

Apply the migrations in order, then the hardening script:

```
supabase/migrations/202610030001_initial_safex.sql      # tables
supabase/migrations/202610030002_offline_report_sync.sql
supabase/migrations/202610050003_employee_master_sync.sql   # master columns + audit table
supabase/sql/02_rls.sql                                 # grants / RLS / policies (resumable)
supabase/sql/99_gate_test.sql                           # must be all PASS
```

`202610050003` adds `safety_pass_no`, `skill_grade`, `blood_group`, `home_address`,
`source` and `synced_at` to `public.employees`. **None of them are granted to a browser
role.** `blood_group` is health data and must only ever reach an authorised first-aid/SOS
flow. The migration also creates `employee_master_sync_runs`, a service-role-only audit
trail of every import.

You also need a `tenants` row whose `slug` matches `SAFEX_TENANT_SLUG`.

### Run it

```bash
npm run employees:dry-run                 # parse, map, report — touches nothing
npm run employees:import -- --ensure-site # create the site row if missing, then upsert
```

| Flag | Effect |
| --- | --- |
| `--dry-run` | Parse and print the mapping; make no database calls. |
| `--ensure-site` | Create the tenant's site row if it does not exist yet. |
| `--deactivate-missing` | Mark employees absent from the sheet as inactive. **Never deletes.** |
| `--limit=N` | Only process the first N rows — useful for a first trial. |

Upserts key on `(tenant_id, employee_no)`, so re-running is safe and idempotent. Rows the
importer wrote are tagged `source = 'employee_master_sync'`, so a hand-edited record is
distinguishable and `--deactivate-missing` will not touch manually created employees.

The script runs on Node 22+, which strips the TypeScript types natively, so it shares the
exact parser the app uses — the import and the live lookup can never drift apart.

---


## 4. The admin console

`/api/admin/employees` lists the roster for the Employee Profile section of the Admin / HSE
Manager dashboard (the mounted SafetyOS console). It is the one endpoint that deliberately
enumerates the directory, so it is gated differently from `/api/employees`:

| | `/api/employees` | `/api/admin/employees` |
| --- | --- | --- |
| Who | any visitor on the site | verified operator session |
| Query | 2 characters minimum | optional |
| Results | 8 maximum | 50 per page, paginated |
| Fields | ID, name, designation, site | + department, skill grade, and PII when released |

### Why there is a separate passcode

The officer sign-in dialog in the UI is a **demo** login — `DEMO_ADMIN_USERNAME` and
`DEMO_ADMIN_PASSWORD` are compile-time constants inside a client component, so every
visitor can read them in the bundle. That is harmless while the dashboard shows synthetic
records, but it cannot stand in front of ~191 real people: anyone could call the endpoint
directly with `curl`.

So the admin API checks `SAFEX_ADMIN_PASSCODE`, which exists only in the server
environment. It is compared in constant time and exchanged for an HMAC-signed, httpOnly,
`SameSite=Strict` cookie that lasts 8 hours. Sign-in attempts are limited to 10 per
10 minutes per IP.

This is deliberately modest: one shared operator credential, no per-user identity, no
record of *who* signed in. It is the smallest thing that is honestly safe in front of real
personal data. **Replace it with Supabase Auth plus a `staff_memberships` role check
before real users touch this.**

### Releasing personal data is a second decision

`SAFEX_ADMIN_PII_ENABLED=false` by default. While it is off, a signed-in officer sees the
same fields a worker would, plus department and skill grade. Turning it on adds safety
pass number, registered mobile and blood group.

Skill grade is **not** behind the flag — it is an occupational competency, and a safety
officer needs it to know who is allowed to do what. Blood group is, because it is health
data: it belongs in an authorised first-aid or SOS flow with an access log, not in a
directory that anyone holding the console password can page through. `home_address` is
not selected by any query at all.

---

## 5. Data-quality findings

Parsed from the supplied sheet: **191 usable rows**, 27 distinct designations. The
following were detected automatically. Numbers are masked here deliberately.

### Blocking for OTP sign-in

| Employee | Problem |
| --- | --- |
| EMP001 | Mobile has 11 digits (`9177…`) — looks like a country code typed without `+`. |
| EMP002 | Mobile has 11 digits (`9939…`). |
| EMP047 | Mobile has 11 digits (`9234…`). |
| EMP037 + EMP191 | Share one mobile number. |
| EMP048 + EMP139 | Share one mobile number **and** an identical name — almost certainly one person holding two Employee IDs. |
| EMP069 + EMP083 | Share one mobile number. |
| EMP194, EMP195, EMP196, EMP197 | No mobile, no blood group, no skill grade recorded. |

An employee whose number is missing, malformed or shared with somebody else cannot be
authenticated by OTP, because the code cannot be delivered to one identifiable person.

### Cosmetic / normalised automatically

- Skill-grade spellings corrected on load: `Siler` (EMP004), `Siver` (EMP010, EMP015),
  `Sillver` (EMP093) → **Silver**. Worth fixing at source so the sheet and the app agree.
- `Sweepar` (EMP129) is kept as written; add it to the designation list or correct it.

### Rows that are not people

- **EMP159** and **EMP168** carry only a name and no other column. They are skipped and
  reported as unassigned IDs, so they never appear in a search result.
- **EMP081, EMP143, EMP179, EMP180** are absent from the sheet entirely. This matches the
  remark in the sheet that those IDs are blank and reusable.

### Structural gaps

- **No Site column.** Every row is currently mapped to a single site
  (`SAFEX_EMPLOYEE_MASTER_SITE_ID`, default `kedla`). Add a Site column before onboarding a
  second location, otherwise site-scoped reporting cannot be trusted.
- **No Department column.** The report form has a Department field that stays blank.
- **No employment start/end date**, so "Active" is the only lifecycle signal available.

---

## 6. Next steps

1. Fix the mobile numbers listed above in the source sheet, and decide whether EMP048 and
   EMP139 are one person.
2. Add `Site` and `Department` columns.
3. Apply the migrations, create the tenant row, then run `npm run employees:import`.
4. Switch the app to the database by leaving `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto` and
   confirming `/api/bootstrap` reports `"directory":"supabase"`.
5. Unpublish the Google Sheet and clear `SAFEX_EMPLOYEE_MASTER_CSV_URL`.
6. Only then enable OTP sign-in, which depends on one verified mobile per employee.


## West Bokaro master configuration (October 2026)

The supplied Google CSV URL is configured in the local, git-ignored `.env.local`.
**Deployment environment variables must be configured separately**; the URL and roster
are intentionally not committed to this public repository:

```dotenv
SAFEX_EMPLOYEE_DIRECTORY_SOURCE=sheet
SAFEX_EMPLOYEE_MASTER_CSV_URL=<the supplied published CSV URL, with literal & separators>
SAFEX_EMPLOYEE_MASTER_SITE_ID=west-bokaro
SAFEX_EMPLOYEE_MASTER_SITE_NAME=West Bokaro (WBD)
SAFEX_EMPLOYEE_MASTER_SITE_REGION=Ghatotand, Ramgarh
SAFEX_EMPLOYEE_MASTER_TTL_SECONDS=600
```

Set `SAFEX_ADMIN_PASSCODE` using your deployment secret manager to enable the authorised
admin roster. No passcode is hard-coded. Restart the server after configuration changes.
Edit employee details in the source sheet: console edits are session-only and do not
update Google Sheets. Training, certificates and other activity records are not inferred
from an employee's presence in the master.

If neither real source can answer, `/api/bootstrap` reports `directory: unavailable`,
`employeeCount: 0` and `degraded: true`; employee lookup endpoints return HTTP 503 rather
than a successful empty roster. Authentication is still required for the admin endpoint.
The sheet is refreshed every ten minutes; a last successful in-memory copy is retained
on temporary fetch failures. Restarting clears that cache.

The sandbox could not establish a TLS connection to Google Sheets during setup. Live
column mapping and employee counts remain unverified. In an environment with Google
access, confirm bootstrap reports `sheet`, check one known employee and an unknown ID,
and confirm private fields are absent from worker responses. Do not publish real roster
files or test responses in Git or logs.
