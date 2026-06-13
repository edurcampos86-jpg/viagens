// Ciclo de vida do PAT do GitHub — esquema "lembrar neste aparelho".
//
// O PAT continua cifrado em repouso (AES-256-GCM), mas com uma chave de
// aparelho não-extraível guardada no IndexedDB (ver ./device-key.js) — SEM
// senha-mestra. No load, init() auto-decifra e mantém o token em memória.
//
// Fluxo:
//   1. boot:           init()         → auto-decifra o token (se configurado).
//   2. primeira vez:   setupPAT(token) → cifra e guarda; já fica desbloqueado.
//   3. uso:            getToken()      → token em memória ou null.
//   4. esquecer:       clear()         → apaga ciphertext + chave do aparelho.
//
// Assinaturas getToken()/isUnlocked()/isConfigured() preservadas: o trips-api
// e os componentes seguem chamando settings.getToken() sem mudança.

import { encryptToken, decryptToken, deleteDeviceKey } from './device-key.js';

const STORAGE_KEY = 'viagens.v3.pat'; // ciphertext (base64) do esquema novo
const META_KEY = 'viagens.v3.pat.meta';

// Chaves do esquema ANTIGO (cifrado por senha-mestra) — só para limpeza.
const LEGACY_KEYS = ['viagens.v2.pat', 'viagens.v2.pat.meta'];

let inMemoryToken = null;

export function isConfigured() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function isUnlocked() {
  return !!inMemoryToken;
}

export function getToken() {
  return inMemoryToken;
}

export function getMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || 'null');
  } catch {
    return null;
  }
}

// Chamado no boot. Auto-decifra o PAT com a chave do aparelho.
// Falha de decifra (chave do aparelho perdida / blob corrompido) ou presença
// apenas do blob ANTIGO por senha → trata como ausente: zera o blob quebrado
// e pede reconfigurar. Nunca lança (boot não pode quebrar).
export async function init() {
  const blob = localStorage.getItem(STORAGE_KEY);
  if (!blob) {
    inMemoryToken = null;
    return false;
  }
  try {
    inMemoryToken = await decryptToken(blob);
    return true;
  } catch {
    // ciphertext órfão (sem a chave do aparelho) — limpa para pedir reconfigurar.
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
    inMemoryToken = null;
    return false;
  }
}

// Cola o token → cifra com a chave do aparelho → guarda. Sem senha.
export async function setupPAT(token) {
  if (!token || typeof token !== 'string') throw new Error('PAT inválido');
  const blob = await encryptToken(token.trim());
  localStorage.setItem(STORAGE_KEY, blob);
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ created_at: new Date().toISOString(), version: 3 }),
  );
  inMemoryToken = token.trim();
}

// Só zera a sessão em memória (mantém o ciphertext). Útil para "travar" sem
// esquecer. Próximo init() re-decifra.
export function lock() {
  inMemoryToken = null;
}

// "Esquecer PAT deste aparelho": apaga ciphertext (novo + antigo) e rotaciona
// a chave do aparelho (deleteDeviceKey), invalidando qualquer blob remanescente.
export async function clear() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  inMemoryToken = null;
  await deleteDeviceKey();
}
