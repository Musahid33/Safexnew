import type { OutboxSyncResult } from './report-outbox';

/**
 * Single source of truth for the connection/sync banner.
 *
 * The front page must never show two banners at once (that was the clutter this replaces),
 * so this function collapses every combination of network + outbox state into at most ONE
 * banner, or `null` when there is genuinely nothing to say.
 */
export type SyncBannerTone = 'offline' | 'syncing' | 'synced' | 'queued' | 'attention' | 'error';
export type SyncBannerIcon = 'offline' | 'syncing' | 'synced' | 'queued' | 'attention';

/** How long a transient confirmation stays on screen before it takes itself away. */
export const SYNC_BANNER_AUTO_DISMISS_MS = 4500;

export type SyncBanner = {
  tone: SyncBannerTone;
  icon: SyncBannerIcon;
  titleKey: string;
  detailKey: string;
  params?: Record<string, string | number>;
  /** `sync-now` is only offered while online, so the action can actually succeed. */
  action: 'sync-now' | null;
  /** Transient confirmations fade out on their own so the page stays clean. */
  autoDismissMs: number | null;
};

export type SyncStatusInput = {
  isOnline: boolean;
  syncState: OutboxSyncResult['status'] | 'syncing' | 'storage-error';
  queuedCount: number;
  syncEnabled: boolean;
};

export function describeSyncStatus({ isOnline, syncState, queuedCount, syncEnabled }: SyncStatusInput): SyncBanner | null {
  // 1. Offline wins over everything: the worker's main worry is "did my report get lost?".
  //    Shown even with an empty queue, so the missing connection is never a surprise.
  if (!isOnline) {
    return {
      tone: 'offline',
      icon: 'offline',
      titleKey: 'You are offline',
      detailKey: queuedCount > 0
        ? (queuedCount === 1
          ? '1 report is saved on this device and will sync automatically.'
          : '{count} reports are saved on this device and will sync automatically.')
        : 'Saved on device · waiting to sync',
      params: queuedCount > 0 ? { count: queuedCount } : undefined,
      action: null,
      autoDismissMs: null
    };
  }

  // 2. Back online and a queue is draining. Only worth showing while something is actually
  //    queued - a "syncing" panel over an empty queue would sit there saying nothing.
  if (syncState === 'syncing' && queuedCount > 0) {
    return {
      tone: 'syncing',
      icon: 'syncing',
      titleKey: 'Back online · syncing saved reports',
      detailKey: queuedCount > 0 ? '{count} reports saved on this device' : 'Waiting for a connection and a configured database endpoint.',
      params: queuedCount > 0 ? { count: queuedCount } : undefined,
      action: null,
      autoDismissMs: null
    };
  }

  // 3. Just finished: a short confirmation that hides itself.
  if (syncState === 'synced' && queuedCount === 0) {
    return {
      tone: 'synced',
      icon: 'synced',
      titleKey: 'Saved reports synced',
      detailKey: 'All saved reports are synced.',
      action: null,
      autoDismissMs: SYNC_BANNER_AUTO_DISMISS_MS
    };
  }

  // 4. Online and empty queue: say nothing at all (no clutter).
  if (queuedCount === 0) return null;

  // 5. Online with reports still waiting: explain why and offer the manual retry.
  const attention: Record<string, { detailKey: string; tone: SyncBannerTone }> = {
    'needs-attention': { detailKey: 'Some queued reports need attention before they can sync.', tone: 'attention' },
    'server-error': { detailKey: 'The database server is unavailable. Reports remain saved here and will retry.', tone: 'attention' },
    'rate-limited': { detailKey: 'Sync is temporarily rate-limited; it will retry later.', tone: 'attention' },
    'storage-error': { detailKey: 'Offline report storage could not be read. Keep the form open and try again.', tone: 'error' },
    idle: { detailKey: 'Waiting for a connection and a configured database endpoint.', tone: 'queued' },
    offline: { detailKey: 'Saved on device · waiting to sync', tone: 'queued' },
    synced: { detailKey: 'All saved reports are synced.', tone: 'queued' },
    'backend-unconfigured': { detailKey: 'Reports are saved on this device. Database sync is not configured on the Safex server yet.', tone: 'queued' }
  };
  const mapped = attention[syncState] ?? attention.idle;

  return {
    tone: mapped.tone,
    icon: mapped.tone === 'attention' || mapped.tone === 'error' ? 'attention' : 'queued',
    titleKey: '{count} reports saved on this device',
    detailKey: mapped.detailKey,
    params: { count: queuedCount },
    action: syncEnabled ? 'sync-now' : null,
    autoDismissMs: null
  };
}
