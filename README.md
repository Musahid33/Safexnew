# Safex production starter

A Next.js + TypeScript PWA-oriented Safex app. The SafexNew Supabase schema and the initial West Bokaro employee master are now provisioned. The worker app shows only data it can actually read — the tenant's site and company name, the employee master, published recognitions and the reports the signed-in worker filed. Sections with no published records show an empty state; no sample rows are drawn. OTP/SMS and VAPID are not connected yet.

## Included now

- Responsive safety home inspired by the latest mobile reference: compact tenant/site header, six-language chip strip, stacked report/training/circular shortcuts, a Document Vault / Library grid for SOP/SWP, Risk Assessments, Legal & Statutory Compliance and Policy & Procedures, a Wall of Fame / Reward Wall carousel with a stationary Name / Reward For table beneath the images, plus the nearest upcoming event in Explore & Learn. Circular and notice archives remain accessible without latest-item cards on Home. The Report chooser retains all nine types: Near Miss, UC, UA, Hazard, Grievance, Speak Up, Suggestion, Feedback and Safety Observation.
- Multi-site first-open selector; session site context; Change Site in the header. Single-site tenant logic is represented in code (one site auto-selects).
- **Logged reports** on the Reports tab: every report the selected site has stored in Supabase, read straight from the database on open — no Employee ID, no mobile number, no gate. Search, type filters, status counts, refresh and paged "load more". Tapping a report opens a modal with the full stored record and the attached photo (a ten-minute signed URL; the bucket stays private). References are readable and type-prefixed — `NM-72138A64`, not `OFFLINE-…` — and a queued report already shows the number it will keep after sync (`lib/reports/report-ref.ts`). The four confidential types (Speak Up, Grievance, Feedback, Suggestion) and anonymous rows are excluded in the query, and no Employee ID or mobile number is ever selected or displayed (see `lib/reports/site-feed.ts`). Below it, "Pending on this device" shows only what this browser has not yet synced.
- Reference-inspired reporting flows: direct UC (Unsafe Condition) and UA (Unsafe Act) forms, plus Safety Observation safe-practice options; Hazard accident/property-damage/red-risk choices; Feedback, Grievance and Suggestion category pickers; tailored fields for Near Miss, Hazard, observations, Speak Up and other concerns.
- Report form fields include worker lookup, name/Employee ID/designation autofill, location, department where relevant, incident date/time, severity where relevant, description, immediate action and optional image (12 MB limit). Anonymous reporting is available only for Speak Up; that mode hides identity and stores no employee link. Other report types require a selected employee profile.
- The **employee master uses real records only**. The initial 193-row WBD roster is imported into the tenant/site-scoped Supabase tables; do not commit or publish a roster export. Configure the server-only `SUPABASE_SERVICE_ROLE_KEY`, `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto`, and `SAFEX_TENANT_SLUG=emveess-infraventures` in the production environment. The public lookup returns only directory-safe fields for an exact active match at the selected site. Unavailable sources return HTTP 503; there is no synthetic fallback. See `docs/employee-master.md`.
- Site-scoped Employee ID search under **More → Search Employee Profile** opens the **Employee Safety Passport** directly after an exact match. The page follows the approved passport design: navy credential header, active-status badge, profile card with Employee ID and Safety Pass slot, a 13-row Personal Details panel, the eight-card Safety Record Summary (Near Miss, Hazard, Unsafe Acts, Unsafe Conditions, Training, Rewards, Suggestions, Feedback), Latest Training Records, PPE panel, Download PNG, Download PDF (print) and a QR/generated-on footer. The sheet is also the exact PNG export target, and every card opens the existing searchable/filterable record modal with CSV export.
- The passport is **honest about what it does not have**. Public lookup returns Employee ID, name, designation, department, skill grade and active state — so those render from the live directory, together with the tenant company name and site. Mobile number, blood group, address and date of birth are labelled *Verified staff access required* rather than shown; photo, email and date of birth read *Not on record* until the profile is completed in the admin console; record counts stay `—` because a public search must not expose who reported what. No sample employee, photo, count or history is drawn.
- `SAFEX_PUBLIC_SAFETY_PASS=true` (server-only, **default off**) additionally releases the safety pass number in the public passport. It never widens the projection to contact or health fields. Passport download is a directory-only preview, not proof of identity or safety clearance; real history/PII still requires a verified employee session, consent and a protected backend.
- Employee Code profile search, an account login screen for Employees, Safety Supervisors/Site Supervisors and Admins (staff sign-in is verified by the Safex server; OTP and password reset are not connected), and a Training Management portal with a site-scoped Employee Code training check. The training catalog itself is empty until material is published.
- The Admin / HSE Manager dashboard is the uploaded `SafetyOS — Employee Profile Preview (2).html` console, mounted as designed rather than re-implemented: all 18 screens (Case Management, Training Management, Employee Profile, Communications, Document Vault / Library, Audit & Inspection, Form Builder, DM, User & Access, Dashboard, View & Analytics, Certificates, Export Reports, Direct Data Entry, Daily Management, System Settings) with their charts, tables, form builder, CSV / report export and in-memory editing. Reach it from the Admin login tab; access to the roster requires the server-verified operator session below. The design is the source of truth: edit the HTML and run `npm run design:extract` to regenerate `app/safetyos.css` and the two modules in `app/components/safetyos/generated/` (markup + script); never hand-edit those. Admin login is a real frontend-to-backend call: the dialog (and, after the session cookie expires, the console's own sign-in gate) POSTs its credentials to `/api/admin/session`, which verifies them server-side in constant time — either the operator passcode from `SAFEX_ADMIN_PASSCODE` or the shared staff account (`ADMIN_USERNAME` + `ADMIN_PASSWORD`) — and answers with an HMAC-signed session cookie. **No default credential ships in this repository.** With none of those variables set, every `/api/admin/*` route answers `503` instead of opening; the dialog never prints or prefills a password. The console then feeds the real employee master into the design's own directory through the seam in `scripts/extract-design.mjs`; that seam maps only employee number, name, designation and department, so mobile numbers, blood groups and safety pass numbers are never handed to the console even when the API is allowed to release them. When the employee-master source is not configured or reachable, the console opens with an empty directory and a status banner instead of a wall — no synthetic employees are invented. This shared sign-in still does not verify an individual staff role or authenticate with Supabase, and the embedded console’s edits stay in browser memory. The separate protected reward editor described below does write to Supabase.
- Site-scoped report outbox for offline use: each report and its optional image are saved in IndexedDB first, then retried on reconnect/focus and with Background Sync where supported. A server-side Supabase endpoint uses a stable submission ID for idempotent retries, validates tenant/site/employee scope, enforces a database-backed request limit, and stores optional evidence in a private bucket. This stays disabled until the server configuration and offline-sync migration are applied.
- SOS screen dials the company emergency line **+91 7070705925** (`lib/emergency.ts`). A site row with its own `sos_number` wins over that fallback, and the dialog always shows the number it will dial.
- Safety Portal hero with a Life Saving Rule location picker and popup. The ten rules ship in `lib/life-saving-rules.ts`; confirm they match the site's approved list before operational use.
- Notification preference UI, browser permission request and service-worker push display/click handlers.
- More → Appearance (System/Light/Dark and four palettes) and More → Install App.
- Six language labels for key navigation/form actions. Longer translations require review by native speakers.
- Supabase client wrappers, environment template, the existing Safex tenant/site migrations, and an additive schema extension for the live multi-tenant database.
- Tenant company branding comes from the database through `/api/bootstrap`; the header shows nothing rather than an invented company before the server answers. Optional-module flags live in `lib/app-config.ts`; the footer is intentionally removed.

## Source exposure

A browser must download the HTML, CSS and JavaScript it runs, so no deployment can hide those
bytes from a determined visitor. What this project does guarantee:

- **No source maps in production.** `productionBrowserSourceMaps: false` in `next.config.ts`; a
  bundle cannot be mapped back to `app/` or `lib/` filenames.
- **No comments in shipped files.** The compiler strips them from the bundle and the CSS
  minifier strips them from the stylesheet; the only hand-written public asset (`public/sw.js`)
  carries none.
- **No server code in the browser.** Every Supabase call, table name, admin check and secret
  lives behind `app/api/*` or a `server-only` module; the stores are never imported by a
  `'use client'` file. `tests/source-protection.test.mjs` fails the build if that changes.
- **No secrets in the client.** The service-role key, passcode and session secret are read from
  `process.env` on the server only. A client file that mentions one fails the test suite.
- **The admin console is not delivered to workers.** `SafetyOsApp` is a `next/dynamic` import, so
  the ~470 KB console chunk is fetched only when an operator opens the dashboard; the home
  page's initial HTML no longer contains any of that markup.
- **No indexing or archiving.** Every response sends `X-Robots-Tag: noindex, nofollow,
  noarchive, nosnippet, noimageindex, notranslate` and `app/robots.ts` disallows the whole
  origin, so an old build or a cached snippet cannot surface in a search result.
- **Devtools shortcuts are deterred, not blocked.** `app/components/SourceGuard.tsx` swallows
  F12, Ctrl/Cmd+Shift+I/J/C/K and view-source in a production build. This stops a casual visitor
  and nothing more — it is deliberately narrow (form fields keep their context menu, and copy,
  paste, zoom and assistive technology are untouched) because a determined user can always
  open devtools from the browser menu or fetch the file with `curl`.

**The repository itself is the larger exposure.** A public GitHub repository publishes the full
source, migrations and history — the deployed bundle is not the only copy. Keep this repository
**private** (Settings → General → Danger Zone → Change visibility → Private) and invite only the
people who need it. Agents and CI with a repository-scoped token cannot change visibility for
you; that switch is owner-only.

## Run locally

```bash
npm install
npm run dev
```

Open the local preview. Copy `.env.example` to `.env.local` and configure the public URL/key plus server-only secrets as described below. `/api/health` checks Supabase Auth reachability. The SafexNew project has the additive tenant/site schema and the WBD employee master, but `/api/bootstrap` will still report `directory: unavailable` until the deployment has `SUPABASE_SERVICE_ROLE_KEY`, `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto`, and the correct `SAFEX_TENANT_SLUG`. Report sync accepts submissions only when `SUPABASE_SERVICE_ROLE_KEY` and the offline-sync migration are in place; otherwise the outbox keeps them on the device and says so.

## Deploy on Antideploy

- The production start command runs Next.js on `0.0.0.0` and uses the platform-provided `PORT`; local development remains on port 3000.
- Antideploy account authorization is stored outside this project in `~/.antideploy/config.json` with mode `0600`. The project’s `.antideploy.json` will contain only the selected application ID, not an account token.
- The local preview has the public Supabase endpoint configured; Antideploy will need the same public URL/key set in its environment. Public configuration alone does not connect the schema, employee directory or report persistence. Keep report sync disabled until migrations/data are applied and required server-only secrets and tenant controls are configured.
- Never include account tokens, service-role keys, or the OpenRouter key previously posted in project files or deploy archives.

## Configure Supabase safely

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted).
3. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only in the deployment platform's encrypted environment (for example Vercel or Antideploy). Never commit it, put it in `.env.local` shared with others, send it in chat, expose it to the browser, or prefix it with `NEXT_PUBLIC_`. The full activation checklist — every environment variable, the verified-domain SQL and the report-failure code table — is in [`docs/report-sync.md`](docs/report-sync.md); `node scripts/check-deployment.mjs <url> --empNo=EMP004` verifies a deployment from outside.
4. SafexNew's live migration history includes the original four migrations plus `supabase/migrations/20261020171922_safex_existing_schema_extension.sql`. That extension is additive and expects the existing `tenants`/`sites`/employee/report schema; do not apply it as a standalone greenfield migration. Review the entire history before using it on a different project.
   Then apply `supabase/sql/02_rls.sql` — a re-runnable grants/RLS/policy hardening script split into independently runnable PARTs, with an apply ledger so a run that times out in the SQL editor can be resumed. Finish with `supabase/sql/99_gate_test.sql`, which must report PASS on every row (it raises an exception otherwise, so it can gate a deploy).
