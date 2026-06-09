// Persistência LOCAL do extrato bruto e das transações parseadas.
//
// DB PRÓPRIO 'viagens-extrato' em IndexedDB — não toca no 'viagens-v2' da
// sync-queue (mexer lá exigiria bump de DB_VERSION e migração da fila
// offline). Mesmo padrão openDb de src/pwa/sync-queue.js.
//
// O extrato NUNCA vai ao trips.json: daqui só sai o valor derivado, que a
// Etapa 3 aplica por booking via upsertTrip → putTripsFile (com o gate).
//
// Stores:
//   'statements' (keyPath 'hash') → { hash, name, format, raw, ts }
//   'txns'       (keyPath 'id')   → { id: `${hash}:${fitid}`, hash,
//        fitid, date, amount, currency, description,
//        included: boolean, origin: 'extrato' | 'ajustado',
//        appliedTo: null | { tripId, category, index } }

const DB_NAME = 'viagens-extrato';
const DB_VERSION = 1;
const STORE_STATEMENTS = 'statements';
const STORE_TXNS = 'txns';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATEMENTS)) {
        db.createObjectStore(STORE_STATEMENTS, { keyPath: 'hash' });
      }
      if (!db.objectStoreNames.contains(STORE_TXNS)) {
        const store = db.createObjectStore(STORE_TXNS, { keyPath: 'id' });
        store.createIndex('byStatement', 'hash', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// SHA-256 hex do conteúdo do arquivo — a chave do statement. Reimportar o
// MESMO arquivo cai na mesma chave; arquivo editado vira statement novo.
export async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function txnsByStatement(db, hash) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXNS, 'readonly');
    const req = tx.objectStore(STORE_TXNS).index('byStatement').getAll(hash);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Grava o extrato bruto + transações parseadas. Txns que JÁ existem (mesmo
// id = hash:fitid) são puladas para preservar include/exclude, ajustes
// manuais e appliedTo de um import anterior do mesmo arquivo. Ids
// duplicados DENTRO do lote (parser deveria impedir, mas bancos reusam
// FITID) também são pulados — put sobrescreveria a txn anterior em
// silêncio. Retorna { hash, added, skipped }.
export async function saveStatement({ name = '', format = '', raw } = {}, txns = []) {
  if (typeof raw !== 'string' || !raw) throw new Error('saveStatement: raw obrigatório');
  const hash = await hashText(raw);
  const db = await openDb();
  const existing = new Set((await txnsByStatement(db, hash)).map((t) => t.id));
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STATEMENTS, STORE_TXNS], 'readwrite');
    tx.objectStore(STORE_STATEMENTS).put({ hash, name, format, raw, ts: Date.now() });
    const store = tx.objectStore(STORE_TXNS);
    let added = 0;
    for (const t of txns) {
      const id = `${hash}:${t.fitid}`;
      if (existing.has(id)) continue;
      existing.add(id);
      store.put({ id, hash, ...t, included: true, origin: 'extrato', appliedTo: null });
      added++;
    }
    tx.oncomplete = () => resolve({ hash, added, skipped: txns.length - added });
    tx.onerror = () => reject(tx.error);
    // Abort no commit (ex.: QuotaExceededError com extrato grande) NÃO
    // dispara complete/error — sem este handler a Promise penduraria.
    tx.onabort = () => reject(tx.error || new Error('saveStatement: transação abortada'));
  });
}

// Lista os extratos importados (sem as txns).
export async function listStatements() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATEMENTS, 'readonly');
    const req = tx.objectStore(STORE_STATEMENTS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Lista transações — todas, ou só as de um extrato (por hash).
export async function listTxns(hash = null) {
  const db = await openDb();
  if (hash) return txnsByStatement(db, hash);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXNS, 'readonly');
    const req = tx.objectStore(STORE_TXNS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Atualiza uma transação: include/exclude (patch.included) ou ajuste
// manual de dados (amount/date/description/currency) — ajuste de dados
// marca origin:'ajustado', e saveStatement preserva isso em reimports.
// Resolve só no oncomplete da transação (put.onsuccess não garante que o
// commit persistiu).
export async function updateTxn(id, patch = {}) {
  if (!id) throw new Error('updateTxn: id obrigatório');
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TXNS, 'readwrite');
    const store = tx.objectStore(STORE_TXNS);
    let next = null;
    const get = store.get(id);
    get.onsuccess = () => {
      const current = get.result;
      if (!current) {
        reject(new Error(`updateTxn: txn não encontrada: ${id}`));
        tx.abort();
        return;
      }
      const adjustsData = ['amount', 'date', 'description', 'currency'].some((k) => k in patch);
      next = { ...current, ...patch, id };
      if (adjustsData) next.origin = 'ajustado';
      store.put(next);
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('updateTxn: transação abortada'));
  });
}

// Apaga TODO o cache local de extratos (statements + txns).
export async function clearAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_STATEMENTS, STORE_TXNS], 'readwrite');
    tx.objectStore(STORE_STATEMENTS).clear();
    tx.objectStore(STORE_TXNS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('clearAll: transação abortada'));
  });
}
