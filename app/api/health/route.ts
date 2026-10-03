import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const reportSubmissionEnabled = Boolean(
    backendConfigured
    && process.env.SUPABASE_SERVICE_ROLE_KEY
    && process.env.SAFEX_REPORT_SUBMISSIONS_ENABLED === 'true'
  );
  return NextResponse.json({
    status: 'ok',
    app: 'safex',
    backendConfigured,
    reportSubmissionEnabled,
    mode: reportSubmissionEnabled ? 'report-sync-enabled' : backendConfigured ? 'backend-configured-report-sync-disabled' : 'demo-only'
  }, { headers: { 'Cache-Control': 'no-store' } });
}
