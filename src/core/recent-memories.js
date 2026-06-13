// Seletor PURO (sem DOM, sem fetch) das memórias mais recentes para o Herói da
// home (Frente B). Varre `trip.media.gallery` de TODAS as viagens (independe de
// status), coleta só as memórias DURÁVEIS (memory_photo / memory_video),
// achata num feed único enriquecido com a viagem de origem, ordena por data
// desc e devolve as N mais recentes.
//
// Vazio → [] — é o sinal de fallback: o herói some e a home cai no card legado.
//
// Datas: prefere `item.date` (YYYY-MM-DD); quando o item não traz data própria,
// cai na data da viagem (getDates), para memórias antigas nunca afundarem sem
// referência. Itens sem nenhuma data vão para o fim.

import { getDates } from './schema.js';

// Só o que é "memória durável" entra no herói (não image/video local nem
// video_link de href morto). Espelha o contrato da Fase 1.
const MEMORY_TYPES = new Set(['memory_photo', 'memory_video']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function effectiveDate(item, trip) {
  if (ISO_DATE.test(String(item?.date || ''))) return item.date;
  return getDates(trip).start || '';
}

export function getRecentMemories(trips, n = 6) {
  if (!Array.isArray(trips)) return [];
  const count = Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;

  const feed = [];
  for (const trip of trips) {
    const gallery = trip?.media?.gallery;
    if (!Array.isArray(gallery)) continue;
    for (const item of gallery) {
      if (!item || !MEMORY_TYPES.has(item.type)) continue;
      if (!item.src && !item.poster && !item.thumb) continue; // nada renderizável
      feed.push({
        type: item.type,
        src: item.src || '',
        poster: item.poster || item.thumb || '',
        thumb: item.thumb || item.poster || '',
        caption: item.caption || '',
        accent: item.accent || '',
        aspect: item.aspect || '',
        duration: item.duration,
        date: effectiveDate(item, trip),
        tripId: trip.id || '',
        tripName: trip.name || '',
        continent: trip.continent || '',
      });
    }
  }

  // Desc por data ISO (string compare funciona p/ YYYY-MM-DD); '' afunda.
  feed.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return feed.slice(0, count);
}
