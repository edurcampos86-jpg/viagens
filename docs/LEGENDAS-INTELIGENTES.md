# Legendas inteligentes via Anthropic API

> Módulo `scripts/smart_captions.py` + flag `--smart-captions` em
> `scripts/ingest_takeout.py`. **Opt-in** — pipeline padrão segue factual.

## TL;DR

- Por padrão, a ingestão gera legendas factuais no formato `"Cidade · DD MMM YYYY"`.
- Com `--smart-captions`, cada foto recebe uma legenda **emocional** (8-15 palavras, pt-BR) gerada por **Claude Haiku 4.5** via vision.
- Custo: ~**$0.0008 por imagem** (~$0.67 para 840 fotos).
- Em qualquer falha de API, cai no **fallback factual** — nunca quebra a ingestão.
- ⚠️ **Legendas smart precisam de revisão manual no PR** — o modelo pode alucinar detalhes.

## Como ativar

### Pré-requisito

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."     # já configurada na sua máquina
pip install -r scripts/requirements-curator.txt
```

Se a env var estiver vazia, o pipeline aborta com mensagem clara antes de qualquer chamada.

### Estimar custo antes de rodar

```powershell
python scripts/ingest_takeout.py --input ./media-import --smart-captions --estimate-cost
```

Saída:

```
Estimativa de custo (--smart-captions, modelo claude-haiku-4-5):
  840 foto(s) × ~$0.0008 = ~$0.6720 USD
  (cálculo conservador; não chama a API)
```

Esse modo só conta itens locais — **não toca na API**. Use para ter ideia antes de ativar.

### Rodar com smart-captions ativado

```powershell
python scripts/ingest_takeout.py --input ./media-import --smart-captions
```

Opções:

| Flag | Default | O quê |
|---|---|---|
| `--smart-captions` | `false` | Ativa o modo. |
| `--smart-model` | `claude-haiku-4-5` | Modelo Claude (qualquer modelo vision-capable). |
| `--smart-rpm` | `45` | Rate-limit defensivo em requests/min. |
| `--estimate-cost` | `false` | Combinada com `--smart-captions`, só calcula custo e sai. |

### O que muda no `proposals.json`

Cada item ganha o campo `caption_smart_source`:

```diff
 {
   "path": "media-import/foz-2021/04.jpg",
   "type": "image",
   "timestamp": 1623456000,
   "lat": -25.69,
   "lon": -54.43,
   "source": "exif",
-  "caption": "Foz do Iguaçu · 12 jun 2021",
-  "caption_auto": true
+  "caption": "Trovão das águas que ensurdece e abraça ao mesmo tempo.",
+  "caption_auto": true,
+  "caption_smart_source": "claude-haiku-4-5"
 }
