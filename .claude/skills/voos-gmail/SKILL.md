---
name: voos-gmail
description: >-
  Ingestão de reservas (voos, hospedagens, experiências) do Gmail para uma
  viagem em data/trips.json, no formato canônico ADR-001 e SEM PII. Use SEMPRE
  que o Eduardo pedir para "varrer/buscar o Gmail" por reservas de uma viagem,
  "ingerir os voos/hotéis da viagem X", "atualizar as reservas da <viagem> a
  partir do e-mail", "confirmar o que já está reservado", ou colar um e-mail de
  confirmação (cia aérea/hotel) pedindo para registrar. A skill busca no Gmail
  conectado, extrai os campos, TIRA todo localizador/bilhete/nº de cartão,
  funde via script determinístico e abre um PR sem mergear. Se não achar
  reserva, registra "lacuna confirmada" em vez de inventar.
---

# Ingestão de reservas do Gmail → trips.json (skill voos-gmail)

Automatiza o rito da Frente Bookings Vivos: ler os e-mails de confirmação,
extrair voos/hospedagens no schema canônico (`bookings.{flights,stays,
experiences}` + `budget.planned`), **remover toda PII** (repo é público) e
fundir na viagem — tudo num PR, sem merge. O merge determinístico e as duas
redes de segurança automáticas vivem em `scripts/ingest_bookings_json.py`.

## Invariantes (não negociáveis)
- **Nunca cria viagem:** se o `tripId` não existe em `trips.json`, o script
  aborta. Não invente viagem — confirme o id com o Eduardo.
- **Zero PII (repo público, ADR-001):** nada de localizador/PNR, nº de bilhete,
  frequent flyer, cartão ou CVV. `localizador` é sempre `null`. O script aborta
  se detectar qualquer um; ainda assim, faça o grep manual do passo 6.
