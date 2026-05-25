# Backlog — Portal de Viagens

> Itens adiados conscientemente. Cada entrada lista o contexto que originou,
> caminhos viáveis e a decisão pendente.

---

## Auto-sync seguro (originado em Sprint 1 T2)

**Contexto:** o botão "Sync agora" foi removido em 2026-05-24 por armazenar
PAT do GitHub em texto claro no `localStorage` (B-N1, ver
[`SPRINT1_FINDINGS.md`](../SPRINT1_FINDINGS.md)). A funcionalidade de
automação do save é desejável mas precisa de implementação segura.

**Caminhos viáveis:**

1. **OAuth Device Flow via GitHub App dedicado.** Token de sessão (curto),
   não PAT longo. Usuário autoriza uma vez, app recebe tokens com escopo
   mínimo. Refresh transparente. Maior complexidade de setup (precisa
   GitHub App publicado), mas é o padrão moderno.
2. **Formulário no site → POST para endpoint Supabase → cria issue/PR
   no GitHub via `GITHUB_TOKEN` do backend.** Token nunca toca o browser.
   Funciona bem se já houver Supabase deployado. Limitação: requer backend
   ativo (hoje o backend está pronto mas inerte — ver `docs/DEPLOY.md`).
3. **Manter manual (status quo após T2) e melhorar o fluxo de export.**
   Ex.: gerar patch já formatado com `git diff` pronto pra copiar, ou
   abrir o arquivo no GitHub Web com o novo conteúdo no clipboard.
   Custo zero de segurança, fricção média.

**Decisão pendente:** qual caminho seguir. Antes de decidir, vale considerar:
- Frequência real com que Eduardo edita trips.json (se é diário, opção 1; se
  é semanal, opção 3 talvez baste)
- Estado do backend Supabase (se ficar inerte, opção 2 sai)
- Apetite por publicar GitHub App público (opção 1 exige)

---

## Gmail OAuth pronto pra deploy (F1 da Sprint SP-Junho)

**Contexto:** o fluxo de importar reservas do Gmail (F1) está implementado
e testado, mas inerte — falta a infraestrutura de deploy. Adiado pra uma
sprint de infra dedicada.

**O que já existe (código pronto):**

- `backend/functions/gmail-oauth/` — handshake OAuth do Google.
- `backend/functions/gmail-parser/` — extrai reservas dos e-mails. Senders
  dedicados: TAP (`senders/tap.ts`), Booking (`senders/booking.ts`); demais
  via `senders/generic.ts` (LATAM, GOL, Airbnb, Decolar, Hotels.com, events)
  com fallback LLM (`llm-fallback.ts`).
- `src/components/inbox.js` — UI da caixa de entrada de reservas.
- `deriveDatesFromBookings` — já coberto por `tests/v2-modules.test.mjs`.
- `backend/migrations/001_initial.sql` — schema com RLS (`gmail_tokens`,
  tokens cifrados, acesso só via Edge Function).

**O que falta (deploy/infra):**

1. Criar o projeto Supabase.
2. Rodar `supabase db push` da migration `001_initial.sql`.
3. Configurar `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` no OAuth Console.
4. Deploy das 2 edge functions (`gmail-oauth`, `gmail-parser`).
5. Plugar o botão "Importar do Gmail" no FAB ⚙ da U2.

