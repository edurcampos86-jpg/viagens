# ADR-001 — Schema canônico = `bookings.{flights, stays, experiences}`

## Status

`Accepted` — 2026-05-24

---

## Contexto

Durante a auditoria T1 da Sprint 1 (PR #49), identificamos que **4 camadas do projeto descrevem o schema de reservas (`bookings`) de formas mutuamente inconsistentes**:

- **JSON Schema** ([`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json)) declara `transporte[]`, `hospedagem[]`, `documentos_necessarios[]`, `decisoes_pendentes[]` e `orcamento`. NÃO declara `bookings` no top-level.
- **V2 JS** (`src/core/schema.js`, `src/components/*`, `src/agents/*`) consome `bookings.{flights, stays, experiences}` em **30 referências** distribuídas em 6 arquivos.
- **Dados reais** (`data/trips.json`, 52 viagens) têm **ambos os formatos coexistindo**: 36 viagens com `hospedagem[]` populado (legacy) e 42 viagens com `bookings: {flights:[], stays:[], experiences:[]}` em **stubs vazios** criados pela migration V1→V2 mas nunca preenchidos.
- **PRD** (`docs/PRD-viagens-v2.md` §3.2) descreve `bookings.{flights, stays, experiences}` com PNRs e `source: gmail|manual` como aspiração não cumprida.

O drift é silenciado por `"additionalProperties": true` na linha 361 do JSON Schema — o validador permite o shape novo sem rejeitar, então o CI passa. Mas o silêncio não é resolução: ele normaliza a inconsistência e adia a decisão.

**Consequência operacional documentada (B-N11):** a função `computeActualFromBookings` em [`src/components/budget.js:64-72`](../src/components/budget.js) sempre retorna `{flights: 0, stays: 0, experiences: 0}` porque os arrays nunca foram populados. A feature "Orçamento vivo" anunciada no [`CHANGELOG-V2.md`](../CHANGELOG-V2.md) linha 95 como **"✅ Atualização orçamento auto > 80%"** está **silenciosamente quebrada em produção** desde 2026-05-19.

A decisão a tomar: qual dos formatos é canônico? Sem essa resposta, nem o T4 da Sprint 1 (documentar schema) nem o Cockpit da Sprint 2 (matriz cross-tab viagens × bookings) são viáveis.

---

## Decisão

### 1. Schema canônico = `bookings.{flights, stays, experiences}`

**Justificativa, baseada em evidência empírica do levantamento de dependências:**

- V2 JS já depende de `bookings.*` em **30 referências** em 6 arquivos: [`src/core/schema.js`](../src/core/schema.js) (6), [`src/core/dates.js`](../src/core/dates.js) (6), [`src/components/trip-editor.js`](../src/components/trip-editor.js) (6), [`src/components/budget.js`](../src/components/budget.js) (6), [`src/components/inbox.js`](../src/components/inbox.js) (5), [`src/components/benchmark.js`](../src/components/benchmark.js) (1).
- V2 JS tem **zero** referências de dados a `transporte` / `documentos_necessarios` / `decisoes_pendentes` / `orcamento` (top-level). As poucas menções em UI são strings em português (`"Reserve hospedagem"`, `"🏨 Editar hospedagem"`) — não acessam o campo de dado.
- A função tradutora [`getBookings(trip)`](../src/core/schema.js#L79) já isola consumidores V2 do schema legacy: lê `trip.bookings.flights/stays/experiences` quando V2, faz fallback para `trip.hospedagem[]` quando V1, sempre retorna a shape unificada `{flights, stays, experiences, source}`.
- Custo estimado de **manter 1A** (consolidar em `bookings`): ~3-4h focadas em schema + migração de dados.
- Custo estimado da alternativa **1B** (consolidar em `transporte`/`hospedagem`): ~8-12h, com reescrita de 30 referências em 6 arquivos V2 estáveis + reescrita dos 25 testes em [`tests/v2-modules.test.mjs`](../tests/v2-modules.test.mjs) + reescrita da Edge Function `backend/functions/price-monitor` + reescrita do `migrate_v1_to_v2.py` que viraria contraditório.

Os campos legacy (`hospedagem`, `transporte`, `air`, `nts`, `logistics.hotels`) ficam **deprecated mas tolerados** enquanto o [`assets/app.js`](../assets/app.js) legacy ainda os consumir (17 referências a `hospedagem` lá). Limpeza completa é trabalho futuro fora do escopo desta decisão — rastreado em entrada própria no BACKLOG.

### 2. Migração retroativa de dados existentes

Regras a serem implementadas pelo script da Fase 3 deste plano:

- `trip.hospedagem[]` → copiado para `trip.bookings.stays[]`, preservando nome e dados estruturados (`cidade`, `check_in`, `check_out`, `noites`, `tipo`, `confirmada`)
- `trip.air` (string descritiva) → vira `trip.bookings.flights[0].titulo`
- `trip.nts` → preservado intacto (já existe); pode também derivar `bookings.stays[].nights` quando há exatamente 1 stay
- Viagens com `status: "done"` → bookings derivados recebem `confirmada: true`
- Viagens com `status: "planned"` → bookings derivados recebem `confirmada: false` (revisão manual depois)
- Viagens com `status: "wishlist"` → permanecem sem bookings derivados
- **Campos legacy NÃO são removidos** do JSON. Coexistem com `bookings` para compatibilidade com `assets/app.js` legacy. A escolha entre os dois lados é problema do leitor (V2 lê bookings; legacy lê hospedagem; tradutor `getBookings()` reconcilia).

### 3. Campos novos `criticidade` e `dataLimite` em cada booking

Para viabilizar a fórmula de urgência ponderada que vai dirigir o sorting do Cockpit (Sprint 2):

- **`criticidade: "alta" | "media" | "baixa"`** — opcional, default por tipo de booking:
  - `flight` → `alta` (perder voo costuma cancelar viagem inteira)
  - `stay` → `media` (substituível com fricção média até D-7)
  - `experience` → `baixa` (alguns são substituíveis; ingressos premium podem ser bumpados manualmente para `alta`)
- **`dataLimite: ISO date string | null`** — opcional. Quando o booking expira ou precisa estar fechado **independente da data da viagem** (ex.: visto Schengen exige fechar 15 dias antes; certo ingresso só vende até X dias antes do evento). Quando null, urgência calcula só a partir da data da viagem.

Esses campos são adicionados ao JSON Schema na Fase 2 deste plano e populados manualmente pelo Eduardo (ou via Gmail parser quando aplicável) na Fase 3+.

### 4. Proveniência de geocoding `geo_source` — Frente B (B1)

Adendo posterior (Frente B — robustez do módulo Viagens). Motivado pelo bug `sanisland-2026` (festa em Praia do Forte classificada como Maldivas): o pipeline resolveu um nome de lugar para o país errado e **nada no registro indicava se país/coords vieram de geocoding automático ou de input humano**, então não havia como protegê-los.

- **`geo_source: "manual" | "nominatim"`** — opcional, ADITIVO. Espelha a convenção de `dates.computed_from`:
  - `manual` — país/`lat`/`lon` digitados à mão pelo Eduardo. **Não é sobrescrito por geocoding automático** (a UI respeita o input humano).
  - `nominatim` — resolvido pelo autocomplete Nominatim/OSM.
  - **Ausente** (registros legacy) = proveniência desconhecida; `getGeoSource()` retorna `source: "unknown"`. Backward-compatible: registros sem o campo continuam válidos.
- **Trava de confiança (B2):** a resolução Nominatim passa a ter viés de região (Brasil por padrão) e marca resultados duvidosos (baixa relevância, ambíguos ou fora da região) como **"⚠ confirmar"** em vez de auto-atribuir — exige confirmação manual. Objetivo: impedir a repetição do caso "San Island → Maldivas".

Leitor tolerante em [`src/core/schema.js`](../src/core/schema.js) (`getGeoSource`, validação de range lat/lon e enum), lógica pura em [`src/core/geo.js`](../src/core/geo.js) (`assessGeoTrust`, `rankByRegion`, `isValidLat/Lon`), UI em [`src/components/trip-editor.js`](../src/components/trip-editor.js). Declarado em [`trip.schema.json`](../data/schemas/trip.schema.json).

> **Débito relacionado (Frente B / B3 — só planejado):** o editor grava `dates.{start,end}` (v2) enquanto registros legacy usam `startDate/endDate` de topo, sem remover os legacy. A normalização `legacy ↔ dates.*` + reconciliação de proveniência será proposta como ADR próprio com migração reversível e dry-run. Não implementado aqui.

---

## Consequências

| Item | Impacto |
|---|---|
| ✅ Sprint 2 (Cockpit) viável | Bookings têm dados reais após Fase 3, matriz cross-tab cor-codificada funciona |
| ✅ Orçamento vivo desbloqueado | `computeActualFromBookings` passa a retornar valores reais quando `price_brl` for adicionado por booking |
| ✅ Fórmula de urgência computável | Campos `criticidade` e `dataLimite` passam a existir formalmente |
| ✅ V2 JS estável | Zero refactor em código que já funciona; tradutor `getBookings()` continua válido |
| ⚠ JSON Schema precisa ser atualizado | Declarar `bookings.*` formalmente (Fase 2) |
| ⚠ Migração de dados precisa rodar | Backup automático + dry-run + apply (Fase 3) |
| ⚠ Limpeza de campos legacy fica como débito | Removível só quando `assets/app.js` for refatorado/aposentado — rastreado no BACKLOG |
| ⚠ PRD precisa de nota de atualização | Apontando para `docs/SCHEMA_V2.md` como fonte da verdade (Fase 4) |
| 🔵 B-N11 marcado como pendente | "Orçamento vivo" será desbloqueado na Fase 3 quando bookings tiverem `price_brl` |

---

## Alternativas consideradas

### Alternativa A — Documentar drift exposto (3 sub-schemas convivendo)

**Rejeitada porque normaliza disfunção.** Documentar três versões "oficiais" do schema (`transporte`/`hospedagem` formal + `bookings.*` em código + `hospedagem` real nos dados) cria dívida cognitiva permanente. Quem chega busca "qual schema usar?" e fica sem resposta. Mantém o site num estado em que cada novo desenvolvedor precisa re-internalizar o drift.

### Alternativa B — Documentar aspiração como real (fingir que `bookings` está populado)

**Rejeitada por ser fabricação documental.** Escrever `SCHEMA_V2.md` assumindo que `bookings.flights[*].price_brl` tem dados é mentir sobre o estado atual. O Cockpit Sprint 2 seria construído sobre dado vazio, descoberto só em runtime. Custo de reverter cresceria à medida que código fosse adicionado sobre essa premissa falsa.

### Alternativa 1B — Consolidar para o schema antigo (`transporte`/`hospedagem`)

**Rejeitada com base em dados empíricos do levantamento de dependências:**

- Custo 3-4× maior que 1A (~8-12h vs ~3-4h)
- Reverter 30 referências em 6 arquivos V2 que já estão estáveis e testados
- Reescrever os 25 testes de [`tests/v2-modules.test.mjs`](../tests/v2-modules.test.mjs) que validam o shape `flights/stays/experiences`
- Reescrever a Edge Function [`backend/functions/price-monitor/index.ts`](../backend/functions/price-monitor/index.ts) que monitora `bookings.flights`
- O script [`scripts/migrate_v1_to_v2.py`](../scripts/migrate_v1_to_v2.py) viraria contraditório com seu próprio nome — teria que ser deletado ou reescrito invertendo o sentido da migração
- O PRD §3.2 inteiro teria que ser reescrito como recomeço, e o CHANGELOG-V2 inteiro precisaria de erratas

---

## Plano de execução

4 fases sequenciais, cada uma 1 PR:

1. **Fase 1 — ADR-001 + BACKLOG** (este PR) — só `.md`, ~30 min
2. **Fase 2 — Schema formal** — declarar `bookings.*` em `trip.schema.json`, ~45 min
3. **Fase 3 — Migração de dados** — popular `bookings.*` retroativamente, ~1h30min
4. **Fase 4 — Documentação SCHEMA_V2.md** — schema com dados reais, ~45 min

Ordem importa: Fase 3 depende de Fase 2. PRs serão referenciados por número quando abertos.

---

## Referências

- **PR #49** — Auditoria T1 que identificou o drift de schemas ([`SPRINT1_FINDINGS.md`](../SPRINT1_FINDINGS.md))
- **PR #51** — Hotfix do smoke test (acoplamento de versão do SW, relacionado mas independente)
- [`SPRINT1_FINDINGS.md`](../SPRINT1_FINDINGS.md) — seção Fase B, achados B-N1/B-N2/B-N11
- [`CHANGELOG-V2.md`](../CHANGELOG-V2.md) linha 95 — promessa "Atualização orçamento auto > 80%" (B-N11 = promessa não cumprida)
- [`data/schemas/trip.schema.json:361`](../data/schemas/trip.schema.json) — `additionalProperties: true` que silencia o drift
- [`src/core/schema.js:79`](../src/core/schema.js) — tradutor `getBookings()` que isola consumidores V2 do schema legacy
- [`src/components/budget.js:64-72`](../src/components/budget.js) — `computeActualFromBookings` que retorna zeros constantes (B-N11)
- [`docs/PRD-viagens-v2.md`](PRD-viagens-v2.md) §3.2 — schema aspiracional V2 (referência histórica)
