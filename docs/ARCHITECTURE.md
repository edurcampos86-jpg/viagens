# Arquitetura — Portal de Viagens v2.0

Documento complementar ao [PRD](./PRD-viagens-v2.md). Detalha as camadas, fluxos de leitura/escrita, contratos entre componentes e princípios de segurança.

---

## 1. Princípios fundadores

1. **`data/trips.json` é a única fonte da verdade** do dado de viagem. Backend, agentes e integrações nunca substituem esse arquivo — só propõem mudanças.
2. **Static-first.** O site precisa renderizar memórias e planejamento mesmo sem backend, sem PAT, sem login. Tudo acima disso é *progressive enhancement*.
3. **Human-in-the-loop.** Nenhum dado externo (e-mail, preço, sugestão de agente) entra no `trips.json` sem aprovação explícita do usuário e sem virar commit no GitHub.
4. **Auditabilidade total.** Toda escrita no `trips.json` é um commit assinado pelo usuário. O histórico do GitHub *é* o log de auditoria.
5. **Privacidade por escopo mínimo.** Cada integração pede o mínimo de permissão necessária. Gmail é `readonly`. PAT é `contents:write` no repositório `viagens` apenas.

---

## 2. Camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│                  FRONTEND (GitHub Pages, estático)                  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  UI                                                           │  │
│  │  - Modo Memória: mapa Leaflet, timeline, cards                │  │
│  │  - Modo Planejamento: kanban, checklist, orçamento, wizard    │  │
│  │  - Agentes: Bagagem · Inspiração · Despachante · Curador      │  │
│  │             Otimizador · Concierge · Cronista                 │  │
│  │  - Visualizações: heatmap, benchmark, matriz de decisão       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  src/core                                                     │  │
│  │  - trips-api.js   → GitHub Contents API client                │  │
│  │  - crypto.js      → AES-256 + PBKDF2 (Web Crypto API)         │  │
│  │  - schema.js      → validação v1↔v2                           │  │
│  │  - storage.js     → wrapper de localStorage cifrado           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  PWA (Workbox)                                                │  │
│  │  - CacheFirst (assets) · NetworkFirst (trips.json)            │  │
│  │  - StaleWhileRevalidate (imagens)                             │  │
│  │  - IndexedDB queue para edições offline                       │  │
│  │  - Push notifications                                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────┬───────────────────────────────────┬──────────────────┘
               │ GitHub Contents API (PAT)         │ HTTPS (anon key)
               ▼                                   ▼
   ┌────────────────────────┐         ┌──────────────────────────────┐
   │  data/trips.json       │         │  BACKEND (Supabase)          │
   │  (GitHub, fonte única) │         │  ┌────────────────────────┐  │
   │                        │         │  │ Postgres (RLS por user)│  │
   │  - leitura: fetch raw  │         │  │  - users               │  │
   │  - escrita: PUT API    │         │  │  - gmail_tokens (enc)  │  │
   │    com commit message  │         │  │  - inbox_events        │  │
   │    padronizada         │         │  │  - price_watches       │  │
   │                        │         │  └────────────────────────┘  │
   └────────────────────────┘         │  ┌────────────────────────┐  │
                                      │  │ Edge Functions         │  │
                                      │  │  - gmail-oauth         │  │
                                      │  │  - gmail-parser (cron) │  │
                                      │  │  - price-monitor (cron)│  │
                                      │  └────────────────────────┘  │
                                      └──────────────┬───────────────┘
                                                     │
                                ┌────────────────────┼──────────────────────┐
                                ▼                    ▼                      ▼
                       ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐
                       │ Gmail API      │  │ Kiwi Tequila API │  │ Anthropic API    │
                       │ (readonly)     │  │ (preços)         │  │ (parser fallback,│
                       │                │  │                  │  │  Cronista,       │
                       │                │  │                  │  │  Concierge)      │
                       └────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 3. Fluxos

### 3.1 Leitura (caminho público, sem login)

```
Visitante → GitHub Pages → index.html → fetch('data/trips.json')
                                     → render mapa / cards / timeline
```

Sem PAT, sem Supabase, sem cookies. É o caminho que precisa continuar funcionando para sempre.

### 3.2 Escrita autenticada (CRUD inline)

```
Eduardo abre editor de viagem
   │
   ▼
trip-editor.js valida payload via schema.js
   │
   ▼
trips-api.js:
  1. GET data/trips.json (com SHA atual)
  2. mescla mudança
  3. PUT data/trips.json (Content-Encoding base64, message="feat(trip): add Bruxelas-2026", sha)
   │
   ▼
GitHub registra commit assinado pelo PAT do Eduardo
   │
   ▼
GitHub Pages reflete (até 60s de delay) — frontend já atualiza localmente via cache otimista
```

**Falha de rede / conflito de SHA:** o cliente reabre o editor com diff visual e pede reenvio.
**Modo offline:** edição vai pra fila IndexedDB; ao voltar online, refaz GET → merge → PUT.

### 3.3 Ingestão automática (Gmail → sugestão → commit)

