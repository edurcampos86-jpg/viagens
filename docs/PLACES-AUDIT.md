# Auditoria Lugares × `trips.json` — 2026-05-22

> Branch: `claude/reconciliacao-lugares-api-2026` · Fase 1
> Fonte: revisão manual de https://photos.google.com/places em 2026-05-22.
> Drafts geocodificados em: [`docs/drafts-from-places-audit.json`](drafts-from-places-audit.json).
> Inventário atual: [`docs/INVENTARIO-ATUAL.md`](INVENTARIO-ATUAL.md).
>
> **Atualização 2026-05-23 — Eduardo revisou as 18 perguntas.** Status de cada draft consolidado abaixo.

## Status da revisão (resumo)

| Categoria | Quantidade | Destino |
|---|---|---|
| Removidos (duplicata/não-viagem) | 4 | `salvador`, `honolulu`, `orlando`, `vila-remedios` (não entram em `trips.json`) |
| Promovidos como `done` (marcantes) | 4 | `natal-micareta`, `canoa-quebrada-reveillon-cardume`, `florianopolis-micareta`, `mucuge-aniversario` |
| Promovidos como `done` (agregadores) | 4 | `brasilia-recorrente`, `nordeste-litoral-recorrente`, `aracaju-familia`, `campos-jordao-recorrente` |
| Placeholder a explodir (`draft`) | 1 | `rio-multiplo` (será dividido em N quando Takeout do Rio for processado) |
| `wishlist` (nunca foi) | 1 | `lencois-maranhenses-wishlist` |
| Trips fantasma do briefing | 6 | Investigação em [`TRIPS-FANTASMA-INVESTIGAR.md`](TRIPS-FANTASMA-INVESTIGAR.md) |

## Como ler este documento

1. A tabela "Drafts geocodificados" lista os **19 candidatos** detectados em Lugares e que ainda não têm trip 1-para-1 em `data/trips.json`.
2. Cada candidato vira um **`status: "draft"`** em `docs/drafts-from-places-audit.json` — nenhum entra em `data/trips.json` ainda.
3. A seção "Perguntas para Eduardo" lista o que precisa ser respondido antes de promover qualquer draft.
4. Em **Fase 2** monto a matriz operacional já considerando suas respostas.

## Achado relevante antes de começar

Durante a leitura de `data/trips.json` descobri que **nenhuma trip tem `media.photos` populado** — incluindo `iguacu-2021` (Foz do Iguaçu), que o briefing inicial dava como "JÁ POPULADA com 5 fotos". Pode ser que o populado esteja num branch local não-mergeado, ou o briefing estava desatualizado. **Confirmar.**

## Drafts geocodificados

| Nome | lat | lon | País | Ano sugerido | Conflito com trip existente |
|---|---|---|---|---|---|
| Honolulu | 21.3045 | -157.8557 | Estados Unidos | ❓ | `havai-2024` |
| Nova York (extras) | 40.7580 | -73.9855 | Estados Unidos | ❓ | `ny-2022` (690 fotos → ≥1 viagem extra?) |
| Orlando | 28.5421 | -81.3790 | Estados Unidos | ❓ | `florida-2022` (verificar) |
| Vila dos Remédios | -3.8422 | -32.4111 | Brasil | ❓ | `noronha-2024` |
| Salvador | -12.9822 | -38.4813 | Brasil | — | Pode ser residência atual |
| Rio de Janeiro (extras) | -22.9110 | -43.2094 | Brasil | ❓ | `rio-2023` |
| Brasília (anteriores) | -15.7940 | -47.8828 | Brasil | ❓ | `brasilia-2026` (planned) |
| Aracaju | -10.9162 | -37.0775 | Brasil | ❓ | — |
| Praia do Forte | -12.5775 | -38.0064 | Brasil | ❓ | — |
| Maragogi (extras) | -9.0118 | -35.2225 | Brasil | ❓ | `maragogi-2024` |
| Maceió (extras) | -9.6477 | -35.7339 | Brasil | ❓ | `maragogi-2024` (cobre Maragogi & Maceió) |
| Natal | -5.8054 | -35.2081 | Brasil | ❓ | — |
| Morro de São Paulo | -13.3775 | -38.9160 | Brasil | ❓ | — |
| Canoa Quebrada | -4.5245 | -37.7057 | Brasil | ❓ | — |
| Florianópolis | -27.5973 | -48.5496 | Brasil | ❓ | — |
| Gramado (extras) | -29.3793 | -50.8737 | Brasil | ❓ | `gramado-2023` |
| Campos do Jordão | -22.7383 | -45.5904 | Brasil | ❓ | — |
| Lençóis Maranhenses | -2.5393 | -43.0170 | Brasil | ❓ | — |
| Mucugê | -13.0053 | -41.3703 | Brasil | ❓ | — |

