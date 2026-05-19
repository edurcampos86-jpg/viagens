// Heatmap anual de viagens — F3.1.
// Estilo GitHub contributions: cada dia do ano é um quadrado. Cores:
//   • cinza  : em casa
//   • verde claro : viagem nacional (Brasil)
//   • verde escuro: viagem internacional
//
// Lê os trips em ambos os schemas (v1 e v2) via schema.getDates.
//
// API pública:
//   import { renderHeatmap } from '../components/heatmap.js';
//   renderHeatmap(container, { trips, year });

import { getDates } from '../core/schema.js';

let cssInjected = false;
const CSS = `
.hm-box { font: 14px Inter, system-ui, sans-serif; color: #0f172a; }
.hm-controls { display: flex; gap: 12px; align-items: center; margin-bottom: 8px;
  flex-wrap: wrap; }
.hm-year-select { padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 6px;
  font: inherit; }
.hm-stats { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px;
  color: #475569; }
.hm-stats strong { color: #0f172a; }
.hm-grid { display: inline-grid; grid-template-columns: 20px repeat(53, 12px);
  grid-template-rows: 14px repeat(7, 12px); gap: 2px; padding: 8px;
  background: #f8fafc; border-radius: 6px; }
.hm-day { width: 12px; height: 12px; border-radius: 2px; background: #e2e8f0;
  cursor: pointer; }
.hm-day.domestic { background: #86efac; }
.hm-day.international { background: #15803d; }
.hm-day.empty { background: transparent; }
.hm-day:hover { outline: 2px solid #0f172a; outline-offset: 1px; }
.hm-month-label { font-size: 10px; color: #64748b; text-align: left;
  grid-row: 1; }
.hm-weekday-label { font-size: 10px; color: #64748b; padding-right: 4px;
  display: flex; align-items: center; }
.hm-legend { display: flex; gap: 12px; font-size: 12px; color: #475569;
  margin-top: 8px; align-items: center; }
.hm-legend-cell { display: inline-block; width: 10px; height: 10px;
  border-radius: 2px; vertical-align: middle; margin-right: 4px; }
.hm-tooltip { position: fixed; background: #0f172a; color: #fff;
  padding: 6px 8px; border-radius: 4px; font-size: 12px; pointer-events: none;
  z-index: 10000; white-space: nowrap; opacity: 0; transition: opacity .1s; }
.hm-tooltip.show { opacity: 1; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'hm-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseDay(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isInternational(trip) {
  const cc = (trip.country_code || '').toUpperCase();
  const name = (trip.country || '').toLowerCase();
  if (cc) return cc !== 'BR';
  return name && name !== 'brasil';
}

function* eachDay(start, end) {
  const a = new Date(start.getTime());
  while (a <= end) {
    yield new Date(a.getTime());
    a.setUTCDate(a.getUTCDate() + 1);
  }
}

function fmtDay(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// ── Computação dos dias por viagem ──────────────────────────────────────

export function computeYearData(trips, year) {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  // Map: 'YYYY-MM-DD' -> { trip, level }
  const days = new Map();
  const countries = new Set();
  let kmFlown = 0;
  let daysAbroad = 0;
  let daysDomestic = 0;

  for (const trip of trips || []) {
    const dates = getDates(trip);
    const start = parseDay(dates.start);
    if (!start) continue;
    let end = parseDay(dates.end);
    if (!end) {
      // sem fim explícito: usa nts ou 1 dia
      end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + (dates.nts || 0));
    }
    // intersecta com o ano filtrado
    const effectiveStart = start < yearStart ? yearStart : start;
    const effectiveEnd = end > yearEnd ? yearEnd : end;
    if (effectiveStart > effectiveEnd) continue;

    const level = isInternational(trip) ? 'international' : 'domestic';
    if (trip.country) countries.add(trip.country);
    if (typeof trip.km === 'number') kmFlown += trip.km;

    for (const d of eachDay(effectiveStart, effectiveEnd)) {
      const key = fmtDay(d);
      // se já tem outra viagem no mesmo dia, prioriza a internacional
      const existing = days.get(key);
      if (!existing || (existing.level === 'domestic' && level === 'international')) {
        days.set(key, { trip, level });
      }
      if (level === 'international') daysAbroad++;
      else daysDomestic++;
    }
  }

  return {
    days,
    stats: {
      daysAbroad,
      daysDomestic,
      daysTotal: daysAbroad + daysDomestic,
      countries: [...countries].sort(),
      kmFlown,
    },
  };
}

// ── Render ──────────────────────────────────────────────────────────────

export function renderHeatmap(container, { trips, year, onYearChange } = {}) {
  ensureCss();
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'hm-box';

  // Determina anos disponíveis
  const yearsAvailable = new Set();
  for (const t of trips || []) {
    const d = getDates(t);
    const s = parseDay(d.start);
    const e = parseDay(d.end) || s;
    if (!s) continue;
    for (let y = s.getUTCFullYear(); y <= (e || s).getUTCFullYear(); y++) {
      yearsAvailable.add(y);
    }
  }
  const yearList = [...yearsAvailable].sort();
  const activeYear = year || yearList[yearList.length - 1] || new Date().getUTCFullYear();

  // Controles
  const controls = document.createElement('div');
  controls.className = 'hm-controls';
  const sel = document.createElement('select');
  sel.className = 'hm-year-select';
  yearList.forEach((y) => {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (y === activeYear) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => {
    const next = Number(sel.value);
    renderHeatmap(container, { trips, year: next, onYearChange });
    onYearChange?.(next);
  });
  controls.appendChild(sel);

  const { days, stats } = computeYearData(trips, activeYear);
  const statsBox = document.createElement('div');
  statsBox.className = 'hm-stats';
  statsBox.innerHTML = `
    <span>Dias fora: <strong>${stats.daysAbroad + stats.daysDomestic}</strong>
      (<strong>${stats.daysAbroad}</strong> int + <strong>${stats.daysDomestic}</strong> nac)</span>
    <span>Países: <strong>${stats.countries.length}</strong></span>
    <span>Km voados (acumulado da viagem): <strong>${stats.kmFlown.toLocaleString('pt-BR')}</strong></span>
  `;
  controls.appendChild(statsBox);
  wrap.appendChild(controls);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'hm-grid';
  // Cabeçalho de meses (12 colunas, distribuídas pelas 53 semanas)
  for (let m = 0; m < 12; m++) {
    const date = new Date(Date.UTC(activeYear, m, 1));
    const dayOfYear = Math.floor((date - new Date(Date.UTC(activeYear, 0, 1))) / 86400000);
    const weekIdx = Math.floor((dayOfYear + new Date(Date.UTC(activeYear, 0, 1)).getUTCDay()) / 7);
    const label = document.createElement('div');
    label.className = 'hm-month-label';
    label.textContent = date.toLocaleDateString('pt-BR', { month: 'short' });
    label.style.gridColumn = `${weekIdx + 2} / span 4`;
    grid.appendChild(label);
  }
  // Labels de dias da semana
  ['', 'S', '', 'Q', '', 'S', ''].forEach((d, i) => {
    if (!d) return;
    const lbl = document.createElement('div');
    lbl.className = 'hm-weekday-label';
    lbl.textContent = d;
    lbl.style.gridRow = `${i + 2}`;
    lbl.style.gridColumn = '1';
    grid.appendChild(lbl);
  });

  // Tooltip global
  let tip = document.querySelector('.hm-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hm-tooltip';
    document.body.appendChild(tip);
  }

  // Cada dia do ano
  const yearStart = new Date(Date.UTC(activeYear, 0, 1));
  const yearEnd = new Date(Date.UTC(activeYear, 11, 31));
  for (const d of eachDay(yearStart, yearEnd)) {
    const key = fmtDay(d);
    const data = days.get(key);
    const cell = document.createElement('div');
    cell.className = `hm-day ${data ? data.level : ''}`;
    const weekIdx =
      Math.floor((d - yearStart) / 86400000 + yearStart.getUTCDay()) / 7;
    cell.style.gridColumn = `${Math.floor(weekIdx) + 2}`;
    cell.style.gridRow = `${d.getUTCDay() + 2}`;
    if (data) {
      cell.addEventListener('mouseenter', (e) => {
        tip.textContent = `${key} · ${data.trip.name} (${data.trip.country || data.level})`;
        tip.style.left = `${e.clientX + 10}px`;
        tip.style.top = `${e.clientY + 10}px`;
        tip.classList.add('show');
      });
    } else {
      cell.addEventListener('mouseenter', (e) => {
        tip.textContent = `${key} · em casa`;
        tip.style.left = `${e.clientX + 10}px`;
        tip.style.top = `${e.clientY + 10}px`;
        tip.classList.add('show');
      });
    }
    cell.addEventListener('mousemove', (e) => {
      tip.style.left = `${e.clientX + 10}px`;
      tip.style.top = `${e.clientY + 10}px`;
    });
    cell.addEventListener('mouseleave', () => tip.classList.remove('show'));
    grid.appendChild(cell);
  }

  wrap.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'hm-legend';
  legend.innerHTML = `
    <span><span class="hm-legend-cell" style="background:#e2e8f0;"></span>em casa</span>
    <span><span class="hm-legend-cell" style="background:#86efac;"></span>nacional</span>
    <span><span class="hm-legend-cell" style="background:#15803d;"></span>internacional</span>
  `;
  wrap.appendChild(legend);

  container.appendChild(wrap);
  return { stats, days };
}
