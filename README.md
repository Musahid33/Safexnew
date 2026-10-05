# Safex production starter

A fresh Next.js + TypeScript PWA-oriented scaffold for the Safex flow. It remains in **DEMO MODE** until the real tenant mapping, employee master, Supabase schema/data, OTP/SMS provider, VAPID sender, SOS numbers and policies are configured.

## Included now

- Responsive safety home inspired by the latest mobile reference: compact tenant/site header, six-language chip strip, stacked report/training/circular shortcuts, a Document Vault / Library grid for SOP/SWP, Risk Assessments, Legal & Statutory Compliance, Policy & Procedures and MoM, a Wall of Fame / Reward Wall carousel whose cards carry the awardee name, designation and the reward received, plus the nearest upcoming event in Explore & Learn. Circular and notice archives remain accessible without latest-item cards on Home. The Report chooser retains all nine types: Near Miss, UC, UA, Hazard, Grievance, Speak Up, Suggestion, Feedback and Safety Observation.
- Multi-site first-open selector; session site context; Change Site in the header. Single-site tenant logic is represented in code (one site auto-selects).
- Site-filtered My Site Reports (no Employee No. filter) and an All Site Reports OTP entry screen.
- Reference-inspired reporting flows: direct UC (Unsafe Condition) and UA (Unsafe Act) forms, plus Safety Observation safe-practice options; Hazard accident/property-damage/red-risk choices; Feedback, Grievance and Suggestion category pickers; tailored fields for Near Miss, Hazard, observations, Speak Up and other concerns.
- Report form fields include worker lookup, name/Employee ID/designation autofill, location, department where relevant, incident date/time, severity where relevant, description, immediate action and optional image (12 MB limit). Anonymous reporting is available only for Speak Up; that mode hides identity and stores no employee link. Other report types require a selected employee profile.
- The **employee master uses real records only**. Configure the supplied CSV URL as a server-only `SAFEX_EMPLOYEE_MASTER_CSV_URL` with `SAFEX_EMPLOYEE_DIRECTORY_SOURCE=sheet`. West Bokaro (WBD) is the sole selectable site. No employee master, sample training histories, sample certificates, or synthetic employee fallback is bundled. Unavailable sources return HTTP 503 for lookups; a last successfully loaded sheet may be served from server memory during a transient outage. Worker results are scoped and capped; the full roster requires a verified admin session. See `docs/employee-master.md`.
- Demo Employee Code profile search, an account login screen for Employees, Safety Supervisors/Site Supervisors and Admins (Employee ID + registered-mobile OTP preview; staff password login/reset previews), and a Training Management portal with a site-scoped Employee Code training check.
- The Admin / HSE Manager dashboard is the uploaded `SafetyOS — Employee Profile Preview (2).html` console, mounted as designed rather than re-implemented: all 18 screens (Case Management, Training Management, Employee Profile, Communications, Document Vault / Library, Audit & Inspection, Form Builder, DM, User & Access, Dashboard, View & Analytics, Certificates, Export Reports, Direct Data Entry, Daily Management, System Settings) with their charts, tables, form builder, CSV / report export and in-memory demo records. Reach it from the Admin login tab; access to the roster requires the server-verified operator session below. The design is the source of truth: edit the HTML and run `npm run design:extract` to regenerate `app/safetyos.css` and the two modules in `app/components/safetyos/generated/` (markup + script); never hand-edit those. When `SAFEX_ADMIN_PASSCODE` is set, the console asks for it and then feeds the real employee master into the design's own directory through the seam in `scripts/extract-design.mjs`; that seam maps only employee number, name, designation and department, so mobile numbers, blood groups and safety pass numbers are never handed to the console even when the API is allowed to release them; otherwise the console stays unavailable, with no synthetic fallback. Demo login itself still does not verify a real staff role or authenticate with Supabase, and every console edit stays in browser memory — nothing is written to the database.
- Site-scoped report outbox for offline use: each report and its optional image are saved in IndexedDB first, then retried on reconnect/focus and with Background Sync where supported. A server-side Supabase endpoint uses a stable submission ID for idempotent retries, validates tenant/site/employee scope, enforces a database-backed request limit, and stores optional evidence in a private bucket. This stays disabled until the server configuration and offline-sync migration are applied.
- Site-specific SOS screen; emergency contacts are intentionally `null` until you supply verified numbers.
- Safety Portal hero with a Life Saving Rule location picker and popup; actual company-approved, location-specific rules must be supplied before operational use.
- Notification preference UI, browser permission request and service-worker push display/click handlers.
- More → Appearance (System/Light/Dark and four palettes) and More → Install App.
- Six language labels for key navigation/form actions. Longer translations require review by native speakers.
- Supabase client wrappers, environment template and an initial tenant/site/RLS migration.
- Demo tenant company branding in the header and per-tenant optional-module flags; the footer is intentionally removed, and the shared core UI remains consistent across companies.

## Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to the ignored `.env.local` and set the public Supabase URL/publishable key plus the server-only `SUPABASE_SECRET_KEY`. `/api/health` checks Supabase Auth reachability; `/api/bootstrap` and the employee lookup API use the server-side Supabase directory when its schema, tenant, site and employee rows are present. The directory refuses ambiguous multi-tenant reads unless `SAFEX_TENANT_SLUG` is set. Migrations are not applied automatically. Report sync remains disabled until its schema, rate-limit function, private bucket and verified tenant domain are configured.

## Deploy on Antideploy

- The production start command runs Next.js on `0.0.0.0` and uses the platform-provided `PORT`; local development remains on port 3000.
- Antideploy account authorization is stored outside this project in `~/.antideploy/config.json` with mode `0600`. The project’s `.antideploy.json` will contain only the selected application ID, not an account token.
- The local preview has the public Supabase endpoint configured; Antideploy will need the same public URL/key set in its environment. Public configuration alone does not connect the schema, employee directory or report persistence. Keep report sync disabled until migrations/data are applied and required server-only secrets and tenant controls are configured.
- Never include account tokens, service-role keys, or the OpenRouter key previously posted in project files or deploy archives.

## Configure Supabase safely

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted).
3. Keep `SUPABASE_SECRET_KEY` server-only in deployment secrets. The legacy `SUPABASE_SERVICE_ROLE_KEY` name is also supported. Never commit either value, expose it to the browser, prefix it with `NEXT_PUBLIC_`, or share a real environment file.
4. Review `supabase/migrations/202610030001_initial_safex.sql`, `supabase/migrations/202610030002_offline_report_sync.sql` and `supabase/migrations/202610050003_employee_master_sync.sql` against your real employee/site schema; apply them only to staging first.
   Then apply `supabase/sql/02_rls.sql` — a re-runnable grants/RLS/policy hardening script split into independently runnable PARTs, with an apply ledger so a run that times out in the SQL editor can be resumed. Finish with `supabase/sql/99_gate_test.sql`, which must report PASS on every row (it raises an exception otherwise, so it can gate a deploy).
5. Map and verify vendor domains, sites, roles and actual report columns. Test RLS as anonymous, employee, site officer, vendor admin and a different tenant before production.

The migration deliberately denies direct anonymous access to employee/report tables. Public site selection, employee lookup, anonymous report submission, OTP-protected cross-site summaries and attachment previews still need validated server/Edge endpoints. Do not simply grant public SELECT on raw reports or rely on a browser `site_id`/localStorage value.

## Tenant onboarding, branding and optional features

