import { NextResponse } from 'next/server';

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
    && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.SAFEX_REPORT_SUBMISSIONS_ENABLED === 'true'
  );
  return NextResponse.json({
    status: 'ok',
    app: 'safex',
    backendConfigured,
    supabaseReachable,
    reportSubmissionEnabled,
    mode: reportSubmissionEnabled ? 'report-sync-enabled' : backendConfigured ? 'backend-configured-report-sync-disabled' : 'demo-only'
  }, { headers: { 'Cache-Control': 'no-store' } });
}
