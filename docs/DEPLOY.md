# Deploy do backend — Portal de Viagens v2.0

Checklist manual para você executar quando quiser destravar as features
de backend (Gmail, monitor de preços, agentes Claude). O frontend
funciona standalone sem nada disso.

Se preferir delegar a um agente, veja [`COWORK-PROMPT.md`](./COWORK-PROMPT.md).

---

## 1. Pré-requisitos (5 min)

```bash
# Supabase CLI (Mac)
brew install supabase/tap/supabase

# ou Linux
curl -fsSL https://cli.supabase.com/install.sh | sh

# Login + verificação
supabase login
supabase --version   # deve mostrar >= 1.150
```

## 2. Criar projeto Supabase (3 min)

1. Acesse https://supabase.com/dashboard → **New project** (free tier basta)
2. Anote três valores em `Settings → API`:
   - `Project URL` (ex.: `https://abcdefgh.supabase.co`)
   - `anon public key` (frontend usa)
   - `service_role secret` (apenas Edge Functions — nunca expor)
3. Em local:
   ```bash
   cd /caminho/para/viagens
   cp backend/.env.example backend/.env.local
   # preencha SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
   supabase link --project-ref <seu-ref>
   ```

## 3. Aplicar a migration (1 min)

```bash
supabase db push
# Se der conflito, cole manualmente o conteúdo de
# backend/migrations/001_initial.sql no SQL Editor do dashboard.
```

Verifique no dashboard: tabelas `users`, `gmail_tokens`, `inbox_events`,
`price_watches` devem aparecer em `Table Editor`, todas com RLS ligado.

## 4. Google OAuth (Gmail readonly) — 10 min

1. https://console.cloud.google.com/apis/credentials → **Create credentials** → **OAuth client ID**
2. Tipo: **Web application**
3. Authorized redirect URIs:
   ```
   https://<seu-ref>.supabase.co/functions/v1/gmail-oauth/callback
   ```
4. Em **OAuth consent screen**: adicione seu e-mail como test user; scope mínimo `https://www.googleapis.com/auth/gmail.readonly`.
5. Copie `Client ID` e `Client secret`.

## 5. Configurar secrets das Edge Functions (2 min)

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="xxxx-xxxx.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="GOCSPX-xxxx" \
  GMAIL_REDIRECT_URI="https://<seu-ref>.supabase.co/functions/v1/gmail-oauth/callback" \
  FRONTEND_REDIRECT_URI="https://edurcampos86-jpg.github.io/viagens/#gmail-connected" \
  OAUTH_STATE_SECRET="$(openssl rand -hex 32)"

# Para os agentes Claude (Concierge, Cronista, fallback de parser):
supabase secrets set ANTHROPIC_API_KEY="sk-ant-xxxx"

# Para o monitor de preços (Fase 3):
supabase secrets set KIWI_TEQUILA_API_KEY="xxxx"

# Verificar
supabase secrets list
```

## 6. Deploy das Edge Functions (3 min)

```bash
# Gmail OAuth — precisa de --no-verify-jwt porque o callback chega sem JWT
supabase functions deploy gmail-oauth --no-verify-jwt

# Parser e agentes Claude — JWT verificado normalmente
supabase functions deploy gmail-parser
supabase functions deploy concierge
supabase functions deploy chronicler
supabase functions deploy price-monitor

# Verificar
supabase functions list
```

## 7. Cron jobs (3 min)

No `SQL Editor` do Supabase, cole:

```sql
-- Parser de e-mails a cada 6h
select cron.schedule('gmail-parser', '0 */6 * * *', $$
  select net.http_post(
    'https://<seu-ref>.supabase.co/functions/v1/gmail-parser',
    headers => jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE>')
  )
$$);

-- Monitor de preços diário (meio-dia UTC)
select cron.schedule('price-monitor', '0 12 * * *', $$
  select net.http_post(
    'https://<seu-ref>.supabase.co/functions/v1/price-monitor',
    headers => jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE>')
  )
$$);

-- TTL de inbox_events (3:15 UTC todo dia)
select cron.schedule('prune-inbox', '15 3 * * *', $$
  select public.prune_expired_inbox_events();
$$);
```

> Substitua `<seu-ref>` e `<SERVICE_ROLE>` antes de rodar.

## 8. Conectar pelo frontend (2 min)

1. Abra o site (https://edurcampos86-jpg.github.io/viagens/) ou rode local
2. Clique no badge **🛠 Backend & Gmail** (canto inferior direito)
3. Cole `SUPABASE_URL` + `anon key` → **Salvar conexão**
4. **Enviar magic link** → cheque seu e-mail → clique no link → volta logado
5. **Conectar Gmail →** consent (apenas `gmail.readonly`) → volta para o site
6. Aguarde a próxima execução do cron (até 6h) ou rode manualmente:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer <SERVICE_ROLE>" \
     https://<seu-ref>.supabase.co/functions/v1/gmail-parser
   ```
7. Clique em **📥 Sugestões do Gmail** — deve listar reservas extraídas

## 9. Push notifications (opcional, ~15 min)

Não escopei a Edge Function `push-register` na v2.0 — você precisa:

1. Gerar VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Adicionar tabela `push_subscriptions` (migration 002):
   ```sql
   create table public.push_subscriptions (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references public.users(id) on delete cascade,
     endpoint text not null unique,
     p256dh text not null,
     auth text not null,
     created_at timestamptz default now()
   );
   alter table public.push_subscriptions enable row level security;
   create policy "push_subscriptions self" on public.push_subscriptions
     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
   ```
3. Criar `backend/functions/push-register/index.ts` (POSTa subscription)
4. Atualizar `price-monitor` para chamar Web Push quando `alert=true`
5. Setar secrets `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`

Sem isso, o handler `push` no SW está pronto mas nunca dispara.

## 10. Histórico de branches

A v2.0 já está mergeada em `main` via PR #34 (2026-05-19). As branches
`feat/v2` e `claude/execute-tasks-OsD7g` já foram deletadas.

Trabalhe direto em `main` ou crie uma branch `fix/<nome>` para hotfixes
pontuais durante o deploy do backend.

---

## Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| Magic link não chega | SMTP padrão do Supabase tem rate limit | Configurar SMTP customizado em `Auth → Email`, ou aguardar |
| `401` ao clicar Conectar Gmail | OAuth callback URI diferente do registrado | Conferir exatamente a URL em Google Console vs `GMAIL_REDIRECT_URI` |
| Parser não acha e-mails | Filtro `from:flytap.com OR ...` não bate com sender real | Adicionar sender em `gmail-parser/senders/generic.ts` |
| Concierge retorna `502` | `ANTHROPIC_API_KEY` não setado ou rate limited | `supabase secrets list` para confirmar; verificar https://console.anthropic.com/settings/usage |
| `gmail_tokens` vazio mesmo após callback | `refresh_token` veio null (Google só dá na 1ª autorização) | Revogar acesso em https://myaccount.google.com/permissions, refazer fluxo |
| SW antigo continua ativo | cache do browser | DevTools → Application → Service Workers → Unregister, recarregar |

## Custo estimado (uso pessoal)

| Serviço | Plano | Custo / mês |
|---|---|---|
| Supabase | Free tier | $0 (500MB Postgres, 500K function invocations) |
| Anthropic API | pay-per-use | ~$1–5 (Cronista raro, Concierge sob demanda, fallback de parser raro) |
| Kiwi Tequila | Free tier | $0 (uso pessoal) |
| Google OAuth | Workspace gratuito | $0 |
| GitHub Pages | Free | $0 |
| **Total** | | **< $5/mês** |
