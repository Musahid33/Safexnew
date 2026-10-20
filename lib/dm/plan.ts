/**
 * The Daily Management Plan, as this app records it.
 *
 * The company already had this form in a Google Apps Script app. It is reproduced here so
 * the plan lives with the rest of the site's safety records instead of in a separate
 * Google account: same eleven modules, same fields, but stored in Supabase and rendered to
 * a PDF by us.
 *
 * Everything in this file is pure — no React, no database — so the field lists, the
 * reference number and the validation are covered by tests. A typo in a checklist here is
 * a line missing from a controlled document.
 */

export type Tick = 'yes' | 'no' | 'na' | '';

export type DmPerson = { name: string; number: string; designation: string };

export type DmPlan = {
  /** YYYY-MM-DD. */
  date: string;
  shift: string;
  supervisor: string;
  supervisorNo: string;
  location: string;
  modules: {
    permits: {
      permitNo: string;
      takenBy: string;
      reviewedBy: string;
      checks: boolean[];
      observations: string;
      actions: string;
    };
    tbt: {
      attendees: string;
      topics: string;
      previousIncidents: string;
      criticalTasks: string;
      procedures: string;
      theme: string;
      ppe: string;
      concerns: string;
      takeaways: string;
      conductedBy: string;
    };
    ppe: { employee: string; issue: string; item: string; remarks: string }[];
    walkthrough: { time: string; area: string; type: string; details: string; photo: boolean }[];
    equipment: { name: string; check: string; devices: string; status: string; remarks: string }[];
    tools: {
      name: string; toolId: string; safe: string; description: string;
      condition: string; remarks: string; action: string; responsible: string;
    }[];
    housekeeping: { checks: Record<string, Tick>; observations: string; action: string };
    interaction: {
      team: DmPerson[];
      topics: string[];
      feedback: string;
      escalated: boolean;
      followUp: boolean;
      targetDate: string;
    };
    incident: {
      location: string;
      reportedBy: string;
      reportNo: string;
      date: string;
      time: string;
      categories: string[];
      persons: DmPerson[];
      description: string;
      action: string;
      investigation: boolean;
    };
    training: {
      employee: string;
      action: string;
      observation: string;
      required: boolean;
      conducted: boolean;
      records: boolean;
      needType: string;
    };
    admin: { sopNo: string; compliance: string; adequacy: string; actionBy: string; remarks: string }[];
  };
};

export const SHIFTS = ['A', 'B', 'C', 'General'] as const;

export const PERMIT_CHECKS = [
  'Scope of work correctly defined',
  'All hazards identified',
  'Control measures implemented',
  'Personnel inducted & aware',
  'All required signatures completed'
] as const;

export const TBT_TOPICS = [
  'Life Saving Rules',
  'PPE requirement & usage',
  'Site-specific hazards',
  'SOP / JCC awareness',
  'Incident / near-miss reporting procedure',
  'Record safety campaign',
  'Safe work practices',
  'Lifting & rigging safety',
  'Working at height — fall prevention and anchorage',
  'Hot work safety and fire prevention',
  'Housekeeping (1S & 2S) at workplace',
  'Electrical safety and isolation (LOTO awareness)'
] as const;

export const PPE_ISSUES = ['PPE OK', 'Damaged PPE', 'Missing PPE', 'Dirty PPE', 'Not wearing PPE'] as const;
export const PPE_ITEMS = [
  'Safety Shoe', 'Safety Helmet', 'Nose Mask', 'Fire-resistant Jacket', 'Hand Gloves',
  'Safety Goggles', 'Ear Plug', 'Leather Apron', 'Leg Guard', 'Face Shield', 'Other'
] as const;

export const WALKTHROUGH_TYPES = ['Safe act / condition', 'Unsafe act / condition'] as const;
export const EQUIPMENT_CHECKS = ['Pre-use inspection', 'Mid-shift check'] as const;
export const EQUIPMENT_STATUS = ['OK', 'Deficiency'] as const;
export const TOOL_SAFETY = ['Safe', 'Unsafe'] as const;
export const TOOL_CONDITION = ['Good', 'Damaged'] as const;
export const COMPLIANCE_STATUS = ['Compliant', 'Non-compliant', 'Partially compliant'] as const;
export const SOP_ADEQUACY = ['Adequate', 'Inadequate'] as const;
export const TRAINING_NEEDS = ['PPE usage', 'Work at height', 'Lifting & rigging', 'Hot work', 'Electrical safety', 'Housekeeping', 'Other'] as const;

