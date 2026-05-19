# PRD — Portal de Viagens v2.0

**Projeto:** edurcampos86-jpg/viagens
**Owner:** Eduardo Campos
**Versão:** 2.0 (evolução do portfólio estático para sistema híbrido de planejamento)
**Última atualização:** 18/05/2026

---

## 1. Visão e tese do produto

O portal de viagens hoje é um **portfólio estático**: cumpre bem o papel de "diário visual", mas falha como ferramenta operacional de planejamento. A v2.0 transforma o sistema numa **ferramenta híbrida memória-planejamento** — onde as viagens passadas alimentam decisões futuras com base em dados reais (custos, padrões, preferências), e o planejamento de novas viagens acontece com o mínimo de fricção e o máximo de automação.

**Tese central:** quanto menor o atrito de inserir/editar dados, maior a frequência de uso. Quanto maior a frequência, mais ricos os dados históricos. Quanto mais ricos os dados, mais inteligentes as recomendações. É um ciclo composto — *compounding* aplicado a UX.

**Métricas de sucesso (north star):**

- **Tempo médio para adicionar uma nova viagem:** de ~15min (fluxo atual) para < 2min
- **Taxa de atualização do orçamento real vs planejado:** de ~20% (manual) para > 80% (automático)
- **Cobertura do checklist contextual:** 100% dos destinos com regras específicas aplicadas automaticamente
- **Engajamento PWA:** > 60% das sessões via app instalado (vs browser)

---

## 2. Arquitetura técnica: modelo híbrido

A v2.0 mantém o GitHub Pages + `data/trips.json` como **fonte única da verdade** do dado de viagem. Backend leve atua apenas como **camada de integração** com serviços externos (Gmail, APIs de preço, etc.) — não como banco principal.

### 2.1 Camadas

```
┌─────────────────────────────────────────────────┐
│   FRONTEND (GitHub Pages — atual)               │
│   HTML/CSS/JS + PWA + Service Worker            │
│   - Modo Memória (mapa, timeline, cards)        │
│   - Modo Planejamento (kanban, checklist, etc.) │
│   - Agentes (Bagagem, Inspiração + novos)       │
└────────────────┬────────────────────────────────┘
                 │
       ┌─────────┴──────────┐
       │                    │
       ▼                    ▼
┌──────────────┐   ┌────────────────────────────┐
│  trips.json  │   │  BACKEND DE INTEGRAÇÕES    │
│  (GitHub)    │   │  (Supabase Edge Functions  │
│              │   │   OU Vercel Functions)     │
│  Fonte da    │   │                            │
│  verdade do  │   │  - OAuth Gmail (readonly)  │
│  dado de     │   │  - Parser de e-mails       │
│  viagem      │   │  - Monitor de preços       │
│              │   │  - Webhook calendário      │
└──────────────┘   └────────────────────────────┘
```

### 2.2 Fluxos de escrita

- **Edição de viagem (CRUD):** frontend escreve direto no GitHub via **GitHub Contents API** com Personal Access Token (PAT) armazenado em `localStorage` cifrado. Commit automático com mensagem padronizada (`feat(trip): add Lisboa-2026`).
- **Dados de integração (e-mail parseado, preços monitorados):** backend processa, grava em tabela `inbox_events` no Supabase com TTL de 90 dias, e **sugere** ao usuário pelo frontend ("Encontrei uma reserva da TAP de R$ 4.890 — aplicar à viagem Bruxelas-Julho?"). Após aprovação, o frontend persiste no `trips.json` via GitHub API.

**Princípio:** o backend **propõe**, o usuário **aprova**, o GitHub **registra**. Garante auditabilidade total (todo dado no `trips.json` passou pelo crivo humano via commit).

### 2.3 Stack proposta

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Frontend | HTML5 + JS Vanilla (manter atual) | Zero rewrite, evolutivo |
| Build/bundling | Vite (adicionar) | Hot reload em dev, melhor DX |
| PWA | Workbox (substituir sw.js manual) | Estratégias de cache mais robustas |
| Backend | Supabase (Postgres + Edge Functions + Auth) | Free tier generoso, OAuth nativo |
| Gmail | OAuth 2.0 + Gmail API (scope `gmail.readonly`) | Escopo mínimo, sem permissão de envio |
| Preços | Kiwi Tequila API ou Skyscanner Affiliate | Free tier para uso pessoal |
| Mapas | Leaflet (manter) ou Mapbox (upgrade) | Leaflet é grátis; Mapbox tem rotas |
| Geocoding | Nominatim/OSM (grátis) | Auto-complete de cidades sem custo |

