import { NextResponse } from 'next/server';
import { getSupabaseAdminKey } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const backendConfigured = Boolean(supabaseUrl && publicKey);
  let supabaseReachable = false;

  if (backendConfigured && supabaseUrl && publicKey) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        method: 'GET',
        headers: { apikey: publicKey },
        cache: 'no-store',
        signal: AbortSignal.timeout(5000)
      });
      supabaseReachable = response.ok;
    } catch {
      supabaseReachable = false;
    }
  }

  const reportSubmissionEnabled = Boolean(
    backendConfigured
    && getSupabaseAdminKey()
    && process.env.SAFEX_REPORT_SUBMISSIONS_ENABLED === 'true'
  );
  // The browser only needs reportSubmissionEnabled. Backend/connectivity flags describe the
  // internal deployment, so they are only returned when an operator opts in.
  const detailed = process.env.SAFEX_HEALTH_DETAIL === 'true';
  return NextResponse.json({
    status: 'ok',
    app: 'safex',
    reportSubmissionEnabled,
    mode: reportSubmissionEnabled ? 'report-sync-enabled' : backendConfigured ? 'backend-configured-report-sync-disabled' : 'demo-only',
    ...(detailed ? { backendConfigured, supabaseReachable } : {})
  }, { headers: { 'Cache-Control': 'no-store' } });
}
