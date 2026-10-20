# Employee master

The directory contains personal data, so raw rosters must stay out of this public repository. The browser must never receive mobile numbers, blood groups, home addresses, photo URLs, or the full employee roster.

## Current SafexNew status (20 Oct 2026)

The initial roster has been imported into the live Supabase `public.employees` table and is scoped to:

- Company: `Emveess Infraventures Pvt.Ltd` (`EMVEESS`, tenant slug `emveess-infraventures`).
- Site: `WEST BOKARO GHATO` (`WBD`, site slug `wbd`).
- Imported: **193** unique Employee IDs; **191 active**, **2 inactive** because their source status was blank.
- Public-safe lookup fields: Employee ID, name, designation. Safety pass number and skill grade are in the master but are not returned by the public lookup.
- Phone handling: **179** unique, well-formed mobile values were normalized to `+91…`; **14** are `NULL` (6 shared across three duplicate groups, 2 malformed, 6 missing). Shared values are withheld until individually verified for OTP.
- Blood group, home address, and photo/Drive links were excluded from the import.

The source roster is not stored in this repository. The database has RLS enabled on `employees`, and anonymous direct table reads are denied. No platform super-admin or staff membership has been created yet.

## How lookup works

The browser calls the same-origin route, not Supabase tables directly:

```text
GET /api/employees?siteId=wbd&empNo=<EMPLOYEE_ID>
```

`app/api/employees/route.ts` uses the server-only Supabase adapter in `lib/employee-master/db-source.ts`. It resolves the active tenant, resolves the requested site within that tenant, matches the exact Employee ID, requires `active=true`, and projects each result to exactly three employee fields: `empNo` (Employee ID), `name`, and `designation`. The browser derives its React key and local selected-site context from that response/query.

Protections include same-origin validation, no-store caching, a minimum query length for autocomplete, an 8-result cap, and a per-IP rate limit. Do not grant `anon` SELECT on `employees` or return the full Supabase row.

## Employee Safety Passport

`More → Search Employee Profile` looks up one exact Employee ID at the selected site and
opens the passport page (`app/components/EmployeePassport.tsx`, styles in
`app/components/employee-passport.css`). The layout follows the approved design:
credential header, active badge, profile card, Personal Details, the eight-card Safety
Record Summary, Latest Training Records, PPE, Download PNG / Download PDF and a QR footer.

What is rendered from real data, and what is not:

| Area | Source | Behaviour when unavailable |
| --- | --- | --- |
| Employee ID, name, designation | `public.employees` via `/api/employees` | — |
| Department, skill grade | same (`department` is NULL for all imported rows today) | “Not on record” |
| Company | `public.tenants.company_name` through `/api/bootstrap` | “Company not on record” |
| Site / location | selected site context | “Site not selected” |
| Safety Pass No. | `employees.safety_pass_no` | “Verified staff access required” unless `SAFEX_PUBLIC_SAFETY_PASS=true`, then “not on record” if empty |
| Mobile, blood group, address, date of birth | never selected for public lookup | “Verified staff access required” |
| Photo, email, joining date, pass validity | no column exists yet | “Not on record” |
| Record counts and history | not connected to public lookup | `—`, and an empty-state record table with CSV export |

The passport never invents an employee, photograph, count or history row. Record counts are
deliberately withheld from public search because “this Employee ID filed six hazard reports”
would identify a reporter; officers get them from the authenticated console instead.

`safety_pass_no`, `skill_grade` and `department` are selected server-side by the lookup so
the passport can render them, but the API still decides what is released. `toPublicEmployee`
in `lib/employee-master/parse.ts` is the single place where that projection is defined, and
a unit test pins its keys.

### Opting in to the safety pass number

```dotenv
SAFEX_PUBLIC_SAFETY_PASS=true
```

Server-only, default `false`. It only adds `safetyPassNo`; mobile number, blood group,
address and date of birth are never included. Enable it only after the company approves
showing the credential to anyone who knows an Employee ID.

## Required deployment configuration

The live API currently reports `directory: unavailable` from `/api/bootstrap` even though the database rows exist. The Vercel server environment must be pointed at the SafexNew project and the directory set to Supabase:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=<SafexNew project URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<public key>
SUPABASE_SERVICE_ROLE_KEY=<server-only key; never NEXT_PUBLIC_>
SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto
SAFEX_TENANT_SLUG=emveess-infraventures
```

The service-role key must only be stored in Vercel's encrypted server environment. Never commit it, put it in `.env.example`, or send it in chat. After configuring the deployment, redeploy and verify `/api/bootstrap` reports `directory: supabase`, the WBD site, and **191 active employees**. Then verify one known Employee ID and one unknown ID; do not log or commit response bodies.

The code supports a published CSV as a temporary fallback, but the employee list is already in Supabase. Use `auto` (database first) and remove the CSV URL after confirming production lookup. The published Google Sheet is readable by anyone with its link; unpublish it once no longer required.

## Safe re-import behavior

`npm run employees:dry-run` parses the configured source without writing. `npm run employees:import` upserts by `(tenant_id, employee_no)` and records a sync run. Imports preserve inactive rows, treat blank status as inactive, withhold duplicated mobile numbers from OTP use, and omit blood group by default. Do not enable `--deactivate-missing` without first reviewing the dry run. Never commit an employee CSV or a generated SQL dump.

The live employee API does not require a platform-admin UUID, but admin roster access and tenant management do. Bootstrap an approved platform admin and staff membership separately before enabling those workflows.

## Troubleshooting

- `directory: unavailable`: verify `SUPABASE_SERVICE_ROLE_KEY`, project URL, `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto`, and tenant slug in Vercel; then redeploy. The service role is required because browser roles intentionally cannot read the employee table.
- `directory: supabase` but no matches: verify the selected site is `wbd`, the Employee ID is entered exactly, and the employee is active.
- A matching row can return only the limited public fields above.

## Editing the roster from the console

The Admin / HSE console's **Employee Profile** screen writes through
`/api/admin/employees` (`POST`, `PATCH /:employeeNo`, `DELETE /:employeeNo`). All three need
the same verified operator session as the roster; there is no unauthenticated write path and
no browser role that can touch `public.employees` directly.

- **Which fields**: `full_name`, `designation`, `department`, `work_location` always;
  `mobile_e164`, `blood_group`, `email`, `gender`, `dob`, emergency contact, `home_address`,
  `notes` and `previous_names` only while `SAFEX_ADMIN_PII_ENABLED=true`.
- **Why the flag matters for writes**: with PII off the roster never sends the personal
  fields, so the profile form shows them empty. The API rejects those fields rather than
  accepting the empties and erasing what is stored.
- **Delete is a deactivation**: the row stays, `active=false`, so reports, training records
  and recognitions keep pointing at it. The next sync may reactivate a person who is still
  on the master sheet — remove them there first.
- **Photos are not stored**: the design keeps a 2 MB data URL and says on screen that it is
  a preview. Uploading them needs a storage bucket and a consent decision, not a text
  column.
