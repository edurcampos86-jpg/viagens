# ADR-004 — Carrossel de fotos no hero do plano (`heroGallery[]`)

## Status

`Accepted` — 2026-06-06

Relacionado: [ADR-001](./ADR-001-schema-canonico.md) (schema canônico). Feature: carrossel de fotos no hero da página de plano.

---

## Contexto

O hero da página de plano ([`#planHero`](../index.html)) é renderizado por
`hydratePlanPage()` em [`assets/app.js`](../assets/app.js) (app legado — **não**
em `src/main.js`, que é só a camada v2 de editor/agentes). O fundo do hero
mostra hoje **uma** imagem (`trip.photo`) ou, na ausência dela, um gradiente
`linear-gradient(135deg, color, color2)`.

Já existem **três** representações de mídia no schema, e nenhuma serve para um
carrossel de hero com proveniência:

- `gallery` — **legado do sync.py**, array de **strings (URLs)**. `trip.gallery[0]`
  é lido direto como capa em vários pontos do `app.js` (`heroImageUrl`, cards).
  Redefinir como objetos quebraria esses call-sites.
- `media.gallery` — álbum estruturado (Fase 2) com lightbox próprio; itens
  `{type, src, thumb, caption, …}`, limite 30. É o álbum, não o hero.
- `fotos` — relato futuro `{url, legenda, data, destaque}`.

## Decisão

Novo campo **`heroGallery[]`**, **aditivo e opcional**, dedicado ao carrossel do
hero. Evita a colisão com `gallery` (string[]) e não mexe no álbum `media`.

1. **Schema** ([`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json)):
   `heroGallery` é array de objetos `{ url (obrigatório), source, attribution, alt }`,
   `additionalProperties: false`. Validado no CI via `validate_schemas.py` (que já
   roda `trips.json` contra `trip.schema.json`).

2. **Leitor tolerante** ([`src/core/schema.js`](../src/core/schema.js)):
   `getHeroGallery(trip)` descarta itens sem `url` válida, normaliza os campos
   opcionais para string e nunca lança. Registros legacy sem o campo → `[]`.
   `validateTrip()` ganha checagem leve (array + `url` por item).

3. **Render** (`hydratePlanPage` → `renderPlanHeroCarousel` em `assets/app.js`):
   - `heroGallery` com itens → carrossel: crossfade + Ken Burns + auto-advance 5s,
     pausa no hover, dots (quando >1 foto), etiqueta de proveniência no canto.
   - vazio/ausente → mantém o gradiente/foto única atual. **Backward-compatible.**

4. **Acessibilidade.** `prefers-reduced-motion: reduce` desliga zoom (Ken Burns) e
   auto-advance; cada slide é `role="img"` com `aria-label` = `alt`.

5. **Ciclo de vida.** O timer de auto-advance e os listeners de hover são
   removidos em `teardownPlanHeroCarousel()`, chamado ao re-hidratar e em
   `closePlanPage()` (sem interval vazado entre navegações).

## Consequências

| Item | Impacto |
| --- | --- |
| `gallery` (string[]) | Intacto. Nenhum call-site alterado. |
| `media.gallery` (álbum) | Intacto. Sistemas independentes. |
| Registros legacy | `getHeroGallery` → `[]` → gradiente atual. Zero migração. |
| Deploy | Toca `assets/*` → VERSION do `sw-workbox.js` bumpada (cache-bust). |
| Futuro | Quando `fotos`/`media` consolidarem mídia, `heroGallery` pode ser derivado deles e deprecado. |
