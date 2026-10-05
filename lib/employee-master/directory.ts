import 'server-only';
import { DEMO_SITES } from '@/lib/demo-data';
import type { Site } from '@/lib/types';
import { getEmployeeMasterConfig } from './config';
import {
  countEmployeesInDatabase,
  findEmployeeInDatabase,
  isDatabaseDirectoryConfigured,
  isDatabaseDirectoryIntended,
  listEmployeesFromDatabase,
  listSitesFromDatabase,
  searchEmployeesInDatabase
} from './db-source';
import type { MasterEmployeeRecord } from './parse';
import { findEmployeeByNumber, getEmployeeMaster, searchEmployeeMaster } from './source';

/**
 * Single entry point for "where do employees come from".
 *
 * Resolution order is Supabase -> published sheet/CSV -> synthetic demo records. The
 * sheet is a migration bridge; once `npm run employees:import` has populated
 * `public.employees`, the database wins automatically and the sheet can be unpublished.
 *
 * A source that is configured but unreachable degrades to the next one rather than
 * reporting an empty directory, which would look like a site with no workers.
 */

export type DirectoryMode = 'supabase' | 'sheet' | 'demo';

export type DirectoryStatus = {
  mode: DirectoryMode;
  sites: Site[];
  employeeCount: number;
  dataIssueCount: number;
  /** A richer source was configured but could not be read. */
  degraded: boolean;
};

export async function getDirectoryStatus(): Promise<DirectoryStatus> {
  if (isDatabaseDirectoryConfigured()) {
    const [sites, employeeCount] = await Promise.all([
      listSitesFromDatabase(),
      countEmployeesInDatabase()
    ]);
    if (sites && sites.length > 0 && employeeCount !== null && employeeCount > 0) {
      return { mode: 'supabase', sites, employeeCount, dataIssueCount: 0, degraded: false };
    }
  }

  const config = getEmployeeMasterConfig();
  if (config.enabled) {
    const snapshot = await getEmployeeMaster();
    if (snapshot) {
      const siteIds = [...new Set(snapshot.records.map((record) => record.siteId))];
      const sites: Site[] = siteIds.map((id) => ({
        id,
        name: id === config.site.id ? config.site.name : id,
        region: id === config.site.id ? config.site.region : '',
        sosNumber: null
      }));
      return {
        mode: 'sheet',
        sites: sites.length ? sites : DEMO_SITES,
        employeeCount: snapshot.records.length,
        dataIssueCount: snapshot.issues.length,
        degraded: isDatabaseDirectoryIntended()
      };
    }
  }

  return {
    mode: 'demo',
    sites: DEMO_SITES,
    employeeCount: 0,
    dataIssueCount: 0,
    degraded: isDatabaseDirectoryIntended() || config.enabled
  };
}

export async function searchDirectory(
  siteId: string,
  query: string,
  limit = 8
): Promise<{ mode: DirectoryMode; records: MasterEmployeeRecord[] }> {
  if (isDatabaseDirectoryConfigured()) {
    const records = await searchEmployeesInDatabase(siteId, query, limit);
    if (records !== null) return { mode: 'supabase', records };
  }

  const config = getEmployeeMasterConfig();
  if (config.enabled) {
    const records = await searchEmployeeMaster(siteId, query, limit);
    if ((await getEmployeeMaster()) !== null) return { mode: 'sheet', records };
  }

  return { mode: 'demo', records: [] };
}

export async function findInDirectory(
  siteId: string,
  employeeNo: string
): Promise<{ mode: DirectoryMode; record: MasterEmployeeRecord | null }> {
  if (isDatabaseDirectoryConfigured()) {
    const record = await findEmployeeInDatabase(siteId, employeeNo);
    // `undefined` means the database could not answer; `null` is an authoritative miss.
    if (record !== undefined) return { mode: 'supabase', record };
  }

  const config = getEmployeeMasterConfig();
  if (config.enabled) {
    const record = await findEmployeeByNumber(siteId, employeeNo);
    if ((await getEmployeeMaster()) !== null) return { mode: 'sheet', record };
  }

  return { mode: 'demo', record: null };
}

export type RosterPage = {
  mode: DirectoryMode;
  records: MasterEmployeeRecord[];
  total: number;
};

/**
 * Enumerate the roster for the admin console.
 *
 * `searchDirectory` is deliberately crippled — minimum query length, hard cap — because
 * it serves an unauthenticated form. This one is the opposite: it lists everyone, so it
 * must only ever be reached through a verified admin session.
 *
 * `includePii` is honoured by the database source only. The sheet snapshot already holds
 * every column in server memory, so the projection happens at the API boundary instead.
 */
export async function listDirectory(
  siteId: string,
  options: { query?: string; limit: number; offset: number; includePii?: boolean }
): Promise<RosterPage> {
  if (isDatabaseDirectoryConfigured()) {
    const page = await listEmployeesFromDatabase(siteId, options);
    if (page !== null) return { mode: 'supabase', ...page };
  }

  const config = getEmployeeMasterConfig();
  if (config.enabled) {
    const snapshot = await getEmployeeMaster();
    if (snapshot) {
      const needle = (options.query ?? '').trim().toLowerCase();
      const filtered = snapshot.records.filter((record) => {
        if (siteId && record.siteId !== siteId) return false;
        if (!needle) return true;
        return record.employeeNo.toLowerCase().includes(needle)
          || record.fullName.toLowerCase().includes(needle)
          || record.designation.toLowerCase().includes(needle);
      });
      return {
        mode: 'sheet',
        records: filtered.slice(options.offset, options.offset + options.limit),
        total: filtered.length
      };
    }
  }

  return { mode: 'demo', records: [], total: 0 };
}
