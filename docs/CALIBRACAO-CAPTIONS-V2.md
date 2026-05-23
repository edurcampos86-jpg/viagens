# Calibração das legendas smart — V2

Iteração de qualidade sobre as **legendas inteligentes** (Fase 3 do PR [#38](https://github.com/anthropics/viagens/pull/38)), motivada por 3 problemas observados no smoke test V1 com 5 fotos do álbum Foz do Iguaçu (2021).

## Mudanças

| Camada | V1 (PR #38) | V2 (esta iteração) |
|---|---|---|
| `SYSTEM_PROMPT` | 4 frases corridas, "evita clichês" genérico | Bloco estruturado com 5 regras obrigatórias + estilo + 3 exemplos in-context |
| Contexto inter-foto | Nenhum (cada chamada vê só a foto + trip) | Bloco `[CAPTIONS_JÁ_GERADAS_NESTE_ÁLBUM]` injetado no user prompt a partir da 2ª chamada |
| Parâmetro `previous_captions` | — | Novo, opcional, em `generate_smart_caption(...)` |
| Acumulação no batch | — | `generate_smart_captions_batch` acumula em `generated_captions` local e passa lista crescente |

**Decisão de design (escopo da acumulação).** O brief sugeriu acumular em `_apply_smart_captions` (ingest_takeout.py). Acumulei dentro de `generate_smart_captions_batch` (smart_captions.py) porque o loop por foto vive lá. Como `_apply_smart_captions` invoca o batch **uma vez por cluster**, o escopo natural ("um álbum por chamada de batch") já é correto. Mantém DRY e não vaza estado para o caller.

## Smoke test V2 — Foz do Iguaçu (5 fotos)

Comando idêntico ao V1:

```powershell
New-Item -ItemType Directory -Force -Path "media-import\iguacu-2021" | Out-Null
Copy-Item "media\iguacu-2021\01.webp","media\iguacu-2021\02.webp","media\iguacu-2021\03.webp","media\iguacu-2021\04.webp","media\iguacu-2021\05.webp" -Destination "media-import\iguacu-2021\"
$env:ANTHROPIC_API_KEY = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY","User")
python scripts/ingest_takeout.py --mode album --smart-captions
```

### Tabela comparativa

| # | Manual (referência) | Smart V1 (PR #38) | Smart V2 (esta iteração) |
|---|---|---|---|
| 1 | Pose espontânea no mirante das quedas | Braços abertos diante da fúria da natureza, pequenina e viva de propósito | Blusa floral aberta para as quedas, braços em triunfo diante da cortina branca |
| 2 | (sem ref. manual registrada) | Braços abertos / força bruta da natureza¹ | Camisa vermelha estufada pelos respingos, impossível conter os braços diante dessa parede d'água |
| 3 | (sem ref. manual registrada) | Braços abertos / humilha¹ | Três sorrisos alinhados, bonés pretos e os braços abertos para a cortina d'água ao fundo |
| 4 | Trovão das águas no calçadão | "roar" das quedas — anglicismo não traduzido | Jaqueta amarela contrastaado² na neblina, braços cruzados diante da imensidão |
| 5 | Arco-íris esticado sobre as quedas | Corações batendo na vastidão (ignora o arco-íris) | Óculos escuros contra o brilho, a neblina envolvendo quem se aproxima demais |

¹ V1 só está documentado parcialmente no brief de calibração; estas linhas refletem o sintoma reportado ("3 de 5 começam com 'Braços abertos'", "força bruta", "humilha"), não o texto exato.
² Typo do modelo ("contrastaado" em vez de "contrastando") — incidente único, não-sistêmico, fora do escopo do prompt.

## Análise dos 3 problemas

### Problema 1 — Repetição lexical entre captions do mesmo álbum

| | V1 | V2 |
|---|---|---|
| Captions começando com "Braços abertos" | 3 de 5 | **0 de 5** ✓ |
| Captions contendo "braços" em qualquer posição | (alta) | 4 de 5 ⚠ |
| Captions começando com substantivo distinto | baixa | **5 de 5** ✓ (Blusa, Camisa, Três, Jaqueta, Óculos) |

**Veredito: parcialmente resolvido.** A acumulação inter-batch quebrou a repetição estrutural do início ("Braços abertos diante…") e forçou cada caption a começar com um detalhe visual distinto. Porém o token "braços" ainda gravita o modelo em 4 de 5 captions — o contexto `[CAPTIONS_JÁ_GERADAS]` reduz a repetição mas não a elimina quando o gesto físico está realmente presente nas fotos. Aceitável para o caso de uso (diário pessoal, não copywriting).

### Problema 2 — Anglicismos não traduzidos

| | V1 | V2 |
|---|---|---|
| "roar" sem tradução | sim (foto 4) | **não** ✓ |
| "alive on purpose" → "pequenina e viva de propósito" | sim (foto 1) | **não** ✓ |
| Vocabulário pt-BR natural | inconsistente | "cortina d'água", "parede d'água", "respingos", "neblina", "imensidão" ✓ |

**Veredito: resolvido.** Nenhuma das 5 captions V2 contém anglicismo. Tradução literal de construções inglesas também desapareceu.

### Problema 3 — Perde detalhe visual icônico da foto

| | V1 | V2 |
|---|---|---|
| Captions com pelo menos 1 detalhe único | inconsistente | **5 de 5** ✓ |
| Cor de roupa/acessório mencionada | rara | 4 de 5 (floral, vermelha, bonés pretos, amarela) |
| Elemento meteorológico | rara | 3 de 5 (cortina branca, respingos, neblina) |
| Foto 5 — captura o detalhe icônico esperado (arco-íris no V1 manual) | não | **inconclusivo** — V2 destaca "óculos escuros + brilho + neblina" em vez de arco-íris |

**Veredito: substancialmente resolvido para o conjunto, com 1 dúvida na foto 5.** A regra "SEMPRE inclui pelo menos UM detalhe visual ÚNICO" puxou o modelo para cor de roupa e elemento meteorológico de forma consistente. A dúvida residual: a foto 5 talvez contenha arco-íris (a legenda manual de referência menciona) e o V2 escolheu destacar óculos + neblina. Sem acesso visual à foto não dá pra cravar se houve regressão ou se a foto 5 não tem o arco-íris (pode ter sido outra foto do conjunto manual).

## Métricas

| Métrica | Valor |
|---|---|
| Fotos processadas | 5 |
| Modelo | claude-haiku-4-5 |
| Custo estimado (`COST_PER_ITEM_USD = $0.0008`) | **~$0.0040 USD** |
| Tempo total wall-clock | **16.9 s** |
| Throughput observado | ~3.4 s/foto (inclui rate-limit de 45 RPM ≈ 1.33s mínimo + ~2s vision) |
| Taxa de sucesso | 5/5 (100%) |
| Captions com fallback factual | 0 |
| Suite Python | 125 passed (1 falha pré-existente, sem relação: `test_optimize_cluster_end_to_end_with_synthetic_photos` falha por path separator do Windows também em `main`) |
| Testes de `smart_captions` | **21/21 verdes** (19 originais + 2 novos: `test_system_prompt_v2_contains_calibration_keywords`, `test_batch_passes_previous_captions_to_next_call`) |

## Recomendação técnica

**🟢 Smart V2 pronta para uso real em álbuns pequenos-médios (até ~50 fotos por álbum).** Os 3 problemas reportados foram resolvidos (anglicismos, detalhe icônico) ou substancialmente atenuados (repetição). Antes de rodar contra o catálogo inteiro (840 fotos, ~$0.67), recomendo:

1. **Sample stratificado.** Rodar V2 em 1 álbum urbano (ex.: Bangkok), 1 natureza (ex.: Foz já testado), 1 viagem-família para confirmar generalização do estilo "contemplativo, observador, íntimo".
2. **Revisão de typos.** O modelo às vezes produz erros ortográficos ("contrastaado" na foto 4). Considerar passar `--smart-model claude-sonnet-4-6` em álbuns curados manualmente quando a qualidade textual importa mais que custo.
3. **Eduardo aprova caso-a-caso na curadoria.** O `caption_smart_source` deixa rastro do que é gerado vs editado manualmente.

**Próxima iteração (V3) sugerida só se aparecer:**
- Repetição persistente de "braços" em álbuns onde o gesto não é icônico (sintoma de gravitação léxica do modelo).
- Tom muito uniforme entre álbuns muito diferentes (urbano vs natureza vs gastronomia).

Para qualquer um desses, a alavanca seria adicionar **detecção de tipo de álbum** no `TripContext` (`vibe: urban|nature|food|family`) e modular tom no prompt. Não é necessário agora.