5. Map and verify vendor domains, sites, roles and actual report columns. Test RLS as anonymous, employee, site officer, vendor admin and a different tenant before production.

The migration deliberately denies direct anonymous access to employee/report tables. This repo's narrow employee lookup is implemented as a server route, but its Vercel server-only Supabase configuration still needs to be set and verified. Anonymous Speak Up submission and the logged-report attachment preview are implemented against the live schema; OTP-protected cross-site summaries and an admin moderation queue still need to be built. Do not grant public SELECT on raw reports or rely on a browser `site_id`/localStorage value.

## Admin access

The console, the reward editor and the publishing screens share one server-verified session. There is **no default login**: a borrowed or guessed credential pair published in this repository used to open the employee directory, and it has been removed.

- Set either `SAFEX_ADMIN_PASSCODE` (12+ characters) or `ADMIN_USERNAME` + `ADMIN_PASSWORD` (password 12+) in the deployment's encrypted environment. Never prefix either with `NEXT_PUBLIC_`.
- `SAFEX_ADMIN_SESSION_SECRET` (32+ random characters, e.g. `openssl rand -base64 48`) signs the session cookie. When it is absent the key is derived from the passcode or password, so rotating either one signs every existing session out.
- With none of them set, `/api/admin/session` and every `/api/admin/*` route answer `503`. The console shows that it is disabled instead of accepting a login.
- Sign-in is rate limited (10 attempts per 10 minutes per IP), compared in constant time, and the cookie is `httpOnly`, `SameSite=Strict` and 8 hours long.
- `SAFEX_ADMIN_PII_ENABLED=true` is still a separate, explicit decision: mobile numbers, blood group and address stay hidden without it.
- `SAFEX_REPORT_RATE_LIMIT_SALT` salts the public report rate-limit bucket key. If unset, the service-role key is run through HKDF with its own label first, so the two secrets are never interchangeable.

