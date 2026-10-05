import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase's current secret API keys and legacy service-role keys are both elevated.
 * Keep either one server-only; never import this module into a Client Component.
 */
export function getSupabaseAdminKey(): string | null {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return key?.trim() || null;
}

export function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const adminKey = getSupabaseAdminKey();
  if (!url || !adminKey) return null;
  return createClient(url, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
