/* Safex PWA worker. Report data is never placed in the Cache API. */
const REPORT_DB_NAME = 'safex-offline-report-outbox';
const REPORT_STORE = 'reports';
const REPORT_SYNC_TAG = 'safex-report-outbox-sync';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function openReportDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPORT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(REPORT_STORE)) {
        const store = database.createObjectStore(REPORT_STORE, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
        store.createIndex('state', 'state', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open report queue.'));
  });
}

async function readReportQueue() {
  const database = await openReportDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_STORE, 'readonly');
    const request = transaction.objectStore(REPORT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Could not read report queue.'));
  });
}

async function updateQueuedReport(entry, patch) {
  const database = await openReportDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_STORE, 'readwrite');
    transaction.objectStore(REPORT_STORE).put({ ...entry, ...patch });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not update report queue.'));
    transaction.onabort = () => reject(transaction.error || new Error('Report queue update was cancelled.'));
  });
}

async function removeQueuedReport(id) {
  const database = await openReportDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(REPORT_STORE, 'readwrite');
    transaction.objectStore(REPORT_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not clear synced report.'));
    transaction.onabort = () => reject(transaction.error || new Error('Report queue deletion was cancelled.'));
  });
}

function requestForEntry(entry) {
  const payload = JSON.stringify(entry.payload);
  if (!entry.attachment) {
    return { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload };
  }
  const form = new FormData();
  form.append('payload', payload);
  form.append('attachment', entry.attachment.blob, entry.attachment.name);
  return { method: 'POST', credentials: 'same-origin', body: form };
}

async function notifyReportQueueChanged() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'SAFE_REPORT_OUTBOX_UPDATED' }));
}

async function syncReportQueue() {
  const entries = await readReportQueue();
  for (const entry of entries) {
    if (entry.state !== 'pending') continue;
    let response;
    try {
      response = await fetch(new URL('/api/reports', self.location.origin), requestForEntry(entry));
    } catch (error) {
      await updateQueuedReport(entry, { attempts: (entry.attempts || 0) + 1, lastError: 'Network connection interrupted. This report remains saved on this device.' });
      await notifyReportQueueChanged();
      throw error;
    }

    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (response.ok && result && result.ok) {
      await removeQueuedReport(entry.id);
      continue;
    }
    if (response.status === 503 && result && result.code === 'REPORT_BACKEND_DISABLED') {
      await updateQueuedReport(entry, { attempts: (entry.attempts || 0) + 1, lastError: 'Database sync is not configured on the Safex server.' });
      break;
    }
    if (response.status === 429) {
      await updateQueuedReport(entry, { attempts: (entry.attempts || 0) + 1, lastError: 'Sync is temporarily rate-limited. It will retry later.' });
      throw new Error('Report sync is rate-limited.');
    }
    if (response.status >= 400 && response.status < 500) {
      await updateQueuedReport(entry, { state: 'needs-attention', attempts: (entry.attempts || 0) + 1, lastError: result.error || 'The server rejected this report. Review before retrying.' });
      continue;
    }
    await updateQueuedReport(entry, { attempts: (entry.attempts || 0) + 1, lastError: 'The server is unavailable. This report remains saved on this device.' });
    throw new Error('Report sync will be retried.');
  }
  await notifyReportQueueChanged();
}

self.addEventListener('sync', (event) => {
  if (event.tag === REPORT_SYNC_TAG) event.waitUntil(syncReportQueue());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Safex update', body: 'There is a new safety update.', url: '/' };
  try { if (event.data) payload = { ...payload, ...event.data.json() }; } catch (_) {}
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' },
    tag: payload.tag || 'safex-update',
    renotify: false
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || '/', self.location.origin);
  const target = requested.origin === self.location.origin ? requested.href : `${self.location.origin}/`;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url === target);
    return existing ? existing.focus() : self.clients.openWindow(target);
  }));
});
