// Badge de prontidão nos cards — Sprint Radar · Etapa B (UI aditiva, só leitura).
//
// Para cada card de viagem FUTURA renderizado em #grid, injeta um selo com o
// score de prontidão (computeReadiness) e, no hover/focus, a lista do que falta.
// NÃO altera nenhum dado nem o markup dos cards existentes: observa #grid via
// MutationObserver e acrescenta um elemento próprio (.rdy-*) ao hero do card.
//
// Cores na identidade "Vida & Carreira" (tokens --vc-*): verde (completo),
// âmbar (parcial), vermelho (baixo E perto da data).

import { computeReadiness } from '../core/readiness.js';
import { loadEventos } from '../core/eventos-data.js';

// Limiar de urgência: score baixo só vira vermelho perto da viagem.
const URGENTE_DIAS = 30;
const SCORE_BAIXO = 0.5;

const tripsById = new Map();
const readinessCache = new Map(); // id -> Promise<readiness>
let tripsLoaded = null;

function loadTrips() {
  if (tripsLoaded) return tripsLoaded;
  tripsLoaded = fetch('data/trips.json', { cache: 'no-cache' })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((data) => {
      const trips = (data && Array.isArray(data.trips)) ? data.trips : [];
      for (const t of trips) if (t && t.id) tripsById.set(t.id, t);
      return tripsById;
    })
    .catch(() => tripsById);
  return tripsLoaded;
}

function readinessFor(trip) {
  if (readinessCache.has(trip.id)) return readinessCache.get(trip.id);
  const p = computeReadiness(trip, { eventosLoader: loadEventos });
  readinessCache.set(trip.id, p);
  return p;
}

function nivel(r) {
  if (r.score >= 1) return 'ok';
  if (r.score <= SCORE_BAIXO && r.daysUntil != null && r.daysUntil <= URGENTE_DIAS) return 'urgente';
  return 'parcial';
}

const NIVEL_LABEL = { ok: 'Tudo pronto', parcial: 'Faltam itens', urgente: 'Atenção: perto da data' };

function buildBadge(r) {
  const lvl = nivel(r);
  const pct = Math.round(r.score * 100);
  const wrap = document.createElement('div');
  wrap.className = `rdy rdy--${lvl}`;
  wrap.dataset.rdy = r.id;
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'status');
  wrap.setAttribute(
    'aria-label',
    `Prontidão ${pct}%. ${NIVEL_LABEL[lvl]}.` +
      (r.faltando.length ? ` Falta: ${r.faltando.map((f) => f.label).join(', ')}.` : '')
  );

  const dot = '<span class="rdy-dot" aria-hidden="true"></span>';
  wrap.innerHTML =
    `<span class="rdy-pill">${dot}<span class="rdy-pct">${pct}%</span></span>` + buildPop(r, lvl);
  return wrap;
}

function buildPop(r, lvl) {
  const head = `<div class="rdy-pop-head">${NIVEL_LABEL[lvl]} · ${Math.round(r.score * 100)}%</div>`;
  let body;
  if (r.faltando.length === 0) {
    body = `<div class="rdy-pop-ok">✓ Voo, hospedagem, eventos e roteiro no lugar</div>`;
  } else {
    const itens = r.faltando.map((f) => `<li>${f.label}</li>`).join('');
    body = `<div class="rdy-pop-falta">Falta resolver:</div><ul class="rdy-pop-list">${itens}</ul>`;
  }
  return `<div class="rdy-pop" role="tooltip">${head}${body}</div>`;
}

async function enhanceCard(card) {
  if (!card || card.querySelector(':scope > .card-body [data-rdy]')) return;
  const id = card.dataset.tripId;
  if (!id) return;
  await loadTrips();
  const trip = tripsById.get(id);
  if (!trip) return;

  const r = await readinessFor(trip);
  if (!r.future) return; // badge só em viagens futuras

  const hero = card.querySelector('[data-hero]');
  if (!hero || hero.querySelector('[data-rdy]')) return;
  hero.appendChild(buildBadge(r));
}

