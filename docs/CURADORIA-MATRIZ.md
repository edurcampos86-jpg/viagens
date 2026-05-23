# Matriz operacional — Curadoria manual no Google Photos

> Branch: `claude/reconciliacao-lugares-api-2026` · Fase 2
> Gerado em 2026-05-23, depois de consolidar as decisões do Eduardo na Fase 1.
> Inventário-base: 52 trips (`docs/INVENTARIO-ATUAL.md`).

## Para que serve este documento

É a **fonte única da verdade** durante a curadoria manual de fotos no Google Photos. Cada linha da tabela é uma instrução atômica: "vai em tal Lugar, filtra por tal data, adiciona ao álbum tal". Sem isso, você se perde no meio de 20+ viagens pendentes.

A ordem das colunas reflete o fluxo real:
1. **trip-id** → como o álbum deve se chamar no Photos.
2. **Status mídia** → se o site já tem álbum ou não.
3. **Lugar(es) no Photos** → onde abrir em https://photos.google.com/places.
4. **Álbum existe?** → se precisa criar do zero.
5. **Ação manual** → exatamente o que clicar.
6. **Tempo estimado** → para você priorizar.

## Convenções

- **Nome do álbum no Photos = `trip-id` no site**, exatamente como em `data/trips.json`: kebab-case, sem espaços, sem emoji, sem acentos. Ex: `tailandia-2023`, `natal-micareta`, `nordeste-litoral-recorrente`.
- Trips com `status: planned` ou `wishlist` **não recebem álbum agora** — fotos só existem depois da viagem.
- Trips com `status: draft` (hoje só `rio-multiplo`) são placeholders: o pipeline vai dividir em N quando o Takeout chegar.
- Trips **agregadoras** (sufixo `-recorrente` ou nomes como `aracaju-familia`) **não têm Lugar único do GPS** — você cria o álbum do zero juntando fotos avulsas de várias visitas casuais.

## Como executar (passo-a-passo)

### Navegar Lugares

1. Acessa https://photos.google.com/places.
2. Lista de Lugares aparece com thumbnail + nome + contagem.
3. Clica num Lugar → entra na vista filtrada por GPS.

### Filtrar por intervalo de datas dentro de um Lugar

1. Dentro do Lugar, role o feed até o ano desejado (Photos agrupa por data automaticamente).
2. Clica na **primeira foto** do período.
3. Scroll até a **última foto** do período, segura `Shift` e clica → seleciona o intervalo todo.
4. (Alternativa) Clica "Selecionar" no topo, marca a primeira foto, depois `Shift+clique` na última.

### Adicionar a um álbum

1. Com a seleção feita, ícone `+` no topo direito → "Adicionar a" → "Álbum".
2. Se o álbum já existe: escolhe pelo nome.
3. Se não: clica "Novo álbum" e nomeia exatamente como o `trip-id`.

### Multi-Lugares para o mesmo álbum

Se a trip envolve 3-6 Lugares diferentes (caso `tailandia-2023`, `japao-2023`, `espanha-2024`):

1. Cria o álbum **uma única vez** com o `trip-id`.
2. Para cada Lugar, repete o fluxo de seleção + adicionar — **escolhendo o álbum já existente** na lista, não criando novo.

## Matriz principal

### Categoria A · Já populadas (nenhuma ação)

| trip-id | Status mídia | Lugar no Photos | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `iguacu-2021` | ✅ 9 itens | Foz do Iguaçu | n/a | Nenhuma — 5 fotos + 4 vídeos já em `media/iguacu-2021/` com captions à mão | 0 |
| `atacama-2021` | ⚠️ placeholders | San Pedro de Atacama | n/a | Galeria atual aponta para `picsum.photos`. **Substituir por fotos reais quando o Takeout do Atacama for processado.** Tratado como pendente abaixo. | (ver B) |

### Categoria B · Trip simples — 1 Lugar = 1 álbum (~5 min cada)

