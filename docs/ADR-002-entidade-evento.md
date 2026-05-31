# ADR-002 — Evento é entidade própria, não `bookings.experiences[]`

## Status

`Accepted` — 2026-05-31

---

## Contexto

A Sprint 3.0 introduz a necessidade de planejar **eventos ao nível-dia/hora** dentro de uma viagem: festival, festa, show, passeio, restaurante reservado, etc. O caso disparador é a viagem SP-junho/2026 com 4 eventos (Micareta + 2 dias de festival + Festa Black Pride) precisando de campos que hoje não cabem em lugar nenhum:

- **Local estruturado** (nome, endereço, bairro, lat/lng, google_place_id) — para abrir mapa, calcular Uber, comparar com hotel.
- **Preparação operacional** (dress code, bring list, notas como "energia para chegar do voo e ir direto").
- **Companhia** (quem vai junto — codinomes livres).
- **Prioridade pré-evento** (imperdivel/alta/media/baixa) — separada de criticidade-de-reserva.
- **Rating pessoal + reflexão pós-evento** (1-5 + texto livre).
- **Ingresso rico** (plataforma, código, lote/categoria, quantidade, valor unitário vs total, status do ciclo de vida incluindo `vendido` e `compartilhado_enviado`).
- **Vira_noite** (booleano com impacto operacional em descanso do dia seguinte).

O [ADR-001](ADR-001-schema-canonico.md) estabeleceu `bookings.{flights, stays, experiences}` como schema canônico para **reservas**. Mas `bookings.experiences[]` é deliberadamente leve (titulo, status, data, dataLimite, valor, moeda, criticidade, localizador, link, notas — ver `$defs/booking` em `trip.schema.json`). Estender essa definição para suportar local estruturado + preparação + rating quebraria a invariante "todo booking tem a mesma shape", que é o que viabiliza a fórmula de urgência do Cockpit (Sprint 2).

A decisão a tomar: estender `bookings.experiences[]` para virar evento-rico, **ou** criar entidade `Evento` paralela.

---

## Decisão

### 1. Evento é entidade própria

Schema novo: [`data/schemas/evento.schema.json`](../data/schemas/evento.schema.json), Draft 2020-12, com FK explícita `viagem_id` para `trip.id`.

**Justificativa, baseada na assimetria de campos:**

| Campo | `booking` (ADR-001) | `Evento` (ADR-002) |
|---|---|---|
| titulo, status, data, valor, moeda | ✅ | ✅ |
| dataLimite (urgência de fechamento) | ✅ | ❌ |
| criticidade (alta/media/baixa) | ✅ | via `prioridade` (4 níveis) |
| localizador (PNR/código) | ✅ top-level | ✅ nested em `ingresso.codigo_reserva` |
| tipo + subtipo (taxonomia rica) | ❌ | ✅ |
| local estruturado (lat/lng/place_id) | ❌ | ✅ |
| horario_inicio/fim, vira_noite | ❌ | ✅ |
| preparacao (dress code, bring list) | ❌ | ✅ |
| companhia (lista de codinomes) | ❌ | ✅ |
| rating_pessoal, reflexao_pos | ❌ | ✅ |
| fotos_ids, tags | ❌ | ✅ |

A intersecção é pequena (5 campos) e os campos novos não fazem sentido em flights/stays. Forçar tudo num shape único cria opcionalidade massiva (`type: ["string", "null"]` proliferando) e quebra a fórmula de urgência (que assume `dataLimite` opcional mas `criticidade` enum-3).

### 2. Relação Evento ↔ booking.experience

**Co-existência tolerada, sem migração automática.** Um evento pode (mas não precisa) corresponder a um `bookings.experiences[*]` na viagem-pai. Quando ambos existem:

- O `booking.experience` fica responsável pela parte de **reserva** (urgência de fechamento, valor agregado no orçamento via `computeActualFromBookings`).
- O `Evento` fica responsável pela parte de **vivência** (preparação, local físico, pós-vivência).

Linkagem opcional via convenção: se o Evento foi criado a partir de uma reserva, copia-se `localizador → ingresso.codigo_reserva`. Reconciliação automática fica para Sprint futura (não escopo desta).

### 3. `additionalProperties: false` no schema novo

Diferente de `trip.schema.json` (que usa `additionalProperties: true` na linha 386, causa do drift documentado no ADR-001), o `evento.schema.json` é **estrito desde o início**. Lição direta de Sprint 1: silenciar drift com tolerância é dívida cognitiva permanente.

### 4. PII bloqueado no top-level

Mesmo `not.anyOf` de `trip.schema.json` (banindo `cpf`, `passaporte_*`, `cartao*`, `cvv`, `codigo_reserva`, etc.). Códigos de reserva legítimos vivem nested em `ingresso.codigo_reserva`.

