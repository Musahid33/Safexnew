import 'server-only';
import type { DirectoryUnavailableReason, Site } from '@/lib/types';
import { getBrandingCompanyName, getEmployeeMasterConfig } from './config';
import {
  countEmployeesInDatabase,
  probeDatabaseDirectory,
  findEmployeeInDatabase,
  getCompanyNameFromDatabase,
  isDatabaseDirectoryConfigured,
  isDatabaseDirectoryIntended,
  listEmployeesFromDatabase,
  listSitesFromDatabase,
  searchEmployeesInDatabase
} from './db-source';
import type { MasterEmployeeRecord } from './parse';
import { findEmployeeByNumber, getEmployeeMaster, searchEmployeeMaster } from './source';

/** Real sources only: database (auto mode), then configured sheet. Never invent records. */

export type DirectoryMode = 'supabase' | 'sheet' | 'unavailable';

export type DirectoryStatus = {
  mode: DirectoryMode;
  sites: Site[];
  employeeCount: number;
  /** Tenant branding for the passport. Null when the database cannot answer. */
  companyName: string | null;
  dataIssueCount: number;
  /** A richer source was configured but could not be read. */
  degraded: boolean;
  /** Why the directory is unavailable. Null whenever a source answered. */
  reason: DirectoryUnavailableReason | null;
};

export async function getDirectoryStatus(): Promise<DirectoryStatus> {
  if (isDatabaseDirectoryConfigured()) {
    const [sites, employeeCount, companyName] = await Promise.all([
      listSitesFromDatabase(),
      countEmployeesInDatabase(),
      getCompanyNameFromDatabase()
    ]);
    if (sites && sites.length > 0 && employeeCount !== null && employeeCount > 0) {
      return {
        mode: 'supabase',
        sites,
        employeeCount,
        companyName: companyName ?? getBrandingCompanyName(),
        dataIssueCount: 0,
        degraded: false,
        reason: null
      };
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
        sites,
        employeeCount: snapshot.records.length,
        companyName: getBrandingCompanyName(),
        dataIssueCount: snapshot.issues.length,
        degraded: isDatabaseDirectoryIntended(),
        reason: null
      };
    }
  }

  return {
    mode: 'unavailable',
    // No synthetic site: an empty list is the truthful answer when the master is unreachable.
    sites: [],
    employeeCount: 0,
    companyName: getBrandingCompanyName(),
    dataIssueCount: 0,
    degraded: true,
    reason: await diagnoseUnavailable(config.enabled)
  };
}

/**
 * Name the failure instead of printing one generic hint for every cause. The caller (the
 * profile dialog) turns this into a specific sentence, so an operator can tell a missing
 * service key from an unreachable database without reading server logs.
 */
async function diagnoseUnavailable(snapshotEnabled: boolean): Promise<DirectoryUnavailableReason> {
  if (isDatabaseDirectoryIntended()) {
    // A healthy probe here means the failure was transient between queries; report the
    // database path rather than blaming the configuration.
    return (await probeDatabaseDirectory()) ?? 'database_unreachable';
  }
  return snapshotEnabled ? 'snapshot_unreadable' : 'keys_missing';
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

  return { mode: 'unavailable', records: [] };
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

  return { mode: 'unavailable', record: null };
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

  return { mode: 'unavailable', records: [], total: 0 };
}