| trip-id | Status mídia | Lugar no Photos | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `argentina-2021` | ❌ | Buenos Aires | criar | Em Buenos Aires, filtrar por dez/2021 (e provavelmente jan/2022 — ver TRIPS-FANTASMA, item 1). Selecionar tudo do período → Adicionar a álbum `argentina-2021` (novo). | 7 min |
| `florida-2022` | ❌ | Orlando (+ Miami se houver) | criar | Em Orlando, filtrar por jan/2022. Selecionar tudo → álbum `florida-2022`. Se houver Lugar Miami, repetir adicionando ao mesmo álbum. | 7 min |
| `punta-2022` | ❌ | Punta del Este | criar | fev/2022. Álbum `punta-2022`. | 5 min |
| `cartagena-2022` | ❌ | Cartagena (Colômbia) | criar | mar/2022. Álbum `cartagena-2022`. | 5 min |
| `ny-2022` | ❌ | Manhattan / New York | criar | jun/2022. Álbum `ny-2022`. ⚠️ **Lugares mostra 690 fotos** — se o filtro de jun/2022 capturar < 690, sobram fotos de outras visitas (ver `rio-multiplo` analogia, possível trip futura). | 8 min |
| `cancun-2022` | ❌ | Cancún | criar | jul/2022. Álbum `cancun-2022`. | 5 min |
| `abc-2022` | ❌ | Aruba / Curaçao / Bonaire / San Juan | criar | ago/2022. Vários Lugares — adicionar todos ao álbum `abc-2022` (ver Categoria C também). | 12 min |
| `mykonos-2022` | ❌ | Mykonos | criar | set/2022. Álbum `mykonos-2022`. ⚠️ Cuidado: mesmo Lugar de `mykonos-2025`. **Filtrar por data.** | 6 min |
| `lisboapo-2022` | ❌ | Lisboa + Porto | criar | out/2022. Os dois Lugares no mesmo álbum `lisboapo-2022`. | 8 min |
| `houston-2023` | ❌ | Houston | criar | fev/2023. Álbum `houston-2023`. | 5 min |
| `pragabud-2023` | ❌ | Praga + Budapeste | criar | mar/2023. Dois Lugares → álbum `pragabud-2023`. | 8 min |
| `bali-2023` | ❌ | Denpasar / Ubud (Bali) | criar | mar/2023. Álbum `bali-2023`. | 6 min |
| `machupicchu-2023` | ❌ | Cusco / Aguas Calientes | criar | abr/2023. Álbum `machupicchu-2023`. | 6 min |
| `italia-2023` | ❌ | Roma (+ Vaticano) | criar | mai/2023. Álbum `italia-2023`. | 5 min |
| `alemanha-2023` | ❌ | (cidades alemãs) | criar | out/2023. Álbum `alemanha-2023`. | 6 min |
| `santiago-2024` | ❌ | Santiago | criar | mar/2024. Álbum `santiago-2024`. | 5 min |
| `costarica-2024` | ❌ | San José (CR) e arredores | criar | jun/2024. Álbum `costarica-2024`. | 6 min |
| `havai-2024` | ❌ | Honolulu | criar | jul/2024. Álbum `havai-2024`. Único Havaí — não há outra trip lá. | 5 min |
| `noronha-2024` | ❌ | Vila dos Remédios (Fernando de Noronha) | criar | set/2024. Álbum `noronha-2024`. | 5 min |
| `gramado-2023` | ❌ | Gramado / Canela | criar | jul/2023. Álbum `gramado-2023`. | 5 min |
| `rio-2023` | ❌ | Rio de Janeiro | criar | dez/2023. Álbum `rio-2023`. ⚠️ **Filtrar com cuidado** — Lugares mostra muitas fotos do Rio de visitas adicionais (ver `rio-multiplo`). | 8 min |
| `jericoacoara-2025` | ❌ | Jericoacoara | criar | abr/2025. Álbum `jericoacoara-2025`. | 5 min |
| `mykonos-2025` | ❌ | Mykonos | criar | jul/2025. Álbum `mykonos-2025`. **Diferenciar de `mykonos-2022`** pelo ano. | 6 min |

**Subtotal Categoria B:** 23 trips × ~6 min média = **~140 min (2h20)**.

### Categoria C · Multi-Lugares para o mesmo álbum (~12-15 min cada)

