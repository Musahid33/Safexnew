'use client';

import { useState } from 'react';
import {
  COMPLIANCE_STATUS, EQUIPMENT_CHECKS, EQUIPMENT_STATUS, HOUSEKEEPING_ITEMS, INCIDENT_CATEGORIES,
  MODULE_TITLES, PERMIT_CHECKS, SHIFTS, SOP_ADEQUACY, TBT_TOPICS,
  TOOL_CONDITION, TOOL_SAFETY, TRAINING_NEEDS, severityApplies,
  type DmPlan, type Tick
} from '@/lib/dm/plan';
import { findEmployee, type DirectoryEmployee } from '@/lib/dm/employees';
import { Area, Field, Module, Pick, RowsTable, Toggle, type Column } from './ui';
import { EmployeeDatalists, PersonTable, PpeTable, WalkTable } from './employees';

/**
 * The Daily Management Plan form — the same eleven modules the supervisors already fill.
 *
 * One long screen, each module collapsed to a header until it is needed: a shift that only
 * ran a tool box talk should not have to scroll past the housekeeping checklist to file it.
 */

type Props = {
  plan: DmPlan;
  onChange: (plan: DmPlan) => void;
  onSubmit: () => void;
  onReset: () => void;
  saving: boolean;
  error: string;
  siteName: string;
  /** The employee master, for the number ↔ name lookups. */
  employees: DirectoryEmployee[];
};

const TICKS: { value: Tick; label: string }[] = [
  { value: 'yes', label: 'Y' },
  { value: 'no', label: 'N' },
  { value: 'na', label: 'N/A' }
];

