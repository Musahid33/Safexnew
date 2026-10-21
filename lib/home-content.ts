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
  /** Present when a published circular/notice carries a file or a link. */
  attachmentUrl?: string | null;
};

export function formatHomeFeedDate(value: string, locale = 'en-IN', timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

export function formatHomeFeedTime(value: string, locale = 'en-IN', timeZone = APP_TIME_ZONE): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
