// Edge Function: price-monitor (F3.4)
// Cron diário. Para cada usuário com viagens `planned`, consulta a API
// Kiwi Tequila pelos voos cadastrados e grava snapshot em `price_watches`.
// Marca alert=true quando:
//   • current_price < lowest_price * 0.9  (queda > 10%)
//   • date alternativa ±2 dias > 15% mais barata (best_alternative)
//
// Deploy:
//   supabase secrets set KIWI_TEQUILA_API_KEY=...
//   supabase functions deploy price-monitor

import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIWI_KEY = Deno.env.get('KIWI_TEQUILA_API_KEY') ?? '';

const KIWI_BASE = 'https://api.tequila.kiwi.com/v2/search';

function svc(extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${SERVICE_ROLE}`,
    apikey: SERVICE_ROLE,
    'Content-Type': 'application/json',
    ...extra,
  };
}

interface FlightWatch {
  user_id: string;
  trip_id: string;
  from: string;
  to: string;
  date_from: string;   // DD/MM/YYYY (formato Kiwi)
  date_to: string;     // DD/MM/YYYY
  baseline_price_brl: number;
}

// Lê todas as viagens `planned` de todos os usuários via REST API do
// repositório (assumindo que o frontend mantém uma copia em data/trips.json
// no GitHub Pages). Em produção, ler direto do raw URL — assim o monitor
// nao precisa de PAT.
async function readTripsJson(): Promise<{ trips: Record<string, unknown>[] }> {
  const url = 'https://raw.githubusercontent.com/edurcampos86-jpg/viagens/main/data/trips.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`trips.json: ${res.status}`);
  return res.json();
}

function toKiwiDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function plusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function extractWatches(trips: Record<string, unknown>[]): FlightWatch[] {
  const out: FlightWatch[] = [];
  for (const t of trips) {
    if (t.status !== 'planned') continue;
    const bookings = (t.bookings as { flights?: Record<string, unknown>[] }) || {};
    for (const f of bookings.flights || []) {
      const from = f.from as string | undefined;
      const to = f.to as string | undefined;
      const departure = f.departure as string | undefined;
      const price = f.price_brl as number | undefined;
      if (!from || !to || !departure || !price) continue;
      const day = departure.slice(0, 10);
      // user_id NÃO sai do trips.json — caller injeta via processUser.
      out.push({
        user_id: '',
        trip_id: t.id as string,
        from,
        to,
        date_from: toKiwiDate(day),
        date_to: toKiwiDate(day),
        baseline_price_brl: price,
      });
    }
  }
  return out;
}

async function queryKiwi(w: FlightWatch): Promise<{ price: number; date: string } | null> {
  if (!KIWI_KEY) {
    console.warn('[price-monitor] KIWI_TEQUILA_API_KEY ausente — pulando.');
    return null;
  }
  const url = new URL(KIWI_BASE);
  url.searchParams.set('fly_from', w.from);
  url.searchParams.set('fly_to', w.to);
  url.searchParams.set('date_from', w.date_from);
  url.searchParams.set('date_to', w.date_to);
  url.searchParams.set('curr', 'BRL');
  url.searchParams.set('limit', '5');
  const res = await fetch(url, { headers: { apikey: KIWI_KEY } });
  if (!res.ok) {
    console.error('[price-monitor] Kiwi erro:', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { data?: { price: number; local_departure: string }[] };
  const first = data.data?.[0];
  if (!first) return null;
  return { price: first.price, date: first.local_departure.slice(0, 10) };
}

async function querySurroundingDates(
  w: FlightWatch
): Promise<{ best_price: number; best_date: string } | null> {
  if (!KIWI_KEY) return null;
  const baseDay = w.date_from.split('/').reverse().join('-');
  const candidates = [-2, -1, 1, 2].map((d) => plusDays(baseDay, d));
  let best: { price: number; date: string } | null = null;
  for (const dayIso of candidates) {
    const url = new URL(KIWI_BASE);
    url.searchParams.set('fly_from', w.from);
    url.searchParams.set('fly_to', w.to);
    url.searchParams.set('date_from', toKiwiDate(dayIso));
    url.searchParams.set('date_to', toKiwiDate(dayIso));
    url.searchParams.set('curr', 'BRL');
    url.searchParams.set('limit', '1');
    const res = await fetch(url, { headers: { apikey: KIWI_KEY } });
    if (!res.ok) continue;
    const data = (await res.json()) as { data?: { price: number }[] };
    const p = data.data?.[0]?.price;
    if (p && (!best || p < best.price)) {
      best = { price: p, date: dayIso };
    }
  }
  return best ? { best_price: best.price, best_date: best.date } : null;
}

async function getLastWatch(user_id: string, trip_id: string, route: string) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/price_watches?user_id=eq.${user_id}&trip_id=eq.${trip_id}&route=eq.${encodeURIComponent(route)}&select=lowest_price_brl&order=checked_at.desc&limit=1`,
    { headers: svc() }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] || null;
}

async function insertWatch(payload: {
  user_id: string;
  trip_id: string;
  route: string;
  current_price_brl: number;
  lowest_price_brl: number;
  alert: boolean;
  alert_reason?: string;
}) {
  return fetch(`${SUPABASE_URL}/rest/v1/price_watches`, {
    method: 'POST',
    headers: svc({ Prefer: 'return=minimal' }),
    body: JSON.stringify(payload),
  });
}

async function listUsers(): Promise<string[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id`, {
    headers: svc(),
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.map((r: { id: string }) => r.id);
}

async function processWatch(w: FlightWatch) {
  const current = await queryKiwi(w);
  if (!current) return null;
  const route = `${w.from}-${w.to}/${w.date_from}`;
  const last = await getLastWatch(w.user_id, w.trip_id, route);
  const lowest = last?.lowest_price_brl
    ? Math.min(last.lowest_price_brl, current.price)
    : current.price;

  // Detecta queda relevante
  const baseline = Number(w.baseline_price_brl);
  let alert = false;
  let reason: string | undefined;
  if (current.price < baseline * 0.9) {
    alert = true;
    reason = `queda de ${Math.round((1 - current.price / baseline) * 100)}% vs baseline (R$ ${baseline.toFixed(0)} → R$ ${current.price.toFixed(0)})`;
  }
  const alt = await querySurroundingDates(w);
  if (alt && alt.best_price < current.price * 0.85) {
    alert = true;
    reason = (reason ? reason + ' · ' : '') +
      `data alternativa (${alt.best_date}) está ${Math.round((1 - alt.best_price / current.price) * 100)}% mais barata`;
  }
  await insertWatch({
    user_id: w.user_id,
    trip_id: w.trip_id,
    route,
    current_price_brl: current.price,
    lowest_price_brl: lowest,
    alert,
    alert_reason: reason,
  });
  return { route, alert, reason, current: current.price, lowest };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (!req.headers.get('authorization')?.startsWith('Bearer ')) {
    return new Response('unauthorized', { status: 401 });
  }

  try {
    const trips = (await readTripsJson()).trips || [];
    const watches = extractWatches(trips);
    const users = await listUsers();
    const results: Record<string, unknown[]> = {};
    for (const userId of users) {
      const userWatches = watches.map((w) => ({ ...w, user_id: userId }));
      const out: unknown[] = [];
      for (const w of userWatches) {
        const r = await processWatch(w);
        if (r) out.push(r);
      }
      results[userId] = out;
    }
    return new Response(
      JSON.stringify({ run_at: new Date().toISOString(), users: users.length, results }),
      { headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
    );
  } catch (e) {
    return new Response(`erro: ${(e as Error).message}`, { status: 500 });
  }
});
