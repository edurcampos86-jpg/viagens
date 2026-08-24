# Rotina — varredura semanal de e-mails → proposta de atualização do `trips.json`

> **Regra de ouro:** `data/trips.json` é a fonte da verdade e é **editada por
> humanos**. Esta rotina nunca escreve no arquivo — ela produz uma _proposta_
> de diff que o Eduardo lê, corrige e aplica. Nada de auto-commit.

## Por que existe

Reserva comprada é reserva que some. O e-mail de confirmação chega, vira uma
linha perdida na caixa de entrada e o radar de planejamento continua mostrando
"⚠ sem voo" para uma viagem que já tem voo — ou pior, deixa de mostrar que a
tarifa é não reembolsável. A varredura semanal fecha essa janela: uma vez por
semana o Claude lê o que chegou, compara com o `trips.json` e devolve o que
mudou, em formato pronto para colar.

## O fluxo

```
Gmail (7 dias)  →  Claude lê e extrai  →  compara com data/trips.json
                                                  │
                                                  ▼
                                    proposta de diff (JSON + resumo)
                                                  │
                                          Eduardo revisa
                                                  │
                                     ▼                        ▼
                            aplica no trips.json        descarta / corrige
                                     │
                                     ▼
                      python scripts/validate_schemas.py
                                     │
                                     ▼
                                 commit + push
```

### Passo a passo

1. **Varrer.** Buscar no Gmail os últimos 7 dias com os remetentes e assuntos
   de reserva (LATAM, Gol, Azul, TAP, Booking, Hoteis.com, Airbnb, Decolar,
   confirmações de ingresso).
2. **Extrair.** Para cada e-mail, tirar: o que foi comprado, localizador,
   datas, valor, moeda, se é reembolsável e a data do e-mail.
3. **Casar com o `trips.json`.** Achar a viagem pelo destino + período. Se não
   existir nenhuma, propor uma viagem nova em `status: "draft"` — nunca
   inventar datas que o e-mail não diz.
4. **Propor.** Devolver o bloco JSON de cada `booking` novo/alterado, mais a
   lista de `pendencias` que abrem ou fecham.
5. **Revisar e aplicar.** O Eduardo cola no arquivo, ajusta o que estiver
   torto e roda `python scripts/validate_schemas.py`.

### Campos que a rotina preenche

| Campo             | Onde                        | Regra                                                                                                                                                                                                                                                                         |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localizador`     | `bookings[].localizador`    | PNR / número do itinerário. **Nunca** no nível da viagem — o schema proíbe `codigo_reserva`, `reserva_numero` e `booking_code` ali.                                                                                                                                           |
| `valor` / `moeda` | `bookings[].valor`          | Só o valor efetivamente cobrado. Alimenta o mini-resumo "R$ X pago".                                                                                                                                                                                                          |
| `reembolsavel`    | `bookings[].reembolsavel`   | `false` só quando o e-mail diz explicitamente que a tarifa não é reembolsável. Na dúvida, **omitir** — ausência ≠ `false`.                                                                                                                                                    |
| `reembolso_nota`  | `bookings[].reembolso_nota` | Condição do reembolso em texto livre. Havendo prazo, escreva a data como `DD/MM/AAAA` — o radar a extrai e mostra o selo verde "protegida até DD/MM" enquanto a janela estiver aberta, e "proteção expirada em DD/MM" depois. Sem data no texto não há selo verde, só a nota. |
| `origem_dado`     | `bookings[].origem_dado`    | Sempre `fonte-AAAA-MM-DD` com a data do e-mail. Ex.: `gmail-2026-08-24`.                                                                                                                                                                                                      |
| `pendencias`      | viagem                      | Texto livre do que ainda falta. Some da lista quando a reserva correspondente é confirmada.                                                                                                                                                                                   |
| `status`          | viagem                      | `draft` enquanto faltar data firme; `em_planejamento` com datas mas com `pendencias`; `planned` quando não sobrar nada.                                                                                                                                                       |

### Campos que a rotina NÃO preenche

Número de cartão, CPF, número de passaporte, CVV. O schema tem um bloco `not`
que rejeita esses campos no nível da viagem, e eles não devem aparecer nem em
`notas`. Número de bilhete (ex.: `LA9573462LVKB`) pode ir em `notas` — é
inútil sem o CPF do titular.

## Template do prompt

Cole isto no Claude Chat, com o `data/trips.json` atual anexado:

```text
Você é o assistente de manutenção do meu diário de viagens
(github.com/edurcampos86-jpg/viagens). Anexei o data/trips.json atual.

