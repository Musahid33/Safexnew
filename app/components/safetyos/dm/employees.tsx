'use client';

import {
  PPE_ISSUES, PPE_ITEMS, SEVERITY_LEVELS, WALKTHROUGH_TYPES, severityApplies,
  type DmPerson, type DmPlan
} from '@/lib/dm/plan';
import { findEmployee, type DirectoryEmployee } from '@/lib/dm/employees';
import { PhotoField } from './photo';

/**
 * The employee-aware pieces of the DM form.
 *
 * Every place a person is named — PPE observation, safety interaction, incident and
 * training — takes an employee number or a name and fills the other from the master. The
 * suggestions come from one shared datalist so 190 employees are not re-rendered per row.
 */

export type DmPpeRow = DmPlan['modules']['ppe'][number];
export type DmWalkRow = DmPlan['modules']['walkthrough'][number];

export function EmployeeDatalists({ employees }: { employees: DirectoryEmployee[] }) {
  return <>
    <datalist id="dm-employee-no">
      {employees.map((employee) => <option key={employee.empNo} value={employee.empNo}>{employee.name}</option>)}
    </datalist>
    <datalist id="dm-employee-name">
      {employees.map((employee) => <option key={`${employee.empNo}-n`} value={employee.name}>{employee.empNo}</option>)}
    </datalist>
  </>;
}

