# Auditor — relatório semanal

Workflow GitHub Actions que roda toda segunda às **9h BRT (12h UTC)**
e gera/atualiza `data/audit-report.md` com findings sobre o estado
das viagens.

## O que ele verifica

| Regra | Severidade | Detecta |
|---|---|---|
| **R1** | 🔴 Crítico | Schema inválido em `trips.json`, `documentos.json` ou `preferencias.json` |
| **R2** | 🔴 Crítico | Passaporte que vence em <6 meses **depois** da volta de viagem internacional |
| **R3** | 🔴 Crítico | Viagem `planned` em ≤30 dias **sem** hospedagem |
| **R4** | 🟡 Atenção | Viagem `em_planejamento` em ≤60 dias (precisa decidir se vai ou não) |
| **R5** | 🔴 Crítico | Documento (visto, vacina) não obtido para viagem internacional em ≤30 dias |
| **R6** | 🟡 Atenção | Decisão pendente de criticidade `alta` sem prazo ou com prazo vencido |
| **R7** | 🔵 Informativo | Passaporte sem `valido_ate` em `documentos.json` (impede R2) |

## Fluxo

```
segunda 9h BRT
    │
    ▼
audit.yml roda scripts/auditor.py
    │
    ├─► gera data/audit-report.md (markdown, sempre)
    │
    ├─► se houve mudança no relatório:
    │   └─► abre PR `chore/audit-report` para você revisar/mergear
    │
    └─► se há finding 🔴 crítico E SLACK_WEBHOOK_URL configurado:
        └─► posta resumo no Slack
```

## Como rodar manualmente

### Pela GitHub UI

1. Vai em **Actions** → **auditor** → **Run workflow**
2. Opcional: `simulate_today` (formato `YYYY-MM-DD`) — útil para testar
   regras de prazo simulando uma data futura (ex: `2027-01-15` testa
   se Japão-2027 dispara R3)
3. Clica em **Run workflow**

### Localmente

```bash
pip install -r scripts/requirements-validate.txt
python scripts/auditor.py

# Simulando outra data:
AUDIT_TODAY=2027-01-15 python scripts/auditor.py

# Com Slack (use webhook de teste):
SLACK_WEBHOOK_URL=https://hooks.slack.com/... python scripts/auditor.py
```

## Configurar webhook Slack (opcional)

Você disse no briefing original que configura depois. Quando quiser:

1. **Criar app Slack** em https://api.slack.com/apps → **Create New App** → **From scratch**
2. Nome: `Auditor de Viagens` (ou qualquer um), escolha o workspace
3. No menu lateral: **Incoming Webhooks** → **Activate Incoming Webhooks: On**
4. **Add New Webhook to Workspace** → escolha o canal (ex: `#minhas-viagens` ou seu DM)
5. Copia o **Webhook URL** (formato `https://hooks.slack.com/services/T.../B.../...`)
6. No GitHub: **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
   - Name: `SLACK_WEBHOOK_URL`
   - Secret: cola o URL
7. Pronto. Na próxima execução do auditor, se houver crítico, o resumo
   aparece no Slack.

### Sem webhook configurado

Tudo funciona, só **não envia Slack**. Você ainda recebe o PR semanal
com o relatório markdown quando houver mudança.

## Como silenciar uma regra

Por enquanto, as regras estão hardcoded em `scripts/auditor.py`.
Para silenciar uma:

- **Permanente**: comenta o `findings += check_XXX(...)` na função
  `run_auditor()`.
- **Pontual** (uma viagem): preencha o campo correspondente no schema
  para fazer o finding sumir naturalmente (ex: adiciona hospedagem
  pra R3 não disparar).

Tornar regras configuráveis via JSON é trabalho de fase futura — não
fizemos agora porque o conjunto é pequeno e legível.

## Quando o relatório vira PR vs Slack

| Situação | Relatório markdown | Slack |
|---|---|---|
| Nenhum finding | atualizado se mudou | — |
| Só warn/info | atualizado se mudou | — |
| Há 🔴 crítico, sem webhook configurado | atualizado se mudou | — |
| Há 🔴 crítico, com webhook configurado | atualizado se mudou | ✓ resumo postado |

**Slack é só para "preciso resolver isso esta semana", não para "atualização semanal de status".**
