// Bandeja de sugestões — Curador de E-mail (F2.4).
// Lista eventos pendentes do Supabase e oferece "Aplicar à viagem X" ou
// "Criar viagem nova". Nada vai para `trips.json` sem clique humano.

import * as backend from '../core/backend.js';
import { upsertTrip, getTripsFile, commitMessageFor } from '../core/trips-api.js';
import * as settings from '../core/settings.js';
import { deriveDatesFromBookings } from '../core/dates.js';

let cssInjected = false;
const CSS = `
.inbox-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.inbox-modal { background: #fff; color: #0f172a; width: min(720px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35);
  font: 14px Inter, system-ui, sans-serif; }
.inbox-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
.inbox-body { padding: 12px 20px; }
.inbox-empty { padding: 40px 20px; text-align: center; color: #64748b; }
.inbox-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
  margin-bottom: 10px; }
.inbox-card-head { display: flex; justify-content: space-between; align-items: center;
  gap: 8px; margin-bottom: 6px; }
.inbox-badge { font-size: 11px; font-weight: 700; padding: 2px 8px;
  border-radius: 999px; }
.inbox-badge.flight { background: #dbeafe; color: #1d4ed8; }
.inbox-badge.stay { background: #ecfccb; color: #4d7c0f; }
.inbox-badge.experience { background: #fae8ff; color: #86198f; }
.inbox-badge.unknown { background: #f1f5f9; color: #475569; }
.inbox-meta { font-size: 12px; color: #64748b; }
.inbox-payload { font-family: ui-monospace, monospace; font-size: 12px;
  background: #f8fafc; padding: 8px; border-radius: 6px; margin: 6px 0;
  white-space: pre-wrap; max-height: 120px; overflow: auto; }
.inbox-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.inbox-btn { font: inherit; padding: 6px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; }
.inbox-btn-primary { background: #0f172a; color: #fff; }
.inbox-btn-secondary { background: #fff; color: #0f172a; border-color: #cbd5e1; }
.inbox-btn-danger { background: #fff; color: #b91c1c; border-color: #fecaca; }
.inbox-btn[disabled] { opacity: .5; cursor: not-allowed; }
.inbox-source { font-size: 11px; color: #94a3b8; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'inbox-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

function fmtCurrency(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function summarize(event) {
  const p = event.payload || {};
  switch (event.event_type) {
    case 'flight':
      return [
        p.airline || '?',
        p.pnr ? `PNR ${p.pnr}` : null,
        p.from && p.to ? `${p.from} → ${p.to}` : null,
        p.departure ? p.departure.slice(0, 16).replace('T', ' ') : null,
        fmtCurrency(p.price_brl),
      ].filter(Boolean).join(' · ');
    case 'stay':
      return [
        p.platform || '?',
        p.name || null,
        p.check_in && p.check_out ? `${p.check_in} → ${p.check_out}` : null,
        fmtCurrency(p.price_brl),
      ].filter(Boolean).join(' · ');
    case 'experience':
      return [
        p.name || 'Experiência',
        p.date || null,
        fmtCurrency(p.price_brl),
      ].filter(Boolean).join(' · ');
    default:
      return JSON.stringify(p).slice(0, 80);
  }
}

// ── Aplicação ao trips.json ─────────────────────────────────────────────

function findCandidateTrips(event, allTrips) {
  // Heurística: filtra trips planned cujas datas batem com o evento
  // ou cujo destino casa.
  const candidates = [];
  const p = event.payload || {};
  for (const t of allTrips) {
    if (t.status === 'done') continue;
    let score = 0;
    const dates = t.dates?.start;
    if (event.event_type === 'flight' && p.departure && dates) {
      const diff = Math.abs(new Date(p.departure) - new Date(dates));
      if (diff < 90 * 86400000) score += 3; // 90 dias
    }
    if (event.event_type === 'stay' && p.check_in && dates) {
      const diff = Math.abs(new Date(p.check_in) - new Date(dates));
      if (diff < 60 * 86400000) score += 3;
    }
    if (p.to && t.country) {
      const iataMap = { LIS: 'Portugal', BRU: 'Bélgica', JFK: 'Estados Unidos', BKK: 'Tailândia' };
      if (iataMap[p.to] === t.country) score += 2;
    }
    if (p.name && t.country) {
      if (String(p.name).toLowerCase().includes(t.country.toLowerCase())) score += 1;
    }
    if (score > 0) candidates.push({ trip: t, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 5);
}

function mergeEventIntoTrip(trip, event) {
  const out = JSON.parse(JSON.stringify(trip));
  out.bookings ||= { flights: [], stays: [], experiences: [] };
  const p = { ...event.payload, source: 'gmail', email_id: event.message_id };
  if (event.event_type === 'flight') out.bookings.flights.push(p);
  else if (event.event_type === 'stay') out.bookings.stays.push(p);
  else if (event.event_type === 'experience') out.bookings.experiences.push(p);
  // Recalcula datas se possível (F2.5)
  const inferred = deriveDatesFromBookings(out.bookings);
  if (inferred) {
    out.dates = {
      ...(out.dates || {}),
      start: inferred.start,
      end: inferred.end,
      computed_from: 'flight',
    };
  }
  out.updated_at = new Date().toISOString();
  return out;
}

async function applyToTrip(event, trip) {
  if (!settings.isUnlocked()) {
    throw new Error('PAT não desbloqueado — abra o badge no canto inferior.');
  }
  const next = mergeEventIntoTrip(trip, event);
  await upsertTrip({
    token: settings.getToken(),
    trip: next,
    message: commitMessageFor(next, 'update'),
  });
  await backend.markInboxEvent(event.id, { status: 'applied', applied_trip_id: next.id });
}

async function dismissEvent(event) {
  await backend.markInboxEvent(event.id, { status: 'dismissed' });
}

// ── UI ──────────────────────────────────────────────────────────────────

async function loadAllTrips() {
  // Em modo sem-PAT, usa o trips.json público (read-only).
  if (settings.isUnlocked()) {
    const { content } = await getTripsFile({ token: settings.getToken() });
    return content.trips || [];
  }
  const res = await fetch('data/trips.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha lendo trips.json');
  const data = await res.json();
  return data.trips || [];
}

export async function openInbox() {
  ensureCss();
  if (!backend.isConfigured() || !backend.isAuthenticated()) {
    alert('Conecte o backend Supabase primeiro (badge "🛠 Backend & Gmail").');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'inbox-overlay';
  const modal = document.createElement('div');
  modal.className = 'inbox-modal';
  modal.innerHTML = `
    <div class="inbox-header">
      <strong>📥 Curador de E-mail — Sugestões pendentes</strong>
      <button id="inbox-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div class="inbox-body" id="inbox-body">
      <div class="inbox-empty">Carregando…</div>
    </div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#inbox-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const body = modal.querySelector('#inbox-body');
  let events = [];
  let allTrips = [];
  try {
    [events, allTrips] = await Promise.all([
      backend.listPendingInboxEvents(),
      loadAllTrips(),
    ]);
  } catch (e) {
    body.innerHTML = `<div class="inbox-empty">Erro: ${e.message}</div>`;
    return;
  }
  if (!events.length) {
    body.innerHTML = '<div class="inbox-empty">Nada pendente. Próxima execução do parser em até 6h.</div>';
    return;
  }
  renderList();

  function renderList() {
    body.innerHTML = '';
    events.forEach((ev) => {
      const candidates = findCandidateTrips(ev, allTrips);
      const card = document.createElement('div');
      card.className = 'inbox-card';
      const badge = `<span class="inbox-badge ${ev.event_type}">${ev.event_type}</span>`;
      card.innerHTML = `
        <div class="inbox-card-head">
          <div>${badge} <strong>${summarize(ev)}</strong></div>
          <span class="inbox-source">${ev.source} · ${new Date(ev.created_at).toLocaleString('pt-BR')}</span>
        </div>
        <div class="inbox-meta">${ev.raw_sender}</div>
        <pre class="inbox-payload">${JSON.stringify(ev.payload, null, 2)}</pre>
        <div class="inbox-actions">
          ${candidates.map((c, i) =>
            `<button data-apply="${i}" class="inbox-btn inbox-btn-primary">Aplicar em ${c.trip.name}</button>`
          ).join('')}
          <button data-create class="inbox-btn inbox-btn-secondary">+ Criar viagem nova</button>
          <button data-dismiss class="inbox-btn inbox-btn-danger">Descartar</button>
        </div>
      `;
      card.querySelectorAll('[data-apply]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.getAttribute('data-apply'));
          const target = candidates[idx].trip;
          btn.disabled = true;
          btn.textContent = 'Aplicando…';
          try {
            await applyToTrip(ev, target);
            events = events.filter((x) => x.id !== ev.id);
            renderList();
          } catch (e) {
            alert(`Falha: ${e.message}`);
            btn.disabled = false;
            btn.textContent = `Aplicar em ${target.name}`;
          }
        });
      });
      card.querySelector('[data-create]').addEventListener('click', () => {
        alert('Clique no badge "+ Nova viagem" e cole os campos do payload manualmente — versão futura cria direto.');
      });
      card.querySelector('[data-dismiss]').addEventListener('click', async () => {
        if (!confirm('Descartar este evento? Não vai mais aparecer.')) return;
        try {
          await dismissEvent(ev);
          events = events.filter((x) => x.id !== ev.id);
          renderList();
        } catch (e) { alert(e.message); }
      });
      body.appendChild(card);
    });
  }
}
