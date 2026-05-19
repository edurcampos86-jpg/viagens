# Backend de integrações — Portal de Viagens v2.0

Backend leve em Supabase. **Nunca substitui** o `data/trips.json` como fonte da verdade — só processa integrações externas (Gmail, monitor de preços) e propõe sugestões para o frontend aprovar.

## Estrutura

```
backend/
├── migrations/
│   └── 001_initial.sql           # schema + RLS
├── functions/
│   ├── _shared/                  # utilidades compartilhadas (auth, crypto)
│   ├── gmail-oauth/              # F2.2 — fluxo OAuth com scope readonly
│   └── gmail-parser/             # F2.3 — extrai eventos de e-mails
│       └── senders/              # regex por sender (TAP, Booking, ...)
├── test_fixtures/                # e-mails de exemplo para o parser
└── README.md
```

## Setup inicial (uma vez)

1. **Criar projeto no Supabase** (free tier basta): https://supabase.com/dashboard
2. Anotar as variáveis:
   - `SUPABASE_URL` (ex: `https://xxxxx.supabase.co`)
   - `SUPABASE_ANON_KEY` (chave pública, segura no frontend)
   - `SUPABASE_SERVICE_ROLE_KEY` (apenas servidor / Edge Functions)
3. **Instalar a CLI** do Supabase: `brew install supabase/tap/supabase` ou veja https://supabase.com/docs/guides/cli
4. **Login + link**:
   ```bash
   supabase login
   supabase link --project-ref <seu-ref>
   ```

## Aplicar migrations

```bash
supabase db push
# ou cole o conteúdo de migrations/001_initial.sql no SQL Editor do dashboard
```

RLS é habilitado para todas as tabelas. Policies garantem que cada usuário só lê seus próprios dados via anon key. Acesso a `gmail_tokens.*_encrypted` só pelas Edge Functions (service_role).

## Variáveis de ambiente

Configure no dashboard do Supabase (`Project Settings → Edge Functions → Secrets`):

| Variável | Onde usar | Obrigatória |
|---|---|---|
| `GOOGLE_CLIENT_ID` | gmail-oauth | sim |
| `GOOGLE_CLIENT_SECRET` | gmail-oauth | sim |
| `GMAIL_REDIRECT_URI` | gmail-oauth (callback URL pública) | sim |
| `FRONTEND_REDIRECT_URI` | gmail-oauth (volta para o site) | sim |
| `ANTHROPIC_API_KEY` | gmail-parser (fallback LLM) | só p/ fallback |
| `KIWI_TEQUILA_API_KEY` | price-monitor (Fase 3) | só na F3 |

Para dev local, copie `.env.example` para `.env.local` (gitignored) com os valores.

## Deploy das Edge Functions

```bash
# uma a uma:
supabase functions deploy gmail-oauth --no-verify-jwt
supabase functions deploy gmail-parser
supabase functions deploy price-monitor

# verificar logs
supabase functions logs gmail-parser
```

> **Atenção:** `gmail-oauth` precisa de `--no-verify-jwt` porque o callback do Google chega sem JWT do Supabase; a função valida o `state` manualmente.

## Configurar cron jobs

Pelo dashboard (`Database → Cron Jobs`) ou via SQL:

```sql
-- A cada 6 horas — F2.3
select cron.schedule('gmail-parser', '0 */6 * * *', $$
  select net.http_post(
    'https://<projeto>.supabase.co/functions/v1/gmail-parser',
    headers => jsonb_build_object('Authorization', 'Bearer <service_role>'))
$$);

-- Diário — F3.4
select cron.schedule('price-monitor', '0 12 * * *', $$
  select net.http_post(
    'https://<projeto>.supabase.co/functions/v1/price-monitor',
    headers => jsonb_build_object('Authorization', 'Bearer <service_role>'))
$$);

-- Diário — TTL de inbox_events
select cron.schedule('prune-inbox', '15 3 * * *', $$
  select public.prune_expired_inbox_events();
$$);
```

## Princípios de segurança

1. **Escopo OAuth mínimo:** apenas `gmail.readonly`. Nunca pedir send/modify.
2. **Tokens nunca trafegam para o frontend.** As Edge Functions usam o token para chamar o Gmail e devolvem só o evento extraído.
3. **Anthropic API:** quando usada como fallback de parsing, header `anthropic-no-training: true` obrigatório. Payload enviado ao Claude contém apenas o texto do e-mail (sem destinatário, sem cabeçalhos), e é descartado após extração.
4. **RLS em todas as tabelas.** anon key + JWT do usuário = só vê os próprios dados.
5. **TTL de 90 dias** para `inbox_events` aplicados ou descartados, executado por cron.

## Como conectar com o frontend

O frontend lê `SUPABASE_URL` + `SUPABASE_ANON_KEY` via `src/core/backend.js` (configurado pelo próprio usuário em runtime — sem build step). Ver `src/core/backend.js` no app principal.

## Troubleshooting

- **`401` ao chamar Edge Function:** falta enviar `Authorization: Bearer <jwt-anon-key-do-usuário>`. Ver `backend.js`.
- **`refresh_token = null`:** o Google só devolve refresh token na PRIMEIRA autorização. Se perdeu, vá em https://myaccount.google.com/permissions, revogue o acesso e refaça o fluxo.
- **Parser não extrai nada:** rode `deno test backend/functions/gmail-parser` para validar regex contra os fixtures.