Resumo: **19 drafts** (4 internacionais + 15 nacionais), sendo **8 com conflito potencial** com trip já existente e **11 que parecem ser viagens 100% novas**.

## Perguntas para Eduardo

### Internacionais

1. ✅ **Honolulu** — = `havai-2024`. Draft removido.

2. **Nova York (690 fotos no Lugares)** — Sua trip `ny-2022` cobre **quantas** dessas fotos? Você foi a NY 1, 2 ou 3 vezes? Se mais de uma, em quais períodos (mes/ano)? *(Pendente — tratada via placeholder em fase futura.)*

3. ✅ **Orlando** — parte de `florida-2022`. Draft removido.

4. ✅ **Vila dos Remédios (Fernando de Noronha)** — = `noronha-2024`. Draft removido.

### Nacionais — domicílio

5. ✅ **Salvador** — é cidade de residência atual. Draft removido (não vira trip).

### Nacionais — conflitos com trip existente

6. **Rio de Janeiro** — `rio-2023` é a única visita ao Rio que está na sua memória recente, ou tem visitas antigas (anteriores a 2023) registradas no Photos? Se sim, quantas, e em que anos aproximados?

7. **Brasília** — Você tem viagens passadas a Brasília **anteriores** à `brasilia-2026` (que está como `planned`)? Anos?

8. **Maragogi/Maceió** — A `maragogi-2024` (Maragogi & Maceió) cobre todas as visitas, ou houve outras viagens a esse litoral?

9. **Gramado** — Além de `gramado-2023`, há outras passagens por Gramado/Canela registradas no Photos?

### Nacionais — viagens potencialmente novas (sem trip)

Para cada um destes, responde:
- **Ano(s)** da(s) viagem(ns)
- **Com quem** (família, casal, sozinho, amigos)
- **Motivo** (lazer, evento, trabalho)
- **Status final** (vira `done` direto, ou primeiro `draft` no `trips.json`?)

10. **Aracaju** — ano / cia / motivo?
11. **Praia do Forte (BA)** — ano / cia / motivo? Faz par com Salvador?
12. **Natal (RN)** — ano / cia / motivo? Pode ter sido na mesma trip de Canoa Quebrada?
13. **Morro de São Paulo (BA)** — ano / cia / motivo?
14. **Canoa Quebrada (CE)** — ano / cia / motivo?
15. **Florianópolis (SC)** — ano / cia / motivo? Pode ter sido com Gramado?
16. **Campos do Jordão (SP)** — ano / cia / motivo?
17. **Lençóis Maranhenses (MA)** — ano / cia / motivo?
18. **Mucugê (BA) / Chapada Diamantina** — ano / cia / motivo?

## Discrepâncias com o briefing inicial

O contexto da sessão mencionou alguns matches que conflitam com o `trips.json` atual. Vale checar antes da Fase 2:

| Briefing dizia | Estado real em `trips.json` |
|---|---|
| `argentina-2022` → Buenos Aires | Só existe `argentina-2021` (não há trip de 2022) |
| `patagonia-2022` | Só existe `patagonia-2024` e `patagonia-wishlist` |
| `africa-do-sul-2022` | Só existe `africa-2026` (planned) e nada para 2022/2024 |
| `africa-do-sul-2024` | Idem — não existe |
| `tomorrowland-2024` | Existe `europa-tomorrowland-2026` (planned), não a de 2024 |
| `europa-2025` (Roma+BCN+Berlim+Ibiza+Madrid+Praga) | Cidades estão espalhadas em `italia-2023`, `pragabud-2023`, `espanha-2024`, `alemanha-2023` — não em uma trip única de 2025 |

**Pergunta:** essas viagens (Argentina 2022, Patagônia 2022, África 2022, Tomorrowland 2024, "Europa 2025") **realmente existem** e estão **faltando** no `trips.json`, ou o briefing misturou anos? Se faltam, viram drafts adicionais na Fase 2.

## Próximos passos

1. Você responde as perguntas acima (pode ser em texto solto, eu interpreto).
2. Eu volto, atualizo `docs/drafts-from-places-audit.json` com os anos/decisões.
3. Promovemos drafts confirmados para `data/trips.json` num commit separado.
4. Inicia **Fase 2** com a matriz operacional já alinhada à realidade.

---

> Após você responder, autoriza explicitamente **"Pode iniciar Fase 2"** para eu seguir. Sem isso, fico parado.
