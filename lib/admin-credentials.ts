/**
 * Dummy admin credentials for the demo sign-in dialog.
 *
 * These are intentionally public: the login screen displays them so anyone can try the
 * demo, and the client imports the same constants the server compares against. Every
 * sign-in is checked on the server (constant time) and a success is exchanged for the
 * same HMAC-signed session cookie the operator passcode gets, so the browser no longer
 * decides for itself whether an admin "logged in" — the frontend now talks to the
 * backend.
 *
 * This is a stopgap for the frontend-to-backend hookup phase. Before real users, replace
 * it with Supabase Auth plus a `staff_memberships` role check — do not just hide these
 * constants.
 */
export const ADMIN_USERNAME = 'safety.officer.demo';
export const ADMIN_PASSWORD = 'SafetyDemo2026!';
