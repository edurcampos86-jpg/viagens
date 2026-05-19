// Cifragem AES-256-GCM com chave derivada via PBKDF2-SHA256.
// Web Crypto API nativo do navegador — zero dependências.
//
// Formato do blob retornado por encrypt(): base64( v | salt(16) | iv(12) | ct )
// onde v = 1 byte de versão (0x01).

const VERSION = 0x01;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 200_000; // acima do mínimo (100k) do PRD
const KEY_BITS = 256;

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

async function deriveKey(password, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PBKDF2_ITERATIONS,
    },
    baseKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(plaintext, password) {
  if (typeof plaintext !== 'string') throw new Error('encrypt: plaintext deve ser string');
  if (!password) throw new Error('encrypt: senha obrigatória');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  );
  const blob = new Uint8Array(1 + salt.length + iv.length + ct.length);
  blob[0] = VERSION;
  blob.set(salt, 1);
  blob.set(iv, 1 + salt.length);
  blob.set(ct, 1 + salt.length + iv.length);
  return bytesToBase64(blob);
}

export async function decrypt(blob, password) {
  if (!password) throw new Error('decrypt: senha obrigatória');
  const bytes = base64ToBytes(blob);
  if (bytes[0] !== VERSION) throw new Error('decrypt: versão de blob desconhecida');
  const salt = bytes.slice(1, 1 + SALT_BYTES);
  const iv = bytes.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES);
  const ct = bytes.slice(1 + SALT_BYTES + IV_BYTES);
  const key = await deriveKey(password, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  } catch {
    throw new Error('decrypt: senha incorreta ou blob corrompido');
  }
}
