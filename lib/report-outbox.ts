import type { ReportType } from './types';

const DB_NAME = 'safex-offline-report-outbox';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
export const REPORT_SYNC_TAG = 'safex-report-outbox-sync';

export type ReportSyncPayload = {
  clientSubmissionId: string;
  siteId: string;
  type: ReportType;
  category: string | null;
  anonymous: boolean;
  employeeNo: string | null;
  area: string;
  department: string | null;
  incidentAt: string;
  description: string;
  immediateAction: string;
  severity: 'Low' | 'Medium' | 'High' | null;
  clientSubmittedAt: string;
};

export type StoredAttachment = { blob: Blob; name: string; type: string };
export type QueuedReport = {
  id: string;
  payload: ReportSyncPayload;
  attachment: StoredAttachment | null;
  queuedAt: string;
  attempts: number;
  state: 'pending' | 'needs-attention';
  lastError: string | null;
};

export type OutboxSyncResult = {
  status: 'idle' | 'synced' | 'offline' | 'backend-unconfigured' | 'server-error' | 'needs-attention' | 'rate-limited';
  syncedIds: string[];
  remaining: number;
};

type SyncRegistration = ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } };

let databasePromise: Promise<IDBDatabase> | null = null;
let syncInProgress: Promise<OutboxSyncResult> | null = null;

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw new Error('This browser does not support secure offline report storage.');
  return indexedDB;
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = requireIndexedDb().open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('queuedAt', 'queuedAt', { unique: false });
        store.createIndex('state', 'state', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open offline report storage.'));
    request.onblocked = () => reject(new Error('Offline report storage is busy in another tab. Close other Safex tabs and try again.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise!;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline report storage transaction was cancelled.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Offline report storage transaction failed.'));
  });
}

export function createSubmissionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function enqueueReport(payload: ReportSyncPayload, attachment: File | null): Promise<QueuedReport> {
  const now = new Date().toISOString();
  const entry: QueuedReport = {
    id: payload.clientSubmissionId,
    payload: { ...payload, employeeNo: payload.anonymous ? null : payload.employeeNo },
    attachment: attachment ? { blob: attachment.slice(0, attachment.size, attachment.type), name: attachment.name, type: attachment.type } : null,
    queuedAt: now,
    attempts: 0,
    state: 'pending',
    lastError: null
  };
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).put(entry);
  await transactionDone(transaction);
  return entry;
}

export async function listQueuedReports(): Promise<QueuedReport[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<QueuedReport[]>;
  const entries = await new Promise<QueuedReport[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error('Could not read queued reports.'));
  });
  await transactionDone(transaction);
  return entries.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

export async function deleteQueuedReport(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  transaction.objectStore(STORE_NAME).delete(id);
  await transactionDone(transaction);
}

async function updateQueuedReport(id: string, update: (current: QueuedReport) => QueuedReport): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const request = store.get(id) as IDBRequest<QueuedReport | undefined>;
  request.onsuccess = () => {
    if (request.result) store.put(update(request.result));
  };
  await transactionDone(transaction);
}

function reportRequest(entry: QueuedReport): RequestInit {
  const payload = JSON.stringify(entry.payload);
  if (!entry.attachment) return { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: payload };
  const form = new FormData();
  form.append('payload', payload);
  form.append('attachment', entry.attachment.blob, entry.attachment.name);
  return { method: 'POST', credentials: 'same-origin', body: form };
}

async function readApiResult(response: Response): Promise<{ ok?: boolean; code?: string; error?: string }> {
  try { return await response.json() as { ok?: boolean; code?: string; error?: string }; }
  catch { return {}; }
}

async function runSync(): Promise<OutboxSyncResult> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return { status: 'offline', syncedIds: [], remaining: (await listQueuedReports()).length };
  const entries = await listQueuedReports();
  if (!entries.length) return { status: 'idle', syncedIds: [], remaining: 0 };
  const syncedIds: string[] = [];
  let status: OutboxSyncResult['status'] = 'synced';

  for (const entry of entries) {
    if (entry.state !== 'pending') continue;
    try {
      const response = await fetch('/api/reports', reportRequest(entry));
      const result = await readApiResult(response);
      if (response.ok && result.ok) {
        await deleteQueuedReport(entry.id);
        syncedIds.push(entry.id);
        continue;
      }
      if (response.status === 503 && result.code === 'REPORT_BACKEND_DISABLED') {
        status = 'backend-unconfigured';
        await updateQueuedReport(entry.id, (current) => ({ ...current, attempts: current.attempts + 1, lastError: 'Database sync is not configured on the Safex server.' }));
        break;
      }
      if (response.status === 429) {
        status = 'rate-limited';
        await updateQueuedReport(entry.id, (current) => ({ ...current, attempts: current.attempts + 1, lastError: 'Sync is temporarily rate-limited. It will retry later.' }));
        break;
      }
      if (response.status >= 400 && response.status < 500) {
        status = 'needs-attention';
        await updateQueuedReport(entry.id, (current) => ({ ...current, state: 'needs-attention', attempts: current.attempts + 1, lastError: result.error ?? 'The server rejected this report. Review the queued entry before retrying.' }));
        continue;
      }
      status = 'server-error';
      await updateQueuedReport(entry.id, (current) => ({ ...current, attempts: current.attempts + 1, lastError: 'The server is unavailable. This report remains saved on this device.' }));
      break;
    } catch {
      status = 'offline';
      await updateQueuedReport(entry.id, (current) => ({ ...current, attempts: current.attempts + 1, lastError: 'Network connection interrupted. This report remains saved on this device.' }));
      break;
    }
  }

  const remaining = (await listQueuedReports()).length;
  if (status === 'synced' && remaining > 0) status = 'needs-attention';
  return { status, syncedIds, remaining };
}

export function syncPendingReports(): Promise<OutboxSyncResult> {
  if (syncInProgress) return syncInProgress;
  syncInProgress = runSync().finally(() => { syncInProgress = null; });
  return syncInProgress;
}

export async function retryReportsNeedingAttention(): Promise<void> {
  const entries = await listQueuedReports();
  await Promise.all(entries.filter((entry) => entry.state === 'needs-attention').map((entry) => updateQueuedReport(entry.id, (current) => ({ ...current, state: 'pending', lastError: null }))));
}

export async function registerReportBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready as SyncRegistration;
    await registration.sync?.register(REPORT_SYNC_TAG);
  } catch {
    // Background Sync is an enhancement; the app also retries on online/focus events.
  }
}
