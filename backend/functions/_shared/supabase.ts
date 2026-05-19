// Helpers para acessar o Supabase a partir de Edge Functions.
// Usa fetch direto na REST API para evitar import do SDK (Deno cold start).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.warn('[supabase.ts] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes.');
}

function svcHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    'Authorization': `Bearer ${SERVICE_ROLE}`,
    'apikey': SERVICE_ROLE,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export async function getUserFromJwt(jwt: string): Promise<{ id: string; email: string } | null> {
  if (!jwt) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: SERVICE_ROLE },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { id: data.id, email: data.email };
}

export async function upsertGmailTokens(payload: {
  user_id: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_at: string;
}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/gmail_tokens?on_conflict=user_id`, {
    method: 'POST',
    headers: svcHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(payload),
  });
}

export async function selectGmailTokens(user_id: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: string;
} | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_tokens?user_id=eq.${user_id}&select=access_token,refresh_token,expires_at`,
    { headers: svcHeaders() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

export async function insertInboxEvent(payload: {
  user_id: string;
  event_type: string;
  payload: unknown;
  raw_sender: string;
  message_id: string;
  source: string;
}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/inbox_events`, {
    method: 'POST',
    headers: svcHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
}

export async function listAllGmailUsers(): Promise<string[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gmail_tokens?select=user_id`,
    { headers: svcHeaders() }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: { user_id: string }) => r.user_id);
}