This is one shared operator credential, not per-user identity, and it keeps no record of who signed in. Replace it with Supabase Auth plus a `staff_memberships` role check before real staff accounts are issued.

## Rewards & Recognition (backend)

- Apply `supabase/migrations/202610100004_recognitions.sql` after the initial schema. Set server-only `SUPABASE_SERVICE_ROLE_KEY` and `SAFEX_TENANT_SLUG` to the tenant whose rewards this deployment will display (the provisioned SafexNew tenant slug is `emveess-infraventures`). Do not set the service key in the browser.
- Set a strong server-only `SAFEX_ADMIN_PASSCODE` (12+ characters). Sign in at `/admin/recognitions`. Add **Name** and **Reward For**, optionally a public image URL from your configured Supabase Storage project (or a file you add under `public/rewards/` — the folder is not committed); tick the consent confirmation and then **Publish**. Edit, unpublish or delete from the same screen. Only this server-verified operator session may write; the SafetyOS console shows a handoff card to this screen instead of a second, non-persistent editor.
- `/api/recognitions` serves up to 50 published, consented entries from the configured tenant. The home page shows their images in the carousel and a stationary **Name / Reward For** table immediately below. Without published rows the carousel shows an empty state; it does not draw stock artwork or invent awardee names. If the database is unavailable, the editor reports an error; public view keeps the image-only fallback.
- This shared passcode is not per-user admin authentication or an audit trail. Before production with real employee names, replace it with role-checked staff identity and verify tenant/domain mapping, data consent, photo hosting and retention policies. In a multi-tenant deployment, resolve tenant by verified host rather than a single deployment-scoped slug.

