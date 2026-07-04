# PLANO — Bookings Vivos em todas as viagens

**Status:** `Proposto` — 2026-07-04 · aguarda decisões D1–D5 antes de qualquer código
**Origem:** PR #101 (voos TAP confirmados na `europa-tomorrowland-2026`)

---

## Contexto

O PR #101 gravou os voos da Tomorrowland no **formato canônico da ADR-001**
(`bookings.flights` + `budget.planned`), mas a página `#plan/<id>` (legacy,
`assets/app.js`) não exibiu nada, porque ela lê **outros campos**:

| Widget da página `#plan` | Campo que lê hoje | Campo canônico ignorado |
|---|---|---|
| Orçamento → linha "Voos" etc. | `budget.committed.{voos,hospedagem,passeios,comida}` + override localStorage | `budget.planned.*` |
| Orçamento → "Orçamento total" | `budget.total` ?? heurística `nts × R$1.000` | `budget.planned` (soma) |
| Aba 🎫 Reservas | `trip.air` + `logistics.hotels` + snapshot localStorage | `bookings.{flights,stays,experiences}` |
| Aba 💰 Custos (trips done) | `bookings[*].valor` ✅ (já lê) | — |
| Próxima ação | `bookings.flights[*]` confirmados ✅ (já lê) | — |

Este é o débito previsto na ADR-001 ("campos legacy deprecated mas tolerados
enquanto `assets/app.js` os consumir"). O objetivo do projeto é **pagar a
parte visível desse débito** e deixar o pipeline pronto para viagens novas.

## Objetivo

1. O que foi feito na Tomorrowland fica **visível** na UI para **todas** as
   viagens (a renderização é data-driven — corrigir os leitores ativa tudo).
2. As **próximas viagens programadas** ganham bookings reais no formato
   canônico (extraídos do Gmail, sem localizador — repo público).
3. **Viagens novas** já nascem plugadas: o editor v2 já cria o esqueleto
   canônico (`trip-editor.js:139-140`); falta o fluxo de ingestão recorrente.

## Inventário (recon 2026-07-04)

| Trip | Início | Flights (conf.) | Stays | `budget.planned` | Observação |
|---|---|---|---|---|---|
| sp-junho-2026 | 2026-06-04 | 2 (2) | 1 | vazio | ⚠️ `air` expõe localizador `UJWZTO` (repo público) |
| europa-tomorrowland-2026 | 2026-07-17 | 4 (4) | 0 | ✅ flights+voos | referência do formato (PR #101) |
| brasilia-2026 | 2026-08-07 | 1 (0) | 0 | vazio | placeholder `FLN→BSB` pendente |
| sanisland-2026 | 2026-10-09 | 0 | 0 | vazio | sem bookings |
| japao-2027 | 2027-02-08 | 1 (0) | 1 | vazio | placeholder `GRU→NRT→CTS` |
| marrocos-2027 | 2027-04-12 | 1 (0) | 1 | vazio | placeholder `GRU→LIS→RAK` |

## Frentes (1 PR por fase, recon→plan→execute→smoke)

### Frente 1 — UI legacy lê o canônico (ativa TODAS as viagens de uma vez)

- **F1a — Widget Orçamento** (`populateBudget`, `assets/app.js:~1955`):
  - Orçamento planejado por categoria ← `budget.planned.{flights,stays,experiences,food,other}`
    (numéricos), mapeados para os rótulos voos/hospedagem/passeios/comida.
    Heurística `nts × 1000` vira **fallback** quando `planned` está vazio.
  - "Comprometido" default ← soma de `bookings[*].valor` por categoria
    (D1), preservando override manual do localStorage por cima (comportamento atual).
- **F1b — Aba Reservas** (`populateReservations`, `assets/app.js:~1908`):
  - Lista `bookings.{flights,stays,experiences}` reais; `status confirmado`
    → "✓ Pago/Reservado"; fallback para o comportamento atual (`air`+`logistics`)
    quando a trip não tem bookings.
  - localStorage passa a guardar **só o override de status por booking-id**,
    não mais o snapshot da lista inteira (senão dados novos ficam congelados).
- **Invariantes:** só leitura de campos novos + fallback legacy (nenhuma trip
  quebra); **bump de SW obrigatório** (`assets/*` muda); funções puras extraídas
  e testadas onde couber; parse gate intocado.

### Frente 2 — Dados das viagens programadas

- **F2a — Higiene:** remover o localizador `UJWZTO` do campo `air` da
  sp-junho-2026 (D3). Já é público no histórico git, mas some da superfície.
- **F2b — Bookings reais:** para brasilia-2026, sanisland-2026, japao-2027 e
  marrocos-2027: extrair voos/hospedagens confirmados do Gmail (mesmo rito do
  PR #101 — Claude busca no Gmail conectado, Eduardo confirma, PR sem
  localizador/bilhete/FF) + `budget.planned` por viagem.
  1 PR por viagem ou 1 PR agrupado (D5).
- Depende de F1 mergeada para ter efeito visível (ou aceita-se ordem inversa — D5).

### Frente 3 — Pipeline para viagens novas

- **F3a — Skill `voos-gmail`** (espelho da skill `fotos-desktop`, PR #100):
  rito documentado + script auxiliar para "peguei um e-mail de confirmação →
  bookings canônicos → PR", com checklist anti-vazamento (sem localizador,
  bilhete, FF) e validação `validate_schemas.py`.
- **F3b — (opcional)** ligar o inbox existente (`src/components/inbox.js`,
  Curador de E-mail F2.4 via Supabase) como caminho alternativo — avaliar se
  vale reativar ou se a skill cobre (D4).

## Decisões pendentes (Eduardo)

- **D1 — Semântica de "Comprometido":** soma de `bookings[*].valor` (exige
  preencher `valor` por booking — a Tomorrowland hoje não tem) **ou** manter
  comprometido 100% manual e só ligar o **planejado** ao `planned.*`?
  *Recomendação: soma de `bookings[*].valor` com override manual.*
- **D2 — Chaves de categoria:** consolidar nas chaves v2
  (`flights/stays/experiences/food/other`) com rótulos PT na UI, e tratar
  `voos`-objeto (detalhamento) como metadado ignorado pelos somadores?
  *Recomendação: sim.*
- **D3 — Remover localizador do `air` da sp-junho-2026?** *Recomendação: sim, em F2a.*
- **D4 — Ingestão de novas viagens:** skill desktop (F3a) basta, ou reativar o
  inbox/Supabase (F3b)? *Recomendação: começar pela skill; inbox fica adiado.*
- **D5 — Ordem:** F1 (UI) antes de F2 (dados)? *Recomendação: F1 primeiro —
  cada PR de dados já nasce visível e smoke-ável na tela.*

## Riscos & mitigação

- **localStorage congela dados antigos** (Reservas): migrar formato do
  snapshot → override por id, com fallback de leitura do formato velho.
- **SW precache:** `assets/app.js` está no precache — sem bump de versão o
  smoke em produção mente. Bump em todo PR da Frente 1.
- **Repo público:** checklist anti-vazamento em todo PR de dados (grep por
  localizador/bilhete/FF antes do commit — rito do PR #101).

## Smoke por fase

Produção (`vidacarreira.com.br/#plan/<id>`) após deploy: orçamento mostra
planejado/comprometido reais; aba Reservas lista os voos TAP da Tomorrowland;
trips sem bookings continuam idênticas (fallback).
