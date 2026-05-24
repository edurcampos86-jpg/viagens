# Migration Preview — ADR-001 Fase 3 (data → bookings)

> Documento temporário gerado pelo dry-run de `scripts/migrate_v2_data_to_bookings.py`.
> **Será apagado no Commit C** após `--apply` ser executado.
> Existe para revisão humana entre Commit B (dry-run) e Commit C (apply).

## Estatísticas

| Métrica | Esperado (plano) | Real (dry-run) | Status |
|---|---|---|---|
| Trips processadas | 52 | 52 | ✅ |
| Puladas wishlist | 4 | 4 | ✅ |
| Puladas draft | (não previsto, ajuste 1) | 1 | ✅ |
| Trips com flights derivados | ~38 | 39 | ✅ |
| Trips com stays derivados | ~33 | 35 | ✅ |
| Total flights criados | ~38 | 39 | ✅ |
| Total stays criados | ~33-50 | 46 | ✅ |
| Container adicionado 1ª vez | 10 | 8 | ⚠ -20% (ver nota) |

**Nota sobre desvio de container:** o plano esperava 10 trips sem container; real foi 8.
Diferença porque o cálculo de '10 trips sem bookings' incluía wishlist + draft, que
agora são puladas — não recebem container. Restam 8 trips que ganham container novo
(as 8 viagens recorrentes done sem `air` e sem `hospedagem` — natal-micareta, canoa-
quebrada, etc — ganham container vazio).

**Sobre 'Viagens com bookings populados = 47':** inclui 39 que de fato ganharam
flights/stays + 8 que só ganharam container vazio (recorrentes sem dados-fonte).

## Validação contra schema

```
=== Validando data/trips.v3.preview.json contra trips-file.schema.json ===
  OK: data/trips.v3.preview.json valida contra o schema
```

