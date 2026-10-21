export const APP_TIME_ZONE = 'Asia/Kolkata';

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

/**
 * Events, circulars and notices.
 *
 * These used to be a synthetic set; they are empty now because no publishing feed exists yet.
 * The helpers stay in place so a real source can fill them without touching the screens —
 * every screen renders its empty state until then.
 */
const HOME_FEED: HomeFeedItem[] = [];

export function getHomeFeedItems(kind: HomeFeedKind): HomeFeedItem[] {
  if (kind === 'events') {
    const now = Date.now();
    return HOME_FEED.filter((item) => item.type === 'Event').sort((a, b) => {
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
    return HOME_FEED.filter((item) => item.type === 'Circular').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  if (kind === 'notices') {
    return HOME_FEED.filter((item) => item.type === 'Notice').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  return HOME_FEED.filter((item) => item.type !== 'Event').sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function getUpcomingEvents(now = Date.now()): HomeFeedItem[] {
  return HOME_FEED.filter((item) => item.type === 'Event')
    .filter((event) => new Date(event.date).getTime() >= now)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function formatHomeFeedDate(value: string, locale = 'en-IN', timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatHomeFeedTime(value: string, locale = 'en-IN', timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
