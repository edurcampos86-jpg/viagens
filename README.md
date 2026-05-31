# Vida & Carreira — Eduardo Campos

Vida & Carreira — meu diário de viagens e marcos pessoais. Site estático em GitHub Pages, evoluído na v2.0 para uma ferramenta híbrida com 7 agentes especialistas, edição inline via GitHub API, integração com Gmail e visualizações sobre o histórico.

**Site público:** https://edurcampos86-jpg.github.io/viagens/

---

## O que está no repo

```
viagens/
├── index.html              # entry point do site público
├── assets/                  # app legacy (Leaflet, render, etc.)
├── data/
│   ├── trips.json           # fonte única da verdade do dado de viagem (v2 schema)
│   ├── destination_rules.json
│   ├── benchmarks.json      # gerado por scripts/compute_benchmarks.py
│   └── backups/             # backups pré-migration
├── docs/
│   ├── PRD-viagens-v2.md    # documento do produto
│   ├── ARCHITECTURE.md      # camadas + fluxos
│   ├── AGENTS.md            # spec dos 7 agentes
│   ├── DEPLOY.md            # walkthrough manual de deploy
│   └── COWORK-PROMPT.md     # prompt p/ delegar o deploy a outro agente
├── src/                     # código v2.0 modular
│   ├── core/                # crypto, github API, schema, backend, etc.
│   ├── components/          # editor, checklist, budget, heatmap, decision-matrix, wizard
│   ├── agents/              # 5 agentes novos (customs, price-hunter, concierge, chronicler) + inbox-curator
│   └── pwa/                 # SW Workbox + sync queue + push
├── backend/                 # Supabase Edge Functions + migrations
└── scripts/                 # Python: migration, benchmarks, parsers legacy
```

## Como funciona

O site funciona em **três modos**, escolhidos em runtime:

| Modo | Requer | O que faz |
|---|---|---|
| **Público (anônimo)** | nada | Lê `data/trips.json`, renderiza mapa/timeline/cards. É o que visitantes veem. |
| **Autenticado local** | PAT do GitHub com `contents:write` | CRUD inline + commit automático em `trips.json`. |
| **Backend conectado** | + projeto Supabase + Gmail OAuth | Inbox de e-mails parseados, monitor de preços, agentes Concierge/Cronista. |

A degradação entre modos é graciosa: sem Supabase, a interface mostra "ainda não disponível"; sem PAT, cai no fluxo de baixar JSON. **O site público nunca quebra.**

## Quickstart local

```bash
# clone + sirva o site estático
git clone https://github.com/edurcampos86-jpg/viagens
cd viagens
python3 -m http.server 8000
# abre http://localhost:8000

# (opcional) dev server com hot reload
npm install
npm run dev   # vite na porta 5173
```

Configurar PAT no badge "⚙ Configurar PAT" no canto inferior direito → senha mestra ≥ 8 chars → editar viagens inline.

## Como salvar edições no site

Por motivos de segurança, edições feitas no site permanecem locais (browser)
até serem exportadas e comitadas manualmente no GitHub:

1. Faça suas edições no site
2. Use o botão "Exportar edições" no header
3. Baixe o `trips.json` gerado
4. Cole o conteúdo no `data/trips.json` via GitHub Web (ou via git localmente)
5. Commit

### Por que não há "Sync automático"?

Versões anteriores tinham um botão "Sync agora" que armazenava um GitHub PAT
em `localStorage` para fazer commits automáticos. Removido em 2026-05-24
(Sprint 1 T2) por risco de segurança — PAT em `localStorage` é vulnerável a
XSS e extensões de browser maliciosas, mesmo cifrado.

A automação correta (OAuth Device Flow ou GitHub Actions com formulário) está
no backlog. Veja [`docs/BACKLOG.md`](docs/BACKLOG.md).

## v2.0 — sumário

Veja `CHANGELOG-V2.md` para a lista completa de features. Em alto nível:

- **Edição zero-fricção:** modal CRUD com auto-complete Nominatim, commit automático via Contents API.
- **Checklist contextual:** 12 regras por país (visto, vacinas, voltagem, direção).
- **Schema v2 retrocompatível:** `bookings`, `budget`, `checklist`, `dates`, `notes` — coexiste com `year/month/nts` legado.
- **Inbox de Gmail:** parser de TAP/LATAM/Booking/Airbnb/Decolar/Hotels/Ticketmaster/Eventim/Cvent → sugestões com 1-click apply.
- **Orçamento vivo:** `budget.actual` derivado de `bookings`, barras + pie chart.
- **Heatmap anual:** 365 dias por ano, cinza/verde-claro/verde-escuro.
- **Benchmark próprio:** diária média por continente/país a partir do próprio histórico.
- **Matriz de decisão:** comparador ponderado para dilemas multi-opção.
- **Wizard temporal:** "faltam X dias" muda CTAs por janela (D-90 voo, D-30 ingressos, D-14 bagagem).
- **7 agentes:** 🧳 Bagagem · 💡 Inspiração · 🛂 Despachante · 📥 Curador · 💸 Otimizador · 🍽️ Concierge · 📝 Cronista.
- **PWA upgrade:** Workbox 7 (5 estratégias de cache), Web Push, IndexedDB sync offline.

## Princípios não-negociáveis

1. **`trips.json` é a única fonte da verdade.** Backend propõe, usuário aprova, GitHub registra.
2. **Static-first.** Site funciona sem backend.
3. **Human-in-the-loop.** Nenhuma escrita sem clique humano.
4. **Privacidade mínima:** Gmail `readonly`, `anthropic-no-training: true`, PAT cifrado AES-256 com PBKDF2 200k.

Detalhes em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) e [`docs/PRD-viagens-v2.md`](docs/PRD-viagens-v2.md).

## Deploy do backend (opcional)

Para destravar Gmail + monitor de preços + agentes Claude, siga [`docs/DEPLOY.md`](docs/DEPLOY.md) — checklist manual. Quem prefere delegar a um agente, [`docs/COWORK-PROMPT.md`](docs/COWORK-PROMPT.md) tem o prompt pronto.

## Ingestão de fotos via Google Takeout

Pipeline em Python (Fase 3) detecta viagens a partir de um Takeout do
Google Photos via clusterização espaço-temporal e popula `trips.json`
+ `/media/<trip-id>/` automaticamente — sempre com revisão humana.

Walkthrough completo em [`docs/INGESTAO.md`](docs/INGESTAO.md).

## Stack

| Camada | Tech |
|---|---|
| Frontend | HTML5 + JS Vanilla + (opcional) Vite |
| Build | Vite 6 + ESLint flat config + Prettier |
| PWA | Workbox 7 via CDN |
| Backend | Supabase (Postgres + Edge Functions Deno + Auth) |
| Mapas | Leaflet + MarkerCluster |
| Geocoding | Nominatim/OSM (free) |
| Preços | Kiwi Tequila API |
| LLM | Anthropic API (Sonnet + Haiku) com `anthropic-no-training: true` |

## Decisões arquiteturais

Decisões estruturais do projeto são documentadas como ADRs (Architecture
Decision Records) em `docs/ADR-*.md`.

- [ADR-001 — Schema canônico = `bookings.*`](docs/ADR-001-schema-canonico.md) (2026-05-24)

## Documentação técnica

- [SCHEMA_V2.md — Schema canônico de `trips.json` (formato + fórmula de urgência)](docs/SCHEMA_V2.md)

## Licença

Uso pessoal do Eduardo Campos. Código sob revisão antes de qualquer reuso público.
