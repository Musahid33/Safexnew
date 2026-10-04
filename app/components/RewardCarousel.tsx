'use client';

import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useI18n } from './I18nProvider';

const SLIDE_LABELS = [
  'Safety award illustration',
  'Safety helmet and shield illustration',
  'Recognition medal illustration'
];

/** Feed-ready image record. Pass only approved/published artwork; never include winner details. */
export type RecognitionGalleryItem = {
  id: string;
  altText: string;
  imageUrl?: string | null;
  artworkIndex?: number;
  isPublished?: boolean;
};

const DEMO_RECOGNITIONS: RecognitionGalleryItem[] = SLIDE_LABELS.map((altText, artworkIndex) => ({
  id: `demo-recognition-${artworkIndex + 1}`,
  altText,
  artworkIndex,
  isPublished: true
}));

type Props = { items?: readonly RecognitionGalleryItem[] };

export default function RewardCarousel({ items = DEMO_RECOGNITIONS }: Props) {
  const { T } = useI18n();
  const [paused, setPaused] = useState(false);
  const publishedItems = items.filter((item) => item.isPublished !== false);

  if (!publishedItems.length) return null;

  return <div className={`reward-gallery ${paused ? 'paused' : ''}`} role="region" aria-roledescription="carousel" aria-label={T('Rewards and Recognition Gallery images')}>
    <span className="sr-only">{T('Image-only recognition gallery. Names and winner details are intentionally not displayed.')}</span>
    <div className="reward-gallery-viewport">
      <div className="reward-gallery-track" style={{ animationDuration: `${Math.max(18, publishedItems.length * 6)}s` }}>
        {[0, 1].map((copy) => <div className="reward-gallery-group" key={`gallery-copy-${copy}`} aria-hidden={copy === 1 ? true : undefined}>
          {publishedItems.map((item, index) => <div className="reward-gallery-card" key={`${copy}-${item.id}`}>
            {item.imageUrl
              ? <img className="reward-gallery-image" src={item.imageUrl} alt={item.altText} loading="lazy" decoding="async" />
              : <RewardArtwork slide={item.artworkIndex ?? index % SLIDE_LABELS.length} />}
          </div>)}
        </div>)}
      </div>
    </div>
    <button className="reward-gallery-pause" type="button" onClick={() => setPaused((value) => !value)} aria-label={T(paused ? 'Resume gallery scrolling' : 'Pause gallery scrolling')} aria-pressed={paused}>
      {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
    </button>
  </div>;
}

function RewardArtwork({ slide }: { slide: number }) {
  const palettes = [
    { start: '#102f4b', end: '#12685f', glow: '#4ad0a8', accent: '#ffd26a', pale: '#f8f4e8' },
    { start: '#173c70', end: '#286fb0', glow: '#7dd4e8', accent: '#ffca62', pale: '#edf7ff' },
    { start: '#45255f', end: '#a43e78', glow: '#f18fbd', accent: '#ffd26a', pale: '#fff2f7' }
  ];
  const colors = palettes[slide];
  const gradientId = `reward-wall-gradient-${slide}`;
  const glowId = `reward-wall-glow-${slide}`;

  return <svg className="reward-carousel-art" viewBox="0 0 960 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label={SLIDE_LABELS[slide]}>
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={colors.start} /><stop offset="1" stopColor={colors.end} /></linearGradient>
      <radialGradient id={glowId}><stop offset="0" stopColor={colors.glow} stopOpacity=".45" /><stop offset="1" stopColor={colors.glow} stopOpacity="0" /></radialGradient>
    </defs>
    <rect width="960" height="360" fill={`url(#${gradientId})`} />
    <ellipse cx="680" cy="190" rx="330" ry="250" fill={`url(#${glowId})`} />
    <circle cx="118" cy="48" r="3" fill="#fff" opacity=".45" /><circle cx="218" cy="112" r="5" fill={colors.accent} opacity=".8" />
    <circle cx="810" cy="58" r="4" fill="#fff" opacity=".6" /><circle cx="885" cy="265" r="3" fill={colors.accent} opacity=".8" />
    <path d="M0 310c125-37 220-28 326 7 99 32 214 40 338-1 106-35 200-39 296-13v57H0z" fill="#071b2b" opacity=".23" />
    <path d="M72 0v360M888 0v360" stroke="#fff" strokeOpacity=".07" strokeWidth="1" />
    <path d="M60 62h146M754 300h142" stroke="#fff" strokeOpacity=".12" strokeWidth="2" strokeLinecap="round" />
    {slide === 0 && <g>
      <circle cx="480" cy="165" r="130" fill="#fff" opacity=".07" />
      <path d="M405 92h150v77c0 47-31 83-75 83s-75-36-75-83z" fill={colors.accent} />
      <path d="M406 113h-48v33c0 34 22 57 58 60M554 113h48v33c0 34-22 57-58 60" fill="none" stroke={colors.accent} strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M462 249v33h-38v24h112v-24h-38v-33" fill={colors.accent} />
      <path d="M480 119l10 21 24 3-17 16 4 23-21-11-21 11 4-23-17-16 24-3z" fill={colors.pale} />
      <path d="M288 108l7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2zM672 76l6 12 14 2-10 9 2 14-12-6-12 6 2-14-10-9 14-2zM700 222l5 10 12 2-9 8 2 12-10-6-11 6 2-12-9-8 12-2z" fill={colors.accent} opacity=".9" />
    </g>}
    {slide === 1 && <g>
      <path d="M480 54l125 45v91c0 81-55 127-125 161-70-34-125-80-125-161V99z" fill={colors.pale} opacity=".94" />
      <path d="M480 78l101 36v75c0 65-44 104-101 133-57-29-101-68-101-133v-75z" fill={colors.start} />
      <path d="M385 185c0-53 42-96 95-96s95 43 95 96" fill={colors.accent} />
      <path d="M369 185h222c0 15-12 27-27 27H396c-15 0-27-12-27-27z" fill={colors.accent} />
      <path d="M475 112v66" stroke="#fff" strokeWidth="13" strokeLinecap="round" />
      <path d="M410 160h140" stroke="#fff" strokeWidth="12" strokeLinecap="round" />
      <path d="M475 237l10 20 22 3-16 15 4 21-20-10-20 10 4-21-16-15 22-3z" fill={colors.accent} />
      <circle cx="293" cy="174" r="43" fill="#fff" opacity=".1" /><circle cx="670" cy="146" r="61" fill="#fff" opacity=".09" />
      <path d="M272 74l7 14 16 2-12 11 3 16-14-8-14 8 3-16-12-11 16-2zM673 236l6 12 14 2-10 9 2 14-12-7-12 7 2-14-10-9 14-2z" fill={colors.accent} />
    </g>}
    {slide === 2 && <g>
      <circle cx="480" cy="174" r="135" fill="#fff" opacity=".08" />
      <path d="M480 65l118 44v81c0 75-52 121-118 153-66-32-118-78-118-153v-81z" fill={colors.accent} />
      <path d="M480 91l90 33v66c0 58-39 95-90 122-51-27-90-64-90-122v-66z" fill={colors.start} />
      <path d="M480 126l16 33 37 5-27 26 7 37-33-18-33 18 7-37-27-26 37-5z" fill={colors.pale} />
      <path d="M314 133l8 16 18 3-13 12 3 18-16-9-16 9 3-18-13-12 18-3zM660 87l7 13 15 2-11 11 3 15-14-7-13 7 2-15-11-11 15-2zM680 255l6 12 13 2-10 9 2 13-11-7-12 7 2-13-10-9 13-2z" fill={colors.accent} />
      <path d="M220 286c34-39 71-58 110-58s67 15 87 44M543 272c28-32 61-48 100-48s70 14 101 43" fill="none" stroke="#fff" strokeOpacity=".32" strokeWidth="7" strokeLinecap="round" />
    </g>}
  </svg>;
}
