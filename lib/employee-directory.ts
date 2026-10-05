import { DEMO_EMPLOYEES } from './demo-data';
import type { Employee } from './types';

/**
 * Browser-side employee directory.
 *
 * In demo mode the synthetic roster is filtered locally. When a real employee master is
 * configured the browser holds no roster at all: every lookup is a scoped request to
 * /api/employees, which enforces the minimum query length, the result cap and the
 * per-IP budget, and strips everything except Employee ID, name and designation.
 */

export type DirectoryMode = 'demo' | 'master';

export type EmployeeDirectory = {
  mode: DirectoryMode;
  minQueryLength: number;
  search(siteId: string, query: string, signal?: AbortSignal): Promise<Employee[]>;
  findByEmployeeNo(siteId: string, employeeNo: string, signal?: AbortSignal): Promise<Employee | null>;
};

const MAX_RESULTS = 8;

function matchesLocally(employee: Employee, needle: string): boolean {
  return `${employee.empNo} ${employee.name} ${employee.designation}`.toLowerCase().includes(needle);
}

export const DEMO_DIRECTORY: EmployeeDirectory = {
  mode: 'demo',
  minQueryLength: 1,
  async search(siteId, query) {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return DEMO_EMPLOYEES
      .filter((employee) => (!siteId || employee.siteId === siteId) && matchesLocally(employee, needle))
      .slice(0, MAX_RESULTS);
  },
  async findByEmployeeNo(siteId, employeeNo) {
    const needle = employeeNo.trim().toUpperCase();
    return DEMO_EMPLOYEES.find(
      (employee) => employee.empNo.toUpperCase() === needle && (!siteId || employee.siteId === siteId)
    ) ?? null;
  }
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

export function directoryFor(mode: DirectoryMode): EmployeeDirectory {
  return mode === 'master' ? MASTER_DIRECTORY : DEMO_DIRECTORY;
}