---

## 3. Modelo de dados — evolução do `trips.json`

### 3.1 Schema atual (resumido)

```json
{
  "config": { ... },
  "trips": [
    {
      "id": "string",
      "name": "string",
      "status": "done | planned | wishlist",
      "year": "int", "month": "int",
      "lat": "float", "lon": "float",
      "nts": "int",
      "highlights": ["string"],
      "logistics": { "hotels": [], "restaurants": [], "tips": "string" },
      "hospedagem": [{ "nome": "string" }]
    }
  ]
}
```

### 3.2 Schema v2.0 (adições)

```json
{
  "config": { ... },
  "trips": [
    {
      "id": "string",
      "name": "string",
      "status": "done | planned | wishlist | in_progress",

      // PERÍODO REAL (substitui month/year/nts soltos)
      "dates": {
        "start": "2026-07-14",
        "end": "2026-07-26",
        "computed_from": "flight | manual"   // proveniência
      },

      // RESERVAS ESTRUTURADAS (substitui hospedagem solta)
      "bookings": {
        "flights": [
          {
            "id": "uuid",
            "from": "GRU", "to": "BRU",
            "airline": "TAP",
            "pnr": "ABC123",
            "departure": "2026-07-14T22:30:00",
            "arrival": "2026-07-15T15:45:00",
            "price_brl": 4890.00,
            "source": "gmail" | "manual",
            "email_id": "string (opcional)"
          }
        ],
        "stays": [
          {
            "id": "uuid",
            "name": "Hotel Amigo Bruxelas",
            "platform": "booking | airbnb | direct",
            "check_in": "2026-07-15",
            "check_out": "2026-07-17",
            "price_brl": 2400.00,
            "source": "gmail" | "manual"
          }
        ],
        "experiences": [
          {
            "id": "uuid",
            "name": "Ingresso Tomorrowland",
            "date": "2026-07-19",
            "price_brl": 3200.00,
            "source": "gmail" | "manual"
          }
        ]
      },

      // ORÇAMENTO COMO ORGANISMO VIVO
      "budget": {
        "planned": {
          "flights": 5000, "stays": 8000,
          "food": 4000, "experiences": 3000, "other": 2000
        },
        "actual": {            // calculado automaticamente das bookings
          "flights": 4890, "stays": 2400, ...
        },
        "currency": "BRL"
      },

      // CHECKLIST CONTEXTUAL (dinâmico)
      "checklist": [
        { "item": "Visto Schengen", "done": true, "auto_added": true, "reason": "country=BE" },
        { "item": "Vacina febre amarela", "done": true, "auto_added": true, "reason": "BRA→EU é dispensa, mas mantida por outras escalas" },
        { "item": "Adaptador tipo C/F", "done": false, "auto_added": true, "reason": "voltagem=230V Europa" }
      ],

      // NOTAS (mantém atual + estruturado)
      "notes": {
        "general": "string markdown",
        "decisions_pending": [
          { "id": "uuid", "question": "Dolomitas vs Ibiza?", "options": [...] }
        ]
      },

      // METADADOS
      "created_at": "ISO",
      "updated_at": "ISO",

      // CAMPOS LEGADOS (manter retrocompatibilidade)
      "year": 2026, "month": 7, "nts": 12,
      "lat": ..., "lon": ..., "highlights": [...], "logistics": {...}
    }
  ]
}
```

### 3.3 Banco de regras de destino (novo arquivo `data/destination_rules.json`)

```json
{
  "rules": [
    {
      "match": { "country": "Thailand" },
      "checklist_items": [
        "Visto eletrônico TR (validar elegibilidade)",
        "Vacina febre amarela (obrigatória se vindo do Brasil)",
        "Adaptador tipo A/B/C",
        "Seguro saúde com cobertura Sudeste Asiático",
        "Dengue: repelente com DEET ≥ 30%"
      ],
      "voltage": "220V",
      "drives_on": "left",
      "currency": "THB",
      "visa_required_for_brazilians": true
    },
    {
      "match": { "country": "Brasil", "is_domestic": true },
      "checklist_items": [
        "RG ou CNH válida",
        "Cartão de crédito (não levar só Pix em viagem rural)"
      ]
    }
  ]
}
```

