/**
 * Matching a typed employee number or name against the employee master.
 *
 * The DM form is filled in a stockyard, often one-handed. Rather than make the operator
 * find a person in a list of 190, the number and the name are both searchable: type either
 * one and the other fills itself in.
 *
 * Pure and dependency-free, so the matching rules are covered by tests instead of being
 * discovered in the field.
 */

export type DirectoryEmployee = {
  empNo: string;
  name: string;
  designation: string;
};

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * Resolve a query to exactly one employee, or to nobody.
 *
 * An exact match always wins. A prefix counts only when it is long enough to mean
 * something and only when it identifies a single person — two people called "Ravi" must
 * not silently become one.
 */
export function findEmployee(
  employees: readonly DirectoryEmployee[],
  query: string,
  field: 'empNo' | 'name'
): DirectoryEmployee | null {
  const needle = clean(query).toLowerCase();
  if (!needle) return null;

  const pairs = employees.map((employee) => ({ employee, key: clean(employee[field]).toLowerCase() }));
  const exact = pairs.find((pair) => pair.key === needle);
  if (exact) return exact.employee;

  if (needle.length < (field === 'empNo' ? 2 : 3)) return null;
  const prefixed = pairs.filter((pair) => pair.key.startsWith(needle));
  return prefixed.length === 1 ? prefixed[0].employee : null;
}

/** Keep only the fields the picker needs, and drop rows the master cannot identify. */
export function directoryFromApi(rows: unknown): DirectoryEmployee[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const directory: DirectoryEmployee[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const empNo = clean(record.empNo ?? record.id ?? record.employeeNo);
    const name = clean(record.name ?? record.fullName);
    if (!empNo || !name || seen.has(empNo)) continue;
    seen.add(empNo);
    directory.push({ empNo, name, designation: clean(record.designation) });
  }
  return directory.sort((a, b) => a.empNo.localeCompare(b.empNo, undefined, { numeric: true }));
}
