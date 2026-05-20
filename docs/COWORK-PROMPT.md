# Prompt para Claude Cowork / agente externo — Deploy do backend v2.0

Copia-cola tudo abaixo em uma sessão do Claude Cowork (ou outro agente com acesso ao seu shell + Supabase CLI + Google Console + Anthropic) para delegar o deploy da Fase 2 + Fase 3 + Fase 4 do Portal de Viagens.

**Antes de colar**, garanta que você está autenticado:
- `supabase login` deve estar OK
- Você tem acesso ao projeto `edurcampos86-jpg/viagens` no GitHub
- Você está em uma máquina com `curl`, `openssl` e `npx`

O agente vai te pedir credenciais conforme precisar. Não cole secrets neste prompt — ele pergunta no momento certo.

---

## 🚀 PROMPT — copia daqui pra baixo

```
Você é um engenheiro de deploy. Sua missão: levar o backend do Portal de
Viagens v2.0 (repo edurcampos86-jpg/viagens, branch main, código já
mergeado via PR #34) de "código pronto, inerte" para "produção
funcionando ponta-a-ponta".

IMPORTANTE: o dono do projeto (Eduardo) NÃO é desenvolvedor. Explique
cada passo em português simples. Pergunte uma coisa por vez. NUNCA peça
credenciais em texto aberto no chat — sempre oriente a setar via
`supabase secrets set` no terminal local dele.

## Contexto

O repo já tem todo o código:
- backend/migrations/001_initial.sql — schema com 4 tabelas (users,
  gmail_tokens, inbox_events, price_watches) + RLS + TTL function.
- backend/functions/gmail-oauth/ — fluxo OAuth com scope readonly,
  state HMAC + TTL anti-CSRF, refresh endpoint.
- backend/functions/gmail-parser/ — cron 6h, parsers regex para
  TAP/Booking/LATAM/Gol/Airbnb/Decolar/Hotels/Ticketmaster + fallback
  Claude Haiku.
- backend/functions/price-monitor/ — cron diário, Kiwi Tequila API,
  alertas > 10% de queda ou > 15% em data alternativa ±2 dias.
- backend/functions/concierge/ + chronicler/ — Claude Sonnet com
  anthropic-no-training: true.
- backend/README.md tem a documentação completa.

## Tarefas (execute na ordem)

### 1. Setup do projeto Supabase

- Pergunte ao Eduardo se ele já tem projeto Supabase criado. Se não,
  oriente a criar no dashboard (free tier basta) e a copiar URL +
  anon key + service_role key.
- Confirme que `supabase link --project-ref <ref>` está OK.

### 2. Aplicar a migration

- Rode `supabase db push` a partir da raiz do repo.
- Verifique no SQL Editor:
  select table_name, row_security from information_schema.tables
   where table_schema = 'public' and table_name in
   ('users','gmail_tokens','inbox_events','price_watches');
- TODAS devem ter row_security = YES. Se não, RLS não foi aplicado —
  pare e investigue.

### 3. Google OAuth Client

- Pergunte ao Eduardo se ele já tem Google Cloud project. Se não,
  oriente a criar (gratuito).
- Em https://console.cloud.google.com/apis/credentials:
  - Habilitar Gmail API.
  - Criar OAuth client ID tipo "Web application".
  - Authorized redirect URI: https://<seu-ref>.supabase.co/functions/v1/gmail-oauth/callback
- No OAuth consent screen, adicionar o e-mail do Eduardo como test
  user. Scope: gmail.readonly APENAS.
- Capture client_id e client_secret.

### 4. Anthropic API key

- Pergunte ao Eduardo se ele já tem. Se não, oriente a criar em
  https://console.anthropic.com/settings/keys.
- Avise sobre custo: ~$1-5/mês em uso pessoal.

### 5. Kiwi Tequila API key

- https://tequila.kiwi.com/portal/login → registrar gratuitamente
  (uso pessoal autorizado pelo free tier).
- Capture a API key.

### 6. Setar secrets

Comando consolidado (peça ao Eduardo os valores que faltarem):

  supabase secrets set \
    GOOGLE_CLIENT_ID="..." \
    GOOGLE_CLIENT_SECRET="..." \
    GMAIL_REDIRECT_URI="https://<ref>.supabase.co/functions/v1/gmail-oauth/callback" \
    FRONTEND_REDIRECT_URI="https://edurcampos86-jpg.github.io/viagens/#gmail-connected" \
    OAUTH_STATE_SECRET="$(openssl rand -hex 32)" \
    ANTHROPIC_API_KEY="..." \
    KIWI_TEQUILA_API_KEY="..."

Confirmar com `supabase secrets list`.

### 7. Deploy das Edge Functions

  supabase functions deploy gmail-oauth --no-verify-jwt
  supabase functions deploy gmail-parser
  supabase functions deploy concierge
  supabase functions deploy chronicler
  supabase functions deploy price-monitor

Confirmar com `supabase functions list`. As 5 devem aparecer com
status ACTIVE.

### 8. Smoke tests

- Curl no gmail-parser com service_role key — deve retornar JSON
  vazio (nenhum usuário conectou Gmail ainda, mas a função tem que
  responder 200):

    curl -sS -X POST \
      -H "Authorization: Bearer <SERVICE_ROLE>" \
      https://<ref>.supabase.co/functions/v1/gmail-parser

- Verificar logs:

    supabase functions logs gmail-parser --since 2m

### 9. Cron jobs

No SQL Editor, configure 3 jobs (substitua <ref> e <SERVICE_ROLE>):

  select cron.schedule('gmail-parser', '0 */6 * * *', $$
    select net.http_post(
      'https://<ref>.supabase.co/functions/v1/gmail-parser',
      headers => jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE>')
    )
  $$);

  select cron.schedule('price-monitor', '0 12 * * *', $$
    select net.http_post(
      'https://<ref>.supabase.co/functions/v1/price-monitor',
      headers => jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE>')
    )
  $$);

  select cron.schedule('prune-inbox', '15 3 * * *', $$
    select public.prune_expired_inbox_events();
  $$);

Confirme com `select * from cron.job` — 3 linhas devem aparecer.

### 10. Conexão pelo frontend

- Abra https://edurcampos86-jpg.github.io/viagens/
- Clique no badge "🛠 Backend & Gmail" (canto inferior direito)
- Cole SUPABASE_URL + anon key, salvar
- Enviar magic link para edurcampos86@gmail.com
- Verificar e-mail, clicar no link, voltar ao site
- Clicar "Conectar Gmail" — consent Google → readonly
- Voltar ao site, clicar "📥 Sugestões do Gmail"
- Se ainda não rodou o cron, forçar:

    curl -sS -X POST \
      -H "Authorization: Bearer <SERVICE_ROLE>" \
      https://<ref>.supabase.co/functions/v1/gmail-parser

- Recarregar o modal, deve listar reservas recentes.

### 11. (Opcional) VAPID + push notifications

Não está escopo na v2.0, mas se quiser ativar push:

  npx web-push generate-vapid-keys
  # vai imprimir Public Key e Private Key. Copie.

  supabase secrets set \
    VAPID_PUBLIC_KEY="..." \
    VAPID_PRIVATE_KEY="..."

Criar migration 002 com tabela push_subscriptions (ver DEPLOY.md
seção 9). Criar Edge Function backend/functions/push-register/ que
recebe { subscription } e insere na tabela. Atualizar price-monitor
para chamar Web Push API quando alert=true.

### 12. Confirmar que GitHub Pages atualizou

A v2.0 já está mergeada na main (PR #34 — feito em 2026-05-19). O
GitHub Pages reconstrói o site em ~1-2 minutos após qualquer push em
main. Após o deploy do backend:

- Visite https://edurcampos86-jpg.github.io/viagens/
- Clique no ❓ Como usar v2 no canto inferior direito
- Confirme que o badge mostra "🎯 Modo completo" depois que ele
  conectar o backend + magic link + Gmail.

Se algum botão estiver quebrado, abra um issue no repo com print da
console do browser (F12 → Console).

## Princípios

1. NUNCA cole secrets em logs ou no chat. Use só variáveis de ambiente.
2. NUNCA commite .env ou .env.local (já estão em .gitignore).
3. Se algo der errado, reverta SÓ o passo que falhou — não desfaça
   etapas anteriores que estavam OK.
4. Ao final, gere um relatório curto: "X functions deployadas, Y cron
   jobs ativos, Z smoke tests OK, link do PR".
5. Se travar em algo que precisa de decisão do Eduardo (limite de
   custo, escolha de SMTP customizado, etc.), pare e pergunte.

Comece pedindo ao Eduardo confirmação dos pré-requisitos do passo 1.
```

---

## Como usar no Claude Cowork

1. Abra uma sessão nova no Claude Cowork (`claude` na sua máquina local com permissões de shell).
2. Cole tudo dentro do bloco de código acima.
3. Responda as perguntas conforme o agente faz.
4. Acompanhe os smoke tests no terminal.
5. Ao final, confirme abrindo a Inbox no site e vendo as primeiras sugestões aparecerem.

Tempo total estimado: **30–45 min** (a maioria gasta em consoles externos — Supabase, Google Cloud, Anthropic, Kiwi).

## Se algum agente externo travar

Cada passo do prompt acima é independente e idempotente. Você pode rodar **só o passo que ficou faltando** — ex: se o deploy das Edge Functions deu OK mas o cron não, pule direto para o passo 9.

Para diagnóstico, consulte `docs/DEPLOY.md` seção "Troubleshooting".
