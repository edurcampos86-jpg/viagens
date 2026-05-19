-- Migration 001 — schema inicial do backend de integrações (v2.0).
-- Aplicar via `supabase db push` ou pasted no SQL Editor.
--
-- Princípio de segurança: RLS habilitado em todas as tabelas; o único
-- vetor de acesso autorizado a `gmail_tokens.*_encrypted` é via Edge
-- Functions com service_role key. RLS protege contra leak via anon key
-- mesmo que alguém descubra a URL do Supabase.

-- Extensões
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────
-- users
--   Auth nativa do Supabase já fornece auth.users. Esta tabela mantém
--   apenas metadados específicos do produto (preferências de conexão).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  github_repo text default 'edurcampos86-jpg/viagens',
  default_branch text default 'main'
);

alter table public.users enable row level security;

drop policy if exists "users self" on public.users;
create policy "users self" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ─────────────────────────────────────────────────────────────────────
-- gmail_tokens
--   access/refresh tokens cifrados. Em produção, usar Supabase Vault
--   (column `bytea`); aqui mantemos `text` para simplicidade do MVP, com
--   comentário marcando o TODO de hardening.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.gmail_tokens (
  user_id uuid primary key references public.users (id) on delete cascade,
  access_token text not null,           -- TODO: migrar para bytea + Vault
  refresh_token text not null,          -- TODO: migrar para bytea + Vault
  scope text not null check (scope = 'https://www.googleapis.com/auth/gmail.readonly'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_tokens enable row level security;

-- Usuário pode ver que CONECTOU (não vê o token, mas pode revogar). As
-- Edge Functions usam service_role para ler/escrever tokens.
drop policy if exists "gmail_tokens self meta" on public.gmail_tokens;
create policy "gmail_tokens self meta" on public.gmail_tokens
  for select using (auth.uid() = user_id);

drop policy if exists "gmail_tokens self delete" on public.gmail_tokens;
create policy "gmail_tokens self delete" on public.gmail_tokens
  for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- inbox_events
--   Eventos extraídos de e-mails (voo, hospedagem, ingresso). TTL de 90
--   dias garantido por cron (não está aqui ainda; cron na 002 ou via
--   Supabase Cron jobs).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.inbox_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  event_type text not null check (event_type in ('flight', 'stay', 'experience', 'unknown')),
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  payload jsonb not null,               -- estruturado: {from, to, airline, pnr, ...}
  raw_sender text not null,             -- ex: noreply@flytap.com
  message_id text not null,             -- Gmail message id (unique p/ deduplicação)
  source text not null default 'gmail-regex' check (source in ('gmail-regex', 'gmail-llm', 'manual')),
  applied_trip_id text,                 -- id da viagem no trips.json após aprovação
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

create index if not exists inbox_events_user_status_idx
  on public.inbox_events (user_id, status, created_at desc);

alter table public.inbox_events enable row level security;

drop policy if exists "inbox_events self" on public.inbox_events;
create policy "inbox_events self" on public.inbox_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- price_watches
--   Snapshot diário de preços por rota/viagem; alerta=true quando há
--   queda relevante (cron compara com lowest_price).
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.price_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  trip_id text not null,
  route text not null,                  -- "GRU-BRU" ou "GRU-BRU/2026-07-14"
  current_price_brl numeric(12, 2) not null,
  lowest_price_brl numeric(12, 2) not null,
  alert boolean not null default false,
  alert_reason text,
  checked_at timestamptz not null default now()
);

create index if not exists price_watches_user_trip_idx
  on public.price_watches (user_id, trip_id, checked_at desc);

alter table public.price_watches enable row level security;

drop policy if exists "price_watches self" on public.price_watches;
create policy "price_watches self" on public.price_watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────
-- TTL housekeeping
--   Stored function chamada por Supabase Cron a cada 24h.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.prune_expired_inbox_events()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.inbox_events
   where created_at < now() - interval '90 days'
     and status in ('applied', 'dismissed');
$$;

grant execute on function public.prune_expired_inbox_events() to service_role;
