# Agentes — Portal de Viagens v2.0

Especificação dos sete agentes que operam no portal. Cada agente é um módulo isolado, com inputs e outputs claros, que pode ser ligado/desligado independentemente. Nenhum agente escreve no `data/trips.json` sem aprovação humana.

> **Notação:**
> - **Inputs:** dados que o agente lê para operar.
> - **Outputs:** o que o agente devolve para a UI (e, se aplicável, sugere comitar).
> - **Dependências:** outros módulos, APIs ou agentes de que precisa.
> - **Status:** `existente` (já no repo, pode precisar de adaptação) ou `novo` (criar do zero na v2.0).

---

## Visão geral

| # | Ícone | Nome | Status | Fase de entrega |
|---|---|---|---|---|
| 1 | 🧳 | Bagagem | existente | — (manter) |
| 2 | 💡 | Inspiração | existente | — (manter) |
| 3 | 🛂 | Despachante Digital | novo | Fase 1 (F1.5) |
| 4 | 📥 | Curador de E-mail | novo | Fase 2 (F2.3 + F2.4) |
| 5 | 💸 | Otimizador de Bolso | novo | Fase 3 (F3.4) |
| 6 | 🍽️ | Concierge Local | novo | Fase 4 (F4.2) |
| 7 | 📝 | Cronista da Memória | novo | Fase 4 (F4.3) |

> **Nota sobre agentes legacy do repositório:** os scripts Python `scripts/curador.py` e `scripts/auditor.py` são ferramentas operacionais de linha de comando (curadoria de wishlist e auditoria de schema, respectivamente). Eles não fazem parte dos sete agentes de UI listados aqui, mas continuam disponíveis como tooling.

---

## 1. 🧳 Bagagem  *(existente)*

**Função.** Sugere lista de bagagem por viagem com base em clima do destino, duração e atividades planejadas.

**Inputs.**
- `trip.dates.start` / `trip.dates.end` (ou `year/month/nts` legacy)
- `trip.lat` / `trip.lon`
- `trip.notes.general` (texto livre, opcional)

**Outputs.**
- Lista de itens sugeridos categorizados (roupas, eletrônicos, documentos, saúde).
- Pode ser convertida em itens de `trip.checklist` com `auto_added: true`.

**Dependências.** Nenhuma externa hoje (heurísticas locais).

**Onde mora.** `src/agents/baggage.js` (a portar para nova estrutura na Fase 1).

---

## 2. 💡 Inspiração  *(existente)*

**Função.** Recomenda próximos destinos com base em wishlist, padrões do histórico e janelas livres no calendário.

**Inputs.**
- `trips[]` com `status='wishlist'` e `status='done'`
- Período disponível (input do usuário)
- Preferências (`data/preferencias.json`)

**Outputs.**
- Cards rankeados de destinos com justificativa ("encaixa em 4 dias", "novidade", "já visitou Europa em 2025").

**Dependências.** Nenhuma externa hoje.

**Onde mora.** `src/agents/inspiration.js` (a portar para nova estrutura na Fase 1).

---

## 3. 🛂 Despachante Digital  *(novo — F1.5)*

**Função.** *Due diligence* documental e logística da viagem. Sinaliza pendências antes que viram problema.

**Inputs.**
- `trip.country` (derivado de `lat/lon` ou destino)
- `data/destination_rules.json` (regras por país: visto, vacinas, voltagem, mão de direção, moeda)
- Perfil do usuário (passaporte: número, validade, nacionalidade) — armazenado cifrado no `localStorage`
- `trip.dates.start` para calcular validade mínima do passaporte (regra dos 6 meses)

**Outputs.**
- Card "Status Compliance" com itens cor-categorizados:
  - 🟢 OK
  - 🟡 Atenção (ex: passaporte vence em <8 meses)
  - 🔴 Bloqueante (ex: visto obrigatório não solicitado)
- Cada item linka para fonte oficial (gov.br, Itamaraty, OMS, CDC).
- Sugestões viram itens de `trip.checklist` com `auto_added: true` e `reason`.

**Dependências.**
- `src/core/destination-rules.js` (loader das regras)
- Perfil do usuário em `src/core/profile.js`

**Onde mora.** `src/agents/customs.js`.

**Princípio.** Apenas relata e linka — nunca preenche formulário oficial em nome do usuário.

---

## 4. 📥 Curador de E-mail  *(novo — F2.3/F2.4)*

**Função.** Lê o Gmail do Eduardo (scope readonly), extrai reservas estruturadas e propõe aplicá-las à viagem certa.

**Inputs.**
- Mensagens Gmail filtradas por sender conhecido (TAP, Latam, Gol, Booking, Airbnb, Decolar, Hotels.com, Ticketmaster, Eventim, Cvent).
- Regras de extração regex por sender em `backend/functions/gmail-parser/senders/`.
- Fallback: Claude Haiku via Anthropic API com header `anthropic-no-training: true`.

**Outputs.**
- Eventos estruturados em `inbox_events` (Supabase):
  ```json
  {
    "type": "flight | stay | experience",
    "from": "GRU", "to": "BRU",
    "airline": "TAP",
    "pnr": "ABC123",
    "departure": "2026-07-14T22:30:00",
    "arrival": "2026-07-15T15:45:00",
    "price_brl": 4890.00,
    "raw_sender": "noreply@flytap.com",
    "status": "pending"
  }
  ```
- Bandeja de sugestões no frontend (`src/components/inbox.js`) com ação "Aplicar à viagem X" ou "Criar viagem nova".

**Dependências.**
- Backend Supabase (F2.1) + OAuth Gmail (F2.2).
- Anthropic API (apenas para fallback de parsing).

