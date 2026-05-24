# SCHEMA_V2 — Schema canônico de `data/trips.json`

> Última atualização: **2026-05-24** (ADR-001 Fase 4, PR #55)
> Fonte autoritativa: [`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json) — este doc é a leitura humana dele.

---

## 1. TL;DR

`data/trips.json` é um arquivo único contendo todas as 52+ viagens do Eduardo Campos.
Cada viagem é um objeto com identificação, geolocalização, status, e a estrutura canônica
`bookings.{flights, stays, experiences}` (reservas estruturadas) — implementada na sequência ADR-001
(PRs #52 a #55). Campos legacy (`air`, `hospedagem`, `logistics`, `nts`) ainda existem para
compatibilidade com `assets/app.js`, mas são deprecated.

**O *porquê* dessa escolha está em [`ADR-001-schema-canonico.md`](ADR-001-schema-canonico.md).**
Este documento explica o ***como usar*** o schema: campos, enums, fórmula de urgência, exemplos reais.

---

## 2. Estrutura geral de uma viagem

```
trip
├── id, name, sub, flag, emoji
├── status                       (enum: done | planned | em_planejamento | wishlist | draft)
├── continent, country
├── year, month, label           (período aproximado — legado)
├── startDate, endDate           (período exato — opcional, ISO date)
├── lat, lon, col                (geolocalização + cor do marcador)
├── highlights[], memory         (narrativa curta + texto)
│
├── bookings                     <== CANÔNICO (ADR-001)
│   ├── flights[]                (voos, trens, ônibus long-haul)
│   ├── stays[]                  (hotéis, Airbnb, pousadas, hostels)
│   └── experiences[]            (ingressos, tours, eventos)
│
├── checklist[]                  (preparação: visto, vacinas, etc)
├── decisoes_pendentes[]         (dilemas a resolver pré-viagem)
├── documentos_necessarios[]     (passaporte/visto/vacina/seguro)
├── tags[], pax, type
│
├── media                        (galeria — Fase 2 álbum dinâmico)
│   ├── cover
│   ├── gallery[]                (max 30 itens, image|video)
│   └── stats { photos, videos }
│
├── created_at, updated_at, _schema
│
└── [campos legacy deprecated — preservados para compat com assets/app.js]
    ├── air                      (string narrativa de voos, ex: 'GRU para IGU')
    ├── hospedagem[]             (migra para bookings.stays)
    ├── transporte[]             (migra para bookings.flights/experiences)
    ├── orcamento                (migra para soma de bookings[*].valor)
    ├── nts                      (número de noites — legado)
    └── logistics { hotels[], restaurants[], tips }
```

Campos marcados `deprecated` no JSON Schema (Fase 2, PR #53) mas tolerados em runtime por
`additionalProperties: true`. Limpeza completa só vem depois de aposentar `assets/app.js` legacy.

---

## 3. Schema do objeto `booking`

Cada item em `bookings.flights[]`, `bookings.stays[]` e `bookings.experiences[]`
segue a definição `$defs/booking` declarada em [`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json).

| Campo | Tipo | Obrigatório? | Descrição | Exemplo |
|---|---|---|---|---|
| `id` | string | não | ID interno opcional (ex: para deduplicar com inbox do Gmail) | `"iguacu-2021-fl-001"` |
| `titulo` | string | **sim** | Texto curto que identifica a reserva | `"TAP TP-066 GRU-LIS"` |
| `status` | enum | **sim** | Estado da reserva (ver Seção 4.1) | `"confirmado"` |
| `data` | string (ISO date) | não | Data principal do evento (check-in, voo, ingresso) | `"2026-07-14"` |
| `dataLimite` | string (ISO date) | não | Quando o booking expira (hold de hotel, prazo de visto) | `"2026-06-30"` |
| `valor` | number ≥ 0 | não | Valor monetário pago/orçado; soma em `budget.actual` | `4890.0` |
| `moeda` | enum | não | Código ISO (ver Seção 4.3) | `"BRL"` (default) |
| `localizador` | string \| null | não | PNR, código de reserva, número de pedido | `"ABC123"` |
| `link` | string (URI) \| null | não | URL no site da operadora | `"https://booking.com/..."` |
| `criticidade` | enum | não | Importância (ver Seção 4.2) | `"alta"` |
| `confirmada` | boolean | não | Atalho legacy para `status=confirmado` | `true` |
| `notas` | string | não | Observações livres | `"Migrado de trip.hospedagem..."` |

**`additionalProperties: true`** no `$defs/booking` — campos extras são tolerados, mas evite criar campos não-documentados sem antes atualizar este doc.

---

## 4. Enums e vocabulário controlado

### 4.1 `status`

| Valor | Descrição | Quando usar |
|---|---|---|
| `pendente` | Reserva ainda não foi feita | Default para bookings derivados de viagens `planned` |
| `em_andamento` | Reserva iniciada mas não finalizada | Hold de hotel ativo, fila de seleção, etc |
| `confirmado` | Reserva paga ou confirmada com localizador | Default para bookings derivados de viagens `done` |
| `cancelado` | Reserva cancelada (registro histórico) | Manter para auditoria/contabilidade |
| `na` | Não-aplicável | Booking criado mas não pertinente (raro) |

Alimenta `peso_pendencia` da fórmula de urgência (Seção 5).

### 4.2 `criticidade`

| Valor | Descrição | Default por tipo de booking |
|---|---|---|
| `alta` | Falha cancela a viagem | **`flights`** — perder voo costuma cancelar tudo |
| `media` | Falha causa fricção significativa, mas viável substituir | **`stays`** — hotel pode ser trocado até D-7 |
| `baixa` | Falha causa inconveniência menor | **`experiences`** — vários substituíveis em destino |

Defaults aplicados pela migração da Fase 3 (PR #54). Itens podem ser bumpados manualmente
(ex: ingresso premium do Tomorrowland pode ser elevado para `criticidade: alta`).

Alimenta `peso_criticidade` da fórmula de urgência.

### 4.3 `moeda`

Códigos ISO-4217 aceitos (default `BRL`):

`BRL` · `USD` · `EUR` · `GBP` · `JPY` · `CHF` · `AUD` · `CAD` · `NZD` · `ZAR`

Para moedas fora dessa lista, ampliar o enum em `$defs/booking.moeda` no schema (requer PR + validação).

### 4.4 O que vai em cada array de `bookings`

| Array | Conteúdo | Exemplos |
|---|---|---|
| `bookings.flights[]` | Passagens aéreas, trens long-haul, ônibus interurbano | TAP GRU-LIS, Eurostar London-Paris, RodoNorte SP-FLN |
| `bookings.stays[]` | Hospedagens com check-in/check-out | Hotel das Cataratas, Aman Tokyo, Airbnb Bairro X |
| `bookings.experiences[]` | Ingressos, tours, jantares reservados, festivais | Tomorrowland 3-day pass, jantar Aman Tokyo, tour vinícola |

Decisão de classificação fica com o autor. Em caso de ambiguidade (ex: jantar incluído na diária do hotel), preferir registrar no `stays[*].notas` em vez de criar `experiences` duplicado.

---

## 5. Fórmula de urgência ponderada

Define quão urgente um booking é, alimentando o sorting do Cockpit (Sprint 2).

### 5.1 Especificação

```
urgencia(booking, hoje) = (1 / dias_ate_evento) x peso_criticidade x peso_pendencia

onde:
  dias_ate_evento = min(
      dias(hoje, viagem.start_date),
      dias(hoje, booking.dataLimite)  se dataLimite definido
  )
  ou infinito (zero urgência) se ambos estiverem vazios ou já passaram

  peso_criticidade = {
      "alta":  3,
      "media": 2,
      "baixa": 1
  }

  peso_pendencia = {
      "pendente":     1.0,
      "em_andamento": 0.5,
      "confirmado":   0,
      "cancelado":    0,
      "na":           0
  }
```

**Notas:**
- `viagem.start_date` deriva de `trip.startDate` (se presente), senão `trip.year`+`trip.month` no primeiro dia do mês
- `dias_ate_evento <= 0` → urgência = 0 (evento já passou)
- `dataLimite` permite priorizar holds que expiram antes da viagem
- `confirmado/cancelado/na` zeram urgência mesmo com prazo curto — feature, não bug

### 5.2 Exemplos numéricos

Considere **hoje = 2026-05-24** (data desta documentação).

**Caso 1 — Voo da Europa Tomorrowland 2026, ainda `pendente`**

- Trip: `europa-tomorrowland-2026` (year=2026, month=7) → `viagem.start_date` ≈ 2026-07-14
- `dias_ate_evento` = 14-jul-26 menos 24-mai-26 = **51 dias**
- `peso_criticidade` = 3 (booking em `flights`, default `alta`)
- `peso_pendencia` = 1.0 (`status=pendente`)
- `urgencia` = (1/51) x 3 x 1.0 ≈ **0.0588**
- *Aparece no cockpit com prioridade média-alta. Não é urgência crítica ainda, mas merece atenção.*

**Caso 2 — Hotel da Foz 2021 (já viajada, `confirmado`)**

- Trip: `iguacu-2021`, status `done`
- `booking.status` = `confirmado` → `peso_pendencia` = 0
- `urgencia` = qualquer x qualquer x 0 = **0**
- *Não aparece em cockpit de pendências. Já está no histórico.*

**Caso 3 — Viagem hipotética daqui a 7 dias, booking `pendente`, criticidade `media`**

- `dias_ate_evento` = **7 dias**
- `peso_criticidade` = 2 (`media`)
- `peso_pendencia` = 1.0 (`pendente`)
- `urgencia` = (1/7) x 2 x 1.0 ≈ **0.286**
- *Topo absoluto do cockpit. Urgência crítica — risco real de viagem fracassar se não fechar.*

**Caso 4 — Hold de hotel com `dataLimite` antes da viagem**

- Trip: viagem em 14-jul-26 (Europa Tomorrowland)
- Booking `stays`: hold de hotel em Bruxelas, `dataLimite: 2026-06-30` (expira em 30/jun)
- `dias(hoje, 14-jul)` = 51
- `dias(hoje, 30-jun)` = **37**
- `dias_ate_evento` = min(51, 37) = **37**
- `peso_criticidade` = 2 (`stays`, default `media`)
- `peso_pendencia` = 1.0 (`pendente`)
- `urgencia` = (1/37) x 2 x 1.0 ≈ **0.0541**
- *Cockpit prioriza pelo prazo do hold (37 dias), não pelo da viagem (51 dias). Sem o `dataLimite`, urgência seria ≈ 0.0392 — menos prioritário.*

---

## 6. Exemplos completos (viagens reais migradas)

Os 3 JSONs abaixo foram extraídos de [`data/trips.json`](../data/trips.json) após a migração
da Fase 3 (PR #54, commit `5dceea0`).

### 6.1 — `done` com hotel populado

Viagem realizada em 2021. Migrada pela Fase 3: `air` virou `bookings.flights[0]`, `hospedagem[0].nome` virou `bookings.stays[0].titulo`. Campos legacy preservados.

```json
{
  "id": "iguacu-2021",
  "name": "Foz do Iguaçu",
  "sub": "Paraná · Brasil",
  "status": "done",
  "continent": "Americas",
  "country": "Brasil",
  "flag": "🇧🇷",
  "emoji": "🌊",
  "year": 2021,
  "month": 6,
  "label": "Jun 2021",
  "lat": -25.6953,
  "lon": -54.4367,
  "col": "#22c55e",
  "pax": "família",
  "air": "GRU→IGU",
  "nts": 4,
  "km": 1100,
  "type": "leisure",
  "highlights": [
    "Cataratas do Iguaçu",
    "Parque das Aves",
    "Lado argentino",
    "Usina de Itaipu"
  ],
  "memory": "A imensidão das cataratas deixa qualquer um sem palavras — água por todos os lados.",
  "logistics": {
    "hotels": [
      "Hotel das Cataratas"
    ],
    "restaurants": [
      "Restaurante Ipê",
      "Búfalo Branco"
    ],
    "tips": "Prefira visitar as cataratas cedo pela manhã para evitar multidões."
  },
  "hospedagem": [
    {
      "nome": "Hotel das Cataratas"
    }
  ],
  "bookings": {
    "flights": [
      {
        "id": "iguacu-2021-fl-001",
        "titulo": "GRU→IGU",
        "status": "confirmado",
        "criticidade": "alta",
        "confirmada": true,
        "notas": "Migrado retroativamente de trip.air via ADR-001 Fase 3. Viagem already done — confirmada=true assumida por contexto histórico."
      }
    ],
    "stays": [
      {
        "id": "iguacu-2021-st-001",
        "titulo": "Hotel das Cataratas",
        "status": "confirmado",
        "criticidade": "media",
        "confirmada": true,
        "notas": "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. Viagem already done — confirmada=true assumida por contexto histórico."
      }
    ],
    "experiences": []
  },
  "budget": {
    "planned": {},
    "actual": {},
    "currency": "BRL"
  },
  "checklist": [],
  "media": {
    "cover": "media/iguacu-2021/04.webp",
    "gallery": [
      {
        "type": "image",
        "src": "media/iguacu-2021/04.webp",
        "thumb": "media/iguacu-2021/04-thumb.webp",
        "caption": "Vista panorâmica das cataratas — calçadão do lado brasileiro",
        "width": 1440,
        "height": 1920
      },
      {
        "type": "image",
        "src": "media/iguacu-2021/02.webp",
        "thumb": "media/iguacu-2021/02-thumb.webp",
        "caption": "De braços abertos diante das cataratas",
        "width": 1440,
        "height": 1920
      },
      {
        "type": "image",
        "src": "media/iguacu-2021/01.webp",
        "thumb": "media/iguacu-2021/01-thumb.webp",
        "caption": "Pose espontânea no mirante das quedas",
        "width": 1440,
        "height": 1920
      },
      {
        "type": "image",
        "src": "media/iguacu-2021/03.webp",
        "thumb": "media/iguacu-2021/03-thumb.webp",
        "caption": "Garotada no mirante — energia das cataratas",
        "width": 1440,
        "height": 1920
      },
      {
        "type": "image",
        "src": "media/iguacu-2021/05.webp",
        "thumb": "media/iguacu-2021/05-thumb.webp",
        "caption": "Selfie com cataratas e arco-íris ao fundo",
        "width": 1920,
        "height": 1440
      },
      {
        "type": "video",
        "src": "media/iguacu-2021/video-02.mp4",
        "poster": "media/iguacu-2021/video-02-poster.webp",
        "caption": "Vista aérea das cataratas — voo de drone",
        "date": "2021-06-13",
        "duration": 10
      },
      {
        "type": "video",
        "src": "media/iguacu-2021/video-03.mp4",
        "poster": "media/iguacu-2021/video-03-poster.webp",
        "caption": "Panorâmica das quedas no lado brasileiro",
        "date": "2021-06-12"
      },
      {
        "type": "video",
        "src": "media/iguacu-2021/video-01.mp4",
        "poster": "media/iguacu-2021/video-01-poster.webp",
        "caption": "Salto vertical das cataratas",
        "date": "2021-06-26",
        "duration": 4
      },
      {
        "type": "video",
        "src": "media/iguacu-2021/video-04.mp4",
        "poster": "media/iguacu-2021/video-04-poster.webp",
        "caption": "Clipe rápido do passeio",
        "date": "2021-06-26",
        "duration": 3
      }
    ],
    "stats": {
      "photos": 5,
      "videos": 4
    }
  },
  "created_at": "2021-06-01T00:00:00Z",
  "updated_at": "2026-05-22T00:00:00Z",
  "_schema": 2
}
```

### 6.2 — `planned` com flight (sem hotel ainda)

Viagem em planejamento. Bookings derivados receberam `status: pendente` e `confirmada: false` (revisão manual pendente). Sem hospedagem definida → `stays[]` vazio.

```json
{
  "id": "sp-junho-2026",
  "name": "São Paulo — Só Track Boa + Pride",
  "sub": "São Paulo · SP",
  "status": "planned",
  "continent": "Americas",
  "country": "Brasil",
  "flag": "🇧🇷",
  "emoji": "🎵",
  "year": 2026,
  "month": 6,
  "label": "Jun 2026",
  "startDate": "2026-06-13",
  "endDate": "2026-06-22",
  "lat": -23.5505,
  "lon": -46.6333,
  "col": "#a855f7",
  "pax": "amigos",
  "air": "FLN→GRU (TAM)",
  "nts": 8,
  "km": 860,
  "type": "festival",
  "highlights": [
    "Só Track Boa 13/06",
    "Pride SP 22/06",
    "Vida noturna paulistana"
  ],
  "memory": "",
  "logistics": {
    "hotels": [],
    "restaurants": [],
    "tips": "Passagem já comprada pela TAM. Falta hotel."
  },
  "bookings": {
    "flights": [
      {
        "id": "sp-junho-2026-fl-001",
        "titulo": "FLN→GRU (TAM)",
        "status": "pendente",
        "criticidade": "alta",
        "confirmada": false,
        "notas": "Migrado retroativamente de trip.air via ADR-001 Fase 3. Status=pendente até revisão manual de reservas reais."
      }
    ],
    "stays": [],
    "experiences": []
  },
  "budget": {
    "planned": {},
    "actual": {},
    "currency": "BRL"
  },
  "checklist": [],
  "created_at": "2026-06-01T00:00:00Z",
  "updated_at": "2026-05-19T01:30:18Z",
  "_schema": 2
}
```

### 6.3 — `wishlist` (sem bookings)

Sonho de viagem sem data firme. Por regra do ADR-001 (Decisão 2), wishlist é **pulada** pela migração — `bookings.{flights,stays,experiences}` ficam vazios. Container existe apenas porque já vinha da migração V1 para V2 inicial.

```json
{
  "id": "noruega-2027",
  "name": "Noruega — Fiordos",
  "sub": "Bergen · Flåm · Noruega",
  "status": "wishlist",
  "continent": "Europe",
  "country": "Norway",
  "flag": "🇳🇴",
  "emoji": "🌌",
  "year": 2027,
  "month": 9,
  "label": "Set 2027",
  "startDate": "2027-09-05",
  "endDate": "2027-09-14",
  "lat": 60.3913,
  "lon": 5.3221,
  "col": "#3b82f6",
  "pax": "casal",
  "air": "GRU→FRA→BGO",
  "nts": 9,
  "km": 11400,
  "type": "adventure",
  "highlights": [
    "Fiorde de Geiranger",
    "Aurora Boreal",
    "Trem Flamsbana"
  ],
  "memory": "",
  "logistics": {
    "hotels": [
      "Juvet Landscape Hotel"
    ],
    "restaurants": [],
    "tips": "Setembro oferece folhagem de outono e últimas chances de dias longos."
  },
  "hospedagem": [
    {
      "nome": "Juvet Landscape Hotel"
    }
  ],
  "bookings": {
    "flights": [],
    "stays": [],
    "experiences": []
  },
  "budget": {
    "planned": {},
    "actual": {},
    "currency": "BRL"
  },
  "checklist": [],
  "created_at": "2027-09-01T00:00:00Z",
  "updated_at": "2026-05-19T01:30:18Z",
  "_schema": 2
}
```

---

## 7. Como o Cockpit (Sprint 2) vai usar este schema

**Esta seção descreve intenção, não implementação.** O Cockpit é a Sprint 2 — ainda não foi construído.

- **Matriz cross-tab:** uma linha por viagem (filtrada por status ou janela temporal), 3 colunas (`flights`, `stays`, `experiences`)
- **Cor da célula:** derivada do `status` agregado dos bookings naquela categoria — todos `confirmado` = verde, qualquer `pendente` = amarelo, qualquer `cancelado` recente = vermelho, vazio = cinza
- **Sorting de linhas:** soma de `urgencia(b, hoje)` para todo `b` em cada viagem (linha), descendente — viagens com bookings mais urgentes no topo
- **Filtros propostos:**
  - Próximos 30 / 60 / 90 dias (`viagem.start_date - hoje`)
  - Tipo de pendência (só `flights`, só `stays`, mix)
  - Viagem confirmada vs em decisão (`decisoes_pendentes` não-vazio)
  - Por país, por continente, por companhia (`pax`)

**Pré-requisito implícito:** a Sprint 2 vai precisar popular manualmente alguns campos que
a migração da Fase 3 não preenche por design (`dataLimite`, `valor`, `localizador`,
`criticidade` quando diferente do default). Eduardo pode fazer isso via editor inline V2 ou
via parser de e-mail futuramente.

---

## 8. Validação automática

O schema é validado em CI a cada PR que toca `data/**.json`, `data/schemas/**.schema.json`,
ou os arquivos do próprio validador. Workflow: [`.github/workflows/validate-schemas.yml`](../.github/workflows/validate-schemas.yml).

**Comando local:**

```bash
py scripts/validate_schemas.py
```

Saída esperada:

```
Validando 3 arquivo(s) contra schemas em data/schemas/

OK   data/trips.json
OK   data/documentos.json
OK   data/preferencias.json

Tudo válido.
```

**Sobre `additionalProperties: true` no top-level do schema (`trip.schema.json:361`):**
permite que campos não-declarados convivam. É o que mantém os campos legacy (`air`,
`hospedagem`, `logistics`, `nts`, etc) sem rejeição pelo validador. Quando o legacy for
aposentado (ver entrada no [`BACKLOG.md`](BACKLOG.md)), essa flexibilidade pode ser apertada.

---

## 9. Mudanças desde V1

V1 do `trips.json` (até 2026-05-19) usava: `air` (string), `hospedagem[]` (objetos), `logistics.hotels[]` (strings),
`nts` (int), `year`/`month` para período aproximado, e `budget` flat. O schema V2 (sequência ADR-001,
PRs #52 a #55) introduziu:

- `bookings.{flights, stays, experiences}` como agregadora canônica de reservas
- `$defs/booking` com `status`, `criticidade`, `dataLimite` — campos que alimentam a fórmula de urgência
- Migração retroativa preservando 100% dos campos legacy

Lista completa de mudanças e justificativa em:

- [`CHANGELOG-V2.md`](../CHANGELOG-V2.md) — todas as features da V2 (Fases 1-4 do PRD inicial)
- [`ADR-001-schema-canonico.md`](ADR-001-schema-canonico.md) — por que `bookings.*` ganhou de `transporte/hospedagem` como nome canônico
- [`SPRINT1_FINDINGS.md`](../SPRINT1_FINDINGS.md) — auditoria que descobriu o drift entre 4 camadas