**Conexão:** problema irmão da entrada [Auto-sync seguro](#auto-sync-seguro-originado-em-sprint-1-t2)
— ambos dependem de Supabase deployado e tocam o mesmo backend hoje inerte.
Vale resolver juntos numa próxima sprint de infra.

---

## Endereçar B-N4 — docs stale sobre Concierge

**Contexto:** `docs/ARCHITECTURE.md` §3 e §4.3, `docs/AGENTS.md:204` e
`README.md:25` ainda descrevem o Concierge como Edge Function Supabase
chamando Sonnet. Após PR #46 (commit `439c5ff`), o agente foi refatorado
para chamar `api.anthropic.com` direto do browser com Opus 4.7.

**Trabalho:** atualizar os 3 docs para refletir o estado real, e decidir
se `backend/functions/concierge/` (hoje código morto) deve ser removido
ou re-conectado.

---

## Endereçar B-N10 — `data/documentos.json` versionado

**Contexto:** o arquivo está commitado no repo público e potencialmente
contém dados pessoais (passaporte, vacinas). Não auditei o conteúdo
durante a Sprint 1 (princípio: não ler dados pessoais sem necessidade).

**Trabalho:** confirmar conteúdo. Se houver dados sensíveis, mover para
`.env`/secret ou cifrar com a mesma infraestrutura de
`src/core/anthropic-key.js`.

---

## Endereçar B-N3 — paths absolutos em notificações do SW

**Contexto:** `sw-workbox.js:151,163` usa `'/icons/icon-192.svg'` e
`'/'` que, em GitHub Pages project (`/viagens/`), resolvem para fora do
escopo do site. Latente hoje porque push notifications ainda não foram
ativadas (faltam VAPID keys). Vai falhar silenciosamente assim que push
for ligado.

**Trabalho:** trocar para `'./icons/icon-192.svg'` e `'./'`. ~10 linhas.

---

## Endereçar B-N5 — toast "Nova versão disponível" não dispara em deploys subsequentes

**Contexto:** flag `_swActivatedSeen` em `src/main.js:104` é módulo-scope.
A cada page load reseta para `false`, então o primeiro `sw-activated`
recebido (que normalmente é o de uma versão NOVA pós-deploy) é silenciado
como "instalação inicial".

**Trabalho:** persistir última versão vista em `localStorage` e comparar
com `e.data.version` para decidir mostrar toast. ~20 linhas.

---

## Endereçar B-N7 — adicionar Content-Security-Policy

**Contexto:** sem CSP, defense-in-depth contra XSS é fraca — relevante
porque o site agora cifra credenciais (PAT, Anthropic key) no
`localStorage`. Risco real: comprometimento de CDN (Leaflet, unpkg,
Workbox via Google Cloud Storage, Google Fonts).

**Trabalho:** inventariar origens, escrever CSP via
`<meta http-equiv="Content-Security-Policy">`, testar em browser real.
Não é trivial (vai pegar erros de inline styles/scripts existentes),
mas é a maior vitória de segurança disponível.

---

## Endereçar B-N8 — migrar mídia antiga para LFS

**Contexto:** `.gitattributes` configura LFS para `*.webp`/`*.mp4`, mas
os 18 arquivos de `media/iguacu-2021/` foram commitados ANTES do LFS ser
ativado. Funcionam (são bytes reais no git), mas inflam o repo e
emitem warning em todo `git clone`.

**Trabalho:** `git lfs migrate import --include="*.webp,*.mp4,*.jpg,*.png"
--include-ref=refs/heads/main`. Requer `git lfs install` local, cuidado
com força-push e coordenação com colaboradores (se houver clones ativos).

---

## B-N11 — Orçamento vivo retorna 0 sempre

**Severidade:** 🟡 Atenção (promessa não cumprida do CHANGELOG-V2)

**Descrição:** A função `computeActualFromBookings` em
[`src/components/budget.js:64-72`](../src/components/budget.js) sempre retorna
`{flights: 0, stays: 0, experiences: 0}` porque os arrays
`bookings.flights/stays/experiences` estão vazios em todas as 42 viagens
migradas. O [`CHANGELOG-V2.md`](../CHANGELOG-V2.md) linha 95 promete
"✅ Atualização orçamento auto > 80%" — não cumprido.

**Resolução parcial:** a Fase 3 do [ADR-001](ADR-001-schema-canonico.md)
(PR #54, mergeado em `5dceea0`) populou `bookings.stays[]` e
`bookings.flights[]` retroativamente, mas **não** populou `valor` por
booking — esse campo segue sem dados em todas as 47 viagens migradas.
`computeActualFromBookings` agora itera sobre arrays não-vazios mas
continua somando `0` enquanto `valor` (ou `price_brl`) não for adicionado.

**Status:** ⏳ pendente. Próximo passo: definir UX para popular `valor` por
booking (editor inline, parser de Gmail no backend Supabase, ou input
manual em batch). Fora do escopo de Sprint 1.

---

## B-N12 — Leaflet "Map container is already initialized" em SPA

**Severidade:** 🟡 Atenção (polui console, não quebra UX)

**Sintoma:** ao navegar entre páginas de viagens (`#plan/<id>` → outra viagem),
o console mostra `Error: Map container is already initialized`. Aparece ~5
ocorrências por sessão típica de uso.

**Localização:** `assets/app.js:1932` em `renderMiniMap`.

**Causa raiz provável:** o mini-mapa Leaflet é re-instanciado no mesmo
container DOM sem chamar `.remove()` antes. Bug clássico de SPA com Leaflet.

**Solução proposta:** guardar referência da instância Leaflet em variável
de módulo; antes de re-instanciar, chamar `existingMap.remove()` ou checar
`container._leaflet_id`.

**Prioridade:** baixa — não bloqueia funcionalidade. Resolver junto com
refactor futuro de `assets/app.js`.

**Descoberto em:** smoke test humano da Fase 3 (ADR-001), 24/mai/2026.

---

## B-N13 — "Mês favorito de viagem" mostra undefined em agregação global

**Severidade:** 🟡 Atenção (UX visível, dado incorreto)

**Sintoma:** na tela "Ver tudo com filtros", filtro "Tudo (52 viagens)",
o card "MÊS FAVORITO DE VIAGEM" exibe `undefined (undefinedx)`. Filtros por
ano específico funcionam corretamente (ex: "Jun (1×)" para 2021).

**Causa raiz provável:** função agregadora em `assets/app.js` (área de stats)
usa `mode()` ou `groupBy()` sobre `trips.map(t => t.month)`, e quebra quando
alguma viagem tem `month` undefined/null/string. Confirmado via Console
fetch que existem viagens nessa condição (as 8 recorrentes sem ano: `natal-
micareta`, `canoa-quebrada-reveillon-cardume`, etc).

**Solução proposta:** filtrar `t.month != null && typeof t.month === 'number'`
antes da agregação. Adicionar fallback "—" para mês quando não calculável.

**Prioridade:** média — afeta credibilidade visual da página de stats.

**Descoberto em:** smoke test humano da Fase 3 (ADR-001), 24/mai/2026.
Confirmado preexistente via diagnóstico independente.

---

## Documentar schema V2 + fórmula de urgência

**Status:** ✅ CONCLUÍDO pela Fase 4 do ADR-001 (PR #55, este). Ver
[`docs/SCHEMA_V2.md`](SCHEMA_V2.md).

---

## Limpeza de campos legacy do trips.json (pós-Sprint 2)

**Severidade:** 🔵 Informativo

**Descrição:** Após [ADR-001](ADR-001-schema-canonico.md), os campos
`hospedagem`, `transporte`, `air`, `nts`, `logistics.hotels` permanecem em
`data/trips.json` para compatibilidade com `assets/app.js` legacy (3800
linhas, 17 referências a `hospedagem`). Quando o legacy for aposentado ou
refatorado para usar `getBookings()` em vez de leitura direta, esses
campos podem ser removidos. Não fazer antes — quebraria o site público.

**Pré-requisitos:** `assets/app.js` refatorado para não acessar
`trip.hospedagem`/`trip.air`/`trip.nts` diretamente, sempre via
`src/core/schema.js` (`getBookings`, `getDates`).

---

*Documento vivo. Quando algo daqui virar trabalho, mover para um PR/issue
com referência cruzada a esta entrada.*
