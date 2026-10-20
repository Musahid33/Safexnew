import type { Employee } from './types';

/** Browser lookups always use the scoped server API. No synthetic/offline roster. */

export type DirectoryMode = 'master';

type PublicEmployeeLookup = Pick<
  Employee,
  'empNo' | 'name' | 'designation' | 'department' | 'skillGrade' | 'safetyPassNo' | 'active'
>;

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
  const payload = await response.json() as { employees?: PublicEmployeeLookup[] };
  if (!Array.isArray(payload.employees)) return [];

  // Site and React-key metadata are derived client-side. The API exposes only the three
  // requested employee fields: Employee ID, name and designation.
  const siteId = params.get('siteId') ?? '';
  return payload.employees
    // A missing designation must not hide a real employee: strip the row's identity fields
    // only. Designation is display text, so an empty value degrades to "not recorded".
    .filter((employee) => employee
      && typeof employee.empNo === 'string'
      && employee.empNo.length > 0
      && typeof employee.name === 'string'
      && employee.name.length > 0)
    .map((employee) => ({
      id: `emp-${employee.empNo.toLowerCase()}`,
      empNo: employee.empNo,
      name: employee.name,
      designation: employee.designation ?? '',
      siteId,
      // Work context the server chose to release. `safetyPassNo` stays undefined when the
      // deployment has not opted in, which the passport renders as "restricted".
      department: employee.department ?? null,
      skillGrade: employee.skillGrade ?? null,
      safetyPassNo: employee.safetyPassNo,
      active: employee.active !== false
    }));
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
