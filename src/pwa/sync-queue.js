// Fila de edições offline via IndexedDB.
// Quando uma operação de upsert falha por NetworkError ou estamos
// offline, é enfileirada. O SW dispara 'flush-edit-queue' quando volta
// online; o main thread (com PAT desbloqueado) processa a fila.

const DB_NAME = 'viagens-v2';
const DB_VERSION = 1;
const STORE = 'edits';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(operation) {
  // operation = { kind: 'upsert' | 'delete', trip?, id?, message?, ts }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const op = { ...operation, ts: Date.now() };
    const req = store.add(op);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function list() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function remove(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Tenta drenar a fila chamando o handler do caller para cada operação.
// Retorna { processed, remaining } — operações falhadas voltam na fila.
export async function flush(handler) {
  if (!handler) throw new Error('flush: handler obrigatório');
  const pending = await list();
  let processed = 0;
  for (const op of pending) {
    try {
      await handler(op);
      await remove(op.id);
      processed++;
    } catch (e) {
      console.warn('[sync-queue] op falhou, mantida na fila:', op.id, e);
    }
  }
  const remaining = (await list()).length;
  return { processed, remaining };
}

// Solicita registro de Background Sync (Chromium-only; Safari ignora).
export async function requestSync(tag = 'viagens-edit-queue') {
  if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.sync.register(tag);
    return true;
  } catch {
    return false;
  }
}