TAREFA — varredura semanal:

1. Busque no meu Gmail, nos últimos 7 dias, confirmações de reserva:
   companhias aéreas (LATAM, Gol, Azul, TAP, Ibéria), hospedagem (Booking,
   Hoteis.com, Airbnb, Decolar) e ingressos/eventos.

2. Para cada confirmação encontrada, extraia:
   - o que foi comprado (voo/hospedagem/experiência) e o título curto
   - localizador (PNR ou número do itinerário)
   - data(s) e horários, se o e-mail disser
   - valor e moeda
   - se a tarifa é reembolsável (só marque reembolsavel:false se o e-mail
     afirmar isso explicitamente; na dúvida, omita o campo)
   - a condição de reembolso em reembolso_nota, escrevendo qualquer prazo
     como DD/MM/AAAA — é dessa data que sai o selo verde do radar
   - a data do e-mail, para virar origem_dado no formato "gmail-AAAA-MM-DD"

3. Case cada reserva com uma viagem do trips.json por destino + período.
   Se não houver viagem correspondente, proponha uma nova com
   status "draft" e SÓ os campos que o e-mail sustenta. Não invente datas,
   valores nem coordenadas.

4. Devolva, para cada viagem afetada:
   a) o bloco JSON do booking novo ou alterado, pronto para colar em
      bookings.flights / bookings.stays / bookings.experiences
   b) como fica o array "pendencias" depois da mudança
   c) o status sugerido da viagem (draft / em_planejamento / planned) com
      uma linha de justificativa
   d) um resumo em uma frase do que mudou

REGRAS:
- Você NÃO edita o arquivo. Sua saída é uma proposta que eu reviso.
- Nunca escreva CPF, número de cartão, CVV ou número de passaporte.
- Localizador vai em bookings[].localizador, nunca no nível da viagem.
- Se um e-mail for ambíguo, diga o que está ambíguo em vez de chutar.
- Se nada relevante chegou na semana, responda apenas "sem novidades".
```

## Transições automáticas

Duas regras de **renderização**, implementadas em
`src/core/planning-radar.js`. Nenhuma delas reescreve o `trips.json` — a app
só interpreta o estado declarado, e quem promove o status é o humano nesta
rotina.

### 1. `confirmada-parcial` → `confirmada`

Uma viagem em `em_planejamento` cujo array `pendencias` está **vazio** é
exibida como _confirmada_. É o caso da ordem que foi executada ao atingir o
preço: assim que a última pendência sai da lista, o card para de anunciar
parcialidade sozinho, sem esperar alguém trocar o `status` no arquivo.

Quando a varredura fechar a última pendência de uma viagem, proponha também a
promoção de `em_planejamento` para `planned` — a UI já vai estar mostrando
"confirmada" de qualquer forma, e o arquivo deve alcançar a realidade.

### 2. Viagem vencida vira histórico

Viagem cuja **data final já passou** sai do radar de planejamento e passa a
aparecer no acervo de memórias com o selo **"aguardando registro de
memórias"** — fechamento de posição vira histórico. O `status` no arquivo
continua `planned` até alguém escrever a memória; o selo é o lembrete de que
falta esse registro.

Na varredura semanal, viagens nesse estado são candidatas naturais a virar
`status: "done"` com o campo `memory` preenchido.

## Gatilho recorrente

**Toda segunda-feira, 8h (BRT), via Claude Chat.**

Configuração:

1. No Claude Chat, criar uma tarefa recorrente com o template do prompt acima.
2. Frequência: semanal, segunda-feira, 08:00 — horário de Brasília (UTC−3).
   Em cron UTC isso é `0 11 * * 1`.
3. Conectores necessários: **Gmail** (leitura).
4. Anexar o `data/trips.json` atual a cada rodada, ou apontar para
   `https://raw.githubusercontent.com/edurcampos86-jpg/viagens/main/data/trips.json`.

Segunda de manhã é de propósito: pega o fim de semana, que é quando promoção
de passagem costuma sair, e chega antes da semana engrenar.

### Depois de aplicar a proposta

```bash
python scripts/validate_schemas.py     # obrigatório — o CI roda isto no PR
node tests/planning-radar.test.mjs     # se mexeu na lógica do radar
```

Se a mudança tocar `assets/*` ou `index.html`, bumpe também `VERSION` em
`sw-workbox.js` para invalidar o cache do PWA.
