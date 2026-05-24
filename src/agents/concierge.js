// 🍽️ Concierge Local — PR #1B refactor (Claude API direto).
// Antes dependia do backend Supabase + Edge Function /functions/v1/concierge.
// Agora chama api.anthropic.com diretamente do browser, usando a chave
// gerenciada por src/core/anthropic-key.js (AES-256 em localStorage).
//
// O modal mostra itinerário recém-gerado e permite SALVAR em trip.notes.itinerary
// (via callback de save). Re-abrir o modal recupera o salvo, evitando regenerar.

import * as anthropicKey from '../core/anthropic-key.js';

export const meta = {
  id: 'concierge',
  name: 'Concierge Local',
  icon: '🍽️',
  description: 'Itinerário diário com base no estilo histórico do Eduardo.',
};

const ANTHROPIC_MODEL = 'claude-opus-4-7';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

let cssInjected = false;
const CSS = `
.cn-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.cn-modal { background: #fff; color: #0f172a; width: min(720px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35);
  font: 14px Inter, system-ui, sans-serif; }
.cn-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; gap: 12px; }
.cn-header strong { font-size: 15px; }
.cn-actions { display: flex; gap: 8px; }
.cn-btn { font: inherit; padding: 6px 12px; border-radius: 6px;
  border: 1px solid #cbd5e1; background: #fff; color: #0f172a;
  cursor: pointer; font-size: 13px; }
.cn-btn.cn-btn-primary { background: #0f172a; color: #fff; border-color: #0f172a; }
.cn-btn:disabled { opacity: 0.5; cursor: wait; }
.cn-body { padding: 16px 20px; }
.cn-day { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
  margin-bottom: 10px; }
.cn-day h4 { margin: 0 0 8px; color: #0f172a; font-size: 14px; }
.cn-slot { display: grid; grid-template-columns: 80px 1fr; gap: 8px;
  padding: 6px 0; border-top: 1px solid #f1f5f9; }
.cn-slot:first-of-type { border-top: 0; }
.cn-slot-label { font-size: 11px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.04em; padding-top: 2px; }
.cn-slot-text { font-size: 13px; line-height: 1.5; }
.cn-notes { background: #fef3c7; border: 1px solid #fde68a; padding: 6px 8px;
  border-radius: 4px; font-size: 12px; color: #92400e; margin-top: 6px; }
.cn-loading { padding: 40px 20px; text-align: center; color: #64748b; }
.cn-loading-spinner { display: inline-block; width: 20px; height: 20px;
  border: 2px solid #cbd5e1; border-top-color: #0f172a; border-radius: 50%;
  animation: cn-spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }
@keyframes cn-spin { to { transform: rotate(360deg); } }
.cn-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
  padding: 12px 14px; border-radius: 6px; margin: 12px 0; font-size: 13px; }
.cn-disclaimer { font-size: 11px; color: #94a3b8; padding: 0 20px 16px; }
.cn-cached-badge { display: inline-block; background: #dbeafe; color: #1e40af;
  font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600;
  vertical-align: middle; margin-left: 8px; }
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

function buildPrompt(trip, history) {
  const dates = trip.dates || {};
  const tripInfo = {
    name: trip.name || trip.id,
    country: trip.country || '?',
    city: trip.sub || '',
    start: dates.start || '?',
    end: dates.end || '?',
    nights: trip.nts || '?',
    profile: trip.notes?.general || trip.notes?.plan || '',
  };
  return `Você é um Concierge de viagens premium para um viajante brasileiro experiente. \
Gere um itinerário diário detalhado para a viagem abaixo, considerando estilo histórico.

VIAGEM ALVO:
- Nome: ${tripInfo.name}
- País/cidade: ${tripInfo.country}${tripInfo.city ? ' / ' + tripInfo.city : ''}
- Datas: ${tripInfo.start} a ${tripInfo.end} (${tripInfo.nights} noites)
- Notas do viajante: ${tripInfo.profile || '(sem notas)'}

HISTÓRICO DE VIAGENS DO USUÁRIO NA REGIÃO (para inspiração de estilo):
${history.length ? JSON.stringify(history, null, 2) : '(sem histórico na região)'}

INSTRUÇÕES:
- Gere itinerário dia-a-dia, com slots manhã/tarde/noite específicos
- Mencione restaurantes e hotéis CONCRETOS quando possível (não genéricos como "um bom restaurante")
- Onde o histórico do usuário tiver pistas (ex: "gostou de Cipriani em Veneza"), use isso para sugerir similares
- Para cada sugestão, justifique brevemente em "notes" (estilo: "do mesmo grupo do que você curtiu em X")
- Sem aviso de "consulte localmente" ou disclaimers — assuma viajante experiente
- Português brasileiro, tom amigável mas preciso

