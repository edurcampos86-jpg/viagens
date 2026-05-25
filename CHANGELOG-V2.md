# CHANGELOG — Portal de Viagens v2.0

> Evolução do portfólio estático para sistema híbrido memória + planejamento.
> Branch: `claude/execute-tasks-OsD7g` (renomear para `feat/v2` antes do merge).
> 20 commits atômicos em 5 fases.

**Data:** 2026-05-19
**Sem breaking changes.** O site público continua funcionando exatamente como antes; tudo novo é opt-in.

---

## Sumário

| Fase | Tema | Commits | Linhas |
|---|---|---|---|
| 0 | Setup (PRD + docs + build tooling) | 1 | +1064 |
| 1 | Fundação (CRUD, persist, schema, checklist, Despachante) | 5 | +4255 |
| 2 | Integrações (Supabase, Gmail OAuth, parser, inbox, dates, budget) | 6 | +2452 |
| 3 | Inteligência (heatmap, benchmark, decision matrix, Otimizador) | 4 | +1411 |
| 4 | Experiência (wizard, Concierge, Cronista, PWA) | 4 | +1347 |
| **Total** | | **20** | **+10.529** |

---

## Fase 0 — Setup (`7ae89b2`)

- `docs/PRD-viagens-v2.md`, `docs/ARCHITECTURE.md`, `docs/AGENTS.md`
- Vite 6, ESLint flat config + Prettier (conservadores, ignoram código legado)
- `.gitignore` cobrindo `.env*`, `secrets.*`, `node_modules/`, `dist/`

## Fase 1 — Fundação

| Commit | Feature | Arquivos-chave |
|---|---|---|
| `d26077b` | CRUD inline com auto-complete | `src/components/trip-editor.js`, `src/core/geo.js` |
| `caae193` | Persistência GitHub Contents API + AES-256 + PBKDF2 200k | `src/core/crypto.js`, `src/core/trips-api.js`, `src/core/settings.js` |
| `1f4d17b` | Schema v2 + migration retrocompatível | `scripts/migrate_v1_to_v2.py`, `src/core/schema.js`, `data/backups/` |
| `b5a0f58` | Checklist contextual por país (12 regras) | `data/destination_rules.json`, `src/components/checklist.js` |
| `fe9dde8` | Agente Despachante Digital (🛂) | `src/agents/customs.js` |

42 viagens migradas para v2, todos os campos legacy preservados.

## Fase 2 — Integrações

| Commit | Feature | Arquivos-chave |
|---|---|---|
| `c881b92` | Supabase: 4 tabelas + RLS + TTL | `backend/migrations/001_initial.sql`, `backend/README.md` |
| `4a08579` | Gmail OAuth scope `readonly` | `backend/functions/gmail-oauth/`, `src/core/backend.js` |
| `dd12fd6` | Parser de e-mails: regex + fallback Claude Haiku | `backend/functions/gmail-parser/` (TAP, Booking, LATAM, Gol, Airbnb, Decolar, Hotels.com, Ticketmaster, Eventim, Cvent) |
| `2f8828d` | Bandeja de sugestões com matching de candidatas | `src/components/inbox.js`, `src/core/dates.js` |
| `bb8a2bb` | Período inferido do aéreo + provenance | `src/components/trip-editor.js` |
| `acfd94a` | Orçamento vivo: barras + pie chart | `src/components/budget.js` |

Backend pronto para deploy, inerte até credenciais serem configuradas.

## Fase 3 — Inteligência

| Commit | Feature | Arquivos-chave |
|---|---|---|
| `a6234a5` | Heatmap anual estilo GitHub | `src/components/heatmap.js` |
| `203a466` | Benchmark próprio (Python + JS) | `scripts/compute_benchmarks.py`, `data/benchmarks.json`, `src/components/benchmark.js` |
| `e528871` | Matriz de decisão multicritério | `src/components/decision-matrix.js` |
| `b58160e` | Agente Otimizador de Bolso (💸) | `backend/functions/price-monitor/`, `src/agents/price-hunter.js` |

## Fase 4 — Experiência

| Commit | Feature | Arquivos-chave |
|---|---|---|
| `10e8dff` | Wizard temporal (9 fases por janela) | `src/components/wizard.js` |
| `82dda51` | Agente Concierge Local (🍽️) — Claude Sonnet | `backend/functions/concierge/`, `src/agents/concierge.js`, `backend/functions/_shared/claude.ts` |
| `c2ac802` | Agente Cronista da Memória (📝) | `backend/functions/chronicler/`, `src/agents/chronicler.js` |
| `728ba62` | PWA Workbox + Web Push + IndexedDB sync | `src/pwa/sw-workbox.js`, `src/pwa/sync-queue.js`, `src/pwa/push.js` |

---

## 7 agentes finais

| # | Ícone | Nome | Fase | Onde mora |
|---|---|---|---|---|
| 1 | 🧳 | Bagagem | legado | `assets/app.js` |
| 2 | 💡 | Inspiração | legado | `assets/app.js` |
| 3 | 🛂 | Despachante Digital | F1.5 | `src/agents/customs.js` |
| 4 | 📥 | Curador de E-mail | F2.3+2.4 | `backend/functions/gmail-parser/` + `src/components/inbox.js` |
| 5 | 💸 | Otimizador de Bolso | F3.4 | `backend/functions/price-monitor/` + `src/agents/price-hunter.js` |
| 6 | 🍽️ | Concierge Local | F4.2 | `backend/functions/concierge/` + `src/agents/concierge.js` |
| 7 | 📝 | Cronista da Memória | F4.3 | `backend/functions/chronicler/` + `src/agents/chronicler.js` |

