export type HomeFeedKind = 'events' | 'circulars' | 'notices' | 'updates';
export type HomeContentType = 'Event' | 'Circular' | 'Notice';

export type HomeFeedItem = {
  id: string;
  type: HomeContentType;
  title: string;
  date: string;
  summary: string;
  details: string;
  location?: string;
};

/** Synthetic examples only. No live events, circulars, or notices are connected in demo mode. */
export const DEMO_EVENTS: HomeFeedItem[] = [
  {
    id: 'emergency-response-drill',
    type: 'Event',
    title: 'Emergency Response & Evacuation Drill',
    date: '2026-10-08T10:00:00+05:30',
    location: 'Main Assembly Point',
    summary: 'Practice the site alarm, evacuation route and head-count process.',
    details: 'Join the scheduled demo drill to review alarm response, nearest safe exit, assembly point reporting and head-count responsibilities. Supervisors should brief their teams before the drill. This is sample event content; confirm dates and instructions with your site EHS team.'
  },
  {
    id: 'contractor-safety-day',
    type: 'Event',
    title: 'Contractor Safety Day',
    date: '2026-10-14T09:30:00+05:30',
    location: 'Training Hall',
    summary: 'A short refresher on permits, PPE and work-area coordination.',
    details: 'The demo agenda covers permit-to-work checks, PPE selection, work-area handover and stop-work expectations. Contractor representatives and site coordinators are welcome. This listing is synthetic and is not a confirmed site event.'
  },
  {
    id: 'ppe-fit-awareness',
    type: 'Event',
    title: 'PPE Fit & Awareness Session',
    date: '2026-10-22T14:00:00+05:30',
    location: 'Central Training Room',
    summary: 'Review PPE fit, inspection and replacement basics.',
    details: 'This sample session demonstrates how an event detail can show a topic, date, time and location. Follow only official site communications for actual training schedules.'
  },
  {
    id: 'safety-committee-q3',
    type: 'Event',
    title: 'Safety Committee Meeting · Q3',
    date: '2026-09-28T11:00:00+05:30',
    location: 'Administration Block · Meeting Room 2',
    summary: 'Demo archive entry for a past committee meeting.',
    details: 'A sample archived event entry. Meeting minutes and actions are not connected to the live service.'
  }
];

export const DEMO_CIRCULARS: HomeFeedItem[] = [
  {
    id: 'ppe-compliance-campaign',
    type: 'Circular',
    title: 'PPE Compliance Campaign',
    date: '2026-10-02T09:00:00+05:30',
    summary: 'Refresher on correct PPE selection, inspection and use.',
    details: 'This demo circular highlights the need to select PPE for the task, inspect it before use and replace damaged items. Supervisors should use approved site guidance and report stock or fit concerns through the normal site process.'
  },
  {
    id: 'october-training-calendar',
    type: 'Circular',
    title: 'Safety Training Calendar · October',
    date: '2026-10-01T09:00:00+05:30',
    summary: 'Sample monthly calendar for safety refreshers and briefings.',
    details: 'This is a sample training-calendar circular for the library preview. No registration, attendance record or live schedule is connected.'
  },
  {
    id: 'permit-to-work-update',
    type: 'Circular',
    title: 'Permit-to-Work Reminder',
    date: '2026-09-25T09:00:00+05:30',
    summary: 'Recheck permits and work-area controls before starting a task.',
    details: 'Confirm that permits, isolations and work-area controls are valid before work begins. This demo reminder is not a replacement for the current approved site procedure.'
  }
];

export const DEMO_NOTICES: HomeFeedItem[] = [
  {
    id: 'monsoon-safety-guidelines',
    type: 'Notice',
    title: 'Monsoon Safety Guidelines',
    date: '2026-10-03T08:30:00+05:30',
    summary: 'Check walkways, drainage and electrical enclosures after rain.',
    details: 'Sample notice: keep walkways clear, report standing water or slippery surfaces, and check that electrical enclosures remain protected. Stop work and contact the site team if an unsafe condition is found.'
  },
  {
    id: 'lifting-zone-barricades',
    type: 'Notice',
    title: 'Check Lifting-Zone Barricades',
    date: '2026-10-02T08:30:00+05:30',
    summary: 'Keep pedestrians outside the exclusion zone during lifting.',
    details: 'Before a lift begins, verify that the exclusion zone is marked and barricaded, the signal person is in position, and pedestrian routes remain clear. This is a synthetic reminder, not an active site alert.'
  },
  {
    id: 'electrical-panel-water-check',
    type: 'Notice',
    title: 'Water-Ingress Check · Electrical Panels',
    date: '2026-10-01T08:30:00+05:30',
    summary: 'Report signs of moisture around electrical equipment.',
    details: 'Do not touch wet electrical equipment. Keep clear and notify the responsible site team promptly. This sample notice is for layout demonstration only.'
  }
];

export function getHomeFeedItems(kind: HomeFeedKind): HomeFeedItem[] {
  if (kind === 'events') {
    const now = Date.now();
    return [...DEMO_EVENTS].sort((a, b) => {
      const aTime = new Date(a.date).getTime();
      const bTime = new Date(b.date).getTime();
      const aUpcoming = aTime >= now;
      const bUpcoming = bTime >= now;
      if (aUpcoming && bUpcoming) return aTime - bTime;
      if (!aUpcoming && !bUpcoming) return bTime - aTime;
      return aUpcoming ? -1 : 1;
    });
  }

  if (kind === 'circulars') {
    return [...DEMO_CIRCULARS].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  if (kind === 'notices') {
    return [...DEMO_NOTICES].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  return [...DEMO_CIRCULARS, ...DEMO_NOTICES].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getUpcomingEvents(now = Date.now()): HomeFeedItem[] {
  return DEMO_EVENTS
    .filter((event) => new Date(event.date).getTime() >= now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function formatHomeFeedDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatHomeFeedTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