export const INCIDENT_CATEGORIES = [
  'Near Miss', 'First Aid Case (FAC)', 'Medical Treatment Case (MTC)', 'Lost Time Injury (LTI)',
  'Property / Equipment Damage', 'Environmental Incident', 'Fire / Explosion',
  'Dangerous Occurrence', 'Unsafe Act / Condition', 'Others'
] as const;

/** The 1S/2S checklist. `id` is stable so a saved plan keeps its answers when this list is reordered. */
export const HOUSEKEEPING_ITEMS: { id: string; element: string; text: string }[] = [
  { id: '1s-1', element: '1S — Seiri (Sort out)', text: 'Unused / spare materials removed (no unnecessary inventory in racks / floor)' },
  { id: '1s-2', element: '1S — Seiri (Sort out)', text: 'Fire extinguishers clean, mounted correctly, within inspection validity' },
  { id: '1s-3', element: '1S — Seiri (Sort out)', text: 'Scrap, broken or damaged parts clearly identified and segregated' },
  { id: '1s-4', element: '1S — Seiri (Sort out)', text: 'Unnecessary papers / files removed from desks, drawers and workstations' },
  { id: '1s-5', element: '1S — Seiri (Sort out)', text: 'Unused tools, equipment, cables and accessories removed from the work area' },
  { id: '1s-6', element: '1S — Seiri (Sort out)', text: 'Waste materials, empty containers, bottles, plastic and packaging removed' },
  { id: '1s-7', element: '1S — Seiri (Sort out)', text: 'Obsolete notices, damaged signboards and expired documents removed' },
  { id: '1s-8', element: '1S — Seiri (Sort out)', text: 'Unwanted vegetation and bushes cut and not present at the worksite' },
  { id: '2s-1', element: '2S — Seiton (Set in order)', text: 'Materials stored in designated racks with proper labelling and signage' },
  { id: '2s-2', element: '2S — Seiton (Set in order)', text: 'Racks clearly numbered / coded with item identification' },
  { id: '2s-3', element: '2S — Seiton (Set in order)', text: 'Tools and equipment kept in designated locations (no loose items)' },
  { id: '2s-4', element: '2S — Seiton (Set in order)', text: 'Electrical panels labelled, clean and with unobstructed access' },
  { id: '2s-5', element: '2S — Seiton (Set in order)', text: 'Entry / exit routes and emergency escape paths unobstructed' },
  { id: '2s-6', element: '2S — Seiton (Set in order)', text: 'Walkways clearly marked and personnel use designated walkways' },
  { id: '2s-7', element: '2S — Seiton (Set in order)', text: 'Pathways free from obstructions and no slippery surface' },
  { id: '2s-8', element: '2S — Seiton (Set in order)', text: 'Documents properly filed and labelled in cabinets / files' },
  { id: '2s-9', element: '2S — Seiton (Set in order)', text: 'Office chairs and furniture in good condition and properly arranged' },
  { id: '2s-10', element: '2S — Seiton (Set in order)', text: 'Lights, fans, switches and electrical accessories functional and identified' },
  { id: '2s-11', element: '2S — Seiton (Set in order)', text: 'Computer cables, chargers and cords neatly arranged and secured' },
  { id: '2s-12', element: '2S — Seiton (Set in order)', text: 'Flex boards, information boards and safety posters clean and updated' },
  { id: '2s-13', element: '2S — Seiton (Set in order)', text: 'Fire extinguishers, AFDSS and emergency equipment at designated locations' },
  { id: '2s-14', element: '2S — Seiton (Set in order)', text: 'PPE storage organised and PPE available at designated locations' },
  { id: '2s-15', element: '2S — Seiton (Set in order)', text: 'Machine / vehicle areas with marked storage and clearance around equipment' }
];

