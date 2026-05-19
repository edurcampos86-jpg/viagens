// Configura conexão com o backend Supabase em runtime (sem build step).
// URL + anon key ficam em localStorage; chamadas REST passam o JWT do usuário.

const CONFIG_KEY = 'viagens.v2.backend';
const SESSION_KEY = 'viagens.v2.session';

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setConfig({ url, anonKey }) {
  if (!url || !anonKey) throw new Error('backend.setConfig: url e anonKey obrigatórios');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
    throw new Error('URL Supabase esperada no formato https://xxxx.supabase.co');
  }
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ url: url.replace(/\/$/, ''), anonKey })
  );
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setSession(session) {
  if (!session) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function isConfigured() {
  return !!getConfig();
}

export function isAuthenticated() {
  const s = getSession();
  return !!s?.access_token && Date.now() < (s.expires_at || 0);
}

// ── REST helpers ────────────────────────────────────────────────────────

function requireConfig() {
  const cfg = getConfig();
  if (!cfg) throw new Error('Backend não configurado — chame setConfig primeiro.');
  return cfg;
}

function authHeaders() {
  const { anonKey } = requireConfig();
  const s = getSession();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${s?.access_token || anonKey}`,
    'Content-Type': 'application/json',
  };
}

// ── Auth (magic link) ───────────────────────────────────────────────────

export async function signInWithEmail(email) {
  const { url, anonKey } = requireConfig();
  const res = await fetch(`${url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      create_user: true,
      // Volta para o site após click no link
      email_redirect_to: window.location.origin + window.location.pathname,
    }),
  });
  if (!res.ok) throw new Error(`Falha ao enviar magic link: ${await res.text()}`);
  return true;
}

export function captureSessionFromUrl() {
  // Supabase entrega tokens no fragmento (#access_token=...&refresh_token=...)
  if (!window.location.hash) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const expires_in = Number(params.get('expires_in') || 3600);
  if (!access_token) return null;
  const session = {
    access_token,
    refresh_token,
    expires_at: Date.now() + expires_in * 1000,
  };
  setSession(session);
  // limpa hash
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return session;
}

export function signOut() {
  setSession(null);
}

// ── Gmail OAuth orchestration ──────────────────────────────────────────

export function buildGmailOAuthStartUrl() {
  const { url } = requireConfig();
  const s = getSession();
  if (!s?.access_token) throw new Error('Faça login no backend antes de conectar Gmail.');
  return `${url}/functions/v1/gmail-oauth/start?jwt=${encodeURIComponent(s.access_token)}`;
}

export async function isGmailConnected() {
  const { url } = requireConfig();
  const res = await fetch(`${url}/rest/v1/gmail_tokens?select=expires_at,scope`, {
    headers: authHeaders(),
  });
  if (!res.ok) return false;
  const rows = await res.json();
  return rows.length > 0;
}

// ── Inbox events ───────────────────────────────────────────────────────

export async function listPendingInboxEvents() {
  const { url } = requireConfig();
  const res = await fetch(
    `${url}/rest/v1/inbox_events?status=eq.pending&select=*&order=created_at.desc`,
    { headers: authHeaders() }
  );
  if (!res.ok) throw new Error(`Falha listando inbox: ${await res.text()}`);
  return res.json();
}

export async function markInboxEvent(id, { status, applied_trip_id }) {
  const { url } = requireConfig();
  const patch = {
    status,
    applied_trip_id: applied_trip_id || null,
    applied_at: status === 'applied' ? new Date().toISOString() : null,
  };
  const res = await fetch(`${url}/rest/v1/inbox_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Falha marcando inbox: ${await res.text()}`);
}
