// Gerencia ciclo de vida da chave Anthropic cifrada em localStorage + sessão em memória.
// Espelha o padrão de src/core/settings.js (que gerencia o PAT do GitHub).
//
// Fluxo:
//   1. Primeira vez: setupKey(apiKey, password) → guarda chave cifrada.
//   2. Cada sessão: unlock(password) → decifra e mantém em memória até reload.
//   3. getKey() → chave em memória ou null.
//   4. lock() / clear() → limpa.

import { encrypt, decrypt } from './crypto.js';

const STORAGE_KEY = 'viagens.v2.anthropic';
const META_KEY = 'viagens.v2.anthropic.meta';

let inMemoryKey = null;

export function isConfigured() {
  return !!localStorage.getItem(STORAGE_KEY);
}

export function isUnlocked() {
  return !!inMemoryKey;
}

export function getKey() {
  return inMemoryKey;
}

export function getMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || 'null');
  } catch {
    return null;
  }
}

export async function setupKey(apiKey, password) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('Chave Anthropic inválida');
  if (!apiKey.startsWith('sk-ant-')) {
    throw new Error('Formato inesperado — chaves Anthropic começam com "sk-ant-"');
  }
  if (!password || password.length < 8) {
    throw new Error('Senha mestra precisa ter ao menos 8 caracteres');
  }
  const blob = await encrypt(apiKey, password);
  localStorage.setItem(STORAGE_KEY, blob);
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ created_at: new Date().toISOString(), version: 1 })
  );
  inMemoryKey = apiKey;
}

export async function unlock(password) {
  const blob = localStorage.getItem(STORAGE_KEY);
  if (!blob) throw new Error('Chave Anthropic não configurada');
  const apiKey = await decrypt(blob, password);
  if (!apiKey.startsWith('sk-ant-')) {
    console.warn('[anthropic-key] chave decifrada não começa com sk-ant-');
  }
  inMemoryKey = apiKey;
  return true;
}

export function lock() {
  inMemoryKey = null;
}

export function clear() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(META_KEY);
  inMemoryKey = null;
}
