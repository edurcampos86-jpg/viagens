# Inventário atual — `data/trips.json`

> Gerado em 2026-05-22, revisado em 2026-05-23 após consolidação da auditoria de Lugares (branch `claude/reconciliacao-lugares-api-2026`).
> Detecção de mídia agora consulta `media.gallery[]` (campo correto do schema).

## Resumo

- **Total de trips:** 52
- **`done`:** 41
- **`planned`:** 6
- **`em_planejamento`:** 0
- **`draft`:** 1
- **`wishlist`:** 4
- **Trips com `media.gallery` populado:** 2 / 52

## Lista completa por ano

### 2021

| trip-id | nome | status | mídia |
|---|---|---|---|
| `iguacu-2021` | Foz do Iguaçu | `done` | ✅ (9) |
| `atacama-2021` | Deserto do Atacama | `done` | ✅ (7) |
| `argentina-2021` | Argentina | `done` | ❌ |

### 2022

| trip-id | nome | status | mídia |
|---|---|---|---|
| `florida-2022` | Florida | `done` | ❌ |
| `punta-2022` | Punta del Este | `done` | ❌ |
| `cartagena-2022` | Cartagena | `done` | ❌ |
| `ny-2022` | Nova Iorque | `done` | ❌ |
| `cancun-2022` | Cancún | `done` | ❌ |
| `abc-2022` | Ilhas ABC & Puerto Rico | `done` | ❌ |
| `mykonos-2022` | Mykonos | `done` | ❌ |
| `lisboapo-2022` | Lisboa & Porto | `done` | ❌ |

### 2023

| trip-id | nome | status | mídia |
|---|---|---|---|
| `tailandia-2023` | Tailândia | `done` | ❌ |
| `houston-2023` | Houston | `done` | ❌ |
| `pragabud-2023` | Praga & Budapeste | `done` | ❌ |
| `bali-2023` | Bali | `done` | ❌ |
| `machupicchu-2023` | Machu Picchu | `done` | ❌ |
| `italia-2023` | Itália — Roma & Vaticano | `done` | ❌ |
| `amsterda-2023` | Amsterdã & Bélgica | `done` | ❌ |
| `alemanha-2023` | Alemanha | `done` | ❌ |
| `japao-2023` | Japão | `done` | ❌ |
| `gramado-2023` | Gramado & Canela | `done` | ❌ |
| `rio-2023` | Rio de Janeiro | `done` | ❌ |

### 2024

| trip-id | nome | status | mídia |
|---|---|---|---|
| `patagonia-2024` | Patagônia | `done` | ❌ |
| `santiago-2024` | Santiago | `done` | ❌ |
| `espanha-2024` | Espanha — Ibiza & Cidades | `done` | ❌ |
| `costarica-2024` | Costa Rica | `done` | ❌ |
| `havai-2024` | Havaí | `done` | ❌ |
| `noronha-2024` | Fernando de Noronha | `done` | ❌ |
| `maragogi-2024` | Maragogi & Maceió | `done` | ❌ |

### 2025

| trip-id | nome | status | mídia |
|---|---|---|---|
| `mykonos-2025` | Mykonos 2025 | `done` | ❌ |
| `jericoacoara-2025` | Jericoacoara | `done` | ❌ |

### 2026

| trip-id | nome | status | mídia |
|---|---|---|---|
| `tailandia-2026` | Tailândia 2026 | `done` | ❌ |
| `africa-2026` | África do Sul | `done` | ❌ |
| `sp-junho-2026` | São Paulo — Só Track Boa + Pride | `planned` | ❌ |
| `europa-tomorrowland-2026` | Europa — Tomorrowland Bélgica | `planned` | ❌ |
| `brasilia-2026` | Brasília — Festa da Lili | `planned` | ❌ |
| `sanisland-2026` | San Island — Maldivas | `planned` | ❌ |

### 2027

| trip-id | nome | status | mídia |
|---|---|---|---|
| `japao-2027` | Japão — Hokkaido | `planned` | ❌ |
| `marrocos-2027` | Marrocos | `planned` | ❌ |
| `noruega-2027` | Noruega — Fiordos | `wishlist` | ❌ |

### 2028

| trip-id | nome | status | mídia |
|---|---|---|---|
| `patagonia-wishlist` | Patagônia — Torres del Paine | `wishlist` | ❌ |
| `maldivas-luademel-wishlist` | Maldivas — Lua de Mel | `wishlist` | ❌ |

### Sem ano definido

| trip-id | nome | status | mídia |
|---|---|---|---|
| `natal-micareta` | Natal · Micareta | `done` | ❌ |
| `canoa-quebrada-reveillon-cardume` | Canoa Quebrada · Réveillon Cardume | `done` | ❌ |
| `florianopolis-micareta` | Florianópolis · Micareta | `done` | ❌ |
| `mucuge-aniversario` | Chapada Diamantina · Aniversário | `done` | ❌ |
| `brasilia-recorrente` | Brasília · Visitas recorrentes | `done` | ❌ |
| `nordeste-litoral-recorrente` | Litoral do Nordeste · Visitas recorrentes | `done` | ❌ |
| `aracaju-familia` | Aracaju · Encontros em família | `done` | ❌ |
| `campos-jordao-recorrente` | Campos do Jordão · Visitas recorrentes | `done` | ❌ |
| `rio-multiplo` | Rio de Janeiro · Múltiplas viagens | `draft` | ❌ |
| `lencois-maranhenses-wishlist` | Lençóis Maranhenses | `wishlist` | ❌ |

## Observações

- Trips com mídia populada: **`iguacu-2021`** (5 fotos + 4 vídeos) e **`atacama-2021`** (cobre+galeria com placeholders externos picsum.photos).
- Trips marcadas com `status: draft` foram introduzidas nesta consolidação para sinalizar placeholders pendentes de desambiguação por pipeline (ex.: `rio-multiplo`).
- O contador anterior dizia "0 trips com mídia" porque o gerador filtrava `media.photos` (campo inexistente) em vez de `media.gallery`. Corrigido.