---

## 4. Roadmap em fases

### Fase 1 — Fundação (Quick Wins) — 2 semanas

**Objetivo:** eliminar fricção de edição. Sem isso, nada mais importa.

- [x] **F1.1 — CRUD inline de viagens**
  Formulário modal para criar/editar/duplicar/excluir viagem. Auto-complete de cidade via Nominatim (gratuito). Geração automática de `id`, `lat`, `lon`, `flag` (emoji do país).
  *Critério de aceitação:* adicionar viagem nova em < 2min, sem editar JSON manualmente.

- [x] **F1.2 — Persistência via GitHub API**
  Configuração inicial pede PAT (Personal Access Token) e armazena cifrado no `localStorage`. Toda edição faz commit automático no `trips.json` com mensagem padronizada.
  *Critério de aceitação:* nenhuma viagem precisa do fluxo "baixar JSON → editar no GitHub". Botão "Exportar edições" vira fallback.

- [x] **F1.3 — Schema v2.0 com retrocompatibilidade**
  Migration script (Python) que lê o `trips.json` atual e adiciona campos novos (`dates`, `bookings`, `budget`, `checklist`) preservando os antigos. Frontend lê ambos os formatos.
  *Critério de aceitação:* todas as 22+ viagens existentes carregam normalmente; novas viagens usam schema novo.

- [x] **F1.4 — Checklist contextual dinâmico**
  Implementar `data/destination_rules.json` e lógica de injeção automática de itens baseada em `country` + `is_domestic`. UI mostra badge "auto-adicionado" e permite remover manualmente.
  *Critério de aceitação:* viagem Tailândia gera checklist diferente de viagem São Paulo, automaticamente, na criação.

- [x] **F1.5 — Agente Despachante Digital (🛂)**
  Novo agente que roda *due diligence* da viagem: passaporte (validade 6 meses), visto, vacinas, seguro, voltagem, lado da direção. Conecta com `destination_rules.json`.
  *Critério de aceitação:* agente reporta status verde/amarelo/vermelho por item, com link para fonte oficial.

---

### Fase 2 — Automação de input (Backend + Gmail) — 3 semanas

**Objetivo:** orçamento e período se tornarem organismos vivos.

- [ ] **F2.1 — Setup do backend Supabase**
  Projeto novo, schema com tabelas `users`, `gmail_tokens`, `inbox_events`, `price_watches`. Edge Functions para parsing.
  *Critério de aceitação:* backend deployado, autenticação OAuth funcionando.

- [ ] **F2.2 — OAuth Gmail (scope readonly)**
  Fluxo de conexão: usuário autoriza acesso ao Gmail, token guardado no Supabase com refresh automático.
  *Critério de aceitação:* `edurcampos86@gmail.com` conectado, scope `gmail.readonly`, sem permissão de envio.

- [ ] **F2.3 — Parser de e-mails de viagem**
  Edge Function que filtra Gmail por senders conhecidos (TAP, Latam, Booking, Airbnb, Decolar, Ticketmaster, Cvent) e extrai: tipo (voo/hotel/ingresso), data, valor, destino. Heurísticas regex + LLM fallback (Claude Haiku via API).
  *Critério de aceitação:* taxa de extração correta ≥ 85% em 20 e-mails de teste.

- [ ] **F2.4 — Bandeja de sugestões no frontend**
  Componente "Inbox de Viagem" lista eventos extraídos pendentes de aprovação. Botão "Aplicar à viagem X" ou "Criar viagem nova com esse evento".
  *Critério de aceitação:* nenhum dado vai pro `trips.json` sem aprovação humana.

- [ ] **F2.5 — Período inferido do aéreo**
  Quando uma reserva de voo é aprovada, sistema sugere `dates.start` e `dates.end` da viagem automaticamente. `nts` calculado.
  *Critério de aceitação:* viagem julho/2026 mostra 14/jul→26/jul sem digitação manual.

- [ ] **F2.6 — Orçamento vivo**
  Campo `budget.actual` recalcula automaticamente toda vez que uma `booking` é adicionada. UI mostra barra "Realizado vs Planejado" com cor verde/amarelo/vermelho.
  *Critério de aceitação:* adicionar reserva de R$ 4.890 atualiza `budget.actual.flights` instantaneamente.

---

### Fase 3 — Inteligência (Análise + Decisão) — 3 semanas

**Objetivo:** transformar dados históricos em insights operacionais.