**Onde mora.**
- Frontend: `src/agents/inbox-curator.js` + `src/components/inbox.js`.
- Backend: `backend/functions/gmail-parser/`.

**Princípio.** Conteúdo bruto do e-mail nunca trafega para o frontend. Eventos têm TTL de 90 dias na tabela `inbox_events`.

---

## 5. 💸 Otimizador de Bolso  *(novo — F3.4)*

**Função.** Monitora preços de voos e hotéis para viagens com status `planned` e alerta em quedas relevantes.

**Inputs.**
- Viagens `planned` com `bookings.flights[]` ou rota cadastrada em `notes.target_routes[]`.
- API Kiwi Tequila (free tier) para preços de voo.
- Eventualmente: API Booking/Hotels.com para hospedagem (avaliar na F3.4).

**Outputs.**
- Linhas em `price_watches` (Supabase) com snapshot diário.
- Web Push notification quando:
  - Preço cai > 10% sobre menor preço observado, OU
  - Data alternativa (±2 dias do plano) tem desconto > 15%.
- UI: cartão no agente com histórico de alertas e gráfico de tendência.

**Dependências.**
- Backend Supabase + Edge Function `price-monitor` (cron diário).
- Service Worker com push (F4.4).

**Onde mora.**
- Frontend: `src/agents/price-hunter.js`.
- Backend: `backend/functions/price-monitor/`.

**Princípio.** Apenas sugere. Eduardo decide se troca a reserva. Nunca compra automaticamente.

---

## 6. 🍽️ Concierge Local  *(novo — F4.2)*

**Função.** Gera itinerário diário por viagem combinando histórico (hotéis Aman/Four Seasons, restaurantes premium e locais que o Eduardo já visitou) com padrões do destino (dias fechados em museus, distâncias, sazonalidade).

**Inputs.**
- `trip.dates`, `trip.lat/lon`, `trip.country`
- `logistics.restaurants` e `logistics.hotels` de viagens passadas (cross-trip benchmark)
- `data/preferencias.json` (perfil de gosto)
- Claude API (Sonnet) para geração

**Outputs.**
- Itinerário diário (`itinerary[]` em memória, opcionalmente persistido em `trip.notes.itinerary`).
- Cada dia: manhã / tarde / noite, com restaurante sugerido, atração, deslocamento estimado.
- Justificativa por sugestão ("você gostou de Cipriani em Veneza-2024; este é do mesmo grupo").

**Dependências.**
- Anthropic API (header `anthropic-no-training: true`).
- Acesso a `trips[]` consolidados para extração de preferências.

**Onde mora.** `src/agents/concierge.js`.

**Princípio.** Sugere; não reserva. Não envia dados pessoais para a API além do estritamente necessário (destino, datas, lista anonimizada de preferências).

---

## 7. 📝 Cronista da Memória  *(novo — F4.3)*

**Função.** Pós-viagem (status muda de `in_progress` para `done`), conduz entrevista estruturada e gera o card de memória.

**Inputs.**
- `trip` com `bookings`, `budget`, `checklist` consolidados.
- Respostas do Eduardo a perguntas como:
  - "O que valeu mais que o preço?"
  - "O que ficou aquém?"
  - "Voltaria? Recomendaria pra quem?"
- Histórico de outras viagens (para comparar e contextualizar).

**Outputs.**
- `trip.memory` (texto markdown).
- `trip.highlights[]` (3–5 bullets).
- `trip.logistics.tips` enriquecido.
- **Bônus:** 3 opções de legenda para Instagram em PT-BR no estilo do Eduardo.

**Dependências.**
- Anthropic API (Sonnet) com header `anthropic-no-training: true`.
- Modal de entrevista (`src/components/chronicler-modal.js`).

**Onde mora.** `src/agents/chronicler.js`.

**Princípio.** A entrevista é guiada, nunca automática. O Eduardo pode pular qualquer pergunta. O texto gerado é editável antes do commit.

---

## Padrões comuns a todos os agentes

### Interface mínima

Cada agente em `src/agents/<name>.js` exporta:

```js
export const meta = {
  id: "customs",
  name: "Despachante Digital",
  icon: "🛂",
  description: "Due diligence documental da viagem"
};

export async function run(context) {
  // context = { trip, profile, rules, services }
  // retorna: { items: [...], suggestions: [...], errors: [...] }
}
```

### Princípios

1. **Idempotência.** Rodar duas vezes não duplica sugestões nem dispara dois pushes.
2. **Cancelável.** Toda execução aceita `AbortSignal` para a UI poder cancelar.
3. **Sem efeito colateral persistente.** Agentes não escrevem no `trips.json` diretamente — devolvem sugestões; o componente da UI confirma com o usuário e chama `trips-api.js`.
4. **Sem PII na telemetria.** Se algum dia houver logging, nomes, e-mails, PNRs e valores não vão pro log.
5. **Falha graciosa.** Se uma API externa cai, o agente retorna `{ items: [], errors: [...] }` — a UI mostra "indisponível agora", não quebra.

---

## Roteiro de evolução por agente

| Fase | Agente | Entrega |
|---|---|---|
| 0 | — | Spec deste documento |
| 1 | Bagagem · Inspiração · Despachante | Portar p/ `src/agents/`, novo Despachante |
| 2 | Curador de E-mail | Backend Supabase + parser + bandeja UI |
| 3 | Otimizador de Bolso | Edge Function de preços + push |
| 4 | Concierge · Cronista | Integração Claude API + modais |

---

*Toda mudança de spec de agente exige PR com `docs(agents):` no título.*
