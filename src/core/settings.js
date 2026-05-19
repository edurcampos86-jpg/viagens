// Gerencia ciclo de vida do PAT cifrado em localStorage + sessão em memória.
//
// Fluxo:
//   1. Primeira vez: setupPAT(token, password) → guarda token cifrado.
//   2. Cada sessão: unlock(password) → decifra e mantém em memória até reload.
//   3. getToken() → token em memória ou null.
//   4. lock() / clear() → limpa.

import { encrypt, decrypt } from './crypto.js';

const STORAGE_KEY = 'viagens.v2.pat';
const META_KEY = 'viagens.v2.pat.meta';

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

export async function setupPAT(token, password) {
  if (!token || typeof token !== 'string') throw new Error('PAT inválido');
  if (!password || password.length < 8)
    throw new Error('Senha mestra precisa ter ao menos 8 caracteres');
  const blob = await encrypt(token, password);
  localStorage.setItem(STORAGE_KEY, blob);
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ created_at: new Date().toISOString(), version: 1 })
  );
  inMemoryToken = token;
}

export async function unlock(password) {
  const blob = localStorage.getItem(STORAGE_KEY);
  if (!blob) throw new Error('PAT não configurado — use setupPAT primeiro');
  const token = await decrypt(blob, password);
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    // Heurística leve — se o decrypt deu certo mas o resultado não parece PAT,
    // ainda confiamos no resultado (o usuário pode estar usando um token fine-grained
    // antigo). Só logamos um aviso.
    console.warn('[settings] token decifrado não começa com ghp_/github_pat_');
  }
  inMemoryToken = token;
  return true;
}

export function lock() {
  inMemoryToken = null;
}

export function clear() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  inMemoryToken = null;
}