### 5. IDs em kebab-case sem prefixo

`evento.id` segue mesmo pattern de `trip.id` (`^[a-z0-9][a-z0-9-]*$`). Sem prefixo `ev_` ou `v_` — alinha com `data/trips.json` existente (52 viagens, todas sem prefixo). Reduz cognitive load: 1 convenção, 2 entidades.

---

## Consequências

| Item | Impacto |
|---|---|
| ✅ Eventos com semântica plena | Local, preparação, companhia, rating cabem sem distorção |
| ✅ Fórmula de urgência do Cockpit preservada | `bookings.*` continua com shape uniforme |
| ✅ Schema estrito desde o início | Não repete drift de `additionalProperties: true` |
| ✅ PII protegido | Mesmo `not.anyOf` de `trip.schema.json` |
| ⚠ Duplicação parcial Evento↔booking.experience | Reconciliação manual; resolver em Sprint futura quando volume justificar |
| ⚠ Sem migração automática nesta sprint | As 47 viagens populadas com `bookings.*` não ganham eventos retroativos — manual e por demanda |
| ⚠ Schema `eventos-file.schema.json` é só array | Sem wrapper `{config, eventos: [...]}` por enquanto. Promover quando arquivo virar fonte da verdade (Fase 3) |
| 🔵 Entrada nova no `BACKLOG.md` | "Fase 3: popular eventos retro nas viagens planned (SP-junho, SP-agosto, Brasília)" |

---

## Alternativas consideradas

### Alternativa A — Estender `bookings.experiences[]`

**Rejeitada.** Adicionar `local{}`, `preparacao{}`, `companhia[]`, `rating_pessoal`, `vira_noite` ao `$defs/booking` quebra a invariante de shape uniforme entre flights/stays/experiences. A fórmula de urgência do Cockpit (Sprint 2, definida em `docs/SCHEMA_V2.md` §5) assume essa uniformidade. Custo de reescrever a fórmula + os 25 testes de `tests/v2-modules.test.mjs` é alto; benefício é zero (continuariam sendo 2 conceitos com nomes diferentes no mesmo array).

### Alternativa B — Sub-tipo de booking via discriminator

Adicionar `$defs/booking_experience_rico` herdando de `$defs/booking` com campos extras. **Rejeitada** porque JSON Schema Draft 2020-12 não tem `discriminator` nativo (é extensão OpenAPI). Workaround com `oneOf` deixaria o schema do booking poluído com lógica condicional que o validador atual (`validate_schemas.py`) não trata bem.

### Alternativa C — Eventos como propriedade de trip (`trip.eventos[]`)

Aninhar `eventos[]` dentro de cada viagem, similar a `bookings.*`. **Rejeitada por escala futura.** A viagem SP-junho/2026 tem 4 eventos; uma viagem como "Maldivas 2027" (Réveillon) pode ter 20+. Inflar `trips.json` com isso volta ao problema de single-file gigante (já temos 47 viagens com bookings + media stats). Arquivo separado por viagem (`data/eventos/<viagem-id>.json` na Fase 3) escala melhor para edição manual via overlay e para diff humano em PR.

---

## Plano de execução

Modelo de 4 fases (mesma cadência do ADR-001):

1. **Fase 1+2 — ADR-002 + schema + exemplo** (este PR, Sprint 3.0) — ~1h
2. **Fase 3 — populá-lo de verdade** — criar `data/eventos/<viagem-id>.json` para as viagens `planned`/`em_planejamento` ativas (SP-junho/2026, SP-agosto/2026, Brasília/2026). Migrar `data/exemplos/eventos-sp-junho-2026.json` → `data/eventos/sp-junho-2026.json`. Manual, ~3h.
3. **Fase 4 — Documentação** — `docs/SCHEMA_EVENTOS.md` (referência prática + relação com bookings + fórmula de matching evento↔booking). ~1h.
4. **Fase 5 — Renderização** — card de eventos na plan-page com agrupamento por dia, integração com calendário FullCalendar existente. Sprint própria.

---

## Referências

- [ADR-001](ADR-001-schema-canonico.md) — Decisão sobre `bookings.{flights, stays, experiences}` (precedente)
- [`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json) — Schema da viagem-pai
- [`data/schemas/evento.schema.json`](../data/schemas/evento.schema.json) — Schema novo deste ADR
- [`data/exemplos/eventos-sp-junho-2026.json`](../data/exemplos/eventos-sp-junho-2026.json) — Fixture com 4 eventos validados
- [`scripts/validate_schemas.py`](../scripts/validate_schemas.py) — Validador CI (com entrada nova adicionada por este PR)
- [`docs/SCHEMA_V2.md`](SCHEMA_V2.md) §5 — Fórmula de urgência que motivou preservar shape uniforme de booking
