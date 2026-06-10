// Orçamento vivo — F2.6.
//
// computeActualFromBookings(bookings) → { flights, stays, experiences,
//   food, other, total } (food/other ficam só com input manual).
//
// renderBudget(container, trip, { onChange }) → UI com:
//   - barras planejado vs realizado por categoria, cor por % gasto
//   - gráfico de pizza simples por categoria (SVG inline)
//   - inputs para budget.planned.* (editáveis)

let cssInjected = false;
const CSS = `
.bg-box { font: 14px Inter, system-ui, sans-serif; color: #0f172a;
  display: grid; gap: 12px; }
.bg-row { display: grid; grid-template-columns: 110px 1fr 100px; align-items: center;
  gap: 8px; }
.bg-label { font-weight: 600; font-size: 13px; }
.bg-bar { position: relative; height: 16px; background: #f1f5f9;
  border-radius: 999px; overflow: hidden; }
.bg-bar-fill { height: 100%; transition: width .2s ease; }
.bg-bar-fill.green { background: #22c55e; }
.bg-bar-fill.yellow { background: #eab308; }
.bg-bar-fill.red { background: #ef4444; }
.bg-bar-fill.gray { background: #94a3b8; }
.bg-amt { text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; }
.bg-planned-input { padding: 4px 6px; border: 1px solid #cbd5e1; border-radius: 6px;
  font: inherit; width: 90px; text-align: right; }
.bg-total { font-weight: 700; padding-top: 8px; border-top: 1px solid #e2e8f0;
  margin-top: 4px; }
.bg-pie-wrap { display: flex; align-items: center; gap: 16px; }
.bg-legend { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px;
  font-size: 12px; align-items: center; }
.bg-legend-dot { width: 10px; height: 10px; border-radius: 50%; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'bg-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

const CATEGORIES = [
  { key: 'flights', label: 'Voos', color: '#3b82f6' },
  { key: 'stays', label: 'Hospedagem', color: '#10b981' },
  { key: 'experiences', label: 'Experiências', color: '#a855f7' },
  { key: 'food', label: 'Alimentação', color: '#f59e0b' },
  { key: 'other', label: 'Outros', color: '#6b7280' },
];

function fmt(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(n);
}

// ── Cálculo ─────────────────────────────────────────────────────────────

export function computeActualFromBookings(bookings) {
  // Fase 3 (schema, bookings[*].valor): `valor` em BRL (moeda ausente =
  // BRL) tem precedência sobre `price_brl`. `valor` em outra moeda NÃO
  // entra na soma (que é BRL) — cai para price_brl quando houver.
  const amount = (x) => {
    if (typeof x?.valor === 'number' && (x.moeda || 'BRL') === 'BRL') return x.valor;
    return typeof x?.price_brl === 'number' ? x.price_brl : 0;
  };
  const sum = (arr) => (arr || []).reduce((acc, x) => acc + amount(x), 0);
  return {
    flights: sum(bookings?.flights),
    stays: sum(bookings?.stays),
    experiences: sum(bookings?.experiences),
  };
}

export function mergeActual(trip) {
  const computed = computeActualFromBookings(trip?.bookings);
  const existing = trip?.budget?.actual || {};
  // food/other vêm do input manual; outros do cálculo.
  return {
    flights: computed.flights || 0,
    stays: computed.stays || 0,
    experiences: computed.experiences || 0,
    food: existing.food || 0,
    other: existing.other || 0,
  };
}

function levelFor(actual, planned) {
  if (!planned) return 'gray';
  const ratio = actual / planned;
  if (ratio > 1) return 'red';
  if (ratio > 0.8) return 'yellow';
  return 'green';
}

// ── Render ──────────────────────────────────────────────────────────────

export function renderBudget(container, trip, { onChange } = {}) {
  ensureCss();
  container.innerHTML = '';
  const planned = { ...(trip.budget?.planned || {}) };
  const actual = mergeActual(trip);

  const box = document.createElement('div');
  box.className = 'bg-box';

  const rows = document.createElement('div');
  rows.className = 'bg-box';

  let totalPlanned = 0;
  let totalActual = 0;

  CATEGORIES.forEach(({ key, label }) => {
    const p = Number(planned[key] || 0);
    const a = Number(actual[key] || 0);
    totalPlanned += p;
    totalActual += a;

    const row = document.createElement('div');
    row.className = 'bg-row';

    const lbl = document.createElement('span');
    lbl.className = 'bg-label';
    lbl.textContent = label;

    const bar = document.createElement('div');
    bar.className = 'bg-bar';
    const fill = document.createElement('div');
    const pct = p ? Math.min(100, (a / p) * 100) : 0;
    fill.className = `bg-bar-fill ${levelFor(a, p)}`;
    fill.style.width = `${pct}%`;
    fill.title = p ? `${pct.toFixed(0)}% do planejado` : 'sem planejamento';
    bar.appendChild(fill);

    const amt = document.createElement('div');
    amt.innerHTML = `
      <div class="bg-amt">${fmt(a)}</div>
      <input type="number" min="0" step="50" class="bg-planned-input"
        value="${p || ''}" placeholder="planejado" />
    `;
    amt.querySelector('input').addEventListener('change', (e) => {
      const v = Number(e.target.value);
      planned[key] = isFinite(v) ? v : 0;
      onChange?.({ planned, actual });
      renderBudget(container, { ...trip, budget: { ...trip.budget, planned } }, { onChange });
    });

    row.append(lbl, bar, amt);
    rows.appendChild(row);
  });

  // Linha de total
  const totalRow = document.createElement('div');
  totalRow.className = 'bg-row bg-total';
  totalRow.innerHTML = `
    <span class="bg-label">Total</span>
    <span></span>
    <span class="bg-amt">${fmt(totalActual)} / ${fmt(totalPlanned)}</span>
  `;
  rows.appendChild(totalRow);

  box.appendChild(rows);

  // Pie chart
  const pieWrap = document.createElement('div');
  pieWrap.className = 'bg-pie-wrap';
  pieWrap.appendChild(buildPie(actual));
  const legend = document.createElement('div');
  legend.className = 'bg-legend';
  CATEGORIES.forEach(({ label, color, key }) => {
    const dot = document.createElement('span');
    dot.className = 'bg-legend-dot';
    dot.style.background = color;
    const t = document.createElement('span');
    t.textContent = `${label}: ${fmt(actual[key])}`;
    legend.append(dot, t);
  });
  pieWrap.appendChild(legend);
  box.appendChild(pieWrap);

  container.appendChild(box);
  return {
    get planned() { return planned; },
    get actual() { return actual; },
  };
}

function buildPie(actual) {
  const total = CATEGORIES.reduce((a, c) => a + (actual[c.key] || 0), 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '120');
  if (!total) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', '16');
    c.setAttribute('cy', '16');
    c.setAttribute('r', '15.5');
    c.setAttribute('fill', '#f1f5f9');
    svg.appendChild(c);
    return svg;
  }
  let cumulative = 0;
  CATEGORIES.forEach(({ key, color }) => {
    const v = actual[key] || 0;
    if (!v) return;
    const start = cumulative / total;
    cumulative += v;
    const end = cumulative / total;
    const path = describeArc(16, 16, 15.5, start, end);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', color);
    svg.appendChild(p);
  });
  return svg;
}

function describeArc(cx, cy, r, startFrac, endFrac) {
  const a1 = startFrac * Math.PI * 2 - Math.PI / 2;
  const a2 = endFrac * Math.PI * 2 - Math.PI / 2;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}
