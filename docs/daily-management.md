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
| 3 | PPE checking | rows: **All (team)** or **Individual** (employee number ↔ name from the master), issue, every PPE item observed, remarks, photo |
| 4 | Site walk-through | rows: area, observation type (`Safe act`, `Good Practices`, `Unsafe act`, `Unsafe condition`), severity 1–5 for unsafe only, details, immediate action taken, photo |
| 5 | Equipment / machinery | rows: equipment, check, safety devices, status, action, photo |
| 6 | Tools & tackles | rows: tool, ID, safe/unsafe, condition, description, action, responsible, photo |
| 7 | Housekeeping (1S / 2S) | 23 criteria (8 × 1S, 15 × 2S) answered Y / N / N/A, plus observations, action and photo |
| 8 | Safety interaction | team rows (employee number ↔ name from the master), discussion topics, feedback, escalation, follow-up, photo |
| 9 | Incident / near-miss / hazard | location, reporter, report no, category, persons (employee master), description, action, investigation, photo |
| 10 | Training | employee number + employee (employee master), need identified, observation, action, three confirmations, photo |
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

## Photos

A photo can be attached to any PPE observation and any walk-through observation. The file
is resized in the browser (longest edge 1000 px, JPEG, quality walked down until it fits)
and stored in `payload` as a data URL — no extra bucket, no signed URLs, and the PDF can be
rebuilt from the record alone.

Limits, enforced on both sides: 12 photos per plan, 140 000 characters each, 1 500 000
characters in total. The browser compresses first, so a normal field photo lands well under
half of that; the server's limits are what stop a plan from becoming a JSON body the
database refuses.

Only `data:image/jpeg` and `data:image/png` are accepted. Anything else — a link, an HTML
data URL, a file that failed to decode — is dropped, and the PDF skips an image it cannot
read rather than failing the document.

## Declaration and signature

A plan cannot be filed without the officer's sign-off, and the sign-off is part of the
record rather than a separate form:

1. **Declaration** — a required checkbox: *"I declare that all the information recorded in
   this Daily Management Plan is true and correct to the best of my knowledge."* The Hindi
   line under it says the same thing for the supervisors who read it that way.
2. **Signature** — signed by hand in a canvas: a finger on the phone, a mouse on the
   desktop. Only a real stroke counts; a stray tap is not a signature. `Clear signature`
   wipes the pad and the signing time with it.
3. **Submit** stays disabled until both are done, and the server enforces the same two
   rules in `normalisePlan(..., { requireSignOff: true })`, so a hand-made POST cannot file
   an unsigned plan. Archived plans filed before this existed still open and reprint — their
   PDF prints "Signature (not on record)" rather than a blank claim.

The PDF carries the block at the foot of the last page: the declaration, the drawn
signature fitted into a 176 × 54 pt box, the supervisor's name and employee number, and the
UTC time it was signed. After filing, the workspace shows **"Thank you Mr <supervisor> for
submitting the DM"** with the DM number and the PDF link.

## Photo evidence

Every module that can carry evidence does: PPE (per row), site walk-through (per row),
equipment (per row), tools (per row), housekeeping, safety interaction, incident / near
miss and training. One **Photo** button opens the browser's own sheet, which offers
Camera and Gallery / Files side by side.

A plan may carry 24 photos, each up to 140 000 characters as a JPEG data URL, with 2 400 000
characters across the plan; the browser compresses to about 120 000 before sending, and the
server enforces the same ceilings in `normalisePlan`. A photo counts as an answer on its
own — a near miss photographed with nothing typed still fills module 9 — and one embedded
image is reused everywhere it appears instead of being stored twice in the PDF.

## Team-wide or individual observations

A PPE row says who it covers. **All (team)** is the default: the observation is about the
whole shift, so no name is typed — the PDF prints `All employees`. **Individual** reveals
the employee-number and name fields, with the master lookup. Switching back to the team
clears the name, so a saved plan never prints a person's name against a team-wide row.

## Phone layout

The whole console now runs without a permanent sidebar: the topbar's menu button opens the
navigation as a drawer over the page, and the content gets the full width back. On a phone
the drawer closes on the scrim, on Escape, or as soon as a destination is picked.

Every control is sized for a thumb: 16 px inputs (anything smaller makes iOS zoom the page
on focus), 44 px minimum height on fields and buttons, and larger Y / N / N/A ticks. The
submit bar is sticky at the bottom of the screen, so filing is always one tap away while the
long form scrolls behind it. **Expand all** in the form header opens every module at once
instead of eleven taps.

Below 860 px every DM table becomes a stack of cards: the header row disappears and each
cell carries its own label (`data-label`), so a nine-column PPE row is still readable on a
360 px screen. Below 430 px the label moves above the field. The housekeeping checklist
keeps its three Y / N / N/A buttons in a row under the criteria. Nothing in the DM screen
scrolls sideways any more.

A photo is attached with one **Photo** button over a plain `<input type="file"
accept="image/*">`. The input deliberately has no `capture` attribute: without it the phone
shows its own sheet with Camera and Gallery / Files as two options, and with it the phone
skips the sheet and opens the camera, hiding the gallery on Android.

## Employee master lookups

Wherever a person is named (PPE row, safety interaction, incident, training), the employee
number and the name both work: type either one and the other fills from the employee
master. An exact match wins; a prefix only counts when it identifies exactly one person, so
"Ravi" with two Ravis on site resolves to nobody rather than the wrong person.

The picker reads the same `public.employees` rows the console's Employee Profile screen
does (`GET /api/admin/employees`, session-gated), so a corrected spelling in the master
shows up in the next plan.

## Digital signature

The signature block is still text (`Signed: <supervisor>`) drawn on the PDF. A captured
signature would need a Storage upload and one extra column; it is not in this phase.

## Testing

`tests/dm-plan.test.mjs` covers normalisation, references and module counting;
`tests/dm-pdf.test.mjs` renders a filled plan and asserts the `%PDF` header, the reference
in the document, and the page count. Run `npm test`.
