# Safex production starter

A fresh Next.js + TypeScript PWA-oriented scaffold for the Safex flow. It remains in **DEMO MODE** until the real tenant mapping, employee master, Supabase schema/data, OTP/SMS provider, VAPID sender, SOS numbers and policies are configured.

## Included now

- Responsive safety home inspired by the latest mobile reference: compact tenant/site header, six-language chip strip, stacked report/training/circular shortcuts, a Document Vault / Library grid for SOP/SWP, Risk Assessments, Legal & Statutory Compliance, Policy & Procedures and MoM, a Wall of Fame / Reward Wall carousel whose cards carry the awardee name, designation and the reward received, plus the nearest upcoming event in Explore & Learn. Circular and notice archives remain accessible without latest-item cards on Home. The Report chooser retains all nine types: Near Miss, UC, UA, Hazard, Grievance, Speak Up, Suggestion, Feedback and Safety Observation.
- Multi-site first-open selector; session site context; Change Site in the header. Single-site tenant logic is represented in code (one site auto-selects).
- Site-filtered My Site Reports (no Employee No. filter) and an All Site Reports OTP entry screen.
- Reference-inspired reporting flows: direct UC (Unsafe Condition) and UA (Unsafe Act) forms, plus Safety Observation safe-practice options; Hazard accident/property-damage/red-risk choices; Feedback, Grievance and Suggestion category pickers; tailored fields for Near Miss, Hazard, observations, Speak Up and other concerns.
- Report form fields include worker lookup, name/Employee ID/designation autofill, location, department where relevant, incident date/time, severity where relevant, description, immediate action and optional image (12 MB limit). Anonymous reporting is available only for Speak Up; that mode hides identity and stores no employee link. Other report types require a selected employee profile.
- A real **employee master** can be connected without committing it: the roster is read server-side from `SAFEX_EMPLOYEE_MASTER_CSV_URL` (or a local CSV), cached in server memory, and exposed only through a scoped `/api/employees` lookup that enforces a minimum query length, a result cap, a per-IP budget and site scoping. The browser receives Employee ID, name and designation only — never a mobile number, address or blood group, and never the full roster. Without configuration the app keeps its synthetic demo directory. See `docs/employee-master.md`.
- Demo Employee Code profile search, an account login screen for Employees, Safety Supervisors/Site Supervisors and Admins (Employee ID + registered-mobile OTP preview; staff password login/reset previews), and a Training Management portal with a site-scoped Employee Code training check.
- A responsive Safety Officer / Manager command-center preview reachable from the Admin login tab with public, client-only demo credentials. Its dark layout follows the uploaded dashboard screenshots: three status KPIs, expandable sample analytics, an activity feed with temporary in-memory status controls, a Direct Data Injection preview, nine review desks, an Employee Profile Editor, an Audit Type picker, and reward/consequence preview forms. All displayed records are synthetic; form actions do not write or persist data. Demo login does not verify a real staff role or authenticate with Supabase. Live modules remain disabled until the project schema, role checks and auth/OTP flow are verified.
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

Open the local preview. The ignored `.env.local` in this workspace contains the previously provided public project URL and publishable key. `/api/health` checks Supabase Auth reachability. The project responds, but its Data API currently reports that `public.tenants` is missing (PGRST205); report sync remains disabled and demo reports are **not sent to Supabase** until the schema/data and server-only configuration are completed. The uploaded `officer-dashboard.html` was used as a static UI/feature reference only: its embedded Supabase project differs from this app's configured project and its direct browser-table writes were not imported.

## Deploy on Antideploy

- The production start command runs Next.js on `0.0.0.0` and uses the platform-provided `PORT`; local development remains on port 3000.
- Antideploy account authorization is stored outside this project in `~/.antideploy/config.json` with mode `0600`. The project’s `.antideploy.json` will contain only the selected application ID, not an account token.
- The local preview has the public Supabase endpoint configured; Antideploy will need the same public URL/key set in its environment. Public configuration alone does not connect the schema, employee directory or report persistence. Keep report sync disabled until migrations/data are applied and required server-only secrets and tenant controls are configured.
- Never include account tokens, service-role keys, or the OpenRouter key previously posted in project files or deploy archives.

## Configure Supabase safely

1. Create a Supabase project and copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also accepted).
3. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only in Antideploy secrets. Never commit it, put it in `.env.local` shared with others, send it in chat, expose it to the browser, or prefix it with `NEXT_PUBLIC_`.
4. Review `supabase/migrations/202610030001_initial_safex.sql` and `supabase/migrations/202610030002_offline_report_sync.sql` against your real employee/site schema; apply them only to staging first.
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
- The employee search endpoint (`/api/employees`) now applies selected-site scoping, a minimum query length, a result limit and a per-IP rate limit, and returns no contact details. It still needs to move from the sheet/CSV source onto the tenant-scoped Supabase tables, and to be covered by the authenticated session model rather than being open to any same-origin visitor.
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
- Recognition cards show the awardee name, designation and reward. Those three fields are optional in `RecognitionGalleryItem`, so a tenant that has not recorded employee consent can still publish artwork-only cards by leaving them unset. Use synthetic names in demo builds; obtain documented consent before displaying real employee names or photographs.
- Unsent reports and optional photos are held in the browser's IndexedDB outbox until the server confirms receipt; employee name/designation are not queued, only the selected Employee No. needed for server-side site validation. Avoid shared devices. The service worker never caches report/API responses.
- No real emergency phone numbers or real employee PII are included.
