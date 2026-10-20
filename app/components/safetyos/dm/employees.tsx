'use client';

import {
  PPE_ISSUES, PPE_ITEMS, SEVERITY_LEVELS, WALKTHROUGH_TYPES, severityApplies,
  type DmPerson, type DmPlan
} from '@/lib/dm/plan';
import { findEmployee, type DirectoryEmployee } from '@/lib/dm/employees';
import { PhotoField } from './photo';
import { CardField, CardInput, CardSelect, RowCard } from './ui';

/**
 * The employee-aware pieces of the DM form.
 *
 * Every place a person is named — PPE observation, safety interaction, incident and
 * training — takes an employee number or a name and fills the other from the master. The
 * suggestions come from one shared datalist so 190 employees are not re-rendered per row.
 *
 * Every cell carries `data-label`: on a phone the tables collapse into stacked cards and
 * that label is the only thing telling the operator which field they are looking at.
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
  employees, rows, onChange, addLabel, phone = false
}: {
  employees: DirectoryEmployee[];
  rows: DmPerson[];
  onChange: (rows: DmPerson[]) => void;
  addLabel: string;
  phone?: boolean;
}) {
  const update = (index: number, next: DmPerson) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? next : row)));
  const remove = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

  if (phone) {
    return <div className="dm-rows">
      {rows.length === 0 && <p className="dm-empty-state">No rows yet — “{addLabel}” se pehla person add karein.</p>}
      {rows.map((row, index) => <RowCard
        key={index}
        index={index}
        label="Person"
        onRemove={() => remove(index)}
      >
        <CardField label="Emp. no.">
          <CardInput
            label={`Employee number, row ${index + 1}`}
            value={row.number}
            list="dm-employee-no"
            placeholder="Emp. no."
            maxLength={40}
            onChange={(value) => {
              const hit = findEmployee(employees, value, 'empNo');
              update(index, hit ? { number: value, name: hit.name, designation: hit.designation } : { ...row, number: value });
            }}
          />
        </CardField>
        <CardField label="Employee name">
          <CardInput
            label={`Employee name, row ${index + 1}`}
            value={row.name}
            list="dm-employee-name"
            placeholder="Name — master se auto fill"
            maxLength={120}
            onChange={(value) => {
              const hit = findEmployee(employees, value, 'name');
              update(index, hit ? { name: hit.name, number: hit.empNo, designation: hit.designation } : { ...row, name: value });
            }}
          />
        </CardField>
        <CardField label="Designation">
          <CardInput
            label={`Designation, row ${index + 1}`}
            value={row.designation}
            placeholder="Designation"
            maxLength={120}
            onChange={(designation) => update(index, { ...row, designation })}
          />
        </CardField>
      </RowCard>)}
      <button
        type="button"
        className="dm-addrow"
        onClick={() => onChange([...rows, { name: '', number: '', designation: '' }])}
      >+ {addLabel}</button>
    </div>;
  }

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
            <td data-label="Emp. no.">
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
            <td data-label="Employee">
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
            <td data-label="Designation">
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
  employees, rows, onChange, phone = false
}: {
  employees: DirectoryEmployee[];
  rows: DmPpeRow[];
  onChange: (rows: DmPpeRow[]) => void;
  phone?: boolean;
}) {
  const update = (index: number, patch: Partial<DmPpeRow>) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

  if (phone) {
    return <div className="dm-rows">
      {rows.length === 0 && <p className="dm-empty-state">No PPE observation yet — neeche se pehli row add karein.</p>}
      {rows.map((row, index) => {
        const individual = row.scope === 'individual';
        return <RowCard key={index} index={index} label="Observation" onRemove={() => remove(index)}>
          <CardField label="Observed">
            {/* The stored value is `all` / `individual`; the operator reads the two words. */}
            <select
              className="dm-cinput"
              value={row.scope}
              aria-label={`Observation scope, row ${index + 1}`}
              onChange={(event) => update(index, event.target.value === 'individual'
                // Switching back to the team clears the name: the row now speaks for
                // everyone, and a stale name would print against the wrong subject.
                ? { scope: 'individual' }
                : { scope: 'all', employee: '', employeeNo: '' })}
            >
              <option value="all">All (team)</option>
              <option value="individual">Individual</option>
            </select>
          </CardField>
          {individual ? <>
            <CardField label="Emp. no.">
              <CardInput
                label={`Employee number, row ${index + 1}`}
                value={row.employeeNo}
                list="dm-employee-no"
                placeholder="Emp. no."
                maxLength={40}
                onChange={(value) => {
                  const hit = findEmployee(employees, value, 'empNo');
                  update(index, hit ? { employeeNo: hit.empNo, employee: hit.name } : { employeeNo: value });
                }}
              />
            </CardField>
            <CardField label="Employee">
              <CardInput
                label={`Observed employee, row ${index + 1}`}
                value={row.employee}
                list="dm-employee-name"
                placeholder="Name"
                maxLength={120}
                onChange={(value) => {
                  const hit = findEmployee(employees, value, 'name');
                  update(index, hit ? { employee: hit.name, employeeNo: hit.empNo } : { employee: value });
                }}
              />
            </CardField>
          </> : <CardField label="Employee">
            <p className="dm-all-note">All employees — poori team observed</p>
          </CardField>}
          <CardField label="Observation">
            <CardSelect
              label={`Observation, row ${index + 1}`}
              value={row.issue}
              options={PPE_ISSUES}
              blank="Select…"
              onChange={(issue) => update(index, { issue })}
            />
          </CardField>
          <CardField label="PPE observed" hint="Tick each item seen, or add the one that is missing.">
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
                className="dm-chip-add dm-cinput"
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
          </CardField>
          <CardField label="Remarks">
            <CardInput
              label={`Remarks, row ${index + 1}`}
              value={row.remarks}
              placeholder="Remarks"
              maxLength={800}
              onChange={(remarks) => update(index, { remarks })}
            />
          </CardField>
          <CardField label="Photo" boxed={false}>
            <PhotoField value={row.photo} onChange={(photo) => update(index, { photo })} />
          </CardField>
        </RowCard>;
      })}
      <button
        type="button"
        className="dm-addrow"
        onClick={() => onChange([...rows, {
          scope: 'all', employee: '', employeeNo: '', issue: '', items: [], remarks: '', photo: ''
        }])}
      >+ Add PPE observation</button>
    </div>;
  }

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table dm-ppe-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            <th style={{ width: '128px' }}>Observed</th>
            <th style={{ width: '110px' }}>Emp. no.</th>
            <th style={{ width: '170px' }}>Employee</th>
            <th style={{ width: '150px' }}>Observation</th>
            <th>PPE observed</th>
            <th>Remarks</th>
            <th style={{ width: '132px' }}>Photo</th>
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="dm-empty">No PPE observation yet.</td></tr>}
          {rows.map((row, index) => {
            const individual = row.scope === 'individual';
            return <tr key={index}>
              <td className="dm-rownum">{index + 1}</td>
              <td data-label="Observed">
                <select
                  className={`dm-cell-input dm-scope${individual ? ' is-individual' : ''}`}
                  value={row.scope}
                  aria-label={`Observation scope, row ${index + 1}`}
                  onChange={(event) => update(index, event.target.value === 'individual'
                    // Switching back to the team clears the name: the row now speaks for
                    // everyone, and a stale name would print against the wrong subject.
                    ? { scope: 'individual' }
                    : { scope: 'all', employee: '', employeeNo: '' })}
                >
                  <option value="all">All (team)</option>
                  <option value="individual">Individual</option>
                </select>
              </td>
              {individual ? <>
                <td data-label="Emp. no.">
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
                <td data-label="Employee">
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
              </> : <td data-label="Employee" colSpan={2} className="dm-all-cell">
                All employees — poori team observed
              </td>}
              <td data-label="Observation">
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
              <td data-label="PPE observed">
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
              <td data-label="Remarks">
                <input
                  className="dm-cell-input"
                  value={row.remarks}
                  placeholder="Remarks"
                  maxLength={800}
                  aria-label={`Remarks, row ${index + 1}`}
                  onChange={(event) => update(index, { remarks: event.target.value })}
                />
              </td>
              <td data-label="Photo">
                <PhotoField value={row.photo} onChange={(photo) => update(index, { photo })} />
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
      onClick={() => onChange([...rows, {
        scope: 'all', employee: '', employeeNo: '', issue: '', items: [], remarks: '', photo: ''
      }])}
    >+ Add PPE observation</button>
  </div>;
}

/** Module 4 — walk-through observations, with severity only where it means something. */
export function WalkTable({
  rows, onChange, phone = false
}: {
  rows: DmWalkRow[];
  onChange: (rows: DmWalkRow[]) => void;
  phone?: boolean;
}) {
  const update = (index: number, patch: Partial<DmWalkRow>) =>
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  const remove = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

  if (phone) {
    return <div className="dm-rows">
      {rows.length === 0 && <p className="dm-empty-state">No walk-through observation yet.</p>}
      {rows.map((row, index) => {
        const needsSeverity = severityApplies(row.type);
        return <RowCard key={index} index={index} label="Finding" onRemove={() => remove(index)}>
          <CardField label="Location / area">
            <CardInput
              label={`Area, row ${index + 1}`}
              value={row.area}
              placeholder="Area"
              maxLength={120}
              onChange={(area) => update(index, { area })}
            />
          </CardField>
          <CardField label="Observation type">
            <CardSelect
              label={`Observation type, row ${index + 1}`}
              value={row.type}
              options={WALKTHROUGH_TYPES}
              onChange={(type) => update(index, {
                type,
                // A safe act has nothing to rate, so a stale number is cleared rather
                // than left in the payload where it would print again.
                severity: severityApplies(type) ? row.severity : ''
              })}
            />
          </CardField>
          {needsSeverity && <CardField label="Severity (1-5)">
            <CardSelect
              label={`Severity, row ${index + 1}`}
              value={row.severity}
              options={SEVERITY_LEVELS}
              blank="Select 1-5"
              onChange={(severity) => update(index, { severity })}
            />
          </CardField>}
          <CardField label="Details">
            <textarea
              className="dm-cinput"
              rows={3}
              value={row.details}
              placeholder="What was seen"
              maxLength={800}
              aria-label={`Details, row ${index + 1}`}
              onChange={(event) => update(index, { details: event.target.value })}
            />
          </CardField>
          <CardField label="Immediate action taken">
            <textarea
              className="dm-cinput"
              rows={2}
              value={row.action}
              placeholder="Action taken on the spot"
              maxLength={800}
              aria-label={`Immediate action taken, row ${index + 1}`}
              onChange={(event) => update(index, { action: event.target.value })}
            />
          </CardField>
          <CardField label="Photo" boxed={false}>
            <PhotoField value={row.photo} onChange={(photo) => update(index, { photo })} />
          </CardField>
        </RowCard>;
      })}
      <button
        type="button"
        className="dm-addrow"
        onClick={() => onChange([...rows, {
          area: '', type: WALKTHROUGH_TYPES[0], severity: '', details: '', action: '', photo: ''
        }])}
      >+ Add walk-through entry</button>
    </div>;
  }

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table dm-walk-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            <th style={{ width: '150px' }}>Location / area</th>
            <th style={{ width: '150px' }}>Observation type</th>
            <th style={{ width: '100px' }}>Severity</th>
            <th>Details</th>
            <th>Immediate action taken</th>
            <th style={{ width: '132px' }}>Photo</th>
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="dm-empty">No walk-through observation yet.</td></tr>}
          {rows.map((row, index) => {
            const needsSeverity = severityApplies(row.type);
            return <tr key={index}>
              <td className="dm-rownum">{index + 1}</td>
              <td data-label="Location / area">
                <input
                  className="dm-cell-input"
                  value={row.area}
                  placeholder="Area"
                  maxLength={120}
                  aria-label={`Area, row ${index + 1}`}
                  onChange={(event) => update(index, { area: event.target.value })}
                />
              </td>
              <td data-label="Observation type">
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
              <td data-label="Severity">
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
              <td data-label="Details">
                <input
                  className="dm-cell-input"
                  value={row.details}
                  placeholder="What was seen"
                  maxLength={800}
                  aria-label={`Details, row ${index + 1}`}
                  onChange={(event) => update(index, { details: event.target.value })}
                />
              </td>
              <td data-label="Immediate action taken">
                <input
                  className="dm-cell-input"
                  value={row.action}
                  placeholder="Action taken on the spot"
                  maxLength={800}
                  aria-label={`Immediate action taken, row ${index + 1}`}
                  onChange={(event) => update(index, { action: event.target.value })}
                />
              </td>
              <td data-label="Photo">
                <PhotoField value={row.photo} onChange={(photo) => update(index, { photo })} />
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
      onClick={() => onChange([...rows, {
        area: '', type: WALKTHROUGH_TYPES[0], severity: '', details: '', action: '', photo: ''
      }])}
    >+ Add walk-through entry</button>
  </div>;
}