- [ ] **F3.1 — Heatmap anual de viagens**
  Visualização tipo GitHub contributions: 365 dias do ano coloridos por status (em casa, viagem nacional, viagem internacional). Filtro por ano.
  *Critério de aceitação:* renderiza 5 anos (2021–2025) corretamente, totalizando dias fora.

- [ ] **F3.2 — Benchmark próprio de custos**
  Dashboard que cruza `budget.actual` de todas viagens passadas e gera: diária média por região, custo médio de voo por destino, ranking de hotéis por custo-benefício.
  *Critério de aceitação:* abrir destino novo (ex: Ibiza) mostra "Sua diária média em Europa = R$ X; hotel Y está Z% acima".

- [ ] **F3.3 — Matriz de decisão para dilemas**
  Novo módulo dentro de uma viagem `planned`: quando há múltiplas opções de rota/destino, abre comparador estruturado com critérios pesados (clima, custo, deslocamento, preferência casal, novidade vs revisita). Output: score por opção.
  *Critério de aceitação:* dilema "Dolomitas vs Ibiza vs Amsterdã" gera matriz visual com recomendação.

- [ ] **F3.4 — Agente Otimizador de Bolso (💸)**
  Edge Function (cron diário) monitora preços de voos/hotéis para viagens `planned` via API Kiwi. Alerta no frontend quando preço cai > 10% ou quando data alternativa (-2/+2 dias) tem desconto > 15%.
  *Critério de aceitação:* viagem com voo monitorado dispara notificação push quando preço cai.

---

### Fase 4 — Experiência completa — 2 semanas

**Objetivo:** fechar o ciclo memória ↔ planejamento.

- [ ] **F4.1 — Wizard temporal por viagem**
  Linha do tempo "faltam X dias" que muda CTAs por janela: D-90 voo, D-60 hotel, D-30 ingressos, D-14 bagagem. Cada passo conecta com agente apropriado.
  *Critério de aceitação:* abrir viagem futura mostra próximo passo recomendado contextual.

- [ ] **F4.2 — Agente Concierge Local (🍽️)**
  Dado período e destino, sugere itinerário diário com base em: histórico do Eduardo (Aman, Four Seasons, restaurantes premium + locais), dias da semana (museus fechados), distâncias.
  *Critério de aceitação:* gera itinerário 7 dias para Bruxelas considerando preferências históricas.

- [ ] **F4.3 — Agente Cronista da Memória (📝)**
  Pós-viagem (status muda de `in_progress` para `done`), agente conduz entrevista estruturada e gera `memory`, `highlights`, atualiza `logistics.tips`. Opcional: gera legenda pro Instagram.
  *Critério de aceitação:* viagem recém-finalizada vira card de memória completo sem digitação manual.

- [ ] **F4.4 — PWA + push notifications**
  Migrar `sw.js` manual para Workbox. Implementar push notifications nativas para alertas dos agentes 2 e Wizard temporal. Modo offline com fila de sync.
  *Critério de aceitação:* instalar como app no iOS/Android, receber push de queda de preço, editar offline e sincronizar depois.

---

## 5. Restrições e princípios

### 5.1 Segurança e privacidade

- **PAT do GitHub:** armazenado em `localStorage` com criptografia AES-256 (chave derivada de senha do usuário). Nunca em texto claro.
- **Gmail OAuth:** scope mínimo (`gmail.readonly`). Tokens guardados no Supabase com RLS (Row Level Security). Nenhum conteúdo de e-mail trafega pro frontend — só o evento extraído.
- **Parsing de e-mail:** se LLM for usado como fallback, dados sensíveis (preços, PNRs) são enviados pra Anthropic API com flag de não-treinamento (header `anthropic-no-training: true`).
- **LGPD:** todos os dados são do próprio Eduardo. Nenhum compartilhamento com terceiros. Backend pode ser desligado a qualquer momento — `trips.json` continua funcionando standalone.

### 5.2 Princípios de design

1. **Backward compatible sempre:** v2.0 lê `trips.json` v1 sem quebrar.
2. **Static-first:** o site precisa funcionar SEM o backend (modo "somente memória").
3. **Human-in-the-loop:** nenhuma escrita no `trips.json` sem aprovação humana.
4. **Source of truth única:** `trips.json` é o ouro. Backend é cache/integração.
5. **Progressive enhancement:** agentes premium (preço, concierge) são opt-in.

