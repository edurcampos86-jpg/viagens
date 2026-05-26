// H1.5 — varredura genérica do overlay multi-ramo (Sprint SP-Junho 2026).
//
// O overlay localStorage `viagens-trip-state-v1` é multi-ramo: tem
// `_topLevel` (datas/POIs), `committed` (orçamento), `statusOverride`
// (promoção), e várias sub-seções locais que NÃO vão pro trips.json
// (checklist, packing, notes, comments, ...).
//
// O H1 (commit ec21eb8) cobriu só `_topLevel` no diff/sync. O H1.5
// estende pra `committed`. Em vez de cravar `committed` no diff, este
// módulo aceita uma lista `defs` de ramos rastreáveis — assim adicionar
// um ramo novo (ex: configurações de despachante) é só adicionar uma
// entrada em TRACKED_BRANCHES no app.js.
//
// Cada def descreve UM ramo do overlay e como ele mapeia para o trip
// canônico (data/trips.json):
//
//   {
//     branch: '_topLevel' | 'committed' | ...,
//     listFields(st)            → quais chaves desse ramo existem no overlay
//     canonicalGetter(trip, k)  → valor canônico do campo (trip[k] ou trip.budget.committed[k])
//     overrideGetter(st, k)     → valor override no overlay
//     applyToCanonical(out, k, v) → escreve o valor no objeto de saída
//                                   (trip canônico OU patch snippet)
//     clear(st)                 → remove o ramo do overlay
//   }
//
// IMPORTANTE: defs são DOM-free e schema-aware do app — devem viver no
// app.js. Esse módulo é só a engine de iteração, testável isoladamente.

/**
 * Compara overlay state contra trip canônica conforme as defs.
 * Retorna `{ items, snippet }`:
 *   - items: [{ branch, field, path: 'branch.field', original, override }]
 *   - snippet: objeto JSON minimal aplicável ao trip canônico (null se vazio)
 */
export function computeTrackedEdits(trip, st, defs) {
  const out = { items: [], snippet: null };
  if (!trip || !st || !Array.isArray(defs)) return out;
  const draft = { id: trip.id };
  for (const def of defs) {
    if (!def || typeof def.listFields !== 'function') continue;
    const fields = def.listFields(st) || [];
    for (const field of fields) {
      const original = def.canonicalGetter ? def.canonicalGetter(trip, field) : undefined;
      const override = def.overrideGetter ? def.overrideGetter(st, field) : undefined;
      if (JSON.stringify(original) === JSON.stringify(override)) continue;
      out.items.push({
        branch: def.branch,
        field,
        path: `${def.branch}.${field}`,
        original,
        override,
      });
      if (typeof def.applyToCanonical === 'function') {
        def.applyToCanonical(draft, field, override);
      }
    }
  }
  if (out.items.length) out.snippet = draft;
  return out;
}

/**
 * Aplica todos os overrides rastreados de `st` direto no objeto `target`
 * (in-place). Usado por downloadTripsJson pra montar o trips.json final.
 */
export function applyTrackedEdits(target, st, defs) {
  if (!target || !st || !Array.isArray(defs)) return target;
  for (const def of defs) {
    if (!def || typeof def.listFields !== 'function') continue;
    for (const field of def.listFields(st)) {
      const override = def.overrideGetter ? def.overrideGetter(st, field) : undefined;
      if (override === undefined) continue;
      if (typeof def.applyToCanonical === 'function') {
        def.applyToCanonical(target, field, override);
      }
    }
  }
  return target;
}

/**
 * Remove todos os ramos rastreados de `st` in-place. Usado por
 * clearAllEdits. Não toca em sub-seções NÃO rastreadas (checklist,
 * packing, notes, ...) — preserva as edições de runtime intencionalmente
 * locais.
 */
export function clearTrackedBranches(st, defs) {
  if (!st || !Array.isArray(defs)) return st;
  for (const def of defs) {
    if (def && typeof def.clear === 'function') def.clear(st);
  }
  return st;
}
