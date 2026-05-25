// Overlay local de edições — B5 (Sprint SP-Junho 2026).
//
// Camada acima do storage existente `viagens-trip-state-v1` (LS_KEY).
// O storage já guardava patches por SUB-SEÇÃO (checklist, committed,
// reservations, packing, notes, comments, ...) — esse módulo:
//
//   1. Adiciona suporte a edições TOP-LEVEL da trip (startDate, endDate,
//      nts, highlights, ...) num namespace `_topLevel` dentro do patch.
//   2. Expõe API explícita (read/write/list/clear) e merge sobre a trip
//      canônica para `hydratePlanPage` em assets/app.js consumir.
//   3. Calcula diff legível para a UI de sincronização mostrar.
//
// Storage:
//   {
//     "sp-junho-2026": {
//       // sub-seções legadas (intactas, populate* segue lendo direto):
//       "checklist": { "flights": true },
//       "committed": { "stays": 6500 },
//       "reservations": [...],
//       // novo (B5):
//       "_topLevel": { "startDate": "2026-06-14", "endDate": "2026-06-23", "nts": 9 }
//     }
//   }
//
// Compatibilidade: chaves antigas continuam funcionando sem migração.

const LS_KEY = 'viagens-trip-state-v1';

// Campos que podem ser editados via overlay top-level. Mantido restrito
// pra evitar surpresas — adicione conforme necessário.
export const TOP_LEVEL_FIELDS = ['startDate', 'endDate', 'nts', 'highlights', 'pois'];

// Categorias de POI (U4). 'place' é o fallback genérico. A UI mapeia cada
// kind para um emoji/label; aqui só validamos contra esta lista.
export const POI_KINDS = ['place', 'hotel', 'restaurant', 'event', 'beach', 'viewpoint', 'transit'];

function loadAll() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveAll(all) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* quota/private mode */
  }
}

export function readOverlay(tripId) {
  if (!tripId) return {};
  const all = loadAll();
  return all[tripId] || {};
}

// Faz merge profundo do patch no overlay existente.
// Para `_topLevel`, faz merge raso (campo-a-campo). Para sub-seções,
// substitui (mantém o contrato do saveTripState legado).
export function writeOverlay(tripId, patch) {
  if (!tripId || !patch) return;
  const all = loadAll();
  const current = all[tripId] || {};
  const next = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (k === '_topLevel' && v && typeof v === 'object') {
      next._topLevel = { ...(current._topLevel || {}), ...v };
    } else {
      next[k] = v;
    }
  }
  all[tripId] = next;
  saveAll(all);
}

export function listAllOverlays() {
  return loadAll();
}

export function clearOverlay(tripId) {
  if (!tripId) return;
  const all = loadAll();
  delete all[tripId];
  saveAll(all);
}

// Remove apenas as edições top-level, preservando as sub-seções
// (checklist, committed, reservations, ...) que o usuário pode ter
// editado via UI legada.
export function clearTopLevelOverlay(tripId) {
  if (!tripId) return;
  const all = loadAll();
  if (!all[tripId]) return;
  delete all[tripId]._topLevel;
  saveAll(all);
}

// Aplica APENAS os campos top-level do overlay sobre a trip canônica.
// As sub-seções (checklist/committed/...) continuam sendo aplicadas
// pelos populate* legados via loadTripState — não as duplicamos aqui.
export function mergeOverlayIntoTrip(trip, overlay) {
  if (!trip) return trip;
  const topLevel = overlay?._topLevel;
  if (!topLevel || typeof topLevel !== 'object') return trip;
  const merged = { ...trip };
  for (const field of TOP_LEVEL_FIELDS) {
    if (topLevel[field] !== undefined) {
      merged[field] = topLevel[field];
    }
  }
  return merged;
}

// Calcula diff legível entre a trip canônica e o overlay top-level.
// Retorna { hasChanges, fields: [{ key, original, override }] }.
// Útil pra UI de sync mostrar o que será gravado em trips.json.
export function diffOverlayVsTrip(trip, overlay) {
  const out = { hasChanges: false, fields: [] };
  if (!trip || !overlay?._topLevel) return out;
  for (const field of TOP_LEVEL_FIELDS) {
    const override = overlay._topLevel[field];
    if (override === undefined) continue;
    const original = trip[field];
    if (JSON.stringify(original) !== JSON.stringify(override)) {
      out.fields.push({ key: field, original, override });
      out.hasChanges = true;
    }
  }
  return out;
}

// U4 (Fase 2 — POIs no mapa): valida/normaliza um POI vindo da UI.
// Exige `name` não-vazio e coordenadas finitas dentro do range geográfico.
// `kind` cai para 'place' se ausente/desconhecido; `note` é opcional.
// Retorna o POI limpo ({ name, lat, lon, kind, note? }) ou `null` se
// inválido — quem chama decide o feedback.
export function normalizePoi(input) {
  if (!input || typeof input !== 'object') return null;
  const name = String(input.name ?? '').trim();
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!name) return null;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return null;
  const kind = POI_KINDS.includes(input.kind) ? input.kind : 'place';
  const poi = { name, lat, lon, kind };
  const note = String(input.note ?? '').trim();
  if (note) poi.note = note;
  return poi;
}

// Conveniência: serializa o overlay top-level de uma trip num snippet
// pronto pra colar em data/trips.json (objeto JSON dos campos editados).
export function buildPatchSnippet(tripId, overlay) {
  if (!overlay?._topLevel) return null;
  const out = {};
  for (const field of TOP_LEVEL_FIELDS) {
    if (overlay._topLevel[field] !== undefined) {
      out[field] = overlay._topLevel[field];
    }
  }
  return Object.keys(out).length ? { id: tripId, ...out } : null;
}