function scanGrid(grid) {
  grid.querySelectorAll('.card[data-trip-id]').forEach((c) => {
    enhanceCard(c).catch(() => {});
  });
}

let started = false;
export function initReadinessBadges() {
  if (started) return;
  const grid = document.getElementById('grid');
  if (!grid) return;
  started = true;
  ensureCss();

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.matches && node.matches('.card[data-trip-id]')) {
          enhanceCard(node).catch(() => {});
        } else if (node.querySelectorAll) {
          node.querySelectorAll('.card[data-trip-id]').forEach((c) => enhanceCard(c).catch(() => {}));
        }
      }
    }
  });
  obs.observe(grid, { childList: true, subtree: true });
  scanGrid(grid); // cards já presentes
}

// ── CSS (tokens --vc-*) — selo claro, alegre, sem quebrar o card ──────────
const CSS = `
.rdy{position:absolute;bottom:10px;right:12px;z-index:4;font:inherit;cursor:default}
.rdy-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:999px;
  font-weight:700;font-size:12px;line-height:1;letter-spacing:.01em;color:#fff;
  background:var(--rdy-c);box-shadow:0 4px 12px -4px var(--rdy-sh),0 0 0 2px rgba(255,255,255,.55) inset;
  backdrop-filter:saturate(1.1)}
.rdy-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.95);
  box-shadow:0 0 0 2px rgba(255,255,255,.35)}
.rdy-pct{font-variant-numeric:tabular-nums}
.rdy--ok{--rdy-c:var(--vc-material);--rdy-sh:rgba(63,179,137,.55)}
.rdy--parcial{--rdy-c:var(--vc-trabalho);--rdy-sh:rgba(224,163,60,.55)}
.rdy--urgente{--rdy-c:var(--vc-saude);--rdy-sh:rgba(226,75,74,.6)}
.rdy--urgente .rdy-pill{animation:rdyPulse 2.2s ease-in-out infinite}
@keyframes rdyPulse{0%,100%{box-shadow:0 4px 12px -4px var(--rdy-sh),0 0 0 2px rgba(255,255,255,.55) inset}
  50%{box-shadow:0 6px 18px -3px var(--rdy-sh),0 0 0 3px rgba(255,255,255,.7) inset}}
.rdy-pop{position:absolute;bottom:calc(100% + 8px);top:auto;right:0;left:auto;min-width:178px;max-width:240px;
  background:var(--vc-paper);color:var(--vc-ink);border:1px solid var(--vc-paper-3);
  border-radius:12px;padding:11px 13px;box-shadow:0 18px 34px -16px rgba(43,38,32,.55);
  opacity:0;transform:translateY(-4px);pointer-events:none;transition:opacity .16s,transform .16s;z-index:6}
.rdy:hover .rdy-pop,.rdy:focus-visible .rdy-pop,.rdy:focus .rdy-pop{opacity:1;transform:none}
.rdy-pop-head{font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--vc-ink)}
.rdy-pop-falta{font-size:11.5px;color:var(--vc-ink-soft);margin-bottom:3px}
.rdy-pop-ok{font-size:12px;color:var(--vc-material);font-weight:600}
.rdy-pop-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px}
.rdy-pop-list li{font-size:12.5px;font-weight:600;color:var(--vc-ink);display:flex;align-items:center;gap:7px}
.rdy-pop-list li::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--vc-trabalho);flex:none}
@media (prefers-reduced-motion:reduce){.rdy--urgente .rdy-pill{animation:none}}
/* Mobile estreito: encolhe o pill e RESERVA seu canto no bloco nome/sub, pra o
   texto truncar (…) antes de tocar o pill — em vez de escondê-lo. Aditivo, só
   nesta media query; o markup do card não muda. */
@media (max-width:420px){
  .rdy{bottom:9px;right:10px}
  .rdy-pill{padding:3px 8px;font-size:11px;gap:5px}
  .rdy-dot{width:6px;height:6px}
  .card-hero-info{padding-right:70px}
  .card-hero-name,.card-hero-sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('rdy-badge-css')) return;
  const s = document.createElement('style');
  s.id = 'rdy-badge-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}
