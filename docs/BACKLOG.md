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

## Escrever `docs/SCHEMA_V2.md` unificado

**Contexto:** o schema v2 implementado vive em `data/schemas/trip.schema.json`
(JSON Schema validado em CI) + descrição conceitual em
[`docs/PRD-viagens-v2.md`](PRD-viagens-v2.md) §3.2. O briefing original da
Sprint 1 (T4) pedia um documento dedicado com a "fórmula de urgência
ponderada" do Cockpit que NÃO existe hoje.

**Trabalho:** consolidar referência única do schema (campos, enums,
exemplos) + documentar a fórmula de urgência que vai alimentar o Cockpit
(Sprint 2). Decidir antes se o Cockpit vai operar sobre o schema atual
(`bookings.{flights,stays,experiences}`) ou se vai exigir um schema plano
com `tipo` discriminator.

---

*Documento vivo. Quando algo daqui virar trabalho, mover para um PR/issue
com referência cruzada a esta entrada.*