```

- `caption_auto: true` continua presente — sinaliza "gerada automaticamente".
- `caption_smart_source` indica o modelo. **Ausente/None** = foi a versão factual (default ou fallback).
- Editar manualmente → mude **ambos** os campos: `caption_auto: false`, remove `caption_smart_source`.

## Precedência de captions

Quando o pipeline encontra um item que **já existe** em `trip.media.gallery`, a precedência é estrita:

1. **Manual** — caption escrita à mão no `trips.json`. Identificada por:
   - `caption` presente E não vazia
   - `caption_auto` ausente, `null`, ou explicitamente `false`
   - **Nunca é sobrescrita.** O pipeline pula a chamada à API, preserva o texto manual, e marca o item no `proposals.json` com `preserved_manual_caption: true`. O `caption_smart_source` fica `null` (caption não veio do modelo).
2. **Smart** — `caption_auto: true` + `caption_smart_source: "<modelo>"`. Pode ser sobrescrita por uma nova rodada de `--smart-captions` (releitura/recalibração).
3. **Factual** — `caption_auto: true` sem `caption_smart_source`. Fallback do pipeline padrão; também pode ser sobrescrita.

Match entre cluster e gallery é feito por **basename do arquivo** (ex.: `01.webp`). O `src` da gallery (`media/<trip>/01.webp`) e o `path` do cluster (`media-import/<trip>/01.webp`) coincidem nesse basename.

**Implicação prática.** Rodar `--smart-captions` várias vezes na mesma viagem é seguro: tudo que você já editou à mão fica intocado. Se quiser **forçar** uma nova rodada do smart em uma caption específica, edite o item na `gallery` para colocar `caption_auto: true` (ou remova o campo `caption` totalmente) antes de rodar de novo.

## Exemplo lado-a-lado

3 fotos da Foz do Iguaçu:

| Foto | Factual (default) | Smart (`--smart-captions`) |
|---|---|---|
| `04.webp` (vista calçadão) | Foz do Iguaçu · 12 jun 2021 | Trovão das águas que ensurdece e abraça ao mesmo tempo. |
| `02.webp` (braços abertos) | Foz do Iguaçu · 12 jun 2021 | Braços abertos diante da força que cabe no peito. |
| `01.webp` (mirante) | Foz do Iguaçu · 13 jun 2021 | Sorriso espontâneo no fim do percurso de spray e arco-íris. |

Note: a versão factual repete "Foz do Iguaçu · 12 jun 2021" para 2 fotos do mesmo dia. A smart traz a **especificidade do momento**, sem clichês.

## Custos detalhados

Cálculo conservador embutido no módulo (`COST_PER_ITEM_USD = 0.0008`):

| Cenário | # fotos | Custo estimado |
|---|---|---|
| 1 trip pequena (15 fotos) | 15 | $0.012 |
| 1 trip grande (40 fotos) | 40 | $0.032 |
| 42 trips × 20 fotos média | 840 | **$0.67** |
| 100 trips × 30 fotos média | 3.000 | $2.40 |

Valores baseados em Haiku 4.5 (vision) com ~700 input tokens + ~30 output tokens. **Sempre passe `--estimate-cost` antes de rodar a primeira vez** para confirmar o número real.

## Fallback gracioso

Se a chamada à API falhar (rede, rate limit, JSON malformado, conta sem saldo), o item:

1. Recebe a **caption factual** que já tinha sido calculada (cidade · data).
2. `caption_smart_source` fica `null`.
3. Log warning é emitido em stderr.

Resultado: a ingestão **nunca aborta** por causa do modo smart. Você pode rodar com `--smart-captions` mesmo offline parcial — o que conseguir, gera; o resto fica factual.

## Sistema prompt

```
Você é um curador de memórias de viagem. Para cada foto que recebe, escreve
uma legenda curta (8-15 palavras), emocional, em português brasileiro, que
reaviva a experiência de quem viveu o momento. Evita clichês e descrições
genéricas. Foca em sensação e detalhe específico.
```

Cada chamada também envia ao modelo:
- O bloco de **contexto da viagem** (nome, país, highlights, memória).
- O **EXIF** (data + place do reverse-geocode).
- A **caption factual atual** (como referência).
- A imagem em base64.

## ⚠️ Revisão obrigatória no PR

Legendas smart **podem alucinar detalhes** (ex.: identificar uma pessoa pelo nome errado, mencionar um prato que não estava na cena, atribuir um sentimento que você não viveu). Antes de mergear o PR gerado pela ingestão, **leia cada uma**.

Recomendado:

1. Filtra no PR os items que têm `caption_smart_source` setado.
2. Lê uma por uma.
3. Se alguma estiver errada: edita manualmente e muda `caption_auto: false`, remove `caption_smart_source`.
4. Aprovadas viram parte de `data/trips.json` no merge.

## Quando NÃO usar smart-captions

- **Primeiro Takeout massivo**: deixa factual, revisa o pipeline com calma, daí roda smart só no que sobrou.
- **CI / batch automatizado**: o fallback é defensivo, mas custo + latência somam — use seletivamente.
- **Trips com `status: planned`**: ainda não há fotos. Smart só faz sentido depois.
- **Quando o EXIF é insuficiente**: sem GPS/data, smart vai parecer "frase de pôster" — adicione `highlights` na trip antes para enriquecer o contexto.

## Testes

`scripts/test_smart_captions.py` cobre 19 cenários, todos mockando o cliente Anthropic:

- Estimativa de custo (zero, típico, rejeita negativo)
- `TripContext` (trunca memória longa, omite campos vazios)
- `get_api_key` (sucesso / falha quando env ausente)
- `generate_smart_caption` (sucesso, falha de API, imagem ausente)
- `generate_smart_captions_batch` (rate-limit injetável, fallback por item, skip de paths vazios, RPM inválido)
- `_clean_caption` (remove aspas / prefixos)
- Integração: `serialize_cluster` sem smart_source = null; `_apply_smart_captions` sucesso / fallback / skip de orphan

**Nenhum teste chama a API real.** Suite completa: `python -m pytest scripts/`.

## Referências internas

- Módulo: [`scripts/smart_captions.py`](../scripts/smart_captions.py)
- Integração: [`scripts/ingest_takeout.py`](../scripts/ingest_takeout.py) (função `_apply_smart_captions`)
- Schema: [`data/schemas/trip.schema.json`](../data/schemas/trip.schema.json) (campo `caption_smart_source` no `media.gallery.items`)
- Testes: [`scripts/test_smart_captions.py`](../scripts/test_smart_captions.py)
- Doc de ingestão: [`INGESTAO.md`](INGESTAO.md#legendas-inteligentes-opt-in--caption_smart_source)
