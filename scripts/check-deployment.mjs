#!/usr/bin/env node
/**
 * Deployment configuration check for Safex.
 *
 *   node scripts/check-deployment.mjs https://safexnew.vercel.app
 *   node scripts/check-deployment.mjs https://safexnew.vercel.app --empNo=EMP004
 *
 * Verifies, from outside the deployment, the two settings that are easy to get wrong:
 *   1. the employee directory is served from Supabase (not a snapshot, not unavailable);
 *   2. report sync is enabled and the host has a verified tenant_domains row.
 *
 * It only calls public endpoints. It never prints a mobile number, blood group or address,
 * and it does not submit a report — use the app for that.
 *
 * Exit code 0 = every required check passed, 1 = something needs configuration.
 */

const args = process.argv.slice(2);
const baseArg = args.find((value) => !value.startsWith('--'));
const empNoArg = args.find((value) => value.startsWith('--empNo='));
const empNo = empNoArg ? empNoArg.slice('--empNo='.length).trim() : '';
const allowSnapshot = args.includes('--allow-snapshot');

if (!baseArg) {
  console.error('Usage: node scripts/check-deployment.mjs <https://your-deployment> [--empNo=EMP004] [--allow-snapshot]');
  process.exit(1);
}

const base = baseArg.replace(/\/+$/, '');
let failures = 0;

function line(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON error page */ }
  return { status: response.status, body };
}

console.log(`\nSafex deployment check · ${base}\n${'─'.repeat(58)}`);

let health;
try {
  health = await getJson('/api/health');
} catch (error) {
  console.error(`✗ Could not reach ${base} — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

line(health.status === 200, 'App responds', `HTTP ${health.status}`);
line(Boolean(health.body?.reportSubmissionEnabled), 'Report sync enabled',
  health.body?.reportSubmissionEnabled
    ? `mode=${health.body?.mode}`
    : 'SAFEX_REPORT_SUBMISSIONS_ENABLED/SUPABASE_SERVICE_ROLE_KEY missing (reports stay queued on device)');

const bootstrap = await getJson('/api/bootstrap');
const directory = bootstrap.body?.directory;
const directoryOk = directory === 'supabase' || (allowSnapshot && directory === 'sheet');
line(directoryOk, 'Employee directory source',
  directory === 'supabase'
    ? `supabase · ${bootstrap.body?.employeeCount ?? 0} active employees`
    : directory === 'sheet'
      ? `sheet snapshot · ${bootstrap.body?.employeeCount ?? 0} employees (expected supabase in production)`
      : 'unavailable — set SUPABASE_SERVICE_ROLE_KEY, SAFEX_EMPLOYEE_DIRECTORY_SOURCE=auto and SAFEX_TENANT_SLUG');
line(Array.isArray(bootstrap.body?.sites) && bootstrap.body.sites.length > 0, 'Site list',
  (bootstrap.body?.sites ?? []).map((site) => site.name).join(', ') || 'none');
line(Boolean(bootstrap.body?.companyName), 'Company branding',
  bootstrap.body?.companyName ?? 'unset — set tenants.company_name or SAFEX_TENANT_COMPANY_NAME');

if (empNo) {
  const lookup = await getJson(`/api/employees?siteId=${encodeURIComponent(bootstrap.body?.sites?.[0]?.id ?? '')}&empNo=${encodeURIComponent(empNo)}`);
  const found = Boolean(lookup.body?.employees?.length);
  line(found, `Employee lookup ${empNo}`,
    found
      ? `${lookup.body.employees[0].name} · ${lookup.body.employees[0].designation || 'designation not recorded'}`
      : lookup.status === 503
        ? 'directory unavailable (HTTP 503)'
        : 'no active employee with that ID at the selected site');
}

console.log(`${'─'.repeat(58)}`);
if (failures === 0) {
  console.log('All checks passed.\n');
} else {
  console.log(`${failures} check(s) need attention. See docs/report-sync.md and docs/employee-master.md.\n`);
  process.exitCode = 1;
}