export const MODULE_TITLES = [
  'Daily Work Permit Reviews',
  'Daily Tool Box Talk',
  'PPE Checking',
  'Site Walk-through & Inspections',
  'Equipment / Machinery',
  'Tools & Tackles',
  'Housekeeping (1S, 2S)',
  'Safety Interaction & Engagement',
  'Incident / Near Miss / Hazard',
  'Training & Competency',
  'Administrative & Documentation'
] as const;

const MAX_ROWS = 30;
const text = (value: unknown, limit = 800): string =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, limit) : '';

const tick = (value: unknown): Tick => (value === 'yes' || value === 'no' || value === 'na' ? value : '');

function person(value: unknown): DmPerson {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    name: text(row.name, 120),
    number: text(row.number, 40),
    designation: text(row.designation, 120)
  };
}

/** A fresh, empty plan for today. The UI works on this shape end to end. */
export function emptyPlan(date = new Date().toISOString().slice(0, 10)): DmPlan {
  return {
    date,
    shift: 'General',
    supervisor: '',
    supervisorNo: '',
    location: '',
    modules: {
      permits: { permitNo: '', takenBy: '', reviewedBy: '', checks: PERMIT_CHECKS.map(() => false), observations: '', actions: '' },
      tbt: {
        attendees: '', topics: '', previousIncidents: '', criticalTasks: '', procedures: '',
        theme: '', ppe: '', concerns: '', takeaways: '', conductedBy: ''
      },
      ppe: [{ employee: '', issue: '', item: '', remarks: '' }],
      walkthrough: [{ time: '', area: '', type: WALKTHROUGH_TYPES[0], details: '', photo: false }],
      equipment: [{ name: '', check: EQUIPMENT_CHECKS[0], devices: '', status: EQUIPMENT_STATUS[0], remarks: '' }],
      tools: [{ name: '', toolId: '', safe: TOOL_SAFETY[0], description: '', condition: TOOL_CONDITION[0], remarks: '', action: '', responsible: '' }],
      housekeeping: { checks: {}, observations: '', action: '' },
      interaction: { team: [{ name: '', number: '', designation: '' }], topics: [], feedback: '', escalated: false, followUp: false, targetDate: '' },
      incident: {
        location: '', reportedBy: '', reportNo: '', date: '', time: '', categories: [],
        persons: [{ name: '', number: '', designation: '' }], description: '', action: '', investigation: false
      },
      training: { employee: '', action: '', observation: '', required: false, conducted: false, records: false, needType: '' },
      admin: [{ sopNo: '', compliance: COMPLIANCE_STATUS[0], adequacy: SOP_ADEQUACY[0], actionBy: '', remarks: '' }]
    }
  };
}

/** The document number the operator sees: DM-21-10-26. */
export function referenceFor(dateIso: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : new Date().toISOString().slice(0, 10);
  const [year, month, day] = date.split('-');
  return `DM-${day}-${month}-${year.slice(2)}`;
}

/** "DM-21-10-26" → "21-10-26" for an already-suffixed reference. */
export function displayReference(reference: string): string {
  return reference;
}

export type PlanValidation =
  | { ok: true; plan: DmPlan }
  | { ok: false; errors: string[] };

/**
 * Normalise whatever the browser sent into a plan we are willing to store and print.
 *
 * The form is long and mostly optional — a shift may genuinely have nothing to report
 * under Tools & Tackles — so only the header is required, plus at least one filled module,
 * because an empty plan that still produces a numbered PDF is just noise in the archive.
 */
