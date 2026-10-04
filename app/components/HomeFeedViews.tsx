'use client';

import { ArrowLeft, BellRing, CalendarDays, ChevronRight, Clock3, FileText, MapPin, X, type LucideIcon } from 'lucide-react';
import { formatHomeFeedDate, formatHomeFeedTime, getHomeFeedItems, type HomeFeedItem, type HomeFeedKind } from '@/lib/home-content';
import { LANGUAGE_LOCALE } from '@/lib/i18n';
import { useI18n } from './I18nProvider';

type ArchiveConfig = { eyebrow: string; title: string; description: string };
const ARCHIVE_CONFIG: Record<HomeFeedKind, ArchiveConfig> = {
  events: { eyebrow: 'EVENTS', title: 'All Events', description: 'Upcoming and archived sample events for the selected site.' },
  circulars: { eyebrow: 'DOCUMENTS & UPDATES', title: 'All Circulars', description: 'Published circular examples for the selected site.' },
  notices: { eyebrow: 'SITE UPDATES', title: 'All Notices', description: 'Recent sample safety notices for the selected site.' },
  updates: { eyebrow: 'SITE UPDATES', title: 'Circulars & Notices', description: 'Browse all sample circulars and notices for the selected site.' }
};

const FEED_ICON: Record<HomeFeedKind, LucideIcon> = {
  events: CalendarDays,
  circulars: FileText,
  notices: BellRing,
  updates: FileText
};

export function HomeFeedSection({ kind, title, eyebrow, item, siteName, onViewAll, onOpenItem }: {
  kind: Exclude<HomeFeedKind, 'updates'>;
  title: string;
  eyebrow: string;
  item: HomeFeedItem | null;
  siteName: string;
  onViewAll: () => void;
  onOpenItem: (item: HomeFeedItem) => void;
}) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const Icon = FEED_ICON[kind];
  const allLabel = T(kind === 'events' ? 'View all events' : kind === 'circulars' ? 'View all circulars' : 'View all notices');
  const countLabel = T(kind === 'events' ? 'Browse the full event schedule' : kind === 'circulars' ? 'Browse the complete circular library' : 'Browse the complete notice list');
  const itemType = T(kind === 'events' ? 'events' : kind);
  const count = getHomeFeedItems(kind).length;
  const countText = new Intl.NumberFormat(locale).format(count);

  return <section className={`section-block home-feed-section home-feed-${kind}`}>
    <div className="section-heading"><div><span className="eyebrow">{T(eyebrow)}</span><h2>{T(title)}</h2></div><span className="section-note">{siteName}</span></div>
    {item ? <button className="home-feed-feature" type="button" onClick={() => onOpenItem(item)} aria-label={T('Open details for {title}', { title: item.title })}>
      <span className="home-feed-feature-top"><span className="home-feed-tag">{T(kind === 'events' ? 'NEXT UPCOMING · DEMO' : 'LATEST · DEMO')}</span><span className="home-feed-date">{formatHomeFeedDate(item.date, locale)}{kind === 'events' ? ` · ${formatHomeFeedTime(item.date, locale)}` : ''}</span></span>
      <span className="home-feed-title">{item.title}</span>
      {kind === 'events' && item.location && <span className="home-feed-meta"><MapPin size={14} />{item.location}</span>}
      <span className="home-feed-summary">{item.summary}</span>
      <span className="home-feed-open-details">{T('View details')} <ChevronRight size={16} /></span>
    </button> : <div className="home-feed-empty">{T('No upcoming demo events are scheduled right now.')}</div>}
    <button className="home-feed-all-card" type="button" onClick={onViewAll} aria-label={T('{label}, {count} sample entries', { label: allLabel, count: countText })}>
      <span className={`home-feed-all-icon ${kind}`}><Icon size={20} /></span>
      <span className="home-feed-all-copy"><b>{allLabel}</b><small>{countLabel} · {countText} {T('sample')} {itemType}</small></span>
      <ChevronRight className="home-feed-all-arrow" size={19} />
    </button>
  </section>;
}

export function FeedArchivePage({ kind, siteName, onOpenItem, onBack }: { kind: HomeFeedKind; siteName: string; onOpenItem: (item: HomeFeedItem) => void; onBack: () => void }) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const config = ARCHIVE_CONFIG[kind];
  const items = getHomeFeedItems(kind);
  const ArchiveIcon = FEED_ICON[kind];
  const countText = new Intl.NumberFormat(locale).format(items.length);

  return <section className="page-panel feed-archive-page">
    <div className="page-heading feed-page-heading">
      <div><span className="eyebrow">{T(config.eyebrow)} · {siteName}</span><h1>{T(config.title)}</h1><p>{T(config.description)}</p></div>
      <button className="secondary-button feed-back-button" type="button" onClick={onBack}><ArrowLeft size={16} /> {T('Home')}</button>
    </div>
    <div className="feed-archive-list">
      {items.map((item) => {
        const isUpcoming = item.type === 'Event' && new Date(item.date).getTime() >= Date.now();
        return <button className="feed-archive-card" type="button" key={item.id} onClick={() => onOpenItem(item)}>
          <span className={`feed-archive-icon ${item.type.toLowerCase()}`}><ArchiveIcon size={20} /></span>
          <span className="feed-archive-copy">
            <span className="feed-archive-meta"><span className="feed-type-pill">{T(item.type)}{item.type === 'Event' ? ` · ${T(isUpcoming ? 'Upcoming' : 'Past')}` : ''}</span><time dateTime={item.date}>{formatHomeFeedDate(item.date, locale)}{item.type === 'Event' ? ` · ${formatHomeFeedTime(item.date, locale)}` : ''}</time></span>
            <b>{item.title}</b>
            <small>{item.summary}</small>
            {item.location && <span className="feed-archive-location"><MapPin size={13} />{item.location}</span>}
          </span>
          <ChevronRight className="feed-archive-arrow" size={19} />
        </button>;
      })}
    </div>
    {items.length === 0 && <div className="empty-state"><ArchiveIcon size={28} /><b>{T('No entries available')}</b><span>{T('There are no sample entries in this section.')}</span></div>}
    <p className="home-demo-caption">{T('Demo examples only · live event and document feeds are not connected.')}</p>
  </section>;
}

export function HomeFeedDetailDialog({ item, siteName, onClose }: { item: HomeFeedItem; siteName: string; onClose: () => void }) {
  const { language, T } = useI18n();
  const locale = LANGUAGE_LOCALE[language];
  const Icon = item.type === 'Event' ? CalendarDays : item.type === 'Notice' ? BellRing : FileText;
  return <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="feed-detail-title">
    <article className="modal feed-detail-dialog">
      <div className="modal-header">
        <div><span className="eyebrow">{T(item.type).toLocaleUpperCase(locale)} · {siteName}</span><h2 id="feed-detail-title">{item.title}</h2></div>
        <button className="close-button" type="button" onClick={onClose} aria-label={T('Close details')}><X /></button>
      </div>
      <div className="feed-detail-meta"><span><Icon size={16} />{formatHomeFeedDate(item.date, locale)}</span>{item.type === 'Event' && <span><Clock3 size={16} />{formatHomeFeedTime(item.date, locale)}</span>}{item.location && <span><MapPin size={16} />{item.location}</span>}</div>
      <p className="feed-detail-summary">{item.summary}</p>
      <div className="feed-detail-body">{item.details}</div>
      <div className="modal-footnote">{T('Sample content only · confirm actual event dates and site instructions through official channels.')}</div>
    </article>
  </div>;
}
