// Edge Function: gmail-parser
// Roda em cron a cada 6h. Para cada usuário com gmail_tokens válido,
// busca mensagens recentes de senders conhecidos, extrai eventos e grava
// em `inbox_events` (status='pending') para aprovação humana.
//
// Deploy: supabase functions deploy gmail-parser

import { corsHeaders } from '../_shared/cors.ts';
import {
  insertInboxEvent,
  listAllGmailUsers,
  selectGmailTokens,
} from '../_shared/supabase.ts';
import * as tap from './senders/tap.ts';
import * as booking from './senders/booking.ts';
import { latam, gol, airbnb, decolar, hotelsCom, events } from './senders/generic.ts';
import type { ParseResult, ParserModule, RawEmail } from './types.ts';
import { llmExtract } from './llm-fallback.ts';

const PARSERS: ParserModule[] = [
  tap as unknown as ParserModule,
  booking as unknown as ParserModule,
  latam,
  gol,
  airbnb,
  decolar,
  hotelsCom,
  events,
];

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ── Gmail fetch ────────────────────────────────────────────────────────

async function fetchRecentEmails(accessToken: string): Promise<RawEmail[]> {
  // Pega só os 50 mais recentes (últimos 7 dias) de senders conhecidos.
  const senders = [
    'flytap.com',
    'latam.com',
    'voegol.com.br',
    'booking.com',
    'airbnb.com',
    'decolar.com',
    'hotels.com',
    'ticketmaster.com',
    'eventim.com',
    'cvent.com',
  ];
  const q = senders.map((s) => `from:${s}`).join(' OR ') + ' newer_than:7d';
  const listRes = await fetch(
    `${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=50`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) {
    console.error('[parser] listagem falhou:', listRes.status, await listRes.text());
    return [];
  }
  const { messages = [] } = (await listRes.json()) as { messages?: { id: string }[] };

  const emails: RawEmail[] = [];
  for (const m of messages) {
    const detRes = await fetch(`${GMAIL_API}/messages/${m.id}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!detRes.ok) continue;
    const det = await detRes.json();
    const headers = det.payload?.headers || [];
    const from = headers.find((h: { name: string }) => h.name.toLowerCase() === 'from')?.value || '';
    const subject =
      headers.find((h: { name: string }) => h.name.toLowerCase() === 'subject')?.value || '';
    const date = headers.find((h: { name: string }) => h.name.toLowerCase() === 'date')?.value;
    const body_text = extractTextBody(det.payload);
    emails.push({
      message_id: m.id,
      sender: from,
      subject,
      body_text,
      received_at: date ? new Date(date).toISOString() : new Date().toISOString(),
    });
  }
  return emails;
}

function extractTextBody(payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeB64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const p of payload.parts) {
      const text = extractTextBody(p as typeof payload);
      if (text) return text;
    }
  }
  // Fallback: HTML → strip tags
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return decodeB64Url(payload.body.data).replace(/<[^>]+>/g, ' ');
  }
  return '';
}

function decodeB64Url(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0)));
  } catch {
    return '';
  }
}

// ── Token refresh ──────────────────────────────────────────────────────

async function ensureFreshToken(userId: string): Promise<string | null> {
  const tok = await selectGmailTokens(userId);
  if (!tok) return null;
  if (new Date(tok.expires_at).getTime() > Date.now() + 60_000) {
    return tok.access_token;
  }
  // Chama o /refresh do gmail-oauth
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/gmail-oauth/refresh`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, refresh_token: tok.refresh_token }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

// ── Orchestration ──────────────────────────────────────────────────────

export async function parseEmail(
  email: RawEmail
): Promise<{ result: ParseResult | null; source: 'gmail-regex' | 'gmail-llm' }> {
  for (const parser of PARSERS) {
    if (!parser.matches(email.sender)) continue;
    const result = parser.parse(email.body_text);
    if (result && result.confidence >= 0.6) {
      return { result, source: 'gmail-regex' };
    }
    // Fallback LLM se regex existe mas teve baixa confiança
    const fallback = await llmExtract(email.body_text, email.subject);
    if (fallback) return { result: fallback, source: 'gmail-llm' };
    return { result, source: 'gmail-regex' };
  }
  return { result: null, source: 'gmail-regex' };
}

async function processUser(userId: string): Promise<{ inserted: number; total: number }> {
  const accessToken = await ensureFreshToken(userId);
  if (!accessToken) return { inserted: 0, total: 0 };
  const emails = await fetchRecentEmails(accessToken);
  let inserted = 0;
  for (const e of emails) {
    const { result, source } = await parseEmail(e);
    if (!result || result.confidence < 0.4) continue;
    const res = await insertInboxEvent({
      user_id: userId,
      event_type: result.event_type,
      payload: result.payload,
      raw_sender: e.sender,
      message_id: e.message_id,
      source,
    });
    // 409 = unique violation (já existia) — silencioso
    if (res.ok || res.status === 409) inserted++;
  }
  return { inserted, total: emails.length };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  // Acesso restrito ao service_role (cron) ou JWT do próprio usuário.
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return new Response('unauthorized', { status: 401 });
  }

  const userIds = await listAllGmailUsers();
  const results: Record<string, unknown> = {};
  for (const id of userIds) {
    try {
      results[id] = await processUser(id);
    } catch (e) {
      results[id] = { error: (e as Error).message };
    }
  }
  return new Response(JSON.stringify({ run_at: new Date().toISOString(), results }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
});