- **Chave de orçamento v2:** o número de cada categoria vai na chave que os
  widgets leem — `flights`, `stays`, `experiences`, `food`, `other` — **não**
  em `voos`/`hospedagem` (essas só como objeto de DETALHE). Pôr número na chave
  legada = valor invisível na UI (o bug do PR #101). O script aborta e aponta a
  chave certa.
- **Sem invenção:** só registra reserva que existe no e-mail. Se a varredura não
  achar nada para a viagem, registre a lacuna (ver passo 4b) em vez de fabricar.
- **`git add` escopado:** só `data/trips.json`. Nunca `git add -A` (evita o
  phantom do webp LFS e o `.claude/launch.json`).
- **Sem bump de service worker:** `data/trips.json` é NetworkFirst — nada
  precacheado muda. Se o diff tocar `sw-workbox.js`/`assets/*`/`src/*`/
  `index.html`, PARE: algo está errado.
- **Para antes do merge:** abre o PR e devolve o número ao Eduardo.

## Procedimento

> **Interpretador Python:** no Windows use `py -3` (o `python3` costuma ser stub
> da Store); no macOS use `python3`. O script de ingestão é stdlib pura (sem
> venv); o venv só é preciso no passo 7 para o `validate_schemas.py`.

1. **Recon + branch:** confirme o `tripId` alvo (`grep '"id":' data/trips.json`).
   Working tree limpo: `git checkout main && git pull --ff-only`. Crie a branch:
   `git checkout -b feat/voos-<tripId>-<YYYYMMDD>`.

2. **Varra o Gmail** (ferramentas MCP do Gmail). Combine buscas por destino/datas
   e por remetentes típicos — cia aérea (LATAM, GOL, Azul, TAP, Smiles) e
   hospedagem (Booking, Hoteis.com, Airbnb, Expedia). Ex.:
   `from:(latam.com OR voegol.com.br OR flytap.com) after:AAAA/MM/DD`,
   `from:(booking.com OR hoteis.com) {confirmação itinerário}`.
   Abra os threads promissores com `get_thread` (FULL_CONTENT) e leia os detalhes.

3. **Extraia para o schema canônico.** Para cada reserva CONFIRMADA, monte um
   booking (campos conforme `$defs/booking` de `data/schemas/trip.schema.json`):
   - comuns: `titulo`, `status: "confirmado"`, `data` (evento/check-in),
     `valor` + `moeda`, `criticidade` (flight=alta, stay=media), `confirmada:
     true`, `origin: "extraído:gmail"`, `pax`;
   - voo: `partida`/`chegada` (ISO), `franquia`; hospedagem: `check_in`/
     `check_out`, `noites`, `cidade`.
   - **NUNCA copie** localizador, nº de bilhete/e-ticket, frequent flyer, cartão.
     Deixe `localizador: null`. Detalhes tipo "R$X na propriedade"/"cancelamento
     grátis até Y" podem ir em `notas` (sem identificadores).

4a. **Monte o payload** `/tmp/bookings.json`:
   ```json
   {
     "tripId": "<id>",
     "flights": [ ... ], "stays": [ ... ], "experiences": [ ... ],
     "budget": { "stays": 6876.46, "hospedagem": { "BRL": 6876.46, "nota": "..." } },
     "tips": "..."
   }
   ```
   O número de cada categoria vai na chave v2 (`flights`/`stays`/…); o objeto de
   detalhe (`voos`/`hospedagem`) é opcional e espelha o padrão do arquivo.

4b. **Se a varredura não achar reserva** para a viagem, NÃO rode o merge de
   bookings. Em vez disso, acrescente às `notas` do(s) placeholder(s) da viagem:
   `Varredura Gmail DD/MM/AAAA: nenhuma reserva encontrada ➜ lacuna confirmada`
   (via Edit manual), mantendo `status: pendente`. Depois pule para o passo 6.

5. **Rode o merge determinístico:**
   `py -3 scripts/ingest_bookings_json.py /tmp/bookings.json`
   Ele aborta se detectar PII ou número em chave de orçamento errada. Lê a saída:
   viagem, quantos bookings entraram, `budget.planned`. "Nada novo" = idempotente
   (já aplicado), encerre.

6. **Guard read-only + grep anti-vazamento:** `git status --porcelain` deve
   mostrar SÓ `data/trips.json`. Rode o grep de PII no arquivo INTEIRO (não só
   no diff) — o comando concreto, que deve voltar VAZIO:
   `grep -nE '"localizador":\s*"|([0-9][ .-]?){13,}[0-9]' data/trips.json`
   (pega localizador não-nulo e corridas de 13+ dígitos mesmo agrupadas com
   espaço/ponto/hífen — cartão Amex 4-6-5, itinerário quebrado etc.).
   Qualquer sobra → `git restore data/trips.json` e PARE.

7. **Valide o schema** (venv; PEP 668 bloqueia o pip do sistema no macOS):
   `py -3 -m venv .venv; . .venv/Scripts/activate` (Win) ou `. .venv/bin/activate` (mac);
   `pip install -q jsonschema referencing; py -3 scripts/validate_schemas.py`
   Falhou → `git restore data/trips.json` + PARE.

8. **Commit escopado + PR, sem merge:**
   `git add data/trips.json`
   `git diff --cached --stat`  (confirme: só esse arquivo)
   `git commit -m "feat(trips): reservas confirmadas em <tripId> via Gmail"`
   `git push -u origin <branch>` então `gh pr create --fill`. PARE no merge.
   Devolva ao Eduardo o número do PR e o resumo (viagem, N voos/hotéis, total).

9. Ele revisa o preview (Reservas + Orçamento mostram as reservas) e mergeia
   quando aprovar: `gh pr merge <N> --squash --delete-branch`.

## Se algo divergir
Pare e reporte. Nunca force, nunca improvise um caminho alternativo. Em dúvida,
o conservador é `git restore` + branch intacta + avisar o Eduardo. Em especial:
se o script abortar por PII ou por chave de orçamento, **conserte o payload** —
não contorne o guard.
