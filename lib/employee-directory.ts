import type { Employee } from './types';

/** Browser lookups always use the scoped server API. No synthetic/offline roster. */

export type DirectoryMode = 'master';

export type EmployeeDirectory = {
  mode: DirectoryMode;
  minQueryLength: number;
  search(siteId: string, query: string, signal?: AbortSignal): Promise<Employee[]>;
  findByEmployeeNo(siteId: string, employeeNo: string, signal?: AbortSignal): Promise<Employee | null>;
};

async function requestEmployees(params: URLSearchParams, signal?: AbortSignal): Promise<Employee[]> {
  const response = await fetch(`/api/employees?${params.toString()}`, { cache: 'no-store', signal });
  if (!response.ok) {
    if (response.status === 429) throw new Error('LOOKUP_RATE_LIMITED');
    throw new Error('LOOKUP_FAILED');
  }
  const payload = await response.json() as { employees?: Employee[] };
  return Array.isArray(payload.employees) ? payload.employees : [];
}

export const MASTER_DIRECTORY: EmployeeDirectory = {
  mode: 'master',
  minQueryLength: 2,
  async search(siteId, query, signal) {
    const needle = query.trim();
    if (needle.length < 2) return [];
    return requestEmployees(new URLSearchParams({ siteId, q: needle }), signal);
  },
  async findByEmployeeNo(siteId, employeeNo, signal) {
    const needle = employeeNo.trim();
    if (!needle) return null;
    const results = await requestEmployees(new URLSearchParams({ siteId, empNo: needle }), signal);
    return results[0] ?? null;
  }
};
