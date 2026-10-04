export const SAFETY_ALERT_FILTERS = [
  'All',
  'Fatal',
  'LTI',
  'Medical Case',
  'Burn Injury',
  'First Aid',
  'Red Risk',
  'Property Damage',
  'Other'
] as const;

export type SafetyAlertCategory = Exclude<(typeof SAFETY_ALERT_FILTERS)[number], 'All'>;

export type SafetyAlert = {
  id: string;
  category: SafetyAlertCategory;
  title: string;
  date: string;
  site: string;
  area: string;
  description: string;
  rootCause: string;
  immediateActions: string[];
  correctiveActions: string[];
  lessonsLearned: string[];
};

/** Synthetic illustrations of alert records for the demo UI only; no real incident data is connected. */
export const DEMO_SAFETY_ALERTS: SafetyAlert[] = [
  {
    id: 'DEMO-ALERT-001',
    category: 'Fatal',
    title: 'Unprotected edge exposure during maintenance',
    date: '2026-10-02T11:15:00+05:30',
    site: 'Demo Site',
    area: 'Elevated maintenance platform',
    description: 'Demo scenario: a worker fell while maintenance was being carried out near an open edge. No personal or identifying details are included.',
    rootCause: 'The work-at-height review did not confirm that edge protection and fall-arrest controls were in place before access was allowed.',
    immediateActions: ['Stop similar work and restrict access to the affected area.', 'Notify the site emergency response team and account for all personnel.'],
    correctiveActions: ['Install and inspect suitable guardrails or approved fall-arrest systems.', 'Update the work-at-height permit checklist and supervisor verification.', 'Brief affected teams before restarting the task.'],
    lessonsLearned: ['Verify collective fall protection before work starts.', 'A permit is not a substitute for checking controls at the work location.']
  },
  {
    id: 'DEMO-ALERT-002',
    category: 'LTI',
    title: 'Hand injury at a material handling pinch point',
    date: '2026-10-01T15:40:00+05:30',
    site: 'Demo Site',
    area: 'Workshop · sheet handling bay',
    description: 'Demo scenario: a hand was injured while a sheet was being repositioned, resulting in lost work time. No names or employee details are shown.',
    rootCause: 'The load was stabilized manually and the pinch zone was not clearly controlled.',
    immediateActions: ['Stop the task and arrange prompt medical assessment.', 'Secure the material and keep others clear of the pinch zone.'],
    correctiveActions: ['Use suitable lifting or positioning aids for sheet materials.', 'Review the task method and glove/PPE selection with the crew.', 'Mark hand-clear zones and verify the load is stable before release.'],
    lessonsLearned: ['Keep hands out of line-of-fire and pinch points.', 'Plan the movement and use mechanical aids when a load can shift.']
  },
  {
    id: 'DEMO-ALERT-003',
    category: 'Medical Case',
    title: 'Heat stress symptoms during outdoor work',
    date: '2026-09-30T13:05:00+05:30',
    site: 'Demo Site',
    area: 'Outdoor utilities route',
    description: 'Demo scenario: a worker reported dizziness and fatigue during a hot-weather task and was taken for medical evaluation.',
    rootCause: 'Work-rest planning and early recognition of heat stress symptoms were not sufficiently reinforced.',
    immediateActions: ['Move the person to a cool area and arrange medical assessment.', 'Pause nearby work and check on other crew members.'],
    correctiveActions: ['Review hydration, shaded rest breaks and hot-weather work plans.', 'Brief supervisors on symptoms and escalation steps.', 'Reassess work timing when heat conditions change.'],
    lessonsLearned: ['Report symptoms early and never work through dizziness or confusion.', 'Plan for heat exposure before the shift begins.']
  },
  {
    id: 'DEMO-ALERT-004',
    category: 'Burn Injury',
    title: 'Contact with an unguarded hot surface',
    date: '2026-09-29T09:25:00+05:30',
    site: 'Demo Site',
    area: 'Process line · valve station',
    description: 'Demo scenario: a worker received a contact burn after reaching across a recently heated surface during inspection.',
    rootCause: 'The hot surface was not adequately guarded or marked, and the task boundary was unclear.',
    immediateActions: ['Follow the site first-response procedure and arrange medical review.', 'Isolate or barricade the hot surface until it is safe.'],
    correctiveActions: ['Install or restore heat guards and warning labels.', 'Verify cool-down and isolation requirements in the inspection method.', 'Review task positioning and PPE with the team.'],
    lessonsLearned: ['Assume unverified surfaces may be hot.', 'Make thermal hazards visible and control access before inspection.']
  },
  {
    id: 'DEMO-ALERT-005',
    category: 'First Aid',
    title: 'Minor cut while opening a package',
    date: '2026-09-28T10:10:00+05:30',
    site: 'Demo Site',
    area: 'Stores · receiving desk',
    description: 'Demo scenario: a minor hand cut occurred while opening packaging with an unsuitable blade.',
    rootCause: 'The selected cutting tool was not suitable for the package and the safe cutting direction was not followed.',
    immediateActions: ['Provide first aid and report the event through the site process.', 'Remove the damaged or unsuitable cutting tool from use.'],
    correctiveActions: ['Provide approved safety cutters at receiving points.', 'Brief staff on safe cutting direction and storage.', 'Keep hands clear of the cutting path.'],
    lessonsLearned: ['Choose the right tool for the task and cut away from the body.']
  },
  {
    id: 'DEMO-ALERT-006',
    category: 'Red Risk',
    title: 'Energy isolation not verified before intervention',
    date: '2026-09-27T16:20:00+05:30',
    site: 'Demo Site',
    area: 'Pump maintenance zone',
    description: 'Demo scenario: a pre-job check found that an energy source had not been independently verified before maintenance access.',
    rootCause: 'The isolation handover relied on a checklist entry without a field-level try-out and verification.',
    immediateActions: ['Stop the job and keep personnel outside the danger zone.', 'Re-establish isolation and verify zero energy before access.'],
    correctiveActions: ['Require documented try-out and independent verification for the task.', 'Review isolation points with the authorized team.', 'Audit similar permits before work resumes.'],
    lessonsLearned: ['Never rely on assumptions when controlling hazardous energy.', 'Verify isolation at the point of work.']
  },
  {
    id: 'DEMO-ALERT-007',
    category: 'Property Damage',
    title: 'Forklift contact with a storage rack',
    date: '2026-09-26T08:50:00+05:30',
    site: 'Demo Site',
    area: 'Warehouse aisle 3',
    description: 'Demo scenario: a forklift contacted a rack upright while turning in a congested aisle. No injuries were reported in the sample scenario.',
    rootCause: 'The aisle was partially obstructed and the turning area did not provide adequate clearance.',
    immediateActions: ['Stop vehicle movement and cordon off the affected rack.', 'Have a competent person check rack stability before access resumes.'],
    correctiveActions: ['Clear the aisle and restore marked traffic routes.', 'Inspect the rack and replace damaged components if needed.', 'Review speed, visibility and turning controls with operators.'],
    lessonsLearned: ['Keep routes clear and report impact damage immediately.', 'Do not use storage equipment until its stability is confirmed.']
  },
  {
    id: 'DEMO-ALERT-008',
    category: 'Other',
    title: 'Emergency access route found obstructed',
    date: '2026-09-25T12:35:00+05:30',
    site: 'Demo Site',
    area: 'South exit corridor',
    description: 'Demo scenario: stored materials were found narrowing an emergency access route during a routine area check.',
    rootCause: 'Temporary storage controls and end-of-shift housekeeping checks were not followed.',
    immediateActions: ['Remove the obstruction and confirm the route is clear.', 'Check nearby exits and emergency equipment access.'],
    correctiveActions: ['Reinforce no-storage markings and area ownership.', 'Add route checks to routine housekeeping inspections.', 'Escalate repeat obstructions to the responsible supervisor.'],
    lessonsLearned: ['Emergency routes must stay clear throughout the shift, not just during inspections.']
  }
];