```
Cron Supabase (a cada 6h) chama gmail-parser
   │
   ▼
gmail-parser:
  1. Lista mensagens com sender ∈ {TAP, Latam, Booking, Airbnb, ...}
  2. Aplica regex específica por sender
  3. Fallback: chama Claude Haiku com header `anthropic-no-training: true`
  4. Insere em `inbox_events` (status='pending')
   │
   ▼
Frontend (modo autenticado) consulta inbox_events não-aprovados
   │
   ▼
inbox.js renderiza cards "Aplicar à viagem X / Criar viagem nova"
   │
   ▼
Eduardo aprova → trips-api.js faz commit com source='gmail' no booking
              → marca inbox_event.status='applied' no Supabase
```

**Nada do conteúdo bruto do e-mail trafega para o frontend.** Apenas o evento estruturado (tipo, data, valor, destino, PNR).

### 3.4 Monitoramento de preço (Otimizador de Bolso)

```
Cron diário price-monitor
   │
   ▼
Para cada viagem `planned` com `bookings.flights[].pnr` ou rota cadastrada:
  consulta Kiwi Tequila API
  compara com último preço em price_watches
   │
   ▼
Se queda > 10% OU data alternativa (±2 dias) > 15% mais barata:
  grava em price_watches (alerta=true)
  dispara Web Push para devices registrados do usuário
   │
   ▼
Frontend mostra notificação no agente 💸 e na viagem
```

---

## 4. Contratos entre camadas

### 4.1 Frontend ↔ `trips.json`

| Operação | Método | Endpoint | Auth |
|---|---|---|---|
| Ler | `GET` | `https://raw.githubusercontent.com/edurcampos86-jpg/viagens/main/data/trips.json` | Nenhuma |
| Ler (autenticado, p/ SHA) | `GET` | `https://api.github.com/repos/edurcampos86-jpg/viagens/contents/data/trips.json` | PAT |
| Escrever | `PUT` | `https://api.github.com/repos/edurcampos86-jpg/viagens/contents/data/trips.json` | PAT |

Mensagem de commit padronizada: `feat(trip): <verb> <id-viagem>` (verb ∈ {add, update, archive}).

### 4.2 Frontend ↔ Supabase

Todas chamadas usam JWT do usuário (após login no Supabase). RLS garante que `user_id` só vê suas próprias linhas.

| Tabela | Operação típica | Quem escreve |
|---|---|---|
| `users` | `select` | self |
| `gmail_tokens` | `insert`/`update` | Edge Function `gmail-oauth` |
| `inbox_events` | `select`/`update(status)` | frontend (status), parser (insert) |
| `price_watches` | `select` | frontend (read-only); cron `price-monitor` insere |

### 4.3 Supabase ↔ APIs externas

| API | Quem chama | Credencial | Escopo |
|---|---|---|---|
| Gmail API | Edge `gmail-parser` | OAuth token cifrado | `gmail.readonly` |
| Kiwi Tequila | Edge `price-monitor` | API key (Supabase secret) | leitura de preços |
| Anthropic API | Edge `gmail-parser` (fallback) e agentes Concierge/Cronista | API key (Supabase secret) | Header `anthropic-no-training: true` |

---

## 5. Esquema de armazenamento de segredos

| Segredo | Onde mora | Como é protegido |
|---|---|---|
| PAT do GitHub | `localStorage` no navegador do Eduardo | AES-256 com chave derivada via PBKDF2 (≥100k iter) da senha mestra |
| Senha mestra | Não é armazenada | Pedida em cada sessão; mantida em memória até unload |
| Gmail OAuth token | Postgres do Supabase | Cifrado em coluna `bytea` + RLS |
| Anthropic API key | Supabase secret manager | Acesso só via Edge Functions |
| Kiwi API key | Supabase secret manager | Acesso só via Edge Functions |

Arquivos `.env`, `.env.local`, `secrets.*` e `*.credentials` estão no `.gitignore`.

---

## 6. Estratégia de deploy

| Camada | Onde | Trigger |
|---|---|---|
| Frontend | GitHub Pages (branch `main`) | Push em `main` |
| Backend | Supabase (free tier) | `supabase functions deploy <name>` manual ou GitHub Action |
| `trips.json` | GitHub (`main`/`data/trips.json`) | Cada edição autenticada |

Releases seguem o padrão `feat/v2 → main` com PR revisado. Nenhum push direto em `main`.

---

## 7. Modos de operação

| Modo | Quem usa | Capacidades |
|---|---|---|
| **Público (anônimo)** | Qualquer visitante | Ler memórias, mapas, timeline |
| **Autenticado local (PAT)** | Eduardo no navegador dele | CRUD inline, commit automático |
| **Autenticado + backend** | Eduardo com Supabase conectado | Inbox de Gmail, monitor de preços, agentes premium |
| **Offline** | Eduardo sem rede | Lê do cache PWA, fila de edições no IndexedDB |

A degradação entre modos é graciosa: se Supabase cai, o site não quebra; se PAT é inválido, volta para modo "exportar JSON manualmente".

---

## 8. Decisões abertas

- **Renderização do mapa:** continuar com Leaflet (free, leve) ou migrar para Mapbox (rotas reais)? Decisão na Fase 4.
- **Fila offline:** IndexedDB próprio vs Workbox Background Sync? Avaliar na F4.4.
- **Auth de Supabase:** Google OAuth (já temos o fluxo) ou Magic Link via e-mail? Definir antes da F2.1.

---

*Atualizar este documento sempre que uma decisão arquitetural mudar. Decisões pequenas → commit direto; decisões grandes → PR com `docs(arch):` no título.*
