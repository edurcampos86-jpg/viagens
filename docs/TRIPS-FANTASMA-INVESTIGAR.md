# Trips fantasma do briefing — Investigação

> Branch: `claude/reconciliacao-lugares-api-2026` · Fase 1 — Revisão consolidada
> Gerado em 2026-05-23 durante consolidação das respostas do Eduardo.

## Por que esse documento existe

No briefing inicial da auditoria, listei matches entre Lugares e trips que **não existem** em `data/trips.json`. Eduardo apontou a inconsistência. Aqui investigo cada uma das 6 e proponho ação.

Princípio: **não cadastro nada automaticamente** nesses casos — todos exigem confirmação do Eduardo.

## Sumário

| Trip mencionada no briefing | Existe em `trips.json`? | Trip(s) próxima(s) | Recomendação |
|---|---|---|---|
| `argentina-2022` (Buenos Aires) | ❌ | `argentina-2021` (dez/2021) | Verificar se é mesma viagem ou outra |
| `patagonia-2022` | ❌ | `patagonia-2024` (jan/2024) · `patagonia-wishlist` | Provavelmente confusão de ano |
| `africa-do-sul-2022` | ❌ | `africa-2026` (mar/2026, done) | Quase certamente confusão (existe só uma África) |
| `africa-do-sul-2024` | ❌ | `africa-2026` (mar/2026) | Idem |
| `tomorrowland-2024` | ❌ | `europa-tomorrowland-2026` (jul/2026, planned) | Pode ser viagem real anterior — investigar |
| `europa-2025` (Roma+BCN+Berlim+Ibiza+Madrid+Praga) | ❌ | Cidades em `italia-2023`, `pragabud-2023`, `espanha-2024`, `alemanha-2023` | Provavelmente o briefing inflou um euro-trip mítico |

## Investigação detalhada

### 1. `argentina-2022` → Buenos Aires

**Trip(s) próxima(s):**
- `argentina-2021` — dez/2021 — status `done`

**Hipótese:** O Lugares cataloga "Buenos Aires" via GPS, sem distinguir entre viagem de fim-2021 que atravessa o réveillon e viagem de início-2022. Provavelmente é a **mesma viagem** que `argentina-2021`, só que com fotos espalhadas pelos dois anos.

**Recomendação:** **Não criar** nova trip. Em vez disso, anotar em `argentina-2021._audit_notes` que parte das fotos pode ter timestamp de jan/2022.

**Pergunta para Eduardo:** Sua viagem `argentina-2021` (Argentina, dez/2021) terminou em janeiro/2022? Se sim, está tudo certo — fica só uma trip. Se você foi à Argentina em 2022 numa viagem **separada**, criar nova trip.

### 2. `patagonia-2022`

**Trip(s) próxima(s):**
- `patagonia-2024` — jan/2024 — status `done`
- `patagonia-wishlist` — sem ano — status `wishlist` (Torres del Paine)

**Hipótese:** Briefing confundiu 2022 com 2024. Não há referência a Patagônia em 2022 nos dados; o Lugares de "El Calafate" provavelmente é todo da `patagonia-2024`.

**Recomendação:** **Não criar** nova trip. Confirmar com Eduardo que a única viagem realizada à Patagônia foi a de 2024.

**Pergunta para Eduardo:** Você foi à Patagônia mais de uma vez (fora a `patagonia-wishlist` que ainda é sonho)? Ou só em jan/2024?

### 3. `africa-do-sul-2022`

**Trip(s) próxima(s):**
- `africa-2026` — mar/2026 — status `done`

**Hipótese:** O briefing inflou. Só há uma trip de África no `trips.json`, em 2026 (que já foi feita — mar/2026, sendo hoje 2026-05-23).

**Recomendação:** **Não criar** nova trip. Confirmar que só houve uma viagem à África do Sul.

**Pergunta para Eduardo:** Você foi à África do Sul mais de uma vez? Ou só a de março/2026 (Sun City + Pilanesberg)?

### 4. `africa-do-sul-2024`

Mesma análise do item 3 — provavelmente repetição do briefing. **Não criar.** Confirmar.

### 5. `tomorrowland-2024`

**Trip(s) próxima(s):**
- `europa-tomorrowland-2026` — jul/2026 — status `planned` (Bélgica)

**Hipótese:** Aqui o briefing pode estar **certo**. É plausível que Eduardo tenha ido ao Tomorrowland em 2024 (estes festivais são anuais) e a única referência em `trips.json` seja para o futuro `europa-tomorrowland-2026`. Lugares teria fotos de Boom em 2024.

**Recomendação:** **Investigar com Eduardo.** Se confirmado, criar trip `tomorrowland-2024` com `status: done`, `country: Bélgica`, lat=51.085 (Boom), lon=4.367.

**Pergunta para Eduardo:** Você foi ao Tomorrowland 2024 (Boom, Bélgica, jul/2024)? Se sim, preciso cadastrar como trip nova. Se foi a edição 2023 do Tomorrowland, qual o ano exato?

### 6. `europa-2025` (Roma+BCN+Berlim+Ibiza+Madrid+Praga)

**Trip(s) próxima(s):**
- `italia-2023` — mai/2023 — Roma & Vaticano
- `espanha-2024` — mai/2024 — Espanha (inclui Ibiza)
- `alemanha-2023` — out/2023 — Alemanha
- `pragabud-2023` — mar/2023 — Praga & Budapeste

**Hipótese:** O briefing combinou cidades de **4 viagens diferentes** entre 2023 e 2024 em uma trip-fantasma de 2025. Não há suporte nos dados.

**Recomendação:** **Não criar.** Confirmar que não houve euro-trip nova em 2025.

**Pergunta para Eduardo:** Você fez alguma viagem para a Europa em 2025 (algo entre `espanha-2024` e `mykonos-2025`)? Se não, fica confirmado que o briefing inflou.

## Próximos passos

1. Eduardo responde as 5 perguntas acima (a 4 é só "sim/não" como a 3).
2. **Se confirmar `tomorrowland-2024`**, eu adiciono num commit dedicado (não nesta consolidação).
3. **Se confirmar separação `argentina-2022`**, idem.
4. Se nada precisar virar trip, este documento pode ser arquivado com nota "investigação encerrada".

---

> Este relatório não modifica `data/trips.json`. É só um RFC interno para alinhar a Fase 2.
