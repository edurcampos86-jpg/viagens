// Carga de eventos de uma viagem — Sprint 3A · Etapa 3a.
//
// Fonte canônica: data/eventos/<viagem-id>.json — array no formato de
// data/schemas/evento.schema.json, ligado à viagem por viagem_id (FK -> trip.id).
// Ver ADR-002 e eventos-file.schema.json ("futuro data/eventos/<viagem-id>.json").
// Viagem sem arquivo (404) ou conteúdo inválido => [] (o módulo eventos.js
// renderiza o estado vazio). Nunca lança — sempre resolve para um array.
//
// Uso:
//   import { loadEventos } from '../core/eventos-data.js';
//   const evs = await loadEventos(trip.id);
//
// Testabilidade: aceita `fetchImpl` injetável (Node sem rede usa um fake).

const cache = new Map();

export async function loadEventos(viagemId, opts = {}) {
  const { base = 'data/eventos', fetchImpl } = opts || {};
  if (!viagemId || typeof viagemId !== 'string') return [];

  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!doFetch) return [];

  if (cache.has(viagemId)) return cache.get(viagemId);

  let result = [];
  try {
    const res = await doFetch(`${base}/${encodeURIComponent(viagemId)}.json`, {
      cache: 'no-cache',
    });
    if (res && res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) result = data;
    }
  } catch {
    result = [];
  }
  cache.set(viagemId, result);
  return result;
}

// Limpa o cache (uso em testes; também útil após editar dados em runtime).
export function clearEventosCache() {
  cache.clear();
}