export function normalisePlan(input: unknown): PlanValidation {
  const errors: string[] = [];
  const source = (input ?? {}) as Record<string, unknown>;
  const base = emptyPlan(typeof source.date === 'string' ? source.date : undefined);
  const modulesIn = (source.modules ?? {}) as Record<string, unknown>;

  const plan: DmPlan = {
    ...base,
    date: text(source.date, 10),
    shift: text(source.shift, 20) || 'General',
    supervisor: text(source.supervisor, 120),
    supervisorNo: text(source.supervisorNo, 40),
    location: text(source.location, 120)
  };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.date) || Number.isNaN(Date.parse(`${plan.date}T00:00:00Z`))) {
    errors.push('A valid plan date is required.');
  }
  if (!plan.supervisor) errors.push('Supervisor name is required.');

  // 1 — permits
  const permits = (modulesIn.permits ?? {}) as Record<string, unknown>;
  plan.modules.permits = {
    permitNo: text(permits.permitNo, 120),
    takenBy: text(permits.takenBy, 120),
    reviewedBy: text(permits.reviewedBy, 120),
    checks: PERMIT_CHECKS.map((_, index) => Boolean(Array.isArray(permits.checks) ? permits.checks[index] : false)),
    observations: text(permits.observations),
    actions: text(permits.actions)
  };

  // 2 — tool box talk
  const tbt = (modulesIn.tbt ?? {}) as Record<string, unknown>;
  plan.modules.tbt = {
    attendees: text(tbt.attendees, 40),
    topics: text(tbt.topics),
    previousIncidents: text(tbt.previousIncidents),
    criticalTasks: text(tbt.criticalTasks),
    procedures: text(tbt.procedures),
    theme: text(tbt.theme),
    ppe: text(tbt.ppe),
    concerns: text(tbt.concerns),
    takeaways: text(tbt.takeaways),
    conductedBy: text(tbt.conductedBy, 120)
  };

  const rows = (value: unknown): Record<string, unknown>[] =>
    (Array.isArray(value) ? value : []).slice(0, MAX_ROWS).map((row) => (row ?? {}) as Record<string, unknown>);

  plan.modules.ppe = rows(modulesIn.ppe).map((row) => ({
    employee: text(row.employee, 120),
    issue: text(row.issue, 60),
    item: text(row.item, 60),
    remarks: text(row.remarks)
  }));

  plan.modules.walkthrough = rows(modulesIn.walkthrough).map((row) => ({
    time: text(row.time, 20),
    area: text(row.area, 120),
    type: text(row.type, 60),
    details: text(row.details),
    photo: Boolean(row.photo)
  }));

  plan.modules.equipment = rows(modulesIn.equipment).map((row) => ({
    name: text(row.name, 120),
    check: text(row.check, 60),
    devices: text(row.devices),
    status: text(row.status, 40),
    remarks: text(row.remarks)
  }));

  plan.modules.tools = rows(modulesIn.tools).map((row) => ({
    name: text(row.name, 120),
    toolId: text(row.toolId, 60),
    safe: text(row.safe, 40),
    description: text(row.description),
    condition: text(row.condition, 40),
    remarks: text(row.remarks),
    action: text(row.action),
    responsible: text(row.responsible, 120)
  }));

  const housekeeping = (modulesIn.housekeeping ?? {}) as Record<string, unknown>;
  const checksIn = (housekeeping.checks ?? {}) as Record<string, unknown>;
  plan.modules.housekeeping = {
    // Keyed by checklist id, so reordering the list never moves an answer.
    checks: Object.fromEntries(HOUSEKEEPING_ITEMS
      .map((item) => [item.id, tick(checksIn[item.id])] as const)
      .filter(([, value]) => value !== '')),
    observations: text(housekeeping.observations),
    action: text(housekeeping.action)
  };

  const interaction = (modulesIn.interaction ?? {}) as Record<string, unknown>;
  plan.modules.interaction = {
    team: rows(interaction.team).map(person),
    topics: (Array.isArray(interaction.topics) ? interaction.topics : [])
      .map((topic) => text(topic, 80)).filter(Boolean).slice(0, TBT_TOPICS.length + 4),
    feedback: text(interaction.feedback),
    escalated: Boolean(interaction.escalated),
    followUp: Boolean(interaction.followUp),
    targetDate: text(interaction.targetDate, 10)
  };

  const incident = (modulesIn.incident ?? {}) as Record<string, unknown>;
  plan.modules.incident = {
    location: text(incident.location, 120),
    reportedBy: text(incident.reportedBy, 120),
    reportNo: text(incident.reportNo, 60),
    date: text(incident.date, 10),
    time: text(incident.time, 20),
    categories: (Array.isArray(incident.categories) ? incident.categories : [])
      .map((category) => text(category, 60)).filter(Boolean).slice(0, INCIDENT_CATEGORIES.length),
    persons: rows(incident.persons).map(person),
    description: text(incident.description),
    action: text(incident.action),
    investigation: Boolean(incident.investigation)
  };

  const training = (modulesIn.training ?? {}) as Record<string, unknown>;
  plan.modules.training = {
    employee: text(training.employee, 120),
    action: text(training.action),
    observation: text(training.observation),
    required: Boolean(training.required),
    conducted: Boolean(training.conducted),
    records: Boolean(training.records),
    needType: text(training.needType, 60)
  };

  plan.modules.admin = rows(modulesIn.admin).map((row) => ({
    sopNo: text(row.sopNo, 60),
    compliance: text(row.compliance, 40),
    adequacy: text(row.adequacy, 40),
    actionBy: text(row.actionBy, 120),
    remarks: text(row.remarks)
  }));

  if (errors.length === 0 && isEmptyPlan(plan)) {
    errors.push('Fill at least one module before saving the plan.');
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan };
}