export default function DmForm({ plan, onChange, onSubmit, onReset, saving, error, siteName, employees }: Props) {
  const [open, setOpen] = useState<number[]>([1]);
  const m = plan.modules;

  const toggle = (index: number) => setOpen((current) => (
    current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]
  ));

  const setModules = <K extends keyof DmPlan['modules']>(key: K, value: DmPlan['modules'][K]) =>
    onChange({ ...plan, modules: { ...plan.modules, [key]: value } });

  const summary = (index: number): string => {
    switch (index) {
      case 1: return m.permits.permitNo ? `Permit ${m.permits.permitNo}` : 'No permit recorded';
      case 2: return m.tbt.attendees ? `${m.tbt.attendees} attendees` : 'Not filled';
      case 3: return `${m.ppe.filter((row) => row.employee || row.remarks || row.items.length).length} observation(s)`;
      case 4: return `${m.walkthrough.filter((row) => row.area || row.details).length} observation(s)`;
      case 5: return `${m.equipment.filter((row) => row.name).length} equipment row(s)`;
      case 6: return `${m.tools.filter((row) => row.name || row.toolId).length} tool row(s)`;
      case 7: return `${Object.keys(m.housekeeping.checks).length} of ${HOUSEKEEPING_ITEMS.length} checked`;
      case 8: return `${m.interaction.team.filter((row) => row.name).length} person(s) · ${m.interaction.topics.length} topic(s)`;
      case 9: return m.incident.categories.length ? m.incident.categories.join(', ') : 'Nothing reported';
      case 10: return m.training.employee || m.training.observation ? 'Recorded' : 'Not filled';
      default: return `${m.admin.filter((row) => row.sopNo || row.remarks).length} row(s)`;
    }
  };

  const equipmentColumns: Column<DmPlan['modules']['equipment'][number]>[] = [
    { key: 'name', label: 'Equipment / machinery' },
    { key: 'check', label: 'Check', kind: 'select', options: EQUIPMENT_CHECKS },
    { key: 'devices', label: 'Key safety devices checked' },
    { key: 'status', label: 'Status', kind: 'select', options: EQUIPMENT_STATUS },
    { key: 'remarks', label: 'Action / remarks' }
  ];
  const toolColumns: Column<DmPlan['modules']['tools'][number]>[] = [
    { key: 'name', label: 'Tool' },
    { key: 'toolId', label: 'ID / serial' },
    { key: 'safe', label: 'Safe / unsafe', kind: 'select', options: TOOL_SAFETY },
    { key: 'condition', label: 'Condition', kind: 'select', options: TOOL_CONDITION },
    { key: 'description', label: 'Description' },
    { key: 'action', label: 'Action taken' },
    { key: 'responsible', label: 'Responsible' }
  ];
  const adminColumns: Column<DmPlan['modules']['admin'][number]>[] = [
    { key: 'sopNo', label: 'SOP / JHA no.' },
    { key: 'compliance', label: 'Compliance', kind: 'select', options: COMPLIANCE_STATUS },
    { key: 'adequacy', label: 'Adequacy', kind: 'select', options: SOP_ADEQUACY },
    { key: 'actionBy', label: 'Action by' },
    { key: 'remarks', label: 'Actions / remarks' }
  ];
  const setTick = (id: string, value: Tick) => {
    const checks = { ...m.housekeeping.checks };
    if (value === '') delete checks[id];
    else checks[id] = value;
    setModules('housekeeping', { ...m.housekeeping, checks });
  };

  return <div className="dm-form">
    <EmployeeDatalists employees={employees} />
    <section className="dm-card">
      <header className="dm-card-head">
        <div>
          <span className="dm-eyebrow">CONDUCT DM</span>
          <h2>Daily Management Plan</h2>
          <p>Fill the modules that ran this shift. Filing stamps the record, archives the PDF and locks it.</p>
        </div>
        <span className="dm-site-chip">{siteName}</span>
      </header>

      <div className="dm-grid">
        <Field label="Date *" type="date" value={plan.date} onChange={(date) => onChange({ ...plan, date })} />
        <label className="dm-field">
          <span>Shift *</span>
          <select value={plan.shift} onChange={(event) => onChange({ ...plan, shift: event.target.value })}>
            {SHIFTS.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
          </select>
        </label>
        <Field label="Supervisor *" value={plan.supervisor} maxLength={120} onChange={(supervisor) => onChange({ ...plan, supervisor })} />
        <Field label="Supervisor emp. no." value={plan.supervisorNo} maxLength={40} onChange={(supervisorNo) => onChange({ ...plan, supervisorNo })} />
        <Field label="Work location" value={plan.location} maxLength={120} onChange={(location) => onChange({ ...plan, location })} placeholder="Area / department" />
      </div>
    </section>

    <Module index={1} title={MODULE_TITLES[0]} summary={summary(1)} open={open.includes(1)} onToggle={() => toggle(1)}>
      <div className="dm-grid">
        <Field label="Permit no." value={m.permits.permitNo} onChange={(permitNo) => setModules('permits', { ...m.permits, permitNo })} />
        <Field label="Permit taken by" value={m.permits.takenBy} onChange={(takenBy) => setModules('permits', { ...m.permits, takenBy })} />
        <Field label="Permit reviewed by" value={m.permits.reviewedBy} onChange={(reviewedBy) => setModules('permits', { ...m.permits, reviewedBy })} />
      </div>
      <div className="dm-checklist">
        {PERMIT_CHECKS.map((check, index) => <Toggle
          key={check}
          label={check}
          checked={m.permits.checks[index] ?? false}
          onChange={(value) => setModules('permits', {
            ...m.permits,
            checks: PERMIT_CHECKS.map((_, checkIndex) => (checkIndex === index ? value : m.permits.checks[checkIndex] ?? false))
          })}
        />)}
      </div>
      <div className="dm-grid">
        <Area label="Observations / discrepancies" value={m.permits.observations} onChange={(observations) => setModules('permits', { ...m.permits, observations })} />
        <Area label="Immediate action taken" value={m.permits.actions} onChange={(actions) => setModules('permits', { ...m.permits, actions })} />
      </div>
    </Module>

    <Module index={2} title={MODULE_TITLES[1]} summary={summary(2)} open={open.includes(2)} onToggle={() => toggle(2)}>
      <div className="dm-grid">
        <Field label="Attendees (count)" value={m.tbt.attendees} onChange={(attendees) => setModules('tbt', { ...m.tbt, attendees })} />
        <Field label="Conducted by" value={m.tbt.conductedBy} onChange={(conductedBy) => setModules('tbt', { ...m.tbt, conductedBy })} />
      </div>
      <div className="dm-grid">
        <Area label="Topics discussed" value={m.tbt.topics} onChange={(topics) => setModules('tbt', { ...m.tbt, topics })} />
        <Area label="Review of previous day's incidents / near misses" value={m.tbt.previousIncidents} onChange={(previousIncidents) => setModules('tbt', { ...m.tbt, previousIncidents })} />
        <Area label="Today's critical tasks and hazards" value={m.tbt.criticalTasks} onChange={(criticalTasks) => setModules('tbt', { ...m.tbt, criticalTasks })} />
        <Area label="Safety procedures for new tasks / equipment" value={m.tbt.procedures} onChange={(procedures) => setModules('tbt', { ...m.tbt, procedures })} />
        <Area label="Safety theme of the day" value={m.tbt.theme} onChange={(theme) => setModules('tbt', { ...m.tbt, theme })} />
        <Area label="PPE reminders" value={m.tbt.ppe} onChange={(ppe) => setModules('tbt', { ...m.tbt, ppe })} />
        <Area label="Open forum — worker concerns" value={m.tbt.concerns} onChange={(concerns) => setModules('tbt', { ...m.tbt, concerns })} />
        <Area label="Key takeaways / actions" value={m.tbt.takeaways} onChange={(takeaways) => setModules('tbt', { ...m.tbt, takeaways })} />
      </div>
    </Module>

    <Module index={3} title={MODULE_TITLES[2]} summary={summary(3)} open={open.includes(3)} onToggle={() => toggle(3)}>
      <PpeTable employees={employees} rows={m.ppe} onChange={(ppe) => setModules('ppe', ppe)} />
    </Module>

    <Module index={4} title={MODULE_TITLES[3]} summary={summary(4)} open={open.includes(4)} onToggle={() => toggle(4)}>
      <WalkTable rows={m.walkthrough} onChange={(walkthrough) => setModules('walkthrough', walkthrough)} />
    </Module>

    <Module index={5} title={MODULE_TITLES[4]} summary={summary(5)} open={open.includes(5)} onToggle={() => toggle(5)}>
      <RowsTable
        columns={equipmentColumns}
        rows={m.equipment}
        onChange={(equipment) => setModules('equipment', equipment)}
        blank={() => ({ name: '', check: EQUIPMENT_CHECKS[0], devices: '', status: EQUIPMENT_STATUS[0], remarks: '' })}
        addLabel="Add equipment"
      />
    </Module>

    <Module index={6} title={MODULE_TITLES[5]} summary={summary(6)} open={open.includes(6)} onToggle={() => toggle(6)}>
      <RowsTable
        columns={toolColumns}
        rows={m.tools}
        onChange={(tools) => setModules('tools', tools)}
        blank={() => ({ name: '', toolId: '', safe: TOOL_SAFETY[0], description: '', condition: TOOL_CONDITION[0], remarks: '', action: '', responsible: '' })}
        addLabel="Add tool"
      />
    </Module>

    <Module index={7} title={MODULE_TITLES[6]} summary={summary(7)} open={open.includes(7)} onToggle={() => toggle(7)}>
      <div className="dm-rows-scroll">
        <table className="dm-table dm-hk">
          <thead>
            <tr><th className="dm-rownum">#</th><th>Checking criteria</th><th className="dm-hk-tick">Y</th><th className="dm-hk-tick">N</th><th className="dm-hk-tick">N/A</th></tr>
          </thead>
          <tbody>
            {HOUSEKEEPING_ITEMS.map((item, index) => {
              const active = m.housekeeping.checks[item.id] ?? '';
              const previous = HOUSEKEEPING_ITEMS[index - 1];
              return [
                previous?.element !== item.element
                  ? <tr key={`${item.id}-band`} className="dm-hk-band"><td colSpan={5}>{item.element}</td></tr>
                  : null,
                <tr key={item.id}>
                  <td className="dm-rownum">{index + 1}</td>
                  <td className="dm-hk-criteria">{item.text}</td>
                  {TICKS.map((tickOption) => <td key={tickOption.value} className="dm-hk-tick">
                    <button
                      type="button"
                      className={`dm-tick${active === tickOption.value ? ' is-on' : ''}`}
                      aria-pressed={active === tickOption.value}
                      onClick={() => setTick(item.id, active === tickOption.value ? '' : tickOption.value)}
                    >{tickOption.label}</button>
                  </td>)}
                </tr>
              ];
            })}
          </tbody>
        </table>
      </div>
      <div className="dm-grid">
        <Area label="Observation details" value={m.housekeeping.observations} onChange={(observations) => setModules('housekeeping', { ...m.housekeeping, observations })} />
        <Area label="Action taken" value={m.housekeeping.action} onChange={(action) => setModules('housekeeping', { ...m.housekeeping, action })} />
      </div>
    </Module>

    <Module index={8} title={MODULE_TITLES[7]} summary={summary(8)} open={open.includes(8)} onToggle={() => toggle(8)}>
      <PersonTable
        employees={employees}
        rows={m.interaction.team}
        onChange={(team) => setModules('interaction', { ...m.interaction, team })}
        addLabel="Add person"
      />
      <fieldset className="dm-choices">
        <legend>Key discussions</legend>
        {TBT_TOPICS.map((topic) => <Toggle
          key={topic}
          label={topic}
          checked={m.interaction.topics.includes(topic)}
          onChange={(checked) => setModules('interaction', {
            ...m.interaction,
            topics: checked ? [...m.interaction.topics, topic] : m.interaction.topics.filter((entry) => entry !== topic)
          })}
        />)}
      </fieldset>
      <div className="dm-grid">
        <Area label="Feedback from employees" value={m.interaction.feedback} onChange={(feedback) => setModules('interaction', { ...m.interaction, feedback })} />
        <Field label="Follow-up target date" type="date" value={m.interaction.targetDate} onChange={(targetDate) => setModules('interaction', { ...m.interaction, targetDate })} />
      </div>
      <div className="dm-inline">
        <Toggle label="Issue escalated" checked={m.interaction.escalated} onChange={(escalated) => setModules('interaction', { ...m.interaction, escalated })} />
        <Toggle label="Follow-up required" checked={m.interaction.followUp} onChange={(followUp) => setModules('interaction', { ...m.interaction, followUp })} />
      </div>
    </Module>

    <Module index={9} title={MODULE_TITLES[8]} summary={summary(9)} open={open.includes(9)} onToggle={() => toggle(9)}>
      <div className="dm-grid">
        <Field label="Location / area" value={m.incident.location} onChange={(location) => setModules('incident', { ...m.incident, location })} />
        <Field label="Reporting by" value={m.incident.reportedBy} onChange={(reportedBy) => setModules('incident', { ...m.incident, reportedBy })} />
        <Field label="Incident report no." value={m.incident.reportNo} onChange={(reportNo) => setModules('incident', { ...m.incident, reportNo })} />
        <Field label="Date" type="date" value={m.incident.date} onChange={(date) => setModules('incident', { ...m.incident, date })} />
        <Field label="Time" type="time" value={m.incident.time} onChange={(time) => setModules('incident', { ...m.incident, time })} />
      </div>
      <fieldset className="dm-choices">
        <legend>Incident category</legend>
        {INCIDENT_CATEGORIES.map((category) => <Toggle
          key={category}
          label={category}
          checked={m.incident.categories.includes(category)}
          onChange={(checked) => setModules('incident', {
            ...m.incident,
            categories: checked
              ? [...m.incident.categories, category]
              : m.incident.categories.filter((entry) => entry !== category)
          })}
        />)}
      </fieldset>
      <PersonTable
        employees={employees}
        rows={m.incident.persons}
        onChange={(persons) => setModules('incident', { ...m.incident, persons })}
        addLabel="Add person involved"
      />
      <div className="dm-grid">
        <Area label="Brief incident description" value={m.incident.description} onChange={(description) => setModules('incident', { ...m.incident, description })} />
        <Area label="Immediate action taken" value={m.incident.action} onChange={(action) => setModules('incident', { ...m.incident, action })} />
      </div>
      <Toggle label="Investigation initiated" checked={m.incident.investigation} onChange={(investigation) => setModules('incident', { ...m.incident, investigation })} />
    </Module>

    <Module index={10} title={MODULE_TITLES[9]} summary={summary(10)} open={open.includes(10)} onToggle={() => toggle(10)}>
      <div className="dm-grid">
        <Field
          label="Employee no."
          value={m.training.employeeNo}
          maxLength={40}
          list="dm-employee-no"
          onChange={(employeeNo) => {
            const hit = findEmployee(employees, employeeNo, 'empNo');
            setModules('training', {
              ...m.training,
              employeeNo,
              employee: hit ? hit.name : m.training.employee
            });
          }}
        />
        <Field
          label="Employee"
          value={m.training.employee}
          maxLength={120}
          list="dm-employee-name"
          onChange={(employee) => {
            const hit = findEmployee(employees, employee, 'name');
            setModules('training', {
              ...m.training,
              employee,
              employeeNo: hit ? hit.empNo : m.training.employeeNo
            });
          }}
        />
        <Pick label="Training need identified" value={m.training.needType} options={['', ...TRAINING_NEEDS]} onChange={(needType) => setModules('training', { ...m.training, needType })} />
        <Area label="Observation" value={m.training.observation} onChange={(observation) => setModules('training', { ...m.training, observation })} />
        <Area label="Action taken" value={m.training.action} onChange={(action) => setModules('training', { ...m.training, action })} />
      </div>
      <div className="dm-inline">
        <Toggle label="Training required" checked={m.training.required} onChange={(required) => setModules('training', { ...m.training, required })} />
        <Toggle label="Conducted as per plan" checked={m.training.conducted} onChange={(conducted) => setModules('training', { ...m.training, conducted })} />
        <Toggle label="Training records available" checked={m.training.records} onChange={(records) => setModules('training', { ...m.training, records })} />
      </div>
    </Module>

    <Module index={11} title={MODULE_TITLES[10]} summary={summary(11)} open={open.includes(11)} onToggle={() => toggle(11)}>
      <RowsTable
        columns={adminColumns}
        rows={m.admin}
        onChange={(admin) => setModules('admin', admin)}
        blank={() => ({ sopNo: '', compliance: COMPLIANCE_STATUS[0], adequacy: SOP_ADEQUACY[0], actionBy: '', remarks: '' })}
        addLabel="Add row"
      />
    </Module>

    {error && <p className="dm-error" role="alert">{error}</p>}

    <div className="dm-submit">
      <div>
        <strong>Ready to file?</strong>
        <small>The plan gets a DM-DD-MM-YY number and its PDF is archived in DM Records.</small>
      </div>
      <div className="dm-submit-actions">
        <button type="button" className="dm-ghost" onClick={onReset} disabled={saving}>Clear form</button>
        <button type="button" className="dm-primary" onClick={onSubmit} disabled={saving}>
          {saving ? 'Filing…' : 'File DM & generate PDF'}
        </button>
      </div>
    </div>
  </div>;
}
