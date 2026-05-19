// 💸 Otimizador de Bolso — F3.4.
// Consulta price_watches no Supabase e mostra histórico de alertas.
// O monitoramento e a inserção dos snapshots acontecem no backend
// (Edge Function price-monitor, cron diário). Aqui só leitura + UI.

import * as backend from '../core/backend.js';

export const meta = {
  id: 'price-hunter',
  name: 'Otimizador de Bolso',
  icon: '💸',
  description: 'Monitora preços de voos planejados e alerta em quedas relevantes.',
};

function authHeaders() {
  const cfg = backend.getConfig();
  const s = backend.getSession();
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${s?.access_token || cfg.anonKey}`,
  };
}

export async function listAlerts({ limit = 50 } = {}) {
  if (!backend.isConfigured()) {
    throw new Error('Conecte o backend Supabase primeiro.');
  }
  const cfg = backend.getConfig();
  const url = `${cfg.url}/rest/v1/price_watches?alert=eq.true&select=*&order=checked_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha listando alerts: ${await res.text()}`);
  return res.json();
}

export async function listHistoryFor({ trip_id, limit = 30 } = {}) {
  const cfg = backend.getConfig();
  const url = `${cfg.url}/rest/v1/price_watches?trip_id=eq.${encodeURIComponent(trip_id)}&select=*&order=checked_at.desc&limit=${limit}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Falha listando histórico: ${await res.text()}`);
  return res.json();
}

let cssInjected = false;
const CSS = `
.ph-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
  font: 14px Inter, system-ui, sans-serif; color: #0f172a; }
.ph-empty { color: #64748b; font-size: 13px; }
.ph-alert { background: #fef3c7; border: 1px solid #fde68a; padding: 10px;
  border-radius: 6px; margin-bottom: 8px; }
.ph-alert strong { color: #92400e; }
.ph-route { font-family: ui-monospace, monospace; font-size: 12px; }
.ph-prices { font-variant-numeric: tabular-nums; }
.ph-down { color: #15803d; font-weight: 700; }
`;
function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'ph-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

function fmtCurrency(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(n);
}

export async function openPriceHunterModal() {
  ensureCss();
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:20px;border-radius:12px;
    width:min(620px,100%);max-height:90vh;overflow:auto;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);
    font:14px Inter,system-ui,sans-serif;`;
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong>💸 Otimizador de Bolso</strong>
      <button id="ph-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div id="ph-body">Carregando alertas…</div>
    <p style="margin-top:12px;font-size:11px;color:#94a3b8;">
      Monitoramento via Edge Function <code>price-monitor</code> (cron diário) +
      API Kiwi Tequila. Alerta dispara quando preço cai &gt; 10% ou data
      alternativa (±2 dias) tem desconto &gt; 15%. Push notifications: Fase 4.
    </p>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#ph-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const body = modal.querySelector('#ph-body');
  try {
    const alerts = await listAlerts();
    if (!alerts.length) {
      body.innerHTML = '<div class="ph-empty">Sem alertas no momento. O cron diário grava aqui quando detecta quedas relevantes.</div>';
      return;
    }
    body.innerHTML = '';
    alerts.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'ph-alert';
      card.innerHTML = `
        <div class="ph-route">${a.route} · viagem <strong>${a.trip_id}</strong></div>
        <div class="ph-prices">
          Atual: <strong>${fmtCurrency(a.current_price_brl)}</strong> ·
          Menor visto: <span class="ph-down">${fmtCurrency(a.lowest_price_brl)}</span>
        </div>
        <div style="margin-top:4px;font-size:13px;">${a.alert_reason || ''}</div>
        <div style="margin-top:2px;font-size:11px;color:#92400e;">${new Date(a.checked_at).toLocaleString('pt-BR')}</div>
      `;
      body.appendChild(card);
    });
  } catch (e) {
    body.innerHTML = `<div class="ph-empty">Erro: ${e.message}</div>`;
  }
}

export async function run({ trip } = {}) {
  // Interface alinhada com customs.js: retorna { items, counts, overall }
  if (!backend.isConfigured() || !backend.isAuthenticated()) {
    return {
      items: [
        {
          id: 'price-monitor',
          label: 'Monitoramento de preço',
          status: 'yellow',
          message: 'Conecte o backend Supabase para ativar o monitor diário.',
        },
      ],
      counts: { green: 0, yellow: 1, red: 0 },
      overall: 'yellow',
    };
  }
  const watches = trip
    ? await listHistoryFor({ trip_id: trip.id })
    : await listAlerts();
  if (!watches.length) {
    return {
      items: [
        {
          id: 'price-monitor',
          label: 'Monitoramento de preço',
          status: 'green',
          message: 'Sem alertas. Cron diário continua observando os voos planejados.',
        },
      ],
      counts: { green: 1, yellow: 0, red: 0 },
      overall: 'green',
    };
  }
  const items = watches.slice(0, 5).map((w) => ({
    id: w.id,
    label: w.route,
    status: w.alert ? 'red' : 'green',
    message: w.alert
      ? `${w.alert_reason || 'queda detectada'} — atual ${fmtCurrency(w.current_price_brl)}.`
      : `Preço estável — atual ${fmtCurrency(w.current_price_brl)}, menor visto ${fmtCurrency(w.lowest_price_brl)}.`,
  }));
  const counts = items.reduce(
    (a, it) => ({ ...a, [it.status]: (a[it.status] || 0) + 1 }),
    { green: 0, yellow: 0, red: 0 }
  );
  return { items, counts, overall: counts.red ? 'red' : 'green' };
}