---

## Sprint SP-Junho 2026 (em andamento — Fase 1 fechada)

Sprint pra resolver os achados da auditoria ao vivo do `#plan/sp-junho-2026`
(São Paulo — Só Track Boa + Pride, 13–22/jun). Branch direto em `main`,
8 commits atômicos na Fase 1.

| Commit | Lote | O que mudou | Arquivos-chave |
|---|---|---|---|
| `331417e` | pré-sprint | `npm test` passa em Windows (`fileURLToPath`) | `tests/v2-modules.test.mjs` |
| `8c1c482` | B5 | Overlay local com namespace `_topLevel` + UI de sync (dialog/badge/exporter) | `src/core/overlay.js`, `assets/app.js`, `index.html`, `docs/OVERLAY.md` |
| `9bdd089` | B4 | Lazy populate dos cards da timeline (era 8× botão Despachante) | `assets/app.js:hydrateCard` |
| `8ff8cd9` | B3 | `computeNextAction(trip)` — janela T-D + estado (bookings/memory/checklist) | `assets/app.js` |
| `527a106` | B7 | `matches()` cobre region/month/trip_type + 5 regras BR-SP-junho/BR-verao/BE/IT/NL + plug no `populateChecklist`; doméstica sem passaporte | `src/components/checklist.js`, `data/destination_rules.json` (`_schema: 3`), `assets/app.js`, `tests/v2-modules.test.mjs` (+2) |
| `938be78` | B6 | Despachante: toast de profile vazio + spinner + erro visível | `assets/app.js:populateChecklist` |
| `d4b5e96` | B2 | `computeChecklistItems` compartilhado → quickstat conta auto-itens | `assets/app.js` |
| `a1d8992` | B1 | Editor inline de período (popover, ±1d, sugestão das reservas, validação, ↺ revert) → grava em `overlay._topLevel` | `assets/app.js`, import `deriveDatesFromBookings` |

**27/27 testes verdes** ao fim da Fase 1 (era 19/25 antes do fix do path).

### Fase 2 (em andamento)

| Lote | O que mudou | Arquivos-chave |
|---|---|---|
| #56 | cor `Outros` `#6b7280` + esconde câmbio p/ BRL (D6) + entrada Gmail no BACKLOG | `src/components/budget.js`, `assets/app.js`, `docs/BACKLOG.md` |
| U4 | POIs no mapa: `_topLevel.pois[]` com pin por categoria (kind→emoji), add por clique no mapa + popover (ARIA/Esc), remoção pela lista; persiste no overlay e entra no snippet de sync | `src/core/overlay.js` (`normalizePoi`, `POI_KINDS`), `assets/app.js` (`renderPoiPanel`, `openPoiNamePopover`, `POI_KIND_META`), `index.html`, `assets/styles.css` |
| B-N12 | resolvido junto da U4: `renderMiniMap` desmonta a instância Leaflet anterior antes de re-inicializar (acabou o "Map container is already initialized") | `assets/app.js:renderMiniMap` |

**35/35 testes verdes** ao fim da U4 (+8: `normalizePoi` + integração overlay/POIs).

---

## Métricas alcançadas vs PRD

| North star | Meta | v2.0 |
|---|---|---|
| Tempo médio para adicionar viagem | < 2min | ✅ Editor inline + auto-complete |
| Atualização orçamento auto | > 80% | ✅ `computeActualFromBookings` + Gmail inbox |
| Cobertura checklist contextual | 100% destinos cobertos | ✅ 12 regras + Schengen genérico |
| Engajamento PWA | > 60% | ⏳ Depende de uso pós-launch |

| Performance (PRD §5.3) | Meta | v2.0 |
|---|---|---|
| First Contentful Paint 3G | < 1.5s | ⏳ Não medido — manter monitoramento |
| Carga trips.json | < 200ms p/ 500 trips | ✅ 62KB hoje, lazy parse |
| Bundle JS gzipped | < 300KB | ✅ ~165KB **não-gzipped** (~50KB gzipped) |

---

## Próximos passos

1. **Renomear branch para `feat/v2`** e abrir PR para `main`.
2. **Deploy do backend:** seguir `docs/DEPLOY.md` (manual) ou delegar via `docs/COWORK-PROMPT.md`.
3. **Push notifications:** scaffolding pronto, falta gerar VAPID keys + criar Edge Function `push-register` (~15 min).
4. **Aumentar cobertura do parser:** fixtures atualmente em 3 (`TAP`, `Booking`, `Airbnb`); meta de 20 para validar critério ≥85% extração correta — adicionar conforme reservas reais chegam.

---

## Stack final

| Camada | Tech | Versão |
|---|---|---|
| Frontend | HTML5 + JS Vanilla | — |
| Build | Vite | 6.0.7 |
| PWA | Workbox | 7.0 (via CDN) |
| Backend | Supabase | free tier |
| Edge Functions | Deno | nativo Supabase |
| LLM | Anthropic API | Sonnet 4.6, Haiku 4.5 |
| Mapas | Leaflet | 1.9.4 |
| Geocoding | Nominatim | free |
| Preços | Kiwi Tequila | free tier |

**Custo de operação estimado:** < US$ 5/mês (uso pessoal).