- During company onboarding, Safex Super Admin records the tenant company name, address, contact email and mobile number, plus its verified domain and sites. The migration stores the public-facing profile in `tenants` (`company_name`, `company_address`, `contact_email`, `contact_mobile_e164`); optional logo storage is represented by `logo_path`.
- The shared app header displays the tenant company name. Per the current UI request, there is no footer; address, email and mobile remain onboarding profile data and are not displayed in a footer. In this demo the contact fields are intentionally unset.
- The demo UI reads a typed `DEMO_TENANT` profile from `lib/demo-data.ts`. This is not connected to the database. Production must resolve the tenant from a verified host/domain on the server, load its profile, and pass only the approved public branding fields to the UI.
- `tenant_features` stores optional modules by tenant. Current demo flags cover voice reporting, training management, library, circulars, reward wall and push notifications. Employee lookup remains part of the shared reporting core; feature-gated modules use the same shared UI shell. Missing feature rows should be treated as disabled.
- The browser must not read or write `tenant_features` or change company branding. Safex Super Admin onboarding/feature changes belong behind authenticated server routes that verify active membership in `safex_platform_admins`; keep the service-role key server-only. The SQL migration revokes direct table grants from browser roles and includes RLS defense-in-depth policies. The Safex Super Admin management UI/API itself is not yet implemented.
- Keep tenant-specific differences in profile data and explicit feature flags, not separate vendor-specific UI forks. Preserve the core reporting/privacy workflows for every tenant.

## Production blockers before public launch

- Supply and approve the location-specific Life Saving Rules before publishing them; the current Life Saving Rule popup is a placeholder.
- Import and validate the real employee master into Supabase. The sheet-backed loader is a bridge, not the destination: it still needs a Site column, a Department column and one verified mobile per employee. `docs/employee-master.md` lists the specific rows that currently block OTP sign-in (malformed and shared numbers).
- Implement server-side tenant resolution from verified domain and a site directory scoped to that tenant.
- The employee search endpoint (`/api/employees`) supports the tenant-scoped Supabase tables and applies selected-site scoping, a minimum query length, a result limit and a per-IP rate limit; it returns no contact details. It is still an unauthenticated same-origin lookup, so add the verified employee session model and review rate limits before production.
- Before enabling offline sync, apply and review `supabase/migrations/202610030002_offline_report_sync.sql` in staging; configure verified tenant domains, active site/employee records, the private storage bucket and server-only secrets. The route validates same-origin submissions, payloads, site/employee scope, private image type/size and database-backed request limits. Malware scanning, moderation and admin-reviewed attachment previews are still required before public production use.
- Implement OTP by matching Employee ID + submitted phone to the employee master, sending only to the registered phone, and then exposing only redacted summaries for the same vendor tenant. Configure an SMS provider and OTP limits/expiry.
- Implement Safety Officer sign-in, password reset, account lockout and email OTP with verified server-side authentication. The reference-inspired officer forms are preview-only; they do not send or store credentials.
- Add a site/vendor role-management process and audit logs. Test RLS in staging; service-role API code must repeat tenant/site/role checks because it bypasses RLS.
- Configure actual SOS numbers and backup contacts for each site; test every `tel:` link with the site owner.
- Configure push VAPID keys, a push sender, subscription storage, preference checks, unsubscribe/dead-endpoint cleanup, and generic lock-screen payloads. The UI permission request alone does not send push notifications.
- Confirm PWA icon/manifest, HTTPS, service-worker update strategy, browser/device install steps and privacy-safe offline policy. Private report data is not cached by the worker.
- Professionally review Hindi/Odia/Bengali/Punjabi/Marathi translations, accessibility, legal/privacy retention rules and incident-reporting workflow.
- Add automated tests, monitoring, backups, secret rotation, deployment previews and production domain configuration.

## Safety/privacy defaults in this starter

- Home/report submission is public in the UI, but real report APIs are not connected yet.
- My Site Reports uses the active site context; it is not proof of identity.
- All Site Reports must verify the registered phone by OTP and stay within the same vendor tenant.
- Worker summaries mask reporter IDs. Full employee IDs and original attachments belong behind authorized access; reviewed previews only after moderation.
- Anonymous reports have no reporter Employee No. The server also rejects anonymous submissions outside Speak Up.
- Recognition cards show the awardee name, designation and reward. Those three fields are optional in `RecognitionGalleryItem`, so a tenant that has not recorded employee consent can still publish artwork-only cards by leaving them unset. No sample awardee names are displayed; obtain documented consent before displaying real employee names or photographs.
- Unsent reports and optional photos are held in the browser's IndexedDB outbox until the server confirms receipt; employee name/designation are not queued, only the selected Employee No. needed for server-side site validation. Avoid shared devices. The service worker never caches report/API responses.
- No real emergency phone numbers or real employee PII are included.