| trip-id | Status mídia | Lugares no Photos | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `tailandia-2023` | ❌ | Bangkok + Patong + Ao Nang + Nong Prue + Choeng Thale | criar | jan/2023. **Cria o álbum `tailandia-2023` em Bangkok**, depois para cada um dos outros 4 Lugares filtra por jan/2023 e adiciona ao mesmo álbum. **Não confundir com `tailandia-2026`.** | 18 min |
| `amsterda-2023` | ❌ | Amsterdã + Boom | criar | ago/2023. Álbum `amsterda-2023`. ⚠️ Boom (Tomorrowland) deve estar em ago/2023 — se houver fotos de Boom 2024, é trip-fantasma `tomorrowland-2024` a investigar. | 12 min |
| `japao-2023` | ❌ | Tóquio + Kyoto + Suzuka | criar | out/2023. Álbum `japao-2023`. Confirmar Kyoto e Suzuka no Lugares (briefing inicial estava em dúvida). | 15 min |
| `patagonia-2024` | ❌ | El Calafate (+ Torres del Paine?) | criar | jan/2024. Álbum `patagonia-2024`. ⚠️ **Filtrar por data** — `patagonia-wishlist` é o mesmo Lugar (Torres del Paine), mas ainda não foi. | 10 min |
| `espanha-2024` | ❌ | Madrid + Barcelona + Ibiza | criar | mai/2024. Álbum `espanha-2024`. Pode ter outros Lugares espalhados pela Catalunha. | 15 min |
| `maragogi-2024` | ❌ | Maragogi + Maceió | criar | nov/2024. Álbum `maragogi-2024`. ⚠️ **Filtrar por nov/2024** — visitas casuais de outros anos vão para `nordeste-litoral-recorrente`. | 10 min |
| `tailandia-2026` | ❌ | Bangkok + (outros Lugares Tailândia) | criar | jan/2026. Álbum `tailandia-2026`. **Mesmos Lugares de `tailandia-2023` — filtrar exclusivamente por jan/2026.** | 15 min |
| `africa-2026` | ❌ | Sun City + Kempton Park + Pilanesberg | criar | mar/2026. Álbum `africa-2026`. **Única África do Sul** — não há trips fantasma 2022/2024 segundo a investigação. | 15 min |

**Subtotal Categoria C:** 8 trips × ~14 min média = **~110 min (1h50)**.

### Categoria D · Trips agregadoras (criação manual do álbum, sem GPS-cluster automático) (~10-12 min cada)

Estas trips representam **visitas casuais ou afetivas recorrentes** ao mesmo destino. Não fazem sentido como 1 Lugar = 1 álbum, porque o mesmo Lugar mistura fotos de várias ocasiões pequenas. **Você cria o álbum agregado à mão**, escolhendo as fotos que quer no acervo público.

| trip-id | Status mídia | Lugar(es) onde garimpar | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `brasilia-recorrente` | ❌ | Brasília | criar | **Navegar TODAS as datas** do Lugar Brasília no Photos. Selecionar fotos que valem a pena (~10-15 melhores). **Excluir** fotos do período de `brasilia-2026` (ago/2026 — ainda não aconteceu, então hoje não há conflito). Álbum `brasilia-recorrente`. | 12 min |
| `nordeste-litoral-recorrente` | ❌ | Praia do Forte + Morro de SP + Maragogi + Maceió (visitas avulsas) | criar | Para cada um desses Lugares, **excluir** os períodos que já vão para `maragogi-2024` (nov/2024), `natal-micareta` (carnaval), `canoa-quebrada-reveillon-cardume` (réveillon). Pegar o que sobra. Álbum `nordeste-litoral-recorrente`. | 15 min |
| `aracaju-familia` | ❌ | Aracaju | criar | Todas as fotos em Aracaju (encontros de família). Álbum `aracaju-familia`. | 8 min |
| `campos-jordao-recorrente` | ❌ | Campos do Jordão | criar | Todas as fotos em Campos do Jordão (descanso/inverno). Álbum `campos-jordao-recorrente`. | 8 min |

**Subtotal Categoria D:** 4 trips × ~11 min média = **~45 min**.

### Categoria E · Trips marcantes sem ano (filtrar por evento, não data) (~8-10 min cada)

Você marcou estas como "marcantes" mas o ano não está em `trips.json` ainda — o ano vai ser descoberto via EXIF quando o Takeout passar. Hoje, na curadoria manual, **filtra por evento/contexto** dentro do Lugar.

