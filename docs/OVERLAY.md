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
      "pois": [         // U4 (Fase 2) — pontos de interesse no mapa
        { "name": "Parque Ibirapuera", "lat": -23.587, "lon": -46.657, "kind": "viewpoint", "note": "opcional" }
      ]
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

### POIs (`_topLevel.pois[]`) — U4

Cada POI: `{ name, lat, lon, kind, note? }`. `kind` é validado contra
`POI_KINDS` (`overlay.js`) e cai para `'place'` se ausente/desconhecido;
`note` é opcional. Sempre passe input cru por `overlay.normalizePoi(input)`
antes de gravar — ela trima, valida coordenadas (lat ∈ [-90,90],
lon ∈ [-180,180]) e devolve `null` se inválido.

```js
export const POI_KINDS = ['place', 'hotel', 'restaurant', 'event', 'beach', 'viewpoint', 'transit'];
```

A UI legada (`assets/app.js`) mapeia cada kind para emoji/label em
`POI_KIND_META` (pin no mapa + lista). POIs entram no diff/snippet de sync
como qualquer outro campo top-level (são parte de `TOP_LEVEL_FIELDS`).

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

- ✅ **U4 (Fase 2)** — POIs no mapa: `_topLevel.pois[]` renderizados como
  pins por categoria no Leaflet; add via clique no mapa + popover, remoção
  pela lista; persiste no overlay e entra no snippet de sync.
- ✅ **F5 (Fase 3)** — checklist com reordenar (drag/teclado) + prazo por
  item. Decisão: ordem (`checklistOrder`) e prazos (`checklistDue`) persistem
  na **sub-seção legada via `saveTripState`** (junto dos checks, fora do
  snippet de sync do trips.json — são estado pessoal, não dado canônico).
  Lógica pura em [`src/core/checklist-order.js`](../src/core/checklist-order.js).
  > Nota: a ideia inicial era `_topLevel.checklistOrder` (sync ao trips.json),
  > mas optou-se pela sub-seção legada — ordem/prazos são estado pessoal.
- A entrada existente do BACKLOG [Auto-sync seguro](BACKLOG.md) eventualmente
  pode consumir esse overlay como input do PR automático ao trips.json.
