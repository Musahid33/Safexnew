/**
 * Server-only fallback credentials for the staff sign-in.
 *
 * The dialog no longer prints these on screen — a public username/password is exactly the
 * "demo content" that was removed from the app. The values are read on the server only and
 * are never part of a client bundle (`lib/admin-auth.ts` is `server-only`).
 *
 * Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` in the deployment environment to replace them.
 * The fallback exists so an existing deployment does not lose its way in during the swap;
 * change it before real users arrive, and prefer Supabase Auth plus a `staff_memberships`
 * role check over any shared credential.
 */
const FALLBACK_USERNAME = 'safety.officer.demo';
const FALLBACK_PASSWORD = 'SafetyDemo2026!';

export const ADMIN_USERNAME = (process.env.ADMIN_USERNAME ?? '').trim() || FALLBACK_USERNAME;
export const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD ?? '') || FALLBACK_PASSWORD;
