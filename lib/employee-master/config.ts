/**
 * Employee-master configuration. Everything is environment driven so that no real roster,
 * sheet URL or site mapping is ever committed to this repository.
 */

export type EmployeeMasterConfig = {
  enabled: boolean;
  /** Published CSV/TSV endpoint. Preferred in a real deployment. */
  csvUrl: string | null;
  /** Local CSV fallback, for offline development and sandboxes without egress. */
  filePath: string | null;
  cacheTtlMs: number;
  site: { id: string; name: string; code: string | null; region: string; sosNumber: string | null };
};

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function getEmployeeMasterConfig(): EmployeeMasterConfig {
  const csvUrl = env('SAFEX_EMPLOYEE_MASTER_CSV_URL');
  const filePath = env('SAFEX_EMPLOYEE_MASTER_FILE');
  const ttlSeconds = Number(env('SAFEX_EMPLOYEE_MASTER_TTL_SECONDS') ?? '600');
  return {
    enabled: Boolean(csvUrl || filePath),
    csvUrl,
    filePath,
    cacheTtlMs: Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : 600_000,
    site: {
      id: env('SAFEX_EMPLOYEE_MASTER_SITE_ID') ?? 'wbd',
      name: env('SAFEX_EMPLOYEE_MASTER_SITE_NAME') ?? 'West Bokaro',
      code: env('SAFEX_EMPLOYEE_MASTER_SITE_CODE') ?? 'WBD',
      region: env('SAFEX_EMPLOYEE_MASTER_SITE_REGION') ?? 'Ramgarh, Jharkhand',
      // Site emergency contact. Supplied by the tenant; confirm it before every release.
      sosNumber: env('SAFEX_EMPLOYEE_MASTER_SITE_SOS') ?? '7070705925'
    }
  };
}
