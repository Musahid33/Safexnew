-- Remove a vestigial document column.
--
-- `documents.uploaded_by` was carried over from the original import and never written: every
-- row is NULL, nothing in the app selects or patches it, no view, policy, index or function
-- mentions it, and provenance is already recorded where it matters (the audit trail for
-- publishing writes, `safex_audit_events` for provisioning). Keeping an unused FK to
-- `auth.users` only invites a future reader to assume document authorship is tracked.
--
-- The rest of the schema was audited in `CLEANUP-REPORT.md`: every other all-NULL column is
-- an editable profile/register field, and every table without a call site is either read by a
-- seed/audit RPC or required by an RLS helper. None of them is dropped.

alter table public.documents
  drop column if exists uploaded_by;
