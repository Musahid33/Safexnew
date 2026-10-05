/**
 * Import the employee master into Supabase `public.employees`.
 *
 *   npm run employees:dry-run     # parse + map + report, touches nothing
 *   npm run employees:import      # upsert into Supabase
 *
 * Flags
 *   --dry-run             Parse and print the mapping; make no database calls.
 *   --ensure-site         Create the tenant's site row if it does not exist yet.
 *   --deactivate-missing  Mark employees absent from the sheet as inactive (never deletes).
 *   --limit=N             Only process the first N rows (useful for a first trial).
 *
 * Required environment (server-only; never expose the service-role key to a browser):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SAFEX_TENANT_SLUG
 *   SAFEX_EMPLOYEE_MASTER_CSV_URL or SAFEX_EMPLOYEE_MASTER_FILE
 *   SAFEX_EMPLOYEE_MASTER_SITE_ID / _SITE_NAME / _SITE_REGION
 *
 * Run with Node 22+, which strips the TypeScript types natively.
 */
import { readFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseEmployeeMaster, type MasterEmployeeRecord } from '../lib/employee-master/parse.ts';

const CHUNK_SIZE = 100;

type Options = {
  dryRun: boolean;
  ensureSite: boolean;
  deactivateMissing: boolean;
  limit: number | null;
};

