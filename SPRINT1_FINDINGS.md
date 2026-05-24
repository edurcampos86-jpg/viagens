# Sprint 1 — Findings de reconhecimento e auditoria

> Branch: `sprint1/schema-v2` · Gerado em 2026-05-24
> Escopo: reconhecimento do terreno (Fase A) + auditoria estática do JS público (Fase B)
> Princípio: **apenas leitura.** Esta entrega é diagnóstico, não correção.

---

## ⚠ Achado-bloqueador para a Sprint 1 (ler antes de tudo)

**O escopo das Tarefas 2, 3 e 4 do briefing original da Sprint 1 já está implementado neste repositório.** Confirmado por código + docs:

| Tarefa Sprint 1 (briefing) | Estado real no repo |
|---|---|
| T2 — Criar `tools/migrate_trips.py` | ✅ `scripts/migrate_v1_to_v2.py` existe (173 linhas), wired ao npm script `test:migration` ([package.json:16](package.json#L16)) |
| T3 — Migrar `data/trips.json` para schema v2 com `bookings[]` | ✅ Migrado em 2026-05-19 (CHANGELOG-V2.md Fase 1.3, commit `1f4d17b`). Backup em [`data/backups/trips-pre-v2-20260519T013018.json`](data/backups/trips-pre-v2-20260519T013018.json) |
| T4 — Documentar schema v2 em `docs/SCHEMA_V2.md` | ⚠ Parcial: schema declarativo está em [`data/schemas/trip.schema.json`](data/schemas/trip.schema.json) (JSON Schema validado por CI). PRD ([`docs/PRD-viagens-v2.md`](docs/PRD-viagens-v2.md) §3.2) cobre conceitualmente, mas **não existe `docs/SCHEMA_V2.md` com a "fórmula de urgência" descrita no briefing**. Só esse subitem está faltando |

O schema v2 atual usa `bookings.{flights[], stays[], experiences[]}` (estruturado por tipo) — diferente do briefing original, que propunha `bookings[]` plano com `tipo` discriminator. Antes da Tarefa 4, alinhar qual schema o Cockpit (Sprint 2) vai usar.

A Tarefa 1 (esta auditoria) e a Tarefa 4 são as únicas que fazem sentido seguir como propostas. Ver §"Conclusões e perguntas" no fim.

---

## Fase A — Reconhecimento

### A.1 Estrutura do projeto

Árvore relevante (2 níveis, excluindo `node_modules`, `.git`, `media/`, `previews/identidade`):

```
viagens/
├── index.html                # 693 linhas — SPA shell + dialogs
├── manifest.webmanifest      # PWA manifest
├── 404.html                  # página de erro estática
├── package.json              # vite/eslint/prettier (devDeps only)
├── vite.config.js            # dev server :5173, build em dist/, publicDir:false
├── eslint.config.js          # flat config, ignora assets/sw.js/data/
├── .prettierrc.json
├── .prettierignore           # NÃO reformata code legado (assets/, sw.js, index.html)
├── .gitignore                # cobre OAuth secrets, .env, node_modules, .vite, .DS_Store
├── .gitattributes            # Git LFS para *.webp/jpg/png/mp4/heic/avif/mov/webm
├── README.md
├── CHANGELOG-UX.md           # 26 KB — log da fase de UX (tour, empty states)
├── CHANGELOG-V2.md           # 6 KB — 20 commits da V2.0 em 5 fases (até 2026-05-19)
├── QA-REPORT.md              # 20 KB — auditoria estática Fase 1 (B1-B21)
├── sw.js                     # 30 linhas — stub de auto-unregister do SW antigo
├── sw-workbox.js             # 194 linhas — SW v2 com Workbox 7 (CDN)
├── assets/
│   ├── app.js                # 3800 linhas — app legado (timeline, mapa, cards, agentes 🧳/💡)
│   ├── styles.css            # estilos do app legado
│   └── sync-button.js        # 194 linhas — botão "Sync agora" que dispara workflow sync.yml
├── src/                      # código v2 modular
│   ├── main.js               # 808 linhas — bootstrap v2 (badges, modais, SW registration)
│   ├── core/                 # anthropic-key, backend, crypto, dates, geo, schema, settings, trips-api
│   ├── components/           # 7 componentes (benchmark, budget, checklist, decision-matrix, heatmap, inbox, trip-editor, wizard)
│   ├── agents/               # 4 agentes (chronicler, concierge, customs, price-hunter)
│   └── pwa/                  # push.js + sync-queue.js
├── data/
│   ├── trips.json            # 52 trips, schema v2
│   ├── destination_rules.json # 12 regras por país (visto, vacinas, voltagem)
│   ├── benchmarks.json       # cache gerado por compute_benchmarks.py
│   ├── countries-110m.geojson
│   ├── documentos.json       # dados pessoais do Eduardo (NÃO public; ver §risco abaixo)
│   ├── preferencias.json     # estilo do Eduardo (Aman, 4-stars+, premium)
│   ├── sync-state.json
│   ├── backups/              # backups pré-migrations
│   ├── schemas/              # 4 JSON schemas (validados em CI)
│   ├── audit-report.md
│   ├── fase-1b-coleta.md
│   └── fase-1b-pendencias.md
├── docs/                     # 22 arquivos .md (PRD, ARCHITECTURE, AGENTS, DEPLOY, SETUP, ...)
├── scripts/                  # 19 .py (migration, benchmarks, ingest, parsers, auditor, curador)
├── tests/
│   ├── README.md
│   └── v2-modules.test.mjs   # 25 testes, Node 22 nativo
├── backend/                  # Supabase Edge Functions (5 functions) + migrations SQL
├── icons/                    # icon-192.svg, icon-512.svg
├── .github/workflows/        # 7 workflows: audit, curator, ingest, post-deploy-smoke, sync, tests, validate-schemas
└── .claude/settings.json
```

**Configs (1-liner cada):**

| Arquivo | O que faz |
|---|---|
| `package.json` | Vite 6 + ESLint 9 + Prettier 3 (devDeps). Scripts: `dev`, `build`, `preview`, `lint`, `format`, `test`, `test:migration`, `test:benchmarks`. Versão `2.0.0-alpha.0`, type:module |
| `vite.config.js` | Root `.`, `publicDir:false`, dev server :5173, build em `dist/`. Comentário declara que build é só p/ validação local — produção continua servida via GitHub Pages a partir da raiz |
| `eslint.config.js` | Flat config. Ignora `dist/`, `data/`, `previews/`, `icons/`, `sw.js`, `.claude/`. Globals: browser + ES2023 + Leaflet (`L`). Rules conservadoras (no-undef erro, prefer-const warn, eqeqeq smart). `src/**` tem `no-unused-vars` como erro |
| `.prettierrc.json` | Semi, single quote, trailing comma es5, printWidth 100, LF |
| `.prettierignore` | "Não reformatar código existente" — ignora `assets/`, `data/`, `index.html`, `404.html`, `CHANGELOG-UX.md`, etc |
| `.gitignore` | Cobre OAuth (`client_secret.json`, `token.json`), `.env*`, `secrets.*`, `node_modules/`, `dist/`, `media-import/`, `proposals.json` |
| `.gitattributes` | Git LFS para imagens (webp/jpg/png/heic/avif) e vídeos (mp4/mov/m4v/webm). SVG explicitamente fora do LFS |
| `manifest.webmanifest` | PWA: Minhas Viagens, `start_url:./`, scope `./`, theme `#fff8ee`, icons SVG only |
| `404.html` | Página estática com gradient e link "Voltar ao início" |

### A.2 Documentação preexistente

**`README.md`** (5.7 KB) — Apresentação técnica do projeto. Posiciona como "memória + planejamento", site em GitHub Pages, evoluído na v2 para 7 agentes + edição inline + integração Gmail. Lista 3 modos de operação (público / autenticado local com PAT / backend conectado), princípios não-negociáveis (trips.json é SSOT, static-first, human-in-the-loop, privacidade mínima) e stack final.

**`CHANGELOG-V2.md`** (6.2 KB) — Resposta direta à pergunta "a V2 mexe em schema?": **sim, e já mexeu**. 20 commits atômicos em 5 fases, fechados em 2026-05-19. Fase 1.3 (commit `1f4d17b`) introduziu schema v2 retrocompatível com migration Python (`scripts/migrate_v1_to_v2.py`) e backup automático em `data/backups/`. Schema v2 adicionou: `bookings.{flights[],stays[],experiences[]}`, `dates.{start,end,computed_from}`, `budget.{planned,actual,currency}`, `checklist`, `notes`, `created_at`/`updated_at`. **42 viagens migradas**, todos os campos legacy preservados. Hoje há 52 trips no JSON (10 adicionadas pós-migration via PR #38).

**`QA-REPORT.md`** (20 KB) — Auditoria estática Fase 1, 21 achados (2 críticos, 6 altos, 8 médios, 5 baixos). **19 bugs corrigidos**, 2 falsos positivos (B15, B21). Escopo do QA excluiu explicitamente `src/`, `src/agents/`, backend e itens que carecem de browser real (Lighthouse, contraste, touch). Re-verifiquei via Grep e os fixes estão presentes na codebase (B1, B3, B5, B9, B13 confirmados — ver §B abaixo).

**`docs/`** (22 arquivos) — Coleção rica:
- [`PRD-viagens-v2.md`](docs/PRD-viagens-v2.md) — PRD original. Roadmap em 4 fases, todas concluídas (checkboxes `[x]`). Schema v2 detalhado em §3.2
- [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Diagrama ASCII das camadas, fluxos de leitura/escrita, contratos, segredos. **Documento parcialmente stale**: ainda diz que Concierge usa Supabase Edge Function, quando na verdade foi refatorado para chamar Anthropic direto do browser (PR #46, commit `439c5ff`)
- [`AGENTS.md`](docs/AGENTS.md) — Spec dos 7 agentes
- [`INVENTARIO-ATUAL.md`](docs/INVENTARIO-ATUAL.md) — Inventário de 52 trips: 41 done · 6 planned · 1 draft · 4 wishlist · 2 com media.gallery
- [`TRIPS-FANTASMA-INVESTIGAR.md`](docs/TRIPS-FANTASMA-INVESTIGAR.md) — RFC interno com 5 perguntas pendentes p/ Eduardo (trips que existiriam no Google Lugares mas não no trips.json)
- [`BUG-MEMORIA-RENDER.md`](docs/BUG-MEMORIA-RENDER.md) — Diagnóstico de 4 bugs encadeados (modo memória sem renderizar, stats zeradas, mapa sem pins, slider NaN). Todos resolvidos. Verifiquei o fix da `.catch` em `app.js:3799` ✅
- `DEPLOY.md`, `DISASTER_RECOVERY.md`, `SETUP-LOCAL.md`, `SETUP.md`, `INGESTAO.md`, `EDICOES.md`, `LEGENDAS-INTELIGENTES.md`, `CURADOR.md`, `CURADORIA-MATRIZ.md`, `AUDITOR.md`, `PLACES-AUDIT.md`, `CALIBRACAO-CAPTIONS-V2.md`, `COWORK-PROMPT.md`, `CLAUDE_CODE_PROMPT.md`, `SETUP_PROMPT.md`, `COMO-DELEGAR-DEPLOY.md` — operacionais (não lidos integralmente)

**Documentação stale identificada** (worth a follow-up):
1. `docs/ARCHITECTURE.md` §3 ainda mostra Concierge no fluxo Supabase — foi refatorado em PR #46 e agora chama Anthropic API direto do browser via `src/agents/concierge.js`. A tabela §4.3 também precisa atualizar a linha do Concierge
2. `docs/AGENTS.md:204` diz Concierge usa Sonnet via Supabase — código atual usa `claude-opus-4-7` direto do browser (line 18 do agente)
3. `README.md:25-26` ainda mostra `src/agents/inbox-curator.js` — não existe; o curador agora vive em `src/components/inbox.js`

### A.3 Backend

**O que faz:** integrações externas (Gmail readonly, monitor de preços Kiwi, agentes Claude). Nunca substitui `trips.json` como fonte da verdade — só propõe sugestões que o frontend aprova e commita via GitHub API.

**Onde mora:** Supabase (free tier). Estrutura em `backend/`:
- `migrations/001_initial.sql` — schema + Row Level Security
- `functions/_shared/` — utils (claude.ts centraliza `anthropic-no-training: true`)
- `functions/gmail-oauth/` — F2.2, OAuth flow com state HMAC anti-CSRF
- `functions/gmail-parser/` — F2.3, parser regex + LLM fallback Claude Haiku
- `functions/concierge/` — F4.2, Sonnet (mas hoje **inerte**: o frontend refatorou para chamar Claude direto via `src/agents/concierge.js`)
- `functions/chronicler/` — F4.3
- `functions/price-monitor/` — F3.4 (cron diário)
- `test_fixtures/` — 3 e-mails sample (TAP, Booking, Airbnb)

**Deploy:** manual via `supabase functions deploy <name>`, secrets via dashboard. Cron jobs configurados em SQL via `cron.schedule(...)`.

**Endpoints que o frontend chama:**
- `gmail-oauth/start` e `gmail-oauth/callback`
- `gmail-parser` (via cron, frontend só lê resultado em `inbox_events`)
- `price-monitor` (idem)
- `concierge`, `chronicler` — declaradas mas atualmente **bypassed** pelo frontend (vai direto Anthropic)

**Variáveis sensíveis (em Supabase Edge Functions secrets, NÃO no repo):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `FRONTEND_REDIRECT_URI`, `ANTHROPIC_API_KEY`, `KIWI_TEQUILA_API_KEY`, `OAUTH_STATE_SECRET`, `CRON_SECRET`, `WEBPUSH_VAPID_*`. Template em `backend/.env.example` ✅ (sem valores, gitignored em `.env.local`).

**Estado atual de deploy:** docs/PRD-viagens-v2.md e CHANGELOG-V2.md indicam que o backend está **pronto para deploy mas inerte** (sem credenciais configuradas em produção). O frontend degrada graciosamente ("Conectar Supabase + Gmail" mostra o botão, mas não chama nada).

### A.4 Pipeline de build/deploy

**Scripts npm (`package.json:7-17`):**
- `dev` → `vite` (porta 5173, HMR)
- `build` → `vite build` (saída em `dist/`)
- `preview` → `vite preview`
- `lint` / `lint:fix` → ESLint em `assets/**/*.js` e `src/**/*.js`
- `format` / `format:check` → Prettier em `src/**` e `docs/**.md`
- `test` → `node tests/v2-modules.test.mjs` (25 testes Node nativo)
- `test:migration` → `python3 scripts/migrate_v1_to_v2.py --dry-run`
- `test:benchmarks` → `python3 scripts/compute_benchmarks.py --dry-run`

**Deploy de produção:** GitHub Pages automático em push para `main`. **O build Vite não é necessário para deploy** — `index.html` na raiz já carrega `assets/app.js` (module), `assets/sync-button.js` (defer), `src/main.js` (module), e CDNs externos (Leaflet, fonts, Workbox). Vite é opcional para dev/lint/test.

**GitHub Actions (`.github/workflows/`):**

| Workflow | Trigger | O que faz |
|---|---|---|
| `tests.yml` | PR + push em main com mudança em `scripts/**.py` | Roda 4 suites Python (parsers, matching, auditor, curador) em Ubuntu/3.11 |
| `validate-schemas.yml` | PR + push com mudança em `data/**.json` ou schemas | `scripts/validate_schemas.py` valida `trips.json` contra `trips-file.schema.json` |
| `post-deploy-smoke.yml` | Pós deploy GitHub Pages + cron 6h + manual | `curl` em 6 URLs críticas (index.html, app.js, styles.css, sw-workbox.js, manifest, main.js) checando size mínimo + string esperada. Notifica Slack + abre Issue com label `smoke-fail`/`incident` em falha |
| `audit.yml`, `curator.yml`, `ingest.yml`, `sync.yml` | Variados | Pipeline de ingestão de fotos Google Takeout + curadoria de captions (Fase 3 do projeto) |

### A.5 Testes

**Framework:** Node 22 nativo (`node:assert/strict`), sem deps externas. Roda em <1s.

**Cobertura (`tests/v2-modules.test.mjs`, 25 testes):**

| Módulo | Testes |
|---|---|
| `src/core/schema.js` | 7 (getDates v1/v2/empty, validateTrip ok/fail, getBookings v1/v2) |
| `src/core/dates.js` | 3 (deriveDatesFromBookings de flights/stays/null) |
| `src/core/geo.js` | 3 (flagFromCountryCode, slugify acentos, tripIdFrom) |
| `src/components/decision-matrix.js` | 1 (computeScores com pesos) |
| `src/components/benchmark.js` | 2 (compareTrip empty + populado) |
| `src/components/wizard.js` | 3 (nextStep em D-194/D-19/post-trip) |
| `src/components/checklist.js` | 4 (TH, BR, FR via Schengen genérico, idempotência) |
| `src/agents/customs.js` | 2 (doméstica vs internacional) |

**Estão passando?** **Não rodei** (princípio: zero side-effects nesta tarefa). O QA-REPORT (linha 38) diz `npm test` está 25/25 verde no estado pós-correções da Fase 1.

**Cobertura limitada por design:** módulos que dependem de DOM/Web Crypto/network ficam de fora (`trip-editor`, `inbox`, `heatmap`, `budget`, `crypto`, `trips-api`, `pwa/*`, agentes que chamam backend). Validação desses é via smoke manual + `post-deploy-smoke.yml`.

**Python tests:** `scripts/test_parsers.py`, `test_matching.py`, `test_auditor.py`, `test_curador.py`, `test_ingest.py`, `test_smart_captions.py`. Rodam no CI via `tests.yml`. `test_ingest.py` tem 1 falha conhecida no Windows (path separator, documentada em `BUG-MEMORIA-RENDER.md` linha 274) — não bloqueante.

---

## Fase B — Auditoria de bugs nos JS

> Escopo per briefing: `index.html`, `assets/app.js`, `assets/sync-button.js`, `src/main.js`, `sw.js`, `sw-workbox.js`. Achados em `src/agents/concierge.js` e `src/core/anthropic-key.js` foram superficiais (Grep) e só servem para responder questões abertas — não pretendem ser auditoria completa.

### 🔴 Bugs críticos

**B-N1 — PAT em texto claro no `sync-button.js`**
- **File:** [`assets/sync-button.js:19,87`](assets/sync-button.js#L19)
- **Problema:** O botão "Sync agora" pede um PAT do GitHub via `window.prompt(...)` e armazena em `localStorage` **sem cifragem** (`localStorage.setItem('gh_sync_token', token)`). Contraste direto com o PAT do editor inline (`src/core/settings.js`) que usa AES-256 + PBKDF2 200k.
- **Por que importa:** o PRD (linha 332) e o README (linha 84) prometem "PAT cifrado AES-256". O `sync-button.js` viola essa promessa. Se qualquer script externo injetado (XSS, comprometimento de CDN do Leaflet/Workbox) tiver acesso ao `localStorage`, o token vaza em texto claro. O escopo do token é `Actions: read+write` no repo `viagens` — alguém com ele dispara workflows arbitrariamente, podendo gravar em main via `sync.yml`.
- **Correção sugerida:** unificar com `src/core/settings.js` (mesma cifragem, mesma senha mestra). Alternativamente: trocar o botão "Sync agora" por um link para o GitHub Actions UI (dispara o workflow lá) e remover o PAT do site.

**B-N2 — Anthropic API key trafega via header `x-api-key` em request do browser, key visível no DevTools Network durante uso**
- **File:** [`src/agents/concierge.js:158`](src/agents/concierge.js#L158)
- **Problema:** O Concierge foi refatorado em PR #46 (`439c5ff`) para chamar `https://api.anthropic.com/v1/messages` direto do browser, com `x-api-key: <key>` no header. A key fica cifrada em localStorage até o usuário desbloquear — mas no momento do uso ela passa para a aba do Anthropic API. Em DevTools, qualquer extensão ou aba comprometida pode interceptar.
- **Mitigações já presentes:** AES-256/PBKDF2 cifragem em repouso ✅; `anthropic-no-training: true` ✅; `anthropic-dangerous-direct-browser-access: true` (header oficial Anthropic) ✅; modal de unlock por sessão ✅.
- **Por que ainda é crítico:** a key é do Eduardo, blast radius é a fatura dele. Em uso normal é tolerável. Mas:
  1. **Docs estão stale.** `docs/ARCHITECTURE.md` e `AGENTS.md` ainda dizem que Concierge passa por Supabase Edge Function — não passa mais. Quem ler os docs vai assumir uma postura de segurança que não existe.
  2. **`backend/functions/concierge/` virou código morto** — pronto para deploy mas inerte.
  3. O fluxo correto (Supabase secrets + Edge Function) está implementado mas bypassed. Voltar a ele resolve esse risco.
- **Correção sugerida:** decidir entre (a) consolidar em backend e atualizar docs, ou (b) consolidar em browser, atualizar docs, e remover `backend/functions/concierge/`. Sem decisão, a arquitetura permanece divergente.

### 🟡 Atenção (degradam UX / promessas quebradas / código morto)

**B-N3 — Notification icon paths absolutos quebram em GitHub Pages project**
- **File:** [`sw-workbox.js:151-152,163`](sw-workbox.js#L151)
- **Problema:** `icon: '/icons/icon-192.svg'` e `notificationclick → openWindow('/')`. O site é deployado em `https://edurcampos86-jpg.github.io/viagens/`, então `/icons/...` resolve para `https://edurcampos86-jpg.github.io/icons/icon-192.svg` (404) e `/` redireciona para a página principal do GitHub Pages do usuário, **não** para o site viagens.
- **Estado real:** dormant — push notifications ainda não estão ativas (CHANGELOG-V2.md "Próximos passos" diz "falta gerar VAPID keys + criar Edge Function push-register"). Logo que push for ativado, o bug fica visível.
- **Correção:** trocar para caminhos relativos: `icon: './icons/icon-192.svg'`, `openWindow('./')` (compatível com o scope `./` já configurado).

**B-N4 — Documentação stale sobre Concierge**
- **Files:** `docs/ARCHITECTURE.md` §3 e §4.3, `docs/AGENTS.md:204`, `README.md:25`
- **Problema:** Múltiplos docs ainda descrevem o Concierge como Edge Function Supabase com Sonnet. Refatoração PR #46 (commit `439c5ff`, 2026-05-2x) passou para client-side Opus 4.7. Quem ler os docs constrói modelo mental incorreto.
- **Correção:** atualizar 3 arquivos. Trivial.

**B-N5 — `_swActivatedSeen` reseta a cada page load, quebra promessa "toast on update"**
- **File:** [`src/main.js:104,122-128`](src/main.js#L104)
- **Problema:** Flag para ignorar o **primeiro** `sw-activated` (instalação inicial) vive em escopo de módulo. A cada page load ela volta a `false`. Resultado: quando um deploy novo é feito e o usuário visita o site pela primeira vez pós-deploy, o SW novo dispara `sw-activated` → flag aceita como "primeira" e **ignora**. Toast "Nova versão disponível" nunca aparece.
- **Detecção alternativa correta:** comparar `e.data.version` recebida com um valor em `localStorage`/IndexedDB persistido. Toast quando ≠ último visto.

**B-N6 — `assets/sync-button.js` mistura escopo de PAT com src/core/settings.js sem reuso**
- **File:** `assets/sync-button.js` inteiro
- **Problema:** O arquivo vive na pasta `assets/` (módulo legado) mas duplica conceitos do `src/core/settings.js` (PAT storage). Resulta em dois badges de PAT na UI: o do header (este) e o `⚙ Configurar PAT` do FAB stack (src/main.js:543). Usuário confuso. Permissões diferentes (`Actions:write` aqui, `contents:write` lá). Tokens distintos em `localStorage`.
- **Correção:** B-N1 já endereça isso; merger com src/core/settings.js.

**B-N7 — Sem Content-Security-Policy declarado**
- **File:** `index.html` (faltando)
- **Problema:** O site carrega de várias origens (fonts.googleapis.com, unpkg.com, storage.googleapis.com workbox, api.anthropic.com, raw.githubusercontent.com, api.github.com). Sem `<meta http-equiv="Content-Security-Policy">`, qualquer XSS pode injetar `<script src="evil.com">`. Com cifragem de PAT/Anthropic key em jogo, defense-in-depth é desejável.
- **Custo:** CSP exige inventário cuidadoso + testes. Não é trivial mas é a maior vitória de segurança disponível.

**B-N8 — Git LFS configurado mas arquivos existentes não foram migrados**
- **Files:** `media/iguacu-2021/*.webp`, `*.mp4` (18 arquivos, ~13 MB)
- **Problema:** `.gitattributes` define filtros LFS para essas extensões, mas os arquivos commitados em `media/iguacu-2021/` foram adicionados ANTES do LFS ser ativado. O `git clone` deste repo emitiu o warning *"Encountered 18 files that should have been pointers, but weren't"*. Os arquivos funcionam (são bytes reais), mas o repo carrega o peso e o tráfego não usa LFS bandwidth.
- **Detecção:** confirmado por `head -c 200 media/iguacu-2021/01.webp` → header `RIFF...WEBPVP8` (binário real, não pointer LFS).
- **Correção:** `git lfs migrate import --include="*.webp,*.mp4,*.jpg,*.png" --include-ref=refs/heads/main` (instruído no próprio `.gitattributes:7`). Requer `git lfs install` + cuidado com força-push.

**B-N9 — `src/main.js` importa 14 módulos no top-level sem error boundary**
- **File:** [`src/main.js:10-28`](src/main.js#L10)
- **Problema:** Bloco de imports síncrono. Se qualquer um dos 14 arquivos falhar (404 pós-deploy parcial, parse error em um único módulo), todo o bootstrap v2 quebra silenciosamente (o `<script type="module">` falha sem disparar nada visível para o usuário). O `try/catch` em volta de `backend.captureSessionFromUrl()` (linha 83) cobre só uma chamada.
- **Correção:** ou usar dynamic `import()` com fallback para cada feature, ou ao menos um `window.addEventListener('error', ...)` global no início do arquivo registrando falhas no console.

**B-N10 — `data/documentos.json` está versionado e contém dados pessoais**
- **File:** `data/documentos.json`
- **Problema:** O `.gitignore` cobre `client_secret.json`, `token.json`, `*.credentials`, `.env.*` — mas **não** `documentos.json`. O arquivo está commitado e potencialmente expõe número/validade de passaporte, vacinas, dados que o agente Despachante usa. Não consegui confirmar o conteúdo sem ler (a auditoria é leitura-only mas evito ler dados pessoais sem necessidade).
- **Correção:** validar se o conteúdo deveria mesmo ser público (repo é público em `edurcampos86-jpg/viagens`). Se não, mover para `.env`/secret ou cifrar.

### 🔵 Informativo (backlog futuro)

- **`assets/app.js` tem 68 usos de `innerHTML =`** com `escapeHtml`/`escapeAttr` aplicados em 36 lugares. Pareceu consistente nos trechos amostrados, mas merece uma passagem de defesa em profundidade junto com CSP (B-N7).
- **Heatmap modal (src/main.js:683)** faz `fetch('data/trips.json', { cache: 'no-cache' })` — bypassa o SW NetworkFirst do Workbox. Provavelmente intencional (sempre quer JSON fresco), mas duplica lógica do SW. Considerar `cache: 'reload'` ou deixar o SW decidir.
- **`sw-workbox.js:127`** — limpeza de caches antigos filtra `!k.endsWith('-v2')` mas os cache names já estão fixos em `-v2`. Quando alguém promover para `-v3`, esse filtro precisa atualizar. Fragilidade leve.
- **`assets/app.js` tem 3800 linhas em um único arquivo monolítico.** ESLint mostraria warnings de `no-unused-vars` (regra é `warn` aqui, `error` só em `src/**`). Migração progressiva para `src/` é o caminho declarado no PRD §5.2.
- **`assets/sync-button.js` usa `window.prompt`** (linha 81) que não mascara o token na tela. UX/segurança subótima. Pequeno.
- **`backend/functions/concierge/` é código morto** após PR #46. Remover ou re-conectar.
- **`src/components/inbox.js`** existe (referido em README:30 como "agente Curador") — não auditado nesta passada por estar fora do escopo do briefing.

### Promessa Concierge / Claude Opus

**Como está implementado hoje:**
1. Chave Anthropic configurada via badge `🔐 Anthropic` na UI ([`src/main.js:295-365`](src/main.js#L295))
2. Cifrada em `localStorage` (key `viagens.v2.anthropic`) com AES-256-GCM + PBKDF2 200k via [`src/core/anthropic-key.js`](src/core/anthropic-key.js)
3. Desbloqueada por sessão (mantida em memória, perdida no reload)
4. Quando o usuário clica "🍽 Concierge" na tab da plan-page, [`src/agents/concierge.js`](src/agents/concierge.js) chama `https://api.anthropic.com/v1/messages` diretamente do browser com o header `anthropic-dangerous-direct-browser-access: true` (opt-in oficial da Anthropic) e `anthropic-no-training: true`
5. Model: `claude-opus-4-7`. Custo ~$0.30/itinerário.

**Qual das 3 hipóteses do briefing era?**
> "(a) chave de API exposta no front (🔴 crítico — risco de segurança), (b) chamada via proxy/Worker, (c) mock/placeholder."

A resposta é **(a) com mitigação**. A chave é **do próprio Eduardo**, cifrada em repouso, só desbloqueada com senha mestra. Não há servidor que pague a fatura. Não é um SaaS público — é uma ferramenta pessoal. O risco é (i) XSS expondo a chave em memória durante uso, (ii) docs stale induzindo o usuário a achar que o backend é quem chama. Ver B-N2 e B-N4.

**O caminho (b) existe no código (`backend/functions/concierge/`) mas está dormant.** É a pré-refatoração de PR #46.

### Dois service workers — qual é o ativo?

**Ativo:** `sw-workbox.js` (194 linhas). Registrado por [`src/main.js:94`](src/main.js#L94) com escopo `./`. Faz precache de 9 URLs do shell + 5 estratégias runtime (NetworkFirst para `trips.json`, StaleWhileRevalidate para outros JSONs/CSS/JS, CacheFirst para tiles de mapa e imagens, expiry de 30 dias). Versão atual: `viagens-v3-pwa-1`. Trata push + notificationclick + Background Sync tag `viagens-edit-queue`.

**Inativo (stub de transição):** `sw.js` (30 linhas). Nunca é registrado por nada no código atual. Existe para o cenário em que um usuário tem o SW antigo `sw.js` instalado do tempo pré-Workbox — ao atualizar o site, o velho `sw.js` recebe o `activate` event do novo stub, que limpa caches `viagens-v*` e se auto-desregistra. Após isso, `src/main.js` registra o `sw-workbox.js`. **É código de migração correto.** Worth comentar mais claramente que ele NUNCA deve ser registrado de novo.

**Sanity check do `post-deploy-smoke.yml:75-76`:** o smoke checa `sw-workbox.js` contém a string `viagens-v3-pwa-1` — bate com a constante `VERSION` em `sw-workbox.js:27`. ✅

### Git LFS quebrado em `media/iguacu-2021/`

Coberto em B-N8. Resumo: 18 arquivos (5 fotos + 5 thumbs + 4 vídeos + 4 vídeo-thumbs) commitados ANTES do LFS ser ativado. Funcionam, mas bloated. Correção via `git lfs migrate import` (instruído no `.gitattributes:7`).

### Fluxo de edição local → GitHub (mapeamento p/ Sprint 3)

**localStorage:**
- `assets/app.js:171,177,179,1098,1115,1148,1176,1180` — `LS_KEY` (não identifiquei o valor exato sem ler trecho específico; provável `viagens-edits` ou similar). Edições inline de viagem ficam aqui até serem exportadas.
- `assets/app.js:299,304,320` — theme persistence (`theme`)
- `assets/app.js:3055,3097,3101` — empty-state dismissal flags
- `assets/app.js:3370,3555,3556` — tour state (`tour-completed`, `tour-skipped`)
- `assets/sync-button.js:19,40,87` — PAT do sync (sem cifragem) **B-N1**
- `src/core/settings.js` (não lido inteiro) — PAT do editor inline (cifrado)
- `src/core/anthropic-key.js` — chave Anthropic cifrada
- `src/core/backend.js` (não lido) — config Supabase

**Botão "Exportar trips.json":** declarado em `index.html:546-579` (`<dialog id="exportDialog">`). Lógica em `assets/app.js` perto da linha 1144 (`fetch('data/trips.json')` + merge com edits do localStorage + download como blob). Detalhes específicos não auditados — fora do escopo.

**Botão "Sync agora" (header):** [`assets/sync-button.js`](assets/sync-button.js) dispara workflow `sync.yml` via GitHub Actions API. Caminho diferente do CRUD inline (`src/core/trips-api.js`).

**Para Sprint 3 (RF3 — automatizar edição local → GitHub via API):**
- O fluxo já existe (`src/core/trips-api.js` + `src/components/trip-editor.js`). A pergunta para o Eduardo é: o que falta? Provavelmente conflito-handling, fila offline (já existe em `src/pwa/sync-queue.js`?), ou UX de "sincronizar dispositivos múltiplos".

---

## Conclusões e perguntas para o Eduardo

### Diagnóstico final da Sprint 1 original

**T1 (auditoria):** entregue aqui (este arquivo).

**T2 (criar migrate_trips.py):** **redundante.** `scripts/migrate_v1_to_v2.py` já existe, é parte do toolchain (`npm run test:migration`).

**T3 (executar migração):** **redundante.** Foi feita em 2026-05-19. `data/backups/trips-pre-v2-20260519T013018.json` é a evidência. `data/trips.json` atual já está no schema v2.

**T4 (documentar schema v2):** **parcialmente redundante.** Schema declarativo existe (`data/schemas/trip.schema.json`), descrição conceitual no PRD §3.2. **O que falta:** o `docs/SCHEMA_V2.md` com a "fórmula de urgência" descrita no briefing — esse documento NÃO existe.

### Diferença de schema importante entre briefing e realidade

| Briefing original (Sprint 1) | Schema v2 real implementado |
|---|---|
| `bookings[]` plano com `tipo` ∈ `voo/hotel/ingresso/documento/decisao` | `bookings.{flights[], stays[], experiences[]}` estruturado por tipo |
| `id`, `titulo`, `status`, `criticidade`, `notas` por booking | `id`, `airline`/`name`, `from/to/check_in/...`, `price_brl`, `source`, `pnr` |
| Fórmula de urgência baseada em `dataLimite` + `criticidade` + `pendencia` | Não existe campo `criticidade` por booking; nem `dataLimite` global. Decisão de urgência hoje vive em `src/components/wizard.js` (D-90/60/30/14 fixo) |

Antes da Sprint 2 (Cockpit), precisamos decidir: **estender o schema v2 atual com os campos do briefing**, ou **derivar a visão de cockpit dos campos existentes**?

### 3 decisões pendentes para a Sprint 2 (Cockpit)

1. **Schema do cockpit.** O briefing prevê `bookings[]` plano com `tipo: "voo|hotel|ingresso|documento|decisao"`. Schema real tem `bookings.flights[]`, `bookings.stays[]`, `bookings.experiences[]`. Não há `documento` nem `decisao` como tipos de booking — `documento` é tratado pelo agente Despachante (vindo de `destination_rules.json`); `decisao` é o `decision-matrix.js` separado. Para o Cockpit, escolher uma das duas:
   - (a) Achatar `bookings.{flights,stays,experiences}` em um array unificado em tempo de render (compatível, zero migração)
   - (b) Migrar para schema plano com discriminator (segundo round de migração)
2. **Concierge — backend ou browser?** Hoje é client-side (PR #46). Implica: Eduardo precisa lembrar de configurar sua chave Anthropic. Não funciona para visitantes. Em troca: zero custo de backend. Manter? Reverter? Documentar a escolha?
3. **Sync-button PAT (B-N1).** Manter o botão "Sync agora" no header (e endereçar o plaintext PAT)? Ou remover e deixar só o link para GitHub Actions UI?

### Sugestão de redirecionamento da Sprint 1

- ✅ Tarefa 1 — entregue (este arquivo)
- 🔄 **Substituir Tarefas 2-3** por: "Endereçar B-N1, B-N4 e B-N10 — três achados de risco/dívida que viraram visíveis na auditoria"
- 🔄 **Substituir Tarefa 4** por: "Escrever `docs/SCHEMA_V2.md` UNIFICANDO o schema real + a fórmula de urgência do briefing, e marcar `docs/ARCHITECTURE.md` como atualizado"

Eduardo decide. Aguardando direção antes de qualquer mudança no código.
