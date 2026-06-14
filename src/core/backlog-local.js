// Paraquedas local do backlog (Fase 2c).
// Quando o GitHub não está conectado (ou sem rede), a ideia capturada cai
// aqui — IndexedDB, só neste aparelho — e é publicada no backlog.json quando
// você conecta. Custódia segregada: nada disso entra no repositório até a
// publicação explícita.

const DB_NAME = 'viagens-backlog-local';
const DB_VERSION = 1;
const STORE = 'pending';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'lid', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueLocal(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({ item, ts: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listLocal() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeLocal(lid) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(lid);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