Schema usado: `data/schemas/trip.schema.json` na versão da Fase 2 (PR #53, commit 5efa492).

## 5 exemplos before/after

### `iguacu-2021` (status: `done`)

**Antes (campos relevantes):**
```json
{
  "id": "iguacu-2021",
  "status": "done",
  "air": "GRU→IGU",
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
    "flights": [],
    "stays": [],
    "experiences": []
  }
}
```

**Depois (campos relevantes):**
```json
{
  "id": "iguacu-2021",
  "status": "done",
  "air": "GRU→IGU",
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
  }
}
```

**Observações:**
- `status` do booking = `confirmado`, `confirmada=true` (contexto histórico)
- Campos legacy (`air`, `hospedagem`, `logistics`) preservados inalterados ✅

### `argentina-2021` (status: `done`)

**Antes (campos relevantes):**
```json
{
  "id": "argentina-2021",
  "status": "done",
  "air": "LATAM + Aerolíneas",
  "logistics": {
    "hotels": [
      "Palermo Soho Boutique Hotel",
      "Los Sauces (El Calafate)"
    ],
    "restaurants": [
      "Don Julio",
      "La Tablita"
    ],
    "tips": "Use pesos em dinheiro — o câmbio paralelo ('blue') oferece valor muito melhor."
  },
  "hospedagem": [
    {
      "nome": "Palermo Soho Boutique Hotel"
    },
    {
      "nome": "Los Sauces (El Calafate)"
    }
  ],
  "bookings": {
    "flights": [],
    "stays": [],
    "experiences": []
  }
}
```

**Depois (campos relevantes):**
```json
{
  "id": "argentina-2021",
  "status": "done",
  "air": "LATAM + Aerolíneas",
  "logistics": {
    "hotels": [
      "Palermo Soho Boutique Hotel",
      "Los Sauces (El Calafate)"
    ],
    "restaurants": [
      "Don Julio",
      "La Tablita"
    ],
    "tips": "Use pesos em dinheiro — o câmbio paralelo ('blue') oferece valor muito melhor."
  },
  "hospedagem": [
    {
      "nome": "Palermo Soho Boutique Hotel"
    },
    {
      "nome": "Los Sauces (El Calafate)"
    }
  ],
  "bookings": {
    "flights": [
      {
        "id": "argentina-2021-fl-001",
        "titulo": "LATAM + Aerolíneas",
        "status": "confirmado",
        "criticidade": "alta",
        "confirmada": true,
        "notas": "Migrado retroativamente de trip.air via ADR-001 Fase 3. Viagem already done — confirmada=true assumida por contexto histórico."
      }
    ],
    "stays": [
      {
        "id": "argentina-2021-st-001",
        "titulo": "Palermo Soho Boutique Hotel",
        "status": "confirmado",
        "criticidade": "media",
        "confirmada": true,
        "notas": "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. Viagem already done — confirmada=true assumida por contexto histórico."
      },
      {
        "id": "argentina-2021-st-002",
        "titulo": "Los Sauces (El Calafate)",
        "status": "confirmado",
        "criticidade": "media",
        "confirmada": true,
        "notas": "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. Viagem already done — confirmada=true assumida por contexto histórico."
      }
    ],
    "experiences": []
  }
}
```

**Observações:**
- `status` do booking = `confirmado`, `confirmada=true` (contexto histórico)
- Campos legacy (`air`, `hospedagem`, `logistics`) preservados inalterados ✅

### `sp-junho-2026` (status: `planned`)

**Antes (campos relevantes):**
```json
{
  "id": "sp-junho-2026",
  "status": "planned",
  "air": "FLN→GRU (TAM)",
  "logistics": {
    "hotels": [],
    "restaurants": [],
    "tips": "Passagem já comprada pela TAM. Falta hotel."
  },
  "bookings": {
    "flights": [],
    "stays": [],
    "experiences": []
  }
}
```

**Depois (campos relevantes):**
```json
{
  "id": "sp-junho-2026",
  "status": "planned",
  "air": "FLN→GRU (TAM)",
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
  }
}
```

**Observações:**
- `status` do booking = `pendente`, `confirmada=false` (revisão manual pendente)
- Campos legacy (`air`, `hospedagem`, `logistics`) preservados inalterados ✅

### `japao-2027` (status: `planned`)

**Antes (campos relevantes):**
```json
{
  "id": "japao-2027",
  "status": "planned",
  "air": "GRU→NRT→CTS",
  "logistics": {
    "hotels": [
      "Park Hyatt Niseko Hanazono"
    ],
    "restaurants": [],
    "tips": "Fevereiro é o melhor mês para neve em Niseko. Reserve o Hotel com antecedência."
  },
  "hospedagem": [
    {
      "nome": "Park Hyatt Niseko Hanazono"
    }
  ],
  "bookings": {
    "flights": [],
    "stays": [],
    "experiences": []
  }
}
```

**Depois (campos relevantes):**
```json
{
  "id": "japao-2027",
  "status": "planned",
  "air": "GRU→NRT→CTS",
  "logistics": {
    "hotels": [
      "Park Hyatt Niseko Hanazono"
    ],
    "restaurants": [],
    "tips": "Fevereiro é o melhor mês para neve em Niseko. Reserve o Hotel com antecedência."
  },
  "hospedagem": [
    {
      "nome": "Park Hyatt Niseko Hanazono"
    }
  ],
  "bookings": {
    "flights": [
      {
        "id": "japao-2027-fl-001",
        "titulo": "GRU→NRT→CTS",
        "status": "pendente",
        "criticidade": "alta",
        "confirmada": false,
        "notas": "Migrado retroativamente de trip.air via ADR-001 Fase 3. Status=pendente até revisão manual de reservas reais."
      }
    ],
    "stays": [
      {
        "id": "japao-2027-st-001",
        "titulo": "Park Hyatt Niseko Hanazono",
        "status": "pendente",
        "criticidade": "media",
        "confirmada": false,
        "notas": "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. Status=pendente até revisão manual de reservas reais."
      }
    ],
    "experiences": []
  }
}
```

**Observações:**
- `status` do booking = `pendente`, `confirmada=false` (revisão manual pendente)
- Campos legacy (`air`, `hospedagem`, `logistics`) preservados inalterados ✅

### `natal-micareta` (status: `done`)

**Antes (campos relevantes):**
```json
{
  "id": "natal-micareta",
  "status": "done"
}
```

**Depois (campos relevantes):**
```json
{
  "id": "natal-micareta",
  "status": "done",
  "bookings": {
    "flights": [],
    "stays": [],
    "experiences": []
  }
}
```

**Observações:**
- `status` do booking = `confirmado`, `confirmada=true` (contexto histórico)
- Campos legacy (`air`, `hospedagem`, `logistics`) preservados inalterados ✅
- Container vazio: sem `air` e sem `hospedagem` na fonte (caso recorrentes)

## Viagens puladas (5)

| Trip ID | Status | Motivo |
|---|---|---|
| `noruega-2027` | `wishlist` | skip por design (ADR-001 §Decisão 2 + ajuste 1) |
| `patagonia-wishlist` | `wishlist` | skip por design (ADR-001 §Decisão 2 + ajuste 1) |
| `maldivas-luademel-wishlist` | `wishlist` | skip por design (ADR-001 §Decisão 2 + ajuste 1) |
| `rio-multiplo` | `draft` | skip por design (ADR-001 §Decisão 2 + ajuste 1) |
| `lencois-maranhenses-wishlist` | `wishlist` | skip por design (ADR-001 §Decisão 2 + ajuste 1) |

## Campos preservados em TODAS as viagens (sanidade)

| Campo legacy | Trips com o campo (antes) | Trips com mesmo valor (depois) | OK? |
|---|---|---|---|
| `air` | 42 | 42 | ✅ |
| `hospedagem` | 36 | 36 | ✅ |
| `logistics` | 42 | 42 | ✅ |
| `nts` | 42 | 42 | ✅ |
| `year` | 42 | 42 | ✅ |
| `month` | 42 | 42 | ✅ |

Todos os campos legacy preservados sem alteração em 100% dos casos.