/** Rows of people: safety interaction (module 8) and people involved (module 9). */
export function PersonTable({
  employees, rows, onChange, addLabel
}: {
  employees: DirectoryEmployee[];
  rows: DmPerson[];
  onChange: (rows: DmPerson[]) => void;
  addLabel: string;
}) {
  const update = (index: number, next: DmPerson) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? next : row)));

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            <th style={{ width: '120px' }}>Emp. no.</th>
            <th>Employee name</th>
            <th>Designation</th>
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="dm-empty">No rows yet.</td></tr>}
          {rows.map((row, index) => <tr key={index}>
            <td className="dm-rownum">{index + 1}</td>
            <td>
              <input
                className="dm-cell-input"
                value={row.number}
                list="dm-employee-no"
                placeholder="Emp. no."
                maxLength={40}
                aria-label={`Employee number, row ${index + 1}`}
                onChange={(event) => {
                  const hit = findEmployee(employees, event.target.value, 'empNo');
                  update(index, hit
                    ? { number: event.target.value, name: hit.name, designation: hit.designation }
                    : { ...row, number: event.target.value });
                }}
              />
            </td>
            <td>
              <input
                className="dm-cell-input"
                value={row.name}
                list="dm-employee-name"
                placeholder="Name — master se auto fill"
                maxLength={120}
                aria-label={`Employee name, row ${index + 1}`}
                onChange={(event) => {
                  const hit = findEmployee(employees, event.target.value, 'name');
                  update(index, hit
                    ? { name: hit.name, number: hit.empNo, designation: hit.designation }
                    : { ...row, name: event.target.value });
                }}
              />
            </td>
            <td>
              <input
                className="dm-cell-input"
                value={row.designation}
                maxLength={120}
                aria-label={`Designation, row ${index + 1}`}
                onChange={(event) => update(index, { ...row, designation: event.target.value })}
              />
            </td>
            <td className="dm-rowact">
              <button
                type="button"
                className="dm-remove"
                aria-label={`Remove row ${index + 1}`}
                onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              >×</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <button
      type="button"
      className="dm-addrow"
      onClick={() => onChange([...rows, { name: '', number: '', designation: '' }])}
    >+ {addLabel}</button>
  </div>;
}

/** Module 3 — who was observed, what PPE, and a photo of the observation. */
export function PpeTable({
  employees, rows, onChange
}: {
  employees: DirectoryEmployee[];
  rows: DmPpeRow[];
  onChange: (rows: DmPpeRow[]) => void;
}) {
  const update = (index: number, patch: Partial<DmPpeRow>) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table dm-ppe-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            <th style={{ width: '110px' }}>Emp. no.</th>
            <th style={{ width: '180px' }}>Observed employee</th>
            <th style={{ width: '150px' }}>Observation</th>
            <th>PPE observed</th>
            <th>Remarks</th>
            <th style={{ width: '130px' }}>Photo</th>
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="dm-empty">No PPE observation yet.</td></tr>}
          {rows.map((row, index) => <tr key={index}>
            <td className="dm-rownum">{index + 1}</td>
            <td>
              <input
                className="dm-cell-input"
                value={row.employeeNo}
                list="dm-employee-no"
                placeholder="Emp. no."
                maxLength={40}
                aria-label={`Employee number, row ${index + 1}`}
                onChange={(event) => {
                  const hit = findEmployee(employees, event.target.value, 'empNo');
                  update(index, hit
                    ? { employeeNo: hit.empNo, employee: hit.name }
                    : { employeeNo: event.target.value });
                }}
              />
            </td>
            <td>
              <input
                className="dm-cell-input"
                value={row.employee}
                list="dm-employee-name"
                placeholder="Name"
                maxLength={120}
                aria-label={`Observed employee, row ${index + 1}`}
                onChange={(event) => {
                  const hit = findEmployee(employees, event.target.value, 'name');
                  update(index, hit
                    ? { employee: hit.name, employeeNo: hit.empNo }
                    : { employee: event.target.value });
                }}
              />
            </td>
            <td>
              <select
                className="dm-cell-input"
                value={row.issue}
                aria-label={`Observation, row ${index + 1}`}
                onChange={(event) => update(index, { issue: event.target.value })}
              >
                {row.issue === '' && <option value="">Select…</option>}
                {PPE_ISSUES.map((issue) => <option key={issue} value={issue}>{issue}</option>)}
              </select>
            </td>
            <td>
              <div className="dm-ppe-items">
                {row.items.map((item) => <span key={item} className="dm-chip">
                  {item}
                  <button
                    type="button"
                    aria-label={`Remove ${item}`}
                    onClick={() => update(index, { items: row.items.filter((entry) => entry !== item) })}
                  >×</button>
                </span>)}
                <select
                  className="dm-chip-add"
                  value=""
                  aria-label={`Add PPE item, row ${index + 1}`}
                  onChange={(event) => {
                    const item = event.target.value;
                    if (item) update(index, { items: [...row.items, item] });
                  }}
                >
                  <option value="">+ PPE</option>
                  {PPE_ITEMS.filter((item) => !row.items.includes(item))
                    .map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </td>
            <td>
              <input
                className="dm-cell-input"
                value={row.remarks}
                placeholder="Remarks"
                maxLength={800}
                aria-label={`Remarks, row ${index + 1}`}
                onChange={(event) => update(index, { remarks: event.target.value })}
              />
            </td>
            <td>
              <PhotoField
                label="Photo"
                value={row.photo}
                onChange={(photo) => update(index, { photo })}
              />
            </td>
            <td className="dm-rowact">
              <button
                type="button"
                className="dm-remove"
                aria-label={`Remove row ${index + 1}`}
                onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              >×</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <button
      type="button"
      className="dm-addrow"
      onClick={() => onChange([...rows, { employee: '', employeeNo: '', issue: PPE_ISSUES[0], items: [], remarks: '', photo: '' }])}
    >+ Add PPE observation</button>
  </div>;
}

/** Module 4 — walk-through observations, with severity only where it means something. */
export function WalkTable({
  rows, onChange
}: {
  rows: DmWalkRow[];
  onChange: (rows: DmWalkRow[]) => void;
}) {
  const update = (index: number, patch: Partial<DmWalkRow>) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table dm-walk-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            <th style={{ width: '170px' }}>Location / area</th>
            <th style={{ width: '160px' }}>Observation type</th>
            <th style={{ width: '110px' }}>Severity</th>
            <th>Details</th>
            <th style={{ width: '130px' }}>Photo</th>
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="dm-empty">No walk-through observation yet.</td></tr>}
          {rows.map((row, index) => {
            const needsSeverity = severityApplies(row.type);
            return <tr key={index}>
              <td className="dm-rownum">{index + 1}</td>
              <td>
                <input
                  className="dm-cell-input"
                  value={row.area}
                  placeholder="Area"
                  maxLength={120}
                  aria-label={`Area, row ${index + 1}`}
                  onChange={(event) => update(index, { area: event.target.value })}
                />
              </td>
              <td>
                <select
                  className="dm-cell-input"
                  value={row.type}
                  aria-label={`Observation type, row ${index + 1}`}
                  onChange={(event) => update(index, {
                    type: event.target.value,
                    // A safe act has nothing to rate, so a stale number is cleared rather
                    // than left in the payload where it would print again.
                    severity: severityApplies(event.target.value) ? row.severity : ''
                  })}
                >
                  {WALKTHROUGH_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </td>
              <td>
                {needsSeverity
                  ? <select
                    className={`dm-cell-input${row.severity ? '' : ' is-missing'}`}
                    value={row.severity}
                    aria-label={`Severity, row ${index + 1}`}
                    onChange={(event) => update(index, { severity: event.target.value })}
                  >
                    <option value="">Select 1-5</option>
                    {SEVERITY_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                  : <span className="dm-na" title="Safe acts and good practices carry no severity">—</span>}
              </td>
              <td>
                <input
                  className="dm-cell-input"
                  value={row.details}
                  placeholder="What was seen"
                  maxLength={800}
                  aria-label={`Details, row ${index + 1}`}
                  onChange={(event) => update(index, { details: event.target.value })}
                />
              </td>
              <td>
                <PhotoField label="Photo" value={row.photo} onChange={(photo) => update(index, { photo })} />
              </td>
              <td className="dm-rowact">
                <button
                  type="button"
                  className="dm-remove"
                  aria-label={`Remove row ${index + 1}`}
                  onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                >×</button>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <button
      type="button"
      className="dm-addrow"
      onClick={() => onChange([...rows, { area: '', type: WALKTHROUGH_TYPES[0], severity: '', details: '', photo: '' }])}
    >+ Add walk-through entry</button>
  </div>;
}
