import 'server-only';
import { readFile } from 'node:fs/promises';
import { getEmployeeMasterConfig, type EmployeeMasterConfig } from './config';
import { parseEmployeeMaster, type MasterEmployeeRecord, type MasterIssue } from './parse';

/**
 * Server-side employee master loader.
 *
 * The roster contains personal data (names, registered mobiles). It is loaded here, cached
 * in server memory and never shipped to the browser wholesale — route handlers project it
 * down to {empNo, name, designation} before responding.
 */

export type EmployeeMasterSnapshot = {
  records: MasterEmployeeRecord[];
  issues: MasterIssue[];
  skipped: number;
  origin: 'url' | 'file';
  loadedAt: number;
};

type CacheEntry = { snapshot: EmployeeMasterSnapshot; expiresAt: number };

let cache: CacheEntry | null = null;
let inFlight: Promise<EmployeeMasterSnapshot | null> | null = null;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 4 * 1024 * 1024;

async function readFromUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

async function readFromFile(path: string): Promise<string | null> {
  try {
    const text = await readFile(path, 'utf8');
    return text.length > MAX_BYTES ? null : text;
  } catch {
    return null;
  }
}

async function load(config: EmployeeMasterConfig): Promise<EmployeeMasterSnapshot | null> {
  const attempts: { origin: 'url' | 'file'; read: () => Promise<string | null> }[] = [];
  if (config.csvUrl) attempts.push({ origin: 'url', read: () => readFromUrl(config.csvUrl as string) });
  if (config.filePath) attempts.push({ origin: 'file', read: () => readFromFile(config.filePath as string) });

  for (const attempt of attempts) {
    const text = await attempt.read();
    if (!text) continue;
    const parsed = parseEmployeeMaster(text, { defaultSiteId: config.site.id });
    if (parsed.records.length === 0) continue;
    return { ...parsed, origin: attempt.origin, loadedAt: Date.now() };
  }
  return null;
}

export async function getEmployeeMaster(): Promise<EmployeeMasterSnapshot | null> {
  const config = getEmployeeMasterConfig();
  if (!config.enabled) return null;

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.snapshot;
  if (inFlight) return inFlight;

  inFlight = load(config)
    .then((snapshot) => {
      if (snapshot) cache = { snapshot, expiresAt: Date.now() + config.cacheTtlMs };
      // A transient failure must not wipe a good roster; keep serving the stale copy.
      return snapshot ?? cache?.snapshot ?? null;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

function score(record: MasterEmployeeRecord, needle: string): number {
  const empNo = record.employeeNo.toLowerCase();
  const name = record.fullName.toLowerCase();
  if (empNo === needle) return 0;
  if (empNo.startsWith(needle)) return 1;
  if (name.startsWith(needle)) return 2;
  if (name.split(' ').some((part) => part.startsWith(needle))) return 3;
  if (name.includes(needle) || empNo.includes(needle)) return 4;
  if (record.designation.toLowerCase().includes(needle)) return 5;
  return Number.POSITIVE_INFINITY;
}

export async function searchEmployeeMaster(siteId: string, query: string, limit = 8): Promise<MasterEmployeeRecord[]> {
  const snapshot = await getEmployeeMaster();
  if (!snapshot) return [];
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  return snapshot.records
    .filter((record) => !siteId || record.siteId === siteId)
    .map((record) => ({ record, rank: score(record, needle) }))
    .filter((entry) => Number.isFinite(entry.rank))
    .sort((a, b) => (a.rank - b.rank) || a.record.employeeNo.localeCompare(b.record.employeeNo))
    .slice(0, Math.min(Math.max(limit, 1), 25))
    .map((entry) => entry.record);
}

export async function findEmployeeByNumber(siteId: string, employeeNo: string): Promise<MasterEmployeeRecord | null> {
  const snapshot = await getEmployeeMaster();
  if (!snapshot) return null;
  const needle = employeeNo.trim().toUpperCase();
  return snapshot.records.find(
    (record) => record.employeeNo === needle && (!siteId || record.siteId === siteId)
  ) ?? null;
}

/** Test/ops helper — drops the memoised roster so the next read re-fetches. */
export function clearEmployeeMasterCache(): void {
  cache = null;
}