### 5.3 Performance

- First Contentful Paint < 1.5s em 3G simulado
- Tempo de carga do `trips.json` (até 500 viagens) < 200ms
- Bundle JS total < 300KB gzipped (excluindo libs de mapa)

---

## 6. Estrutura de pastas proposta

```
viagens/
├── .github/workflows/        # CI/CD existente
├── .claude/                  # Configs do Claude Code existentes
├── assets/                   # Manter
├── data/
│   ├── trips.json            # Schema v2.0 (existente, evoluído)
│   ├── destination_rules.json # NOVO — regras por país
│   └── benchmarks.json       # NOVO — cache de benchmarks calculados
├── docs/
│   ├── PRD-viagens-v2.md     # Este documento
│   ├── ARCHITECTURE.md       # NOVO — diagrama detalhado
│   ├── API.md                # NOVO — endpoints do backend
│   └── AGENTS.md             # NOVO — spec de cada agente
├── icons/                    # Manter
├── previews/                 # Manter
├── scripts/
│   ├── migrate-v1-to-v2.py   # NOVO — migration do schema
│   └── seed-rules.py         # NOVO — popula destination_rules.json
├── src/                      # NOVO — código modularizado
│   ├── core/
│   │   ├── trips-api.js      # GitHub API client
│   │   ├── crypto.js         # Cifragem de PAT
│   │   └── schema.js         # Validação
│   ├── components/
│   │   ├── trip-editor.js    # Modal CRUD
│   │   ├── checklist.js      # Checklist contextual
│   │   ├── budget.js         # Orçamento vivo
│   │   ├── heatmap.js        # Heatmap anual
│   │   ├── decision-matrix.js # Matriz de decisão
│   │   └── wizard.js         # Wizard temporal
│   ├── agents/
│   │   ├── baggage.js        # Existente
│   │   ├── inspiration.js    # Existente
│   │   ├── customs.js        # NOVO — Despachante
│   │   ├── price-hunter.js   # NOVO — Otimizador
│   │   ├── inbox-curator.js  # NOVO — Curador de e-mail
│   │   ├── concierge.js      # NOVO — Concierge Local
│   │   └── chronicler.js     # NOVO — Cronista
│   └── pwa/
│       └── sw-workbox.js     # Service worker upgrade
├── backend/                  # NOVO — Supabase functions
│   ├── functions/
│   │   ├── gmail-oauth/
│   │   ├── gmail-parser/
│   │   └── price-monitor/
│   ├── migrations/           # Schema SQL
│   └── README.md
├── index.html                # Manter (evoluir)
├── manifest.webmanifest      # Manter
├── sw.js                     # Deprecar gradualmente
└── README.md                 # Atualizar
```

---

## 7. Critérios de aceitação globais

1. ✅ Site continua funcionando para visitantes públicos (modo "somente memória"), sem dependência do backend.
2. ✅ Eduardo consegue adicionar viagem nova em < 2min, sem editar JSON.
3. ✅ Checklist da viagem para Tailândia inclui visto e vacina automaticamente; viagem para SP não.
4. ✅ Reserva da TAP no Gmail aparece como sugestão no frontend e, após aprovação, atualiza `budget.actual.flights` e `dates`.
5. ✅ Heatmap anual mostra os 5 anos de histórico corretamente.
6. ✅ Dilema "Dolomitas vs Ibiza vs Amsterdã" pode ser resolvido pela matriz de decisão.
7. ✅ PWA instalável, modo offline funcional, push notifications ativas.
8. ✅ Toda escrita no `trips.json` vira commit auditável no GitHub.
9. ✅ Zero credenciais sensíveis (PAT, tokens) em texto claro em qualquer lugar.
10. ✅ Bundle JS < 300KB gzipped, FCP < 1.5s em 3G.

---

## 8. Glossário

- **PAT:** Personal Access Token (GitHub) — credencial para escrita via API.
- **PWA:** Progressive Web App — site que se comporta como aplicativo nativo.
- **RLS:** Row Level Security (Postgres/Supabase) — isolamento de dados por usuário.
- **Edge Function:** função serverless executada perto do usuário (Supabase/Vercel).
- **SSOT:** Single Source of Truth — princípio de ter um único lugar canônico para um dado.
- **Schema migration:** processo de evoluir estrutura de dados sem quebrar dados antigos.

---

*Documento vivo. Edite via PR e mantenha o histórico no commit.*
