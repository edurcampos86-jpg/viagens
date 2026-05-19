// Edge Function: gmail-oauth
//
// Dois endpoints:
//   GET /functions/v1/gmail-oauth/start?jwt=<user_jwt>
//     → 302 para Google Consent
//   GET /functions/v1/gmail-oauth/callback?code=&state=
//     → troca code por tokens, persiste, redireciona para o frontend
//
// Deploy:
//   supabase functions deploy gmail-oauth --no-verify-jwt
//
// `--no-verify-jwt` é necessário porque o /callback chega sem auth do
// Supabase; validamos o `state` manualmente (HMAC do user_id + nonce).

import { corsHeaders } from '../_shared/cors.ts';
import { getUserFromJwt, upsertGmailTokens } from '../_shared/supabase.ts';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const GMAIL_REDIRECT_URI = Deno.env.get('GMAIL_REDIRECT_URI') ?? '';
const FRONTEND_REDIRECT_URI = Deno.env.get('FRONTEND_REDIRECT_URI') ?? '';
const STATE_SECRET = Deno.env.get('OAUTH_STATE_SECRET') ?? 'dev-only-state-secret';

const enc = new TextEncoder();

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(STATE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signState(userId: string): Promise<string> {
  const nonce = crypto.randomUUID();
  const issued = Date.now().toString();
  const payload = `${userId}.${nonce}.${issued}`;
  const sig = await hmac(payload);
  return btoa(`${payload}.${sig}`);
}

async function verifyState(state: string): Promise<{ user_id: string } | null> {
  try {
    const decoded = atob(state);
    const parts = decoded.split('.');
    if (parts.length !== 4) return null;
    const [userId, nonce, issued, sig] = parts;
    const expected = await hmac(`${userId}.${nonce}.${issued}`);
    if (expected !== sig) return null;
    // Estado válido por 10 minutos
    if (Date.now() - Number(issued) > 10 * 60 * 1000) return null;
    return { user_id: userId };
  } catch {
    return null;
  }
}

function badConfig(): Response {
  return new Response(
    JSON.stringify({
      error: 'config_missing',
      hint: 'Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI, FRONTEND_REDIRECT_URI nos secrets da função.',
    }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  );
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (!CLIENT_ID || !CLIENT_SECRET || !GMAIL_REDIRECT_URI || !FRONTEND_REDIRECT_URI) {
    return badConfig();
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/.*gmail-oauth/, '');

  // ── START ────────────────────────────────────────────────────────
  if (path === '/start' || path === '/start/') {
    const jwt = url.searchParams.get('jwt') || req.headers.get('authorization')?.replace('Bearer ', '');
    const user = jwt ? await getUserFromJwt(jwt) : null;
    if (!user) {
      return new Response('Unauthorized — faça login no Supabase primeiro.', {
        status: 401,
        headers: corsHeaders(origin),
      });
    }
    const state = await signState(user.id);
    const authUrl = new URL(GOOGLE_AUTH);
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', GMAIL_REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPE);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent'); // garante refresh_token
    authUrl.searchParams.set('state', state);
    return Response.redirect(authUrl.toString(), 302);
  }

  // ── CALLBACK ─────────────────────────────────────────────────────
  if (path === '/callback' || path === '/callback/') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return new Response('missing code/state', { status: 400 });
    }
    const verified = await verifyState(state);
    if (!verified) {
      return new Response('invalid state — refaça o fluxo a partir do frontend', { status: 400 });
    }

    // Troca code por tokens
    const tokenRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: GMAIL_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return new Response(`Google token exchange falhou: ${await tokenRes.text()}`, { status: 502 });
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };
    if (!tokens.refresh_token) {
      return new Response(
        'Google não devolveu refresh_token. Revogue o acesso em ' +
          'https://myaccount.google.com/permissions e tente novamente.',
        { status: 400 }
      );
    }
    if (!tokens.scope?.includes('gmail.readonly')) {
      return new Response(`Escopo retornado errado: ${tokens.scope}`, { status: 400 });
    }

    const expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const persist = await upsertGmailTokens({
      user_id: verified.user_id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: SCOPE,
      expires_at,
    });
    if (!persist.ok) {
      return new Response(`Falha ao persistir tokens: ${await persist.text()}`, { status: 500 });
    }
    // Sucesso — devolve o usuário ao frontend
    return Response.redirect(FRONTEND_REDIRECT_URI, 302);
  }

  // ── REFRESH (idempotente, chamada pelo parser) ────────────────────
  if (path === '/refresh') {
    const body = (await req.json().catch(() => null)) as { user_id?: string; refresh_token?: string } | null;
    if (!body?.refresh_token) {
      return new Response('missing refresh_token', { status: 400 });
    }
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: body.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return new Response(`refresh falhou: ${await res.text()}`, { status: 502 });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('not found', { status: 404 });
});
