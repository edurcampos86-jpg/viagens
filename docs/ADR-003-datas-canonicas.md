# ADR-003 — Forma canônica de datas = `startDate`/`endDate` top-level

## Status

`Accepted` — 2026-06-06

Relacionado: [ADR-001](./ADR-001-schema-canonico.md) (schema canônico de `bookings`). Frente B (robustez do módulo Viagens), bloco B3.

---

## Contexto

O leitor [`src/core/schema.js`](../src/core/schema.js) declarava no docstring que a fonte canônica de datas era o objeto aninhado `dates.{start,end,computed_from}` (v2). A realidade dos dados e do código contradiz isso:

- **0 de 52** registros em [`data/trips.json`](../data/trips.json) usam `dates.*`.
- **7** registros usam `startDate`/`endDate` top-level; **35** usam `year`/`month`; **10** (agregadoras/wishlist) não têm data.
- `startDate`/`endDate` é lido por **todo o pipeline Python** (`matcher.py`, `sync.py`, `auditor.py`, `curador.py`, `radar_digest.py`, `ingest_takeout.py`, `build_coleta_template.py`) e pelo renderer legacy [`assets/app.js`](../assets/app.js).
- Apesar disso, o `collect()` do editor ([`src/components/trip-editor.js`](../src/components/trip-editor.js)) **só sabia gravar `dates.*`**.

Isso cria um **drift latente**: como nenhuma viagem foi salva pelo editor ainda, há 0 ocorrências de `dates.*` hoje — mas a **próxima** gravação de qualquer registro criaria `dates.*` ao lado de `startDate/endDate`+`year/month`, sem removê-los, deixando duas representações de data convivendo e podendo divergir. Foi o ponto cego identificado na investigação do bug `sanisland-2026`.

---

## Decisão

**Opção B — `startDate`/`endDate` top-level é a forma canônica de datas.**

1. **Escrita canônica.** O editor passa a gravar `startDate`/`endDate` e **deriva** os espelhos legacy `year`/`month`/`nts` (helper puro `deriveLegacyDateFields` em [`src/core/dates.js`](../src/core/dates.js)). Para de emitir `dates.*` (B3.1).
2. **Leitura única.** `getDates()` em `schema.js` continua sendo o **leitor tolerante único** — lê `dates.*` OU `startDate/endDate` OU `year/month`, nessa ordem. Consumidores não mudam.
3. **Seed sem perda.** Ao abrir um registro legacy no editor, o estado de trabalho de datas é semeado via `getDates(source)` — editar+salvar um registro `year/month` ou `startDate/endDate` **não perde a data** ao gravar o canônico.
4. **`dates.*` deprecado.** Marcado como alias de leitura apenas; não deve mais ser escrito. Removível só quando `assets/app.js` e o pipeline Python forem aposentados — mesmo tratamento dado a `transporte`/`hospedagem` no ADR-001.
5. **Guarda anti-regressão (B3.3).** Teste node que falha se algum registro tiver `dates.*` divergente de `startDate/endDate` (ou `dates.*` órfão sem o canônico).

A migração de dados retroativa (normalizar os 7 legacy + 35 `year/month`) é **B3.2**, separada e ainda pendente — com `--dry-run` antes do `--apply`, backup e contagem de afetados.

---

## Consequências

| Item | Impacto |
|---|---|
| ✅ Drift latente estancado | Editor para de criar duas representações de data; B3.1 não toca dados |
| ✅ Doc alinhada à realidade | `schema.js` deixa de afirmar que `dates.*` é canônico |
| ✅ Baixo raio de mudança | `getDates()` já abstrai leitura; pipeline Python e `app.js` (que leem `startDate/endDate`) seguem intactos |
| ✅ Sem perda em edição de legacy | Seed via `getDates()` preserva datas ao gravar canônico |
| ✅ Regressão barrada no CI | Guarda B3.3 falha o build se o drift reaparecer |
| ⚠ Migração de dados pendente | B3.2 normaliza os 42 registros (reversível, dry-run) — fora deste PR |
| ⚠ Provenance de datas (`computed_from`) | Permanece conceito de runtime (não persistido), como já era — fora de escopo |

---

## Alternativas consideradas

### Alternativa A — Forward para `dates.*` (canonizar o aninhado)

**Rejeitada por raio/risco desproporcionais.** Tornar `dates.*` canônico exigiria reescrever **todo o pipeline Python** (7 scripts) e o `assets/app.js`, que leem `startDate/endDate` diretamente — além de migrar 42 registros para uma forma que nenhum consumidor atual usa. Custo alto para alinhar o código à aspiração do docstring, quando é mais barato alinhar o docstring à realidade dos dados (Opção B).

---

## Plano de execução

3 blocos, cada um 1 PR:

1. **B3.1 + B3.3** (este PR) — fix de escrita (`collect()`), docstring, helper `deriveLegacyDateFields`, seed sem perda, guarda anti-drift, testes. Só `src/` + `tests/` + `docs/`. **Não toca dados.**
2. **B3.2 — migração de dados** (pendente) — script `migrate_dates_canonical.py` com `--dry-run`/`--apply`, backup, contagem de afetados. Toca `data/trips.json`.

Ordem importa: B3.1 antes de B3.2 (senão novas edições recriam drift durante a migração); a guarda B3.3 fecha a porta.

---

## Referências

- [ADR-001](./ADR-001-schema-canonico.md) §4 — proveniência de geocoding `geo_source` (Frente B / B1), origem da investigação
- [`src/core/schema.js`](../src/core/schema.js) — `getDates()`, leitor tolerante único
- [`src/core/dates.js`](../src/core/dates.js) — `deriveLegacyDateFields()`
- [`src/components/trip-editor.js`](../src/components/trip-editor.js) — `collect()` canônico + seed via `getDates`
- PR #78 — correção do registro `sanisland-2026` (festa em Praia do Forte) que expôs o drift
- PR #79 — Frente B / B1+B2 (país/coords editáveis + trava de confiança)
