import { supabase } from './supabase';

export type OfflineMutationKind =
  | 'time_entry_insert'
  | 'time_entry_update'
  | 'absence_insert'
  | 'maintenance_request_insert'
  | 'form_submit';

export interface OfflineMutation {
  id: string;
  kind: OfflineMutationKind;
  payload: Record<string, unknown>;
  conflictKey?: string;
  createdAt: string;
  attempts: number;
  status: 'queued' | 'syncing' | 'failed' | 'conflict';
  lastError?: string;
}

const DB_NAME = 'vihem-offline';
const STORE_NAME = 'mutations';
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

function createId() {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll(): Promise<OfflineMutation[]> {
  if (!('indexedDB' in window)) return JSON.parse(localStorage.getItem('vihem.offline.queue') || '[]') as OfflineMutation[];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as OfflineMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

async function write(record: OfflineMutation) {
  if (!('indexedDB' in window)) {
    const records = await readAll();
    const next = [...records.filter(item => item.id !== record.id), record];
    localStorage.setItem('vihem.offline.queue', JSON.stringify(next));
    notify();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  notify();
}

async function remove(id: string) {
  if (!('indexedDB' in window)) {
    localStorage.setItem('vihem.offline.queue', JSON.stringify((await readAll()).filter(item => item.id !== id)));
    notify();
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  notify();
}

export async function getOfflineQueue() {
  try { return await readAll(); } catch { return []; }
}

export function subscribeOfflineQueue(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function queueOfflineMutation(kind: OfflineMutationKind, payload: Record<string, unknown>, conflictKey?: string) {
  const record: OfflineMutation = {
    id: createId(), kind, payload, conflictKey, createdAt: new Date().toISOString(), attempts: 0, status: 'queued',
  };
  await write(record);
  return record;
}

async function executeMutation(record: OfflineMutation) {
  if (record.kind === 'time_entry_insert' || record.kind === 'absence_insert' || record.kind === 'maintenance_request_insert') {
    const table = record.kind === 'time_entry_insert'
      ? 'vihem_time_entries'
      : record.kind === 'absence_insert' ? 'vihem_staff_absence_requests' : 'vihem_maintenance_requests';
    return supabase.from(table).insert(record.payload);
  }
  if (record.kind === 'time_entry_update') {
    const { id, data } = record.payload as { id: string; data: Record<string, unknown> };
    return supabase.from('vihem_time_entries').update(data).eq('id', id);
  }
  const { table, data } = record.payload as { table: string; data: Record<string, unknown> };
  return supabase.from(table).insert(data);
}

export async function flushOfflineQueue() {
  if (!navigator.onLine) return;
  const records = await getOfflineQueue();
  for (const record of records.filter(item => item.status === 'queued' || item.status === 'failed')) {
    await write({ ...record, status: 'syncing', attempts: record.attempts + 1 });
    const { error } = await executeMutation(record);
    if (!error) {
      await remove(record.id);
    } else {
      const conflict = error.code === '409' || error.code === '23505' || String(error.message).toLowerCase().includes('conflict');
      await write({ ...record, status: conflict ? 'conflict' : 'failed', attempts: record.attempts + 1, lastError: error.message });
    }
  }
  notify();
}