function parseArgs(argv: string[]): Options {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  return {
    dryRun: argv.includes('--dry-run'),
    ensureSite: argv.includes('--ensure-site'),
    deactivateMissing: argv.includes('--deactivate-missing'),
    limit: limitArg ? Number(limitArg.split('=')[1]) || null : null
  };
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

function fail(message: string, hint?: string): never {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

async function loadSourceText(): Promise<{ text: string; label: string }> {
  const url = env('SAFEX_EMPLOYEE_MASTER_CSV_URL');
  const file = env('SAFEX_EMPLOYEE_MASTER_FILE');

  if (url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) fail(`Could not download the sheet (HTTP ${response.status}).`);
    return { text: await response.text(), label: 'published sheet' };
  }
  if (file) {
    return { text: await readFile(file, 'utf8'), label: `file ${file}` };
  }
  return fail(
    'No employee master source configured.',
    'Set SAFEX_EMPLOYEE_MASTER_CSV_URL or SAFEX_EMPLOYEE_MASTER_FILE.'
  );
}

async function resolveTenant(db: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await db.from('tenants').select('id, company_name').eq('slug', slug).maybeSingle();
  if (error) fail(`Tenant lookup failed: ${error.message}`, 'Has 202610030001_initial_safex.sql been applied?');
  if (!data) fail(`No tenant with slug "${slug}".`, 'Create the tenant row first, then re-run.');
  console.log(`  tenant   : ${data.company_name} (${slug})`);
  return data.id;
}

async function resolveSite(
  db: SupabaseClient,
  tenantId: string,
  slug: string,
  name: string,
  region: string,
  ensure: boolean
): Promise<string> {
  const { data, error } = await db
    .from('sites')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('slug', slug)
    .maybeSingle();
  if (error) fail(`Site lookup failed: ${error.message}`);
  if (data) {
    console.log(`  site     : ${data.name} (${slug})`);
    return data.id;
  }
  if (!ensure) {
    fail(`No site with slug "${slug}" for this tenant.`, 'Create it, or re-run with --ensure-site.');
  }
  const { data: created, error: insertError } = await db
    .from('sites')
    .insert({ tenant_id: tenantId, slug, name, region, active: true })
    .select('id')
    .single();
  if (insertError || !created) fail(`Could not create site "${slug}": ${insertError?.message ?? 'unknown error'}`);
  console.log(`  site     : ${name} (${slug}) — created`);
  return created.id;
}

function toRow(record: MasterEmployeeRecord, tenantId: string, siteId: string) {
  return {
    tenant_id: tenantId,
    site_id: siteId,
    employee_no: record.employeeNo,
    full_name: record.fullName,
    designation: record.designation || null,
    department: record.department,
    mobile_e164: record.mobileE164,
    safety_pass_no: record.safetyPassNo,
    skill_grade: record.skillGrade,
    blood_group: record.bloodGroup,
    active: record.active,
    source: 'employee_master_sync',
    synced_at: new Date().toISOString()
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('\nSafex · employee master import');
  console.log('─'.repeat(52));

  const { text, label } = await loadSourceText();
  const siteSlug = env('SAFEX_EMPLOYEE_MASTER_SITE_ID') ?? 'kedla';
  const siteName = env('SAFEX_EMPLOYEE_MASTER_SITE_NAME') ?? siteSlug;
  const siteRegion = env('SAFEX_EMPLOYEE_MASTER_SITE_REGION') ?? '';

  const parsed = parseEmployeeMaster(text, { defaultSiteId: siteSlug });
  let records = parsed.records;
  if (options.limit) records = records.slice(0, options.limit);

  console.log(`  source   : ${label}`);
  console.log(`  parsed   : ${parsed.records.length} usable rows, ${parsed.skipped} skipped`);
  console.log(`  issues   : ${parsed.issues.length}`);

  const errors = parsed.issues.filter((issue) => issue.severity === 'error');
  if (errors.length) {
    console.log('\n  Blocking data issues:');
    for (const issue of errors) console.log(`    · [${issue.employeeNo}] ${issue.message}`);
  }
  const noMobile = parsed.records.filter((record) => !record.mobileE164).length;
  if (noMobile) {
    console.log(`\n  ${noMobile} employee(s) have no usable mobile number — OTP sign-in will not work for them.`);
  }

  if (options.dryRun) {
    console.log('\n  Dry run — nothing was written. First rows as they would be stored:\n');
    for (const record of records.slice(0, 5)) {
      console.log(`    ${record.employeeNo.padEnd(8)} ${record.fullName.padEnd(26)} ${(record.designation || '—').padEnd(24)} mobile=${record.mobileE164 ? 'yes' : 'no'}`);
    }
    console.log(`\n  ${records.length} row(s) would be upserted into public.employees.`);
    console.log('  Re-run without --dry-run (and with credentials set) to apply.\n');
    return;
  }

  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const tenantSlug = env('SAFEX_TENANT_SLUG');
  if (!url || !serviceKey) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  if (!tenantSlug) fail('SAFEX_TENANT_SLUG is required so the roster lands in exactly one tenant.');

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const tenantId = await resolveTenant(db, tenantSlug);
  const siteId = await resolveSite(db, tenantId, siteSlug, siteName, siteRegion, options.ensureSite);

  const { data: run } = await db
    .from('employee_master_sync_runs')
    .insert({ tenant_id: tenantId, site_id: siteId, source_label: label, rows_read: records.length, issue_count: parsed.issues.length })
    .select('id')
    .single();

  let upserted = 0;
  try {
    for (let index = 0; index < records.length; index += CHUNK_SIZE) {
      const chunk = records.slice(index, index + CHUNK_SIZE).map((record) => toRow(record, tenantId, siteId));
      const { error } = await db
        .from('employees')
        .upsert(chunk, { onConflict: 'tenant_id,employee_no', ignoreDuplicates: false });
      if (error) throw new Error(error.message);
      upserted += chunk.length;
      process.stdout.write(`\r  upserting: ${upserted}/${records.length}`);
    }
    process.stdout.write('\n');

    let deactivated = 0;
    if (options.deactivateMissing) {
      const keep = records.map((record) => record.employeeNo);
      const { data, error } = await db
        .from('employees')
        .update({ active: false, synced_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('site_id', siteId)
        .eq('source', 'employee_master_sync')
        .not('employee_no', 'in', `(${keep.map((value) => `"${value}"`).join(',')})`)
        .select('id');
      if (error) throw new Error(error.message);
      deactivated = data?.length ?? 0;
      console.log(`  deactivated: ${deactivated} employee(s) no longer in the sheet`);
    }

    if (run) {
      await db.from('employee_master_sync_runs').update({
        finished_at: new Date().toISOString(),
        rows_upserted: upserted,
        rows_deactivated: deactivated,
        rows_skipped: parsed.skipped,
        ok: true
      }).eq('id', run.id);
    }

    console.log(`\n✓ Imported ${upserted} employee(s) into public.employees.`);
    console.log('  The app will now read the directory from Supabase; the sheet can be unpublished.\n');
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (run) {
      await db.from('employee_master_sync_runs')
        .update({ finished_at: new Date().toISOString(), rows_upserted: upserted, ok: false, error_text: message })
        .eq('id', run.id);
    }
    fail(`Import failed after ${upserted} row(s): ${message}`);
  }
}

main().catch((cause) => fail(cause instanceof Error ? cause.message : String(cause)));
