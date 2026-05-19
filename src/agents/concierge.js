// 🍽️ Concierge Local — F4.2.
// Frontend: monta payload com histórico relevante e chama backend
// /functions/v1/concierge. Renderiza itinerário em modal.

import * as backend from '../core/backend.js';

export const meta = {
  id: 'concierge',
  name: 'Concierge Local',
  icon: '🍽️',
  description: 'Itinerário diário com base no estilo histórico do Eduardo.',
};

let cssInjected = false;
const CSS = `
.cn-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.cn-modal { background: #fff; color: #0f172a; width: min(680px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35);
  font: 14px Inter, system-ui, sans-serif; }
.cn-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
.cn-body { padding: 16px 20px; }
.cn-day { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
  margin-bottom: 10px; }
.cn-day h4 { margin: 0 0 8px; color: #0f172a; }
.cn-slot { display: grid; grid-template-columns: 80px 1fr; gap: 8px;
  padding: 4px 0; border-top: 1px solid #f1f5f9; }
.cn-slot:first-of-type { border-top: 0; }
.cn-slot-label { font-size: 11px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.04em; padding-top: 2px; }
.cn-slot-text { font-size: 13px; line-height: 1.4; }
.cn-notes { background: #fef3c7; border: 1px solid #fde68a; padding: 6px 8px;
  border-radius: 4px; font-size: 12px; color: #92400e; margin-top: 6px; }
.cn-loading { padding: 40px 20px; text-align: center; color: #64748b; }
.cn-disclaimer { font-size: 11px; color: #94a3b8; padding: 0 20px 16px; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'cn-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

// Coleta histórico relevante das trips passadas (mesmo continente ou país)
export function collectHistory(targetTrip, allTrips) {
  if (!Array.isArray(allTrips)) return [];
  const seen = new Set();
  const out = [];
  for (const t of allTrips) {
    if (t.id === targetTrip.id) continue;
    if (t.status !== 'done') continue;
    const sameRegion =
      (targetTrip.country && t.country === targetTrip.country) ||
      (targetTrip.continent && t.continent === targetTrip.continent);
    if (!sameRegion) continue;
    const key = t.country;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      country: t.country,
      hotels: t.logistics?.hotels || [],
      restaurants: t.logistics?.restaurants || [],
      tips: t.logistics?.tips || '',
    });
    if (out.length >= 6) break;
  }
  return out;
}

export async function fetchItinerary(trip, history) {
  if (!backend.isConfigured() || !backend.isAuthenticated()) {
    throw new Error('Conecte e autentique-se no backend Supabase primeiro.');
  }
  const cfg = backend.getConfig();
  const session = backend.getSession();
  const payload = {
    trip: {
      country: trip.country,
      city: trip.sub || '',
      dates: { start: trip.dates?.start, end: trip.dates?.end },
    },
    history,
  };
  const res = await fetch(`${cfg.url}/functions/v1/concierge`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Concierge: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function openConciergeModal(trip) {
  ensureCss();
  const overlay = document.createElement('div');
  overlay.className = 'cn-overlay';
  const modal = document.createElement('div');
  modal.className = 'cn-modal';
  modal.innerHTML = `
    <div class="cn-header">
      <strong>🍽️ Concierge Local — ${trip.name || trip.id}</strong>
      <button id="cn-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div id="cn-body" class="cn-body">
      <div class="cn-loading">Consultando histórico e gerando itinerário…</div>
    </div>
    <div class="cn-disclaimer">
      Sugestões via Claude Sonnet (anthropic-no-training: true). Edite o itinerário
      manualmente — o Concierge propõe, você confirma.
    </div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#cn-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const body = modal.querySelector('#cn-body');

  try {
    // Carrega trips para o histórico
    const tripsRes = await fetch('data/trips.json', { cache: 'no-cache' });
    const allTrips = (await tripsRes.json()).trips || [];
    const history = collectHistory(trip, allTrips);
    const { itinerary } = await fetchItinerary(trip, history);
    if (!Array.isArray(itinerary) || !itinerary.length) {
      body.innerHTML = '<p>Sem itinerário gerado. Tente novamente.</p>';
      return;
    }
    body.innerHTML = '';
    itinerary.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'cn-day';
      card.innerHTML = `
        <h4>Dia ${d.day} — ${d.date || ''}</h4>
        ${slot('Manhã', d.morning)}
        ${slot('Tarde', d.afternoon)}
        ${slot('Noite', d.evening)}
        ${d.notes ? `<div class="cn-notes">${escapeHtml(d.notes)}</div>` : ''}
      `;
      body.appendChild(card);
    });
  } catch (e) {
    body.innerHTML = `<p style="color:#b91c1c;">Erro: ${e.message}</p>`;
  }
}

function slot(label, text) {
  if (!text) return '';
  return `
    <div class="cn-slot">
      <div class="cn-slot-label">${label}</div>
      <div class="cn-slot-text">${escapeHtml(text)}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export async function run({ trip } = {}) {
  if (!trip) throw new Error('concierge.run: trip obrigatório');
  return openConciergeModal(trip);
}
