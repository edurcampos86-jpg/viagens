# Testes — v2.0

Suite mínima em **Node 22** sem dependências. Cobre os módulos puros (sem DOM/network) do `src/core/` e `src/components/`.

## Rodar

```bash
npm test
# ou diretamente:
node tests/v2-modules.test.mjs
```

Saída esperada: `25 passed, 0 failed.`

Testes auxiliares (rodam scripts Python idempotentes em dry-run):

```bash
npm run test:migration   # confirma migration v1→v2 é idempotente
npm run test:benchmarks  # confirma compute_benchmarks.py executa
```

## Cobertura

| Módulo | Testes |
|---|---|
| `src/core/schema.js` | getDates v1+v2+empty, validateTrip OK/fail, getBookings v1+v2 (7) |
| `src/core/dates.js` | deriveDatesFromBookings de flights, stays, null (3) |
| `src/core/geo.js` | flagFromCountryCode, slugify (acentos), tripIdFrom (3) |
| `src/components/decision-matrix.js` | computeScores rankeia com pesos (1) |
| `src/components/benchmark.js` | compareTrip empty + populado com diff% (2) |
| `src/components/wizard.js` | nextStep nas 3 fases principais (3) |
| `src/components/checklist.js` | TH/BR/Schengen/idempotência (4) |
| `src/agents/customs.js` | run doméstica vs internacional (2) |

## O que NÃO está coberto aqui

Por design — exigem browser, DOM ou network:
- `src/components/trip-editor.js` (modal interativo)
- `src/components/inbox.js` (REST API Supabase)
- `src/components/heatmap.js` (CSS Grid + tooltip)
- `src/components/budget.js` (SVG inline)
- `src/agents/concierge.js` + `chronicler.js` + `price-hunter.js` (chamam backend)
- `src/core/crypto.js` (Web Crypto API)
- `src/core/trips-api.js` (Contents API)
- `src/pwa/*` (Service Worker, IndexedDB, Push)

Para esses, validação é via **smoke test no browser** seguindo o checklist em `docs/DEPLOY.md`.

## Filosofia

- Testes só dos pontos onde a lógica é não-trivial (regex de inferência de datas, ponderação de critérios, retrocompat schema).
- Sem framework — `node:assert/strict` resolve.
- Roda em < 1s.
- Quebra se as funções públicas mudarem assinatura sem update.

Adicione novos testes conforme funções puras forem extraídas. Para DOM/network, prefira teste manual documentado em CHANGELOG.