| trip-id | Status mídia | Lugar no Photos | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `natal-micareta` | ❌ | Natal (RN) | criar | Em Natal, achar fotos de **Micareta** (carnaval fora de época, geralmente nov/dez). Selecionar o cluster temporal. Álbum `natal-micareta`. | 10 min |
| `canoa-quebrada-reveillon-cardume` | ❌ | Canoa Quebrada | criar | Em Canoa, achar fotos de **virada de ano** (dez 31 → jan 1). Selecionar cluster. Álbum `canoa-quebrada-reveillon-cardume`. | 8 min |
| `florianopolis-micareta` | ❌ | Florianópolis | criar | Em Floripa, achar fotos de **Micareta**. Selecionar cluster. Álbum `florianopolis-micareta`. | 10 min |
| `mucuge-aniversario` | ❌ | Mucugê | criar | Em Mucugê (Chapada Diamantina), achar fotos do **aniversário**. Selecionar cluster. Álbum `mucuge-aniversario`. | 8 min |

**Subtotal Categoria E:** 4 trips × ~9 min média = **~36 min**.

### Categoria F · Placeholder draft (skip por enquanto)

| trip-id | Status mídia | Lugar no Photos | Álbum? | Ação manual | Tempo |
|---|---|---|---|---|---|
| `rio-multiplo` | ❌ | Rio de Janeiro | **NÃO criar agora** | Esperar Takeout completo do Lugar "Rio de Janeiro". O pipeline (Fase 3 + ingest) detecta clusters temporais e divide em N trips individuais. Aí cada uma vira álbum. | 0 (agora) |

### Categoria G · Trips `planned` (sem ação até a viagem acontecer)

| trip-id | Lugar previsto | Quando |
|---|---|---|
| `sp-junho-2026` | São Paulo | jun/2026 |
| `europa-tomorrowland-2026` | Boom (Bélgica) + outras | jul/2026 |
| `brasilia-2026` | Brasília | ago/2026 |
| `sanisland-2026` | Maldivas | out/2026 |
| `japao-2027` | Hokkaido | fev/2027 |
| `marrocos-2027` | Marrocos | abr/2027 |

**Ação hoje:** nenhuma. **Quando a viagem acontecer:** cria álbum com o `trip-id` igual ao de cima.

### Categoria H · Wishlist (sem ação)

| trip-id | Notas |
|---|---|
| `noruega-2027` | Fiordos — wishlist |
| `patagonia-wishlist` | Torres del Paine — wishlist |
| `maldivas-luademel-wishlist` | Lua de mel — wishlist |
| `lencois-maranhenses-wishlist` | Nunca foi — wishlist (Eduardo confirmou na Fase 1) |

## Casos especiais — atenção redobrada

### Caso 1 · Patagônia 2024 vs Patagônia futura (wishlist)

- Mesma região (El Calafate / Torres del Paine).
- **`patagonia-2024`** = jan/2024, status `done` → cria álbum `patagonia-2024` agora.
- **`patagonia-wishlist`** = futuro, status `wishlist` → não tem foto ainda.
- **Risco:** filtros do Photos vão misturar com hipotéticas viagens futuras. Hoje seguro — só existe a de 2024.

### Caso 2 · Japão 2023 com 3 cidades

- **`japao-2023`**: Tóquio + Kyoto + Suzuka. Briefing dizia "Tóquio confirmado, faltam Kyoto e Suzuka — confirmar no Photos".
- **Ação dentro da curadoria:** abrir o Lugar Tóquio em out/2023, depois conferir se Kyoto e Suzuka aparecem como Lugares separados no Lugares. Se sim, adicionar ao mesmo álbum `japao-2023`.

### Caso 3 · Europa 2025 (Roma+BCN+Berlim+Ibiza+Madrid+Praga)

O briefing inicial mencionou uma trip-fantasma `europa-2025` cobrindo 6 cidades. **A investigação em [`TRIPS-FANTASMA-INVESTIGAR.md`](TRIPS-FANTASMA-INVESTIGAR.md) concluiu que não existe** — cidades estão espalhadas em `italia-2023`, `pragabud-2023`, `espanha-2024`, `alemanha-2023`.

**Ação:** **não criar** álbum `europa-2025`. Distribui as fotos pelas 4 trips que já existem, conforme as datas.