const filled = (value: string | undefined) => Boolean(value && value.trim());

/** True when only the header has been filled in. */
export function isEmptyPlan(plan: DmPlan): boolean {
  const m = plan.modules;
  const permits = filled(m.permits.permitNo) || filled(m.permits.takenBy) || filled(m.permits.observations)
    || m.permits.checks.some(Boolean);
  const tbt = Object.values(m.tbt).some(filled);
  const table = (list: Record<string, unknown>[]) => list.some((row) => Object.entries(row)
    .some(([key, value]) => key !== 'check' && key !== 'status' && key !== 'type' && key !== 'safe'
      && key !== 'condition' && key !== 'compliance' && key !== 'adequacy' && filled(value as string)));
  const housekeeping = Object.keys(m.housekeeping.checks).length > 0
    || filled(m.housekeeping.observations) || filled(m.housekeeping.action);
  const interaction = m.interaction.team.some((row) => row.name) || m.interaction.topics.length > 0
    || filled(m.interaction.feedback);
  const incident = filled(m.incident.description) || filled(m.incident.reportNo)
    || m.incident.categories.length > 0 || m.incident.persons.some((row) => row.name);
  const training = filled(m.training.employee) || filled(m.training.observation) || filled(m.training.action);
  return !(permits || tbt || table(m.ppe) || table(m.walkthrough) || table(m.equipment)
    || table(m.tools) || housekeeping || interaction || incident || training || table(m.admin));
}

/** How many of the eleven modules carry any answer — shown in DM Records. */
export function filledModuleCount(plan: DmPlan): number {
  const m = plan.modules;
  const has = (test: boolean) => (test ? 1 : 0);
  return [
    has(filled(m.permits.permitNo) || m.permits.checks.some(Boolean) || filled(m.permits.observations)),
    has(Object.values(m.tbt).some(filled) || filled(m.tbt.attendees)),
    has(m.ppe.some((row) => row.employee || row.remarks)),
    has(m.walkthrough.some((row) => row.area || row.details)),
    has(m.equipment.some((row) => row.name || row.devices || row.remarks)),
    has(m.tools.some((row) => row.name || row.toolId || row.remarks)),
    has(Object.keys(m.housekeeping.checks).length > 0 || filled(m.housekeeping.observations)),
    has(m.interaction.team.some((row) => row.name) || m.interaction.topics.length > 0 || filled(m.interaction.feedback)),
    has(m.incident.categories.length > 0 || filled(m.incident.description)),
    has(filled(m.training.employee) || filled(m.training.observation)),
    has(m.admin.some((row) => row.sopNo || row.remarks))
  ].reduce((sum, value) => sum + value, 0);
}

// Row types, derived from the plan so the form, the API and the PDF cannot drift apart.
export type DmPpeRow = DmPlan['modules']['ppe'][number];
export type DmWalkthroughRow = DmPlan['modules']['walkthrough'][number];
export type DmEquipmentRow = DmPlan['modules']['equipment'][number];
export type DmToolRow = DmPlan['modules']['tools'][number];
export type DmAdminRow = DmPlan['modules']['admin'][number];
export type DmHousekeepingItem = (typeof HOUSEKEEPING_ITEMS)[number];