## Publishing content to the app (vault, circulars, notices, events)

- Apply `supabase/migrations/202610210005_content_publishing.sql` after the initial schema. It adds `documents.external_url` and `documents.sort_order`, the published-list indexes, the four vault shelves for existing sites and the private `safex-content` bucket (10 MB, PDF/PNG/JPG/WEBP). It is already applied to the SafexNew project (`mclrajfcrjdrlmoqwbdw`) as version `202610210005`.
- Sign in at `/admin/publish` with the same `SAFEX_ADMIN_PASSCODE` session as the rewards page. Pick the site, then publish from **Document Vault**, **Communications** (circular, notice, event) or **Rewards**. Everything is a row scoped by `company_id` + `location_id`.
- A draft or archived row is never returned to the app. `GET /api/content?site=<slug|uuid>` returns only published rows, and `GET /api/content/file/{document|announcement}/<id>` re-checks the status before redirecting to a two-minute signed URL. Unpublishing stops the download immediately; the storage path itself is never exposed.
- Uploads go to the private bucket through `/api/admin/content/upload`. Without the bucket, uploads answer 503 and name the migration; an `https://` link can be published instead.
- The worker app has no fallback content: an empty database shows "No files yet" and "No upcoming events are scheduled for this site."

## Tenant onboarding, branding and optional features

