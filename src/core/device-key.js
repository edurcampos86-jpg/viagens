// Chave de aparelho ("lembrar neste aparelho") — cifra o PAT SEM senha-mestra.
//
// Desenho: uma chave AES-256-GCM aleatória, NÃO-EXTRAÍVEL (extractable:false),
// gerada via Web Crypto e guardada no IndexedDB. Por ser não-extraível, o
// material da chave nunca vira bytes em JS nem em localStorage — só dá para
// usá-la via crypto.subtle. O PAT cifrado (ciphertext) mora em localStorage.
//
// Consequência: o token nunca aparece em texto puro; e mesmo um dump do
// localStorage não basta para decifrá-lo (a chave está no key-store do browser,
// presa ao IndexedDB deste aparelho). Trade-off consciente vs. a senha-mestra:
// conveniência (auto-decifra no load) em troca do gate manual por sessão.
//
// Blob: base64( v(1)=0x01 | iv(12) | ct ).

const DB_NAME = 'viagens-device';
const STORE = 'keys';
const KEY_ID = 'pat-key';
const BLOB_VERSION = 0x01;
const IV_BYTES = 12;

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open falhou'));
  });
}

function idbReq(store, mode, fn) {
  return new Promise((resolve, reject) => {
    openDb().then((db) => {
      const tx = db.transaction(STORE, mode);
      const rq = fn(tx.objectStore(STORE));
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
      tx.oncomplete = () => db.close();
    }, reject);
  });
}

// Chave do aparelho: existe → retorna; não existe → gera (não-extraível) e guarda.
export async function getDeviceKey() {
  const existing = await idbReq(STORE, 'readonly', (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable:false — não dá para exportar o material
    ['encrypt', 'decrypt'],
  );
  await idbReq(STORE, 'readwrite', (s) => s.put(key, KEY_ID));
  return key;
}

// Apaga a chave do aparelho (rotação / "esquecer"). Próximo getDeviceKey gera nova.
export async function deleteDeviceKey() {
  try {
    await idbReq(STORE, 'readwrite', (s) => s.delete(KEY_ID));
  } catch {
    /* ausência/IndexedDB indisponível é inofensivo aqui */
  }
}

export async function encryptToken(token) {
  if (typeof token !== 'string' || !token) throw new Error('encryptToken: token deve ser string não-vazia');
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)),
  );
  const blob = new Uint8Array(1 + IV_BYTES + ct.length);
  blob[0] = BLOB_VERSION;
  blob.set(iv, 1);
  blob.set(ct, 1 + IV_BYTES);
  return bytesToBase64(blob);
}

export async function decryptToken(blobB64) {
  const bytes = base64ToBytes(blobB64);
  if (bytes[0] !== BLOB_VERSION) throw new Error('decryptToken: versão de blob desconhecida');
  const key = await getDeviceKey();
  const iv = bytes.slice(1, 1 + IV_BYTES);
  const ct = bytes.slice(1 + IV_BYTES);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return dec.decode(pt);
}
