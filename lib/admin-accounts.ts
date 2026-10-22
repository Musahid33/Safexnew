import 'server-only';
import { getAdminSupabase } from './supabase/admin';
import { withTimeout } from './with-timeout';
import { supabaseAdminConfigured } from './admin-credentials';

/**
 * Operator sign-in backed by Supabase Auth.
 *
 * The password is never read, stored or compared by this app: it is posted to Supabase's
 * token endpoint, Supabase verifies it against its own bcrypt hash and answers with a user.
 * What this module adds is the allowlist check — a verified Supabase user still gets nothing
 * unless an active row in `public.admin_accounts` names them.
 *
 * Both halves are required. Without a row, anyone who could create an account in the project
 * (or an employee auth user added later) would silently become an operator.
 */

export type AdminAccount = { username: string; email: string };

function publishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? ''
  ).trim();
}

/** The allowlist row for `login`, which may be either the username or the email. */
export async function resolveAdminAccount(login: string): Promise<AdminAccount | null> {
  if (!supabaseAdminConfigured()) return null;
  const store = getAdminSupabase();
  if (!store) return null;

  const value = login.trim().toLowerCase();
  if (value.length < 3 || value.length > 120) return null;

  const column = value.includes('@') ? 'email' : 'username';
  const query = store
    .from('admin_accounts')
    .select('username, email')
    .eq(column, value)
    .eq('active', true)
    .limit(1);

  const result = await withTimeout(query.maybeSingle(), 4000);
  if (!result || result.error || !result.data) return null;
  const row = result.data as { username?: unknown; email?: unknown };
  if (typeof row.username !== 'string' || typeof row.email !== 'string') return null;
  return { username: row.username, email: row.email };
}

/** True when Supabase accepts this email/password pair. The password is never retained. */
export async function verifySupabasePassword(email: string, password: string): Promise<boolean> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const key = publishableKey();
  if (!url || !key || !password || password.length > 200) return false;

  const request = fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    cache: 'no-store',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  const response = await withTimeout(request, 6000);
  if (!response) return false;
  // Always drain the body: a rejected sign-in must cost the same as an accepted one.
  const payload = await response.json().catch(() => null);
  if (!response.ok) return false;

  const user = (payload as { user?: { id?: unknown; email?: unknown } } | null)?.user;
  if (typeof user?.id !== 'string' || !user.id) return false;
  return String(user.email ?? '').toLowerCase() === email.toLowerCase();
}

/** Resolve the allowlist row, then let Supabase verify the password. */
export async function signInWithSupabase(login: string, password: string): Promise<AdminAccount | null> {
  const account = await resolveAdminAccount(login);
  if (!account) return null;
  if (!(await verifySupabasePassword(account.email, password))) return null;
  void markAdminLogin(account.username);
  return account;
}

/** Record the sign-in. Best effort — a failure here must not block a verified operator. */
async function markAdminLogin(username: string): Promise<void> {
  const store = getAdminSupabase();
  if (!store) return;
  await withTimeout(
    store.from('admin_accounts').update({ last_login_at: new Date().toISOString() }).eq('username', username),
    3000
  );
}