### Caso 4 · África do Sul 2022 vs 2024 (não-existem)

Idem caso 3 — investigação concluiu que só existe `africa-2026`.

### Caso 5 · Nova York (690 fotos no Lugares)

- **`ny-2022`** confirmada como única trip nominal de NY hoje.
- **Risco:** se o filtro de jun/2022 capturar << 690 fotos, sobram fotos de outras viagens que Eduardo ainda não cadastrou (ver pergunta 2 do `PLACES-AUDIT.md` — aguardando resposta).
- **Ação hoje:** filtrar `ny-2022` por jun/2022 normalmente. **Se sobrar muito**, anotar em um seguimento da Fase 1 (talvez vire um `ny-multiplo` análogo ao `rio-multiplo`).

### Caso 6 · Amsterdã 2023 vs Tomorrowland 2024 (fantasma)

- **`amsterda-2023`**: Amsterdã + Boom em ago/2023.
- **`tomorrowland-2024`**: não existe em `trips.json`. Investigação em `TRIPS-FANTASMA-INVESTIGAR.md` aponta que é o caso mais plausível de virar trip nova.
- **Ação na curadoria:** quando abrir o Lugar Boom (Bélgica) no Photos, se houver fotos de 2024 sem trip associada, **PARAR** e voltar à Fase 1 para confirmar com Eduardo se foi ao Tomorrowland 2024.

### Caso 7 · Rio múltiplo (categoria F)

Já tratado acima — `rio-multiplo` espera Takeout completo + pipeline. Não criar álbum manual.

### Caso 8 · Trips agregadoras vs marcantes no mesmo litoral

- **`maragogi-2024`** (marcante, nov/2024) cobre Maragogi+Maceió daquela viagem.
- **`nordeste-litoral-recorrente`** (agregadora) cobre Praia do Forte + Morro de SP + Maragogi/Maceió de OUTROS anos.
- **`natal-micareta`** cobre Natal apenas no período da Micareta.
- **`canoa-quebrada-reveillon-cardume`** cobre Canoa apenas no réveillon.

**Ação:** ao montar `nordeste-litoral-recorrente`, **excluir** todos os clusters que vão para as trips marcantes. Sobra: visitas avulsas de fim-de-semana, etc.

## Estimativa de tempo total

| Categoria | # trips | Tempo total |
|---|---|---|
| A · Já populadas | 2 | 0 min (atacama precisa swap futuro) |
| B · Trip simples | 23 | ~140 min |
| C · Multi-Lugares | 8 | ~110 min |
| D · Agregadoras | 4 | ~45 min |
| E · Marcantes sem ano | 4 | ~36 min |
| F · Placeholder | 1 | 0 min (skip) |
| G · Planned | 6 | 0 min (skip) |
| H · Wishlist | 4 | 0 min (skip) |
| **TOTAL** | **52** | **~331 min ≈ 5h30** |

**Sugestão de fracionamento:** 4 sessões de ~80 minutos, divididas por ano:
1. **Sessão 1 (~75 min):** trips 2021-2022 (10 trips: argentina/florida/punta/cartagena/ny/cancun/abc/mykonos/lisboapo + atacama swap)
2. **Sessão 2 (~90 min):** trips 2023 (9 trips: tailandia/houston/pragabud/bali/machupicchu/italia/amsterda/alemanha/japao + gramado + rio)
3. **Sessão 3 (~75 min):** trips 2024 + 2025 + 2026 done (10 trips: patagonia/santiago/espanha/costarica/havai/noronha/maragogi/mykonos25/jericoacoara + tailandia26 + africa26)
4. **Sessão 4 (~90 min):** marcantes + agregadoras (8 trips: as 4 de E + as 4 de D)

## Próximos passos

1. Eduardo executa as 4 sessões acima no Google Photos (na ordem ou na que preferir).
2. Após cada lote, o pipeline de Takeout álbum-por-álbum (PR #35) processa e popula `media[]` em `data/trips.json`.
3. Fase 3 (smart-captions) entra opcionalmente para gerar legendas emocionais via Claude API.

---

> Este documento é a fonte da verdade durante a curadoria. **Mantenha aberto em paralelo ao Google Photos.**