Retorne APENAS um objeto JSON válido (sem markdown wrapper, sem texto antes ou depois) com esta forma exata:
{
  "itinerary": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "morning": "texto",
      "afternoon": "texto",
      "evening": "texto",
      "notes": "justificativa breve"
    }
  ]
}`;
}

export async function fetchItinerary(trip, history, { signal } = {}) {
  if (!anthropicKey.isUnlocked()) {
    throw new Error('Chave Anthropic não está desbloqueada nesta sessão.');
  }
  const key = anthropicKey.getKey();
  const prompt = buildPrompt(trip, history);

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-no-training': 'true',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b) => b.type === 'text')?.text || '';
  // Extrai JSON da resposta (Claude pode envolver em markdown apesar do prompt)
  const cleaned = textBlock.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Resposta do Claude não é JSON válido. Conteúdo recebido: ' + textBlock.slice(0, 200));
  }
  if (!parsed.itinerary || !Array.isArray(parsed.itinerary)) {
    throw new Error('Resposta sem campo "itinerary" array.');
  }
  return parsed;
}

export async function openConciergeModal(trip, { onSave } = {}) {
  ensureCss();
  const overlay = document.createElement('div');
  overlay.className = 'cn-overlay';
  const modal = document.createElement('div');
  modal.className = 'cn-modal';

  // Recupera itinerário salvo se existir
  const savedItinerary = trip.notes?.itinerary || null;
  const hasSaved = Array.isArray(savedItinerary) && savedItinerary.length > 0;

  modal.innerHTML = `
    <div class="cn-header">
      <strong>🍽️ Concierge — ${escapeHtml(trip.name || trip.id)} ${hasSaved ? '<span class="cn-cached-badge">salvo</span>' : ''}</strong>
      <div class="cn-actions">
        ${hasSaved ? '<button id="cn-regen" class="cn-btn" type="button">Regerar</button>' : ''}
        <button id="cn-close" type="button" class="cn-btn" style="border:0;font-size:22px;line-height:1;padding:4px 10px;">×</button>
      </div>
    </div>
    <div id="cn-body" class="cn-body">
      ${hasSaved ? '' : '<div class="cn-loading"><span class="cn-loading-spinner"></span>Consultando histórico e gerando itinerário…</div>'}
    </div>
    <div class="cn-disclaimer">
      Sugestões via Claude Opus 4.7 (anthropic-no-training: true).
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let abortCtrl = null;
  const close = () => {
    if (abortCtrl) abortCtrl.abort();
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#cn-close').addEventListener('click', close);

  const body = modal.querySelector('#cn-body');

  const renderItinerary = (itinerary, opts = {}) => {
    body.innerHTML = '';
    itinerary.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'cn-day';
      card.innerHTML = `
        <h4>Dia ${d.day} — ${escapeHtml(d.date || '')}</h4>
        ${slot('Manhã', d.morning)}
        ${slot('Tarde', d.afternoon)}
        ${slot('Noite', d.evening)}
        ${d.notes ? `<div class="cn-notes">${escapeHtml(d.notes)}</div>` : ''}
      `;
      body.appendChild(card);
    });
    if (opts.canSave) {
      const saveBar = document.createElement('div');
      saveBar.style.cssText = 'display:flex;justify-content:flex-end;padding:8px 0;gap:8px;';
      saveBar.innerHTML = `
        <button id="cn-save" class="cn-btn cn-btn-primary" type="button">💾 Salvar à viagem</button>
      `;
      body.appendChild(saveBar);
      modal.querySelector('#cn-save').addEventListener('click', async () => {
        const btn = modal.querySelector('#cn-save');
        btn.disabled = true;
        btn.textContent = 'Salvando…';
        try {
          if (typeof onSave === 'function') {
            const updatedTrip = { ...trip, notes: { ...(trip.notes || {}), itinerary } };
            await onSave(updatedTrip);
            btn.textContent = '✓ Salvo';
            setTimeout(close, 800);
          } else {
            btn.textContent = '✓ (sem callback)';
          }
        } catch (e) {
          btn.disabled = false;
          btn.textContent = '💾 Salvar à viagem';
          const errBox = document.createElement('div');
          errBox.className = 'cn-error';
          errBox.textContent = 'Erro ao salvar: ' + e.message;
          body.insertBefore(errBox, saveBar);
        }
      });
    }
  };

  const generate = async () => {
    body.innerHTML = '<div class="cn-loading"><span class="cn-loading-spinner"></span>Gerando itinerário com Claude Opus…</div>';
    abortCtrl = new AbortController();
    try {
      const tripsRes = await fetch('data/trips.json', { cache: 'no-cache' });
      const allTrips = (await tripsRes.json()).trips || [];
      const history = collectHistory(trip, allTrips);
      const { itinerary } = await fetchItinerary(trip, history, { signal: abortCtrl.signal });
      if (!itinerary.length) {
        body.innerHTML = '<div class="cn-error">Nenhum itinerário retornado. Tente novamente.</div>';
        return;
      }
      renderItinerary(itinerary, { canSave: true });
    } catch (e) {
      if (e.name === 'AbortError') return; // user fechou
      body.innerHTML = `<div class="cn-error">${escapeHtml(e.message)}</div>`;
    } finally {
      abortCtrl = null;
    }
  };

  if (hasSaved) {
    renderItinerary(savedItinerary, { canSave: false });
    const regenBtn = modal.querySelector('#cn-regen');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        if (!confirm('Regerar irá fazer uma nova chamada à API Anthropic (custo ~$0.30). Confirma?')) return;
        generate();
      });
    }
  } else {
    generate();
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

export async function run({ trip, onSave } = {}) {
  if (!trip) throw new Error('concierge.run: trip obrigatório');
  return openConciergeModal(trip, { onSave });
}
