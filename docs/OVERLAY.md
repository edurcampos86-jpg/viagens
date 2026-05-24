# Overlay local — Sprint SP-Junho 2026

> Camada de edições do usuário sobre `data/trips.json`, vivendo só no
> localStorage. Implementado em [`src/core/overlay.js`](../src/core/overlay.js)
> e plugado em [`assets/app.js`](../assets/app.js) (legacy).

## Por quê

`data/trips.json` é a fonte canônica versionada no GitHub. Mas o usuário
edita coisas no browser (data da viagem, item da checklist, valor de
orçamento) e isso vivia silenciosamente no `localStorage` sob a chave
`viagens-trip-state-v1` — sem badge, sem export, sem nada que indicasse
"tem N edições aqui que não saíram desse Chrome".

Resultado: risco crítico de perda silenciosa quando o cache fosse
limpo, ou divergência indetectada entre o que aparece na UI vs o que
está no JSON público.

## Schema

Chave `localStorage`: **`viagens-trip-state-v1`** (mantida da versão pré-B5
pra preservar edições existentes).

```json
{
  "<trip-id>": {
    // sub-seções legadas (pre-B5, populate* lê via loadTripState):
    "checklist": { "<item-id>": true },
    "committed": { "<budget-key>": 1500 },
    "reservations": [...],
    "packing": { "<item-id>": true },
    "packingCustom": ["item manual"],
    "notes": "...",
    "comments": [{ "t": 1234567890, "text": "..." }],
    "inspirationLinks": [...],
    "statusOverride": "planned",

    // novo namespace top-level (B5):
    "_topLevel": {
      "startDate": "2026-06-14",
      "endDate":   "2026-06-23",
      "nts": 9,
      "highlights": [...],
      "pois": [...]     // reservado pra U4 (Fase 2)
    }
  }
}
```

### Por que `_topLevel`?

As sub-seções pré-existentes (`checklist`, `committed`, etc) são lidas
pelo legacy `loadTripState(id)` e aplicadas pelos `populate*` sob demanda.
Não queremos que campos top-level da trip (`startDate`, `nts`, etc) se
misturem com as sub-seções no merge — então isolamos no namespace
`_topLevel` que só `mergeOverlayIntoTrip` toca.

### `TOP_LEVEL_FIELDS`

Lista restrita de campos top-level que o overlay aceita. Adicionar
campo novo: incluir aqui + cobrir no diff/snippet.

```js
export const TOP_LEVEL_FIELDS = ['startDate', 'endDate', 'nts', 'highlights', 'pois'];
```

## API

```js
import * as overlay from '../src/core/overlay.js';

overlay.readOverlay(tripId);
//   → { checklist?, committed?, _topLevel?, ... }

overlay.writeOverlay(tripId, { _topLevel: { startDate: '2026-06-14' } });
//   merge profundo de _topLevel; substitui sub-seções por chave

overlay.clearOverlay(tripId);
//   remove tudo da trip

overlay.clearTopLevelOverlay(tripId);
//   remove só _topLevel, preserva sub-seções

overlay.listAllOverlays();
//   → { "<trip-id>": {...}, ... }

overlay.mergeOverlayIntoTrip(trip, overlay);
//   aplica APENAS _topLevel sobre a trip canônica; retorna nova ref

overlay.diffOverlayVsTrip(trip, overlay);
//   → { hasChanges: bool, fields: [{ key, original, override }] }

overlay.buildPatchSnippet(tripId, overlay);
//   → { id: tripId, startDate, ..., ... }  pronto pra colar em trips.json
```

Também exposto em `window.viagensOverlay` pra inspeção no console.

## Fluxo de UI (plan-page)

1. `hydratePlanPage(trip)` chama `mergeOverlayIntoTrip(trip, readOverlay(trip.id))`
   antes de qualquer render. Os `render*` veem a versão merged.
2. `syncOverlayHeaderUI(trip, overlay)` mostra/esconde:
   - badge `#planOverlayFlag` (laranja, top-right do hero)
   - botão `data-pp-action="overlay-sync"` no header
   - botão `data-pp-action="overlay-export"` no header
3. Click no badge ou no botão "Sincronizar" abre `<dialog id="overlaySyncDialog">`
   com: lista de campos editados + snippet JSON pronto pra colar +
   how-to GitHub Web + descarte do `_topLevel`.

## Onde escreve

- **Editor de período (B1)** — [`openDateEditorPopover`](../assets/app.js)
  grava `{ _topLevel: { startDate, endDate, nts } }`.
- **Sub-seções legadas** — continuam usando `saveTripState(id, patch)` direto
  (sem passar por `overlay.writeOverlay`).

## Próximos passos

- **U4 (Fase 2)** vai usar `_topLevel.pois[]` pra POIs no mapa.
- **F5 (Fase 3)** vai persistir ordem do checklist via overlay (provável
  expansão pra `_topLevel.checklistOrder` ou novo namespace).
- A entrada existente do BACKLOG [Auto-sync seguro](BACKLOG.md) eventualmente
  pode consumir esse overlay como input do PR automático ao trips.json.
