# Curador — agente Claude para wishlist

Workflow GitHub Actions que roda **diariamente às 7h BRT** e usa o Claude
para monitorar oportunidades reais sobre os destinos em `em_planejamento`
e `wishlist`. Diferente do Auditor (que olha só os seus dados), o Curador
**pesquisa o mundo** via web search server tool.

## Conceito

Para cada destino prioritário, o Claude:

1. Recebe o **perfil do viajante** (de `preferencias.json`) + **dados da viagem**
2. Faz até **4 buscas web** procurando notícias relevantes das últimas ~2 semanas
3. Usa uma **tool forçada** (`report_finding`) para retornar veredito estruturado:
   - `alertable: true/false` (com prejuízo a `false` em caso de dúvida)
   - `headline`, `summary`, `source_url`, `reasoning`

System prompt do agente prioriza **conservadorismo** — você falou que 70%
dos alertas falham por excesso, então o prompt diz literalmente
"em dúvida, NÃO alerte".

## O que conta como alertável

Apenas estas categorias passam o filtro:

- 🛫 Nova rota direta de voo São Paulo → destino (ou variação relevante)
- 💰 Promoção significativa (≥25% abaixo da média)
- 🛂 Mudança em política de visto/entrada
- 🎭 Evento cultural relevante no perfil compatível
- 🌅 Fenômeno natural raro com janela específica
- ⚠ Alerta sério de segurança que impeça turismo

Tudo o mais (listas genéricas, posts de influenciadores, notícia tangencial,
variação cambial pequena, protesto urbano pontual) é **ignorado**.

## Fluxo do workflow

```
diário 7h BRT
    │
    ▼
curator.yml → scripts/curador.py
    │
    ├─► seleciona até 5 destinos (em_planejamento prioritário)
    │
    ├─► para cada destino:
    │      ├── Claude pesquisa (até 4 web_search)
    │      └── report_finding com veredito
    │
    ├─► gera data/curator-report.md
    │
    ├─► se relatório mudou: abre PR chore/curator-report
    │
    └─► se há alertable=true E SLACK_WEBHOOK_URL configurado:
        └── posta resumo no Slack
```

## Setup — passo a passo

### 1. Obter chave Anthropic API

1. Vai em https://console.anthropic.com/
2. Cria conta (se ainda não tem) ou loga
3. **Settings** → **Workspaces** → escolhe um workspace (ou cria um)
4. **API Keys** → **Create Key** → nome `viagens-curador`
5. Copia a key (formato `sk-ant-api03-...`) — **ela só aparece uma vez**

### 2. Adicionar como secret no GitHub

1. Vai no repo `edurcampos86-jpg/viagens`
2. **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
3. Name: `ANTHROPIC_API_KEY`
4. Secret: cola a key
5. Pronto.

### 3. (Opcional) Configurar billing

A Anthropic API cobra por token de input/output + web search. Sem billing
configurado, a key cai em **tier free** que tem cota muito pequena (~$5).

Para uso real:
1. No console: **Settings** → **Billing**
2. Adiciona um cartão e/ou compra créditos pré-pagos
3. Define um **limite de spend mensal** (recomendado: $10-20 enquanto testa)

### 4. (Opcional) Webhook Slack

Mesmo do Auditor — veja `docs/AUDITOR.md` §"Configurar webhook Slack".
O secret `SLACK_WEBHOOK_URL` é compartilhado entre Auditor e Curador.

### 5. Pronto

O Curador roda automaticamente toda manhã. Sem chave configurada, o workflow
**falha graciosamente** logo no início (não consome cota).

## Estimativa de custo

Por execução (5 destinos, modelo padrão `claude-haiku-4-5`):

| Item | Tokens estimados | Custo |
|---|---|---|
| System prompt (cached após 1ª) | ~1500 input | $0.0015 + $0.00075 read × 4 |
| User prompts (5 destinos) | ~2500 input | $0.0025 |
| Web search calls (~3-4 por destino) | — | $10/1000 buscas = ~$0.20/dia |
| Output (tool_use forçada) | ~1500 output | $0.0075 |

**Total estimado: ~$0.21/dia × 30 = ~$6/mês** com Haiku 4.5.

Com `CURADOR_MODEL=claude-opus-4-7` (mais inteligente, mais caro):
**~$15-20/mês**. Override só se sentir que Haiku está deixando passar coisas.

## Como rodar manualmente

### Pela GitHub UI

1. **Actions** → **curator** → **Run workflow**
2. Opcionais:
   - `simulate_today`: data simulada (ex: `2027-01-15`)
   - `max_destinos`: override do limite default (5)
   - `model`: override do modelo (ex: `claude-opus-4-7`)
3. **Run workflow**

### Localmente

```bash
pip install -r scripts/requirements-curator.txt
export ANTHROPIC_API_KEY=sk-ant-...
python scripts/curador.py

# Com Opus em vez de Haiku:
CURADOR_MODEL=claude-opus-4-7 python scripts/curador.py

# Limitando a 2 destinos para teste:
CURADOR_MAX_DESTINOS=2 python scripts/curador.py
```

## Como controlar o que ele monitora

O Curador olha **automaticamente** todas as viagens com status
`em_planejamento` ou `wishlist` em `data/trips.json`, ordenadas por
proximidade da data (mais próximas primeiro).

Para incluir/excluir destinos:
- **Incluir mais** → adiciona viagens com `status: "wishlist"`
- **Excluir uma** → muda para `status: "done"` ou `status: "planned"`

O Curador **não toca em `trips.json`** — só lê.

## Decisões e trade-offs

| Decisão | Por quê |
|---|---|
| Modelo padrão é **Haiku 4.5** | Tarefa é classificação binária + busca; Haiku é 5× mais barato. Pode trocar via env var. |
| Apenas web_search server tool (sem APIs específicas) | Não exige configurar Skyscanner/Reddit/etc. Cobertura ampla. Trade-off: depende da qualidade da busca do Claude. |
| Limite de 5 destinos por execução | Controla custo; cobre todas as 9 futuras em <2 dias |
| Limite de 4 buscas por destino | Idem custo; deixa o Claude focar em vez de drag |
| Tool `report_finding` forçada | Output estruturado garantido (sem regex/parse frágil) |
| Conservador no system prompt | Você pediu (70% dos alertas falham por excesso) |

## Quando ele acerta vs erra

**Vai acertar:** novas rotas, vistos mudando, eventos raros (aurora, eclipse), promoções claras de companhias aéreas.

**Vai errar (provavelmente subreportar):** promoções relâmpago de hotel
específico (sites quase nunca indexáveis), eventos super-recentes que ainda
não viraram notícia, mudanças sutis de visto que dependem de embaixada.

A filosofia é **falso negativo > falso positivo**. Quando dúvida, ele cala
e você descobre o destino sozinho. Quando ele alerta, é porque está
relativamente seguro.

## Comparação com o Auditor

| | Auditor | Curador |
|---|---|---|
| Frequência | Semanal (segunda 9h) | Diária (7h) |
| Olha o quê | **Seus dados** | **O mundo lá fora** |
| Dependências | só schema/jsonschema | + Claude API + ANTHROPIC_API_KEY |
| Custo | $0 | ~$6/mês com Haiku |
| Slack | Crítico | Alertável (qualquer headline) |

Os dois usam o **mesmo SLACK_WEBHOOK_URL**, mas mandam para canais diferentes
do seu Slack se você criar dois webhooks (por exemplo `#viagens-auditor` e
`#viagens-curador`).
