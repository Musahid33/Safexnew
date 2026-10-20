# Daily Management (DM) in the admin console

The console's **DM** page is a native Daily Management Plan form with its own archive. It
carries the same eleven modules as the company's controlled DMP document
(`DOC. No EIPL/SMP-DMP-FY26-27-V-01`) — nothing is pulled from the old Apps Script app, and
no Google account or iframe is involved.

Two tabs:

- **Conduct DM** — the form. Filing it stores the plan in Supabase, generates the PDF and
  archives it in Storage. The record is locked once filed.
- **DM Records** — the archive. Every filed plan, newest first, with its reference, date,
  supervisor, module progress and the PDF.

## The document number

```
DM-DD-MM-YY        e.g. plan dated 21 Oct 2026 → DM-21-10-26
DM-DD-MM-YY-2      a second plan filed on the same date
DM-DD-MM-YY-3      and so on
```

`referenceFor()` in `lib/dm/plan.ts` builds the base; `saveDmPlan()` retries with a suffix
when the database rejects the reference as a duplicate (unique per tenant). A suffix is
deliberate — two shifts on the same day are two real plans, and rejecting the second one
would lose a record. The PDF is stored and downloaded as `<reference>.pdf`.

## The eleven modules

| # | Module | Shape |
|---|---|---|
| 1 | Permit reviews | permit no / taken by / reviewed by, 5 review checks, observations, action |
| 2 | Tool Box Talk (TBT) | attendees, conducted by, topics, previous incidents, hazards, procedures, theme, PPE, open forum, takeaways |
| 3 | PPE checking | rows: observed employee, issue, PPE item, remarks |
| 4 | Site walk-through | rows: time, area, observation type, details, photo taken |
| 5 | Equipment / machinery | rows: equipment, check, safety devices, status, action |
| 6 | Tools & tackles | rows: tool, ID, safe/unsafe, condition, description, action, responsible |
| 7 | Housekeeping (1S / 2S) | 23 criteria (8 × 1S, 15 × 2S) answered Y / N / N/A, plus observations and action |
| 8 | Safety interaction | team rows, discussion topics, feedback, escalation, follow-up |
| 9 | Incident / near-miss / hazard | location, reporter, report no, category, persons, description, action, investigation |
| 10 | Training | employee, need identified, observation, action, three confirmations |
| 11 | Admin & documentation | rows: SOP/JHA no, compliance, adequacy, action by, remarks |

Constants and the plan type live in `lib/dm/plan.ts`, which is pure TypeScript — no React, no
database — so the form, the API and the PDF renderer all read the same lists. `normalisePlan()`
caps free text at 800 characters and table rows at 30, and rejects a plan with no date, no
supervisor, or no filled module.

## Storage

`public.daily_management_plans` (migration `202610210002_daily_management_plans.sql`):

| column | notes |
|---|---|
| `tenant_id`, `site_id` | composite FK to `sites(id, tenant_id)` |
| `plan_date`, `reference` | `reference` unique per tenant |
| `shift`, `supervisor_name`, `supervisor_employee_no`, `location` | denormalised for the record list |
| `payload` (`jsonb`) | the whole form — the document of record |
| `modules_filled` | 0–11, so the list shows progress without reading every payload |
| `status` | `submitted` (the API only files submitted plans) |
| `pdf_path` | object path in the `dm-records` bucket |

RLS is enabled with **no policies**, so only the service-role key — i.e. the server route —
can read or write. That is why `/api/admin/dm` uses `getAdminSupabase()` and every request
is gated on a verified operator session.

The bucket `dm-records` is private, 10 MB, `application/pdf` only. PDFs are never served as
signed URLs: `/api/admin/dm/[id]/pdf` streams the file after the session check, so the link
stops working when the operator signs out.

If the upload fails, the row still exists — `readDmPdf()` rebuilds the document from the
payload on demand. The archived bytes and a rebuild are the same document.

## API

All three routes use the shared gate in `lib/http/admin-gate.ts`: same origin → admin API
configured → operator session → rate limit.

| route | does |
|---|---|
| `GET /api/admin/dm?siteId=&limit=&offset=` | the record list, newest first |
| `POST /api/admin/dm` `{siteId, plan}` | normalise, insert with reference, render and archive the PDF → 201 |
| `GET /api/admin/dm/[id]` | one record with its full payload |
| `GET /api/admin/dm/[id]/pdf` | `DM-DD-MM-YY.pdf`, `Content-Disposition: attachment` |

## Rendering

`lib/dm/pdf.ts` draws the document with `pdf-lib`: A4, letterhead
`EMVEESS INFRAVENTURES PVT. LTD.`, the reference in a box beside the title, eleven numbered
module bands, wrapped tables, a declaration with the supervisor's name, and a footer with the
reference, generation time and page count.

Helvetica is a WinAnsi font, so every string goes through `sanitize()` first: curly quotes,
dashes, bullets and `₹` are folded to ASCII, and characters with no WinAnsi form (emoji,
Devanagari) are dropped rather than throwing. Never pass raw user text straight to
`drawText`.

## Not in this phase

Photos and the digital signature block are deferred; the form submits text only. Adding
them means a Storage upload per image and an extra column for the signature path, not a
schema change to `payload`.

## Testing

`tests/dm-plan.test.mjs` covers normalisation, references and module counting;
`tests/dm-pdf.test.mjs` renders a filled plan and asserts the `%PDF` header, the reference
in the document, and the page count. Run `npm test`.