- During company onboarding, Safex Super Admin records the tenant company name, address, contact email and mobile number, plus its verified domain and sites. The migration stores the public-facing profile in `tenants` (`company_name`, `company_address`, `contact_email`, `contact_mobile_e164`); optional logo storage is represented by `logo_path`.
- The shared app header displays the tenant company name. Per the current UI request, there is no footer; address, email and mobile remain onboarding profile data and are not displayed in a footer. The contact fields stay unset until onboarding supplies them.
- The header, company pages and About dialogs take their name from `/api/bootstrap` (`companyName`) through `brandingFor()` in `lib/app-config.ts`. Address, email, mobile and logo stay `null` until the tenant profile supplies them, so the screens say "not configured" instead of inventing details.
- `tenant_features` holds optional-module flags per tenant (voice reporting, training management, library, circulars, reward wall, push notifications). The shipped worker UI reads its compiled defaults from `lib/app-config.ts`, so a flag row has no effect until the feature-gate read is wired to the server. Employee lookup remains part of the shared reporting core; missing feature rows should be treated as disabled.
- The browser must not read or write `tenant_features` or change company branding. Safex Super Admin onboarding/feature changes belong behind authenticated server routes that verify active membership in `safex_platform_admins`; keep the service-role key server-only. The SQL migration revokes direct table grants from browser roles and includes RLS defense-in-depth policies. The Safex Super Admin management UI/API itself is not yet implemented.
- Keep tenant-specific differences in profile data and explicit feature flags, not separate vendor-specific UI forks. Preserve the core reporting/privacy workflows for every tenant.

## Production blockers before public launch

- Confirm the ten Life Saving Rules in `lib/life-saving-rules.ts` are the approved, location-specific list before publishing them.
- The initial WBD master is in Supabase. Configure and verify the server-only directory environment in Vercel; 14 source rows still lack a unique, valid mobile for OTP (shared, malformed or missing), so phone-based sign-in must remain disabled for those records until corrected.
- Implement server-side tenant resolution from verified domain and a site directory scoped to that tenant.
- The employee search endpoint (`/api/employees`) uses the tenant/site-scoped Supabase source when configured, requires an active record at the selected site, applies a minimum query length, result limit and per-IP rate limit, and returns exactly Employee ID, name, designation, department, skill grade and active state (plus the safety pass number only under `SAFEX_PUBLIC_SAFETY_PASS=true`). Same-origin validation is not identity verification; do not use this narrow lookup as authorization for protected employee data.
- Before enabling offline sync, apply and review `supabase/migrations/202610030002_offline_report_sync.sql` in staging; configure verified tenant domains, active site/employee records, the private storage bucket and server-only secrets. The route validates same-origin submissions, payloads, site/employee scope, private image type/size and database-backed request limits. Malware scanning, moderation and admin-reviewed attachment previews are still required before public production use.
- Implement OTP by matching Employee ID + submitted phone to the employee master, sending only to the registered phone, and then exposing only redacted summaries for the same vendor tenant. Configure an SMS provider and OTP limits/expiry.
- Implement Safety Officer sign-in, password reset, account lockout and email OTP with verified server-side authentication. The reference-inspired officer forms are preview-only; they do not send or store credentials.
- Add a site/vendor role-management process and audit logs. Test RLS in staging; service-role API code must repeat tenant/site/role checks because it bypasses RLS.
- Configure actual SOS numbers and backup contacts for each site; test every `tel:` link with the site owner.
- Configure push VAPID keys, a push sender, subscription storage, preference checks, unsubscribe/dead-endpoint cleanup, and generic lock-screen payloads. The UI permission request alone does not send push notifications.
- Confirm PWA icon/manifest, HTTPS, service-worker update strategy, browser/device install steps and privacy-safe offline policy. Private report data is not cached by the worker.
- Professionally review Hindi/Odia/Bengali/Punjabi/Marathi translations, accessibility, legal/privacy retention rules and incident-reporting workflow.
- Expand automated tests beyond the employee-master parser, and add monitoring, backups, secret rotation, deployment previews and production domain configuration.

## Safety/privacy defaults in this starter

- Home/report submission posts to the live `/api/reports` route; a report is stored only after the server validates site/employee scope, the payload and the database-backed rate limit.
- My Site Reports uses the active site context; it is not proof of identity.
- All Site Reports must verify the registered phone by OTP and stay within the same vendor tenant.
- Worker summaries mask reporter IDs. Full employee IDs and original attachments belong behind authorized access; reviewed previews only after moderation.
- Anonymous reports have no reporter Employee No. The server also rejects anonymous submissions outside Speak Up.
- Recognition names and reward reasons appear only in the table below the carousel when consented, published records exist. The `RecognitionGalleryItem` fields are optional to allow image-only award entries. No sample awardee names are displayed; obtain documented consent before displaying real employee names or photographs.
- Unsent reports and optional photos are held in the browser's IndexedDB outbox until the server confirms receipt; employee name/designation are not queued, only the selected Employee No. needed for server-side site validation. Avoid shared devices. The service worker never caches report/API responses.
- No real emergency phone numbers or employee roster data are committed to this repository; employee PII remains in the private Supabase project and is not returned by the public lookup.
