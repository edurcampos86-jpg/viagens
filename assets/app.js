// =================================================================
// Minhas Viagens — app.js
// =================================================================

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTH_NAMES_LONG = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CONTINENT_NAMES = {
  Asia: 'Ásia', Europe: 'Europa', Americas: 'Américas',
  Africa: 'África', Oceania: 'Oceania'
};
const TYPE_NAMES = {
  leisure: 'Lazer', business: 'Trabalho/Evento',
  festival: 'Festival', adventure: 'Aventura'
};

// ── Static seasonal climate fallback (avg °C / precipitation hint) ───
// Used when trip has no `weather` field. Keyed by continent → coarse
// monthly profile for a typical destination on that continent.
const CLIMATE_DEFAULT = {
  Asia:     [22,24,26,28,29,28,27,27,27,26,24,22],
  Europe:   [4, 5, 9,13,17,21,24,24,20,15, 9, 5],
  Americas: [22,22,21,18,15,12,12,14,17,19,21,22],
  Africa:   [25,26,27,26,24,22,21,22,24,26,26,25],
  Oceania:  [22,22,21,19,16,14,13,14,16,18,20,21]
};
const RAIN_HINT = {
  Asia:     ['☼','☼','☁','☂','☂','☂','☂','☂','☂','☁','☼','☼'],
  Europe:   ['❄','❄','☁','☁','☼','☼','☼','☼','☁','☂','☂','❄'],
  Americas: ['☼','☼','☁','☂','☂','☁','☁','☁','☁','☂','☂','☼'],
  Africa:   ['☼','☼','☁','☂','☂','☁','☼','☼','☁','☂','☂','☼'],
  Oceania:  ['☼','☼','☁','☁','☂','☂','☂','☂','☂','☁','☼','☼']
};

// ── Static FX hints (BRL → foreign), updatable; used as a base for
// the small currency widget on planned trips. Real-time fetch optional.
const FX_HINT = {
  Japan:        { code: 'JPY', perBRL: 28.5 },
  Thailand:     { code: 'THB', perBRL: 6.6  },
  Indonesia:    { code: 'IDR', perBRL: 3000 },
  Morocco:      { code: 'MAD', perBRL: 1.8  },
  Norway:       { code: 'NOK', perBRL: 2.0  },
  Italy:        { code: 'EUR', perBRL: 0.17 },
  'South Africa': { code: 'ZAR', perBRL: 3.5 },
  Brasil:       { code: 'BRL', perBRL: 1    }
};

// ── Default planning checklist used when trip has no `checklist` ─────
function defaultChecklist(trip) {
  const monthsAhead = monthsUntil(trip);
  return [
    { id:'passport',  label:'Passaporte com 6+ meses de validade', due:offsetMonths(trip, -6) },
    { id:'visa',      label:'Verificar necessidade de visto', due:offsetMonths(trip, -4) },
    { id:'vaccines',  label:'Vacinas recomendadas (ex.: febre amarela)', due:offsetMonths(trip, -2) },
    { id:'insurance', label:'Seguro-viagem internacional', due:offsetMonths(trip, -1) },
    { id:'flights',   label:'Reservar voos', due:offsetMonths(trip, -3) },
    { id:'hotels',    label:'Reservar hospedagem', due:offsetMonths(trip, -2) },
    { id:'cash',      label:'Cartão internacional + moeda local', due:offsetMonths(trip, -1) },
    { id:'adapter',   label:'Adaptador de tomada', due:offsetMonths(trip, -1) },
    { id:'esim',      label:'eSIM ou chip internacional', due:offsetWeeks(trip, -2) },
    monthsAhead < 0
      ? null
      : { id:'checkin', label:'Check-in online (24h antes)', due:offsetDays(trip, -1) }
  ].filter(Boolean);
}

// ── Default packing list by trip type ────────────────────────────────
function defaultPacking(trip) {
  const base = [
    'Documentos (passaporte, vistos, seguro)',
    'Cartões (crédito + débito) e moeda local',
    'Adaptador universal + carregadores',
    'Higiene pessoal e medicamentos básicos',
    'Filtro solar e óculos escuros'
  ];
  const extras = {
    adventure: ['Calçado de trilha','Mochila pequena','Garrafa reutilizável','Capa de chuva'],
    leisure:   ['Roupa de banho','Roupas leves','Câmera','Livro/Kindle'],
    business:  ['Notebook + carregador','Roupa formal','Adaptador HDMI'],
    festival:  ['Roupa estilizada','Protetor auricular','Power bank']
  };
  return [...base, ...(extras[trip.type] || [])].map((label, i) =>
    ({ id:`p${i}`, label, done:false })
  );
}

// ── Date helpers ─────────────────────────────────────────────────────
function tripStartDate(trip) {
  if (trip.startDate) return new Date(trip.startDate + 'T00:00:00');
  if (trip.year && trip.month) return new Date(trip.year, trip.month - 1, 1);
  return null;
}
function tripEndDate(trip) {
  if (trip.endDate) return new Date(trip.endDate + 'T00:00:00');
  const s = tripStartDate(trip);
  if (!s) return null;
  const e = new Date(s);
  e.setDate(e.getDate() + (trip.nts || 0));
  return e;
}
function daysUntil(trip) {
  const s = tripStartDate(trip);
  if (!s) return null;
  const now = new Date();
  now.setHours(0,0,0,0);
  return Math.round((s - now) / 86400000);
}
function monthsUntil(trip) {
  const d = daysUntil(trip);
  return d == null ? null : Math.round(d / 30);
}
function offsetDays(trip, deltaDays) {
  const s = tripStartDate(trip); if (!s) return null;
  const d = new Date(s); d.setDate(d.getDate() + deltaDays);
  return isoDate(d);
}
function offsetWeeks(trip, weeks) { return offsetDays(trip, weeks * 7); }
function offsetMonths(trip, months) {
  const s = tripStartDate(trip); if (!s) return null;
  const d = new Date(s); d.setMonth(d.getMonth() + months);
  return isoDate(d);
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatCountdown(days) {
  if (days == null) return '';
  if (days < 0) return `há ${Math.abs(days)}d`;
  if (days === 0) return 'hoje!';
  if (days === 1) return 'amanhã!';
  if (days < 14) return `em ${days} dias`;
  if (days < 60) return `em ${Math.round(days/7)} semanas`;
  if (days < 365) return `em ${Math.round(days/30)} meses`;
  return `em ${(days/365).toFixed(1)} anos`;
}
function formatPtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ── Status helpers ───────────────────────────────────────────────────
function isFutureStatus(s) { return s === 'planned' || s === 'wishlist'; }
function isPlanningView() {
  const f = state.filters.status;
  return f === 'planned' || f === 'wishlist';
}

// ── LocalStorage per-trip state (checklists, packing, notes, comments) ─
const LS_KEY = 'viagens-trip-state-v1';
function loadTripState(id) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return all[id] || {};
  } catch { return {}; }
}
function saveTripState(id, patch) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    all[id] = { ...(all[id] || {}), ...patch };
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {}
}

// ── State ────────────────────────────────────────────────────────
const state = {
  trips: [],
  config: {},
  filters: {
    status: 'all',
    continent: 'all',
    year: 'all',
    maxYear: null,
    month: 'all',
    duration: 'all',
    type: 'all',
    pax: 'all',
    search: ''
  },
  expandedTrip: null,
  isDark: null,
  compareMode: false,
  compareIds: new Set(),
  activePlanId: null,
  planActionsBound: false,
};

// ── DOM cache ────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const el = {};

// ── Boot ─────────────────────────────────────────────────────────
async function boot() {
  cacheDom();
  initTheme();
  bindEvents();
  registerSW();
  setupInstallPrompt();

  try {
    const res = await fetch('data/trips.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    state.trips = data.trips;
    state.config = data.config || {};
    // Apply status overrides saved locally (promotion buttons)
    state.trips.forEach(t => {
      const local = loadTripState(t.id);
      if (local.statusOverride) t.status = local.statusOverride;
    });
  } catch (e) {
    console.error('Failed loading trips.json', e);
    $('#secTitleText').textContent = '⚠ Erro ao carregar viagens';
    return;
  }

  el.hdrSub.textContent = `${state.config.owner} · ${state.config.period}`;

  initYearSlider();
  renderYearTimeline();
  populatePaxFilter();
  initMap();
  render();
  refreshEditsIndicator();
  initRouting();
}

function cacheDom() {
  el.stats = $('#stats');
  el.insights = $('#insights');
  el.hdrSub = $('#hdr-sub');
  el.darkBtn = $('#darkBtn');
  el.darkLbl = $('#darkLbl');
  el.darkIcon = el.darkBtn.querySelector('.dark-icon');
  el.installBtn = $('#installBtn');
  el.ytl = $('#ytl');
  el.search = $('#search');
  el.yearSlider = $('#yearSlider');
  el.sliderVal = $('#sliderVal');
  el.advToggle = $('#advToggle');
  el.advPanel = $('#advPanel');
  el.advCount = $('#advCount');
  el.advClear = $('#advClear');
  el.filterMonth = $('#filterMonth');
  el.filterDuration = $('#filterDuration');
  el.filterType = $('#filterType');
  el.filterPax = $('#filterPax');
  el.activeChips = $('#activeChips');
  el.grid = $('#grid');
  el.noResults = $('#noResults');
  el.clearAll = $('#clearAll');
  el.secCount = $('#secCount');
  el.secTitleText = $('#secTitleText');
  el.shareDialog = $('#shareDialog');
  el.shareTitle = $('#shareTitle');
  el.shareToast = $('#shareToast');
  el.tplCard = $('#tpl-trip-card');
  el.nextTimeline = $('#nextTimeline');
  el.compareBtn = $('#compareBtn');
  el.compareDialog = $('#compareDialog');
  el.compareGrid = $('#compareGrid');
  el.emptyDefault = el.noResults.querySelector('[data-empty-default]');
  el.emptyPlanned = el.noResults.querySelector('[data-empty-planned]');
  el.emptyWishlist = el.noResults.querySelector('[data-empty-wishlist]');
  el.dashboardView = $('#dashboardView');
  el.timelineView = $('#timelineView');
  el.memoriaView = $('#memoriaView');
  el.planejamentoView = $('#planejamentoView');
  el.editsBtn = $('#editsBtn');
  el.editsBadgeN = $('#editsBadgeN');
  el.exportDialog = $('#exportDialog');
  el.exportList = $('#exportList');
  el.exportCount = $('#exportCount');
  el.exportDownload = $('#exportDownload');
  el.exportClear = $('#exportClear');
}

// ── Theme ────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  state.isDark = saved ? saved === 'dark' : prefersDark;
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!localStorage.getItem('theme')) {
      state.isDark = e.matches;
      applyTheme();
    }
  });
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.isDark ? 'dark' : 'light');
  el.darkBtn.setAttribute('aria-pressed', String(state.isDark));
  el.darkIcon.textContent = state.isDark ? '☀' : '☾';
  el.darkLbl.textContent = state.isDark ? 'Claro' : 'Escuro';
}
function toggleTheme() {
  state.isDark = !state.isDark;
  localStorage.setItem('theme', state.isDark ? 'dark' : 'light');
  applyTheme();
  if (map) updateMapTiles();
  if (memMap) syncMemTile();
}

// ── Events ───────────────────────────────────────────────────────
function bindEvents() {
  el.darkBtn.addEventListener('click', toggleTheme);

  // Indicator de edições + dialog de export
  if (el.editsBtn) el.editsBtn.addEventListener('click', openExportDialog);
  if (el.exportDownload) el.exportDownload.addEventListener('click', downloadTripsJson);
  if (el.exportClear) el.exportClear.addEventListener('click', clearAllEdits);

  // Event delegation: menu de ações nos cards do kanban (Modo Planejamento e Dashboard)
  document.body.addEventListener('click', e => {
    const trigger = e.target.closest('[data-action="toggle-menu"]');
    if (trigger) {
      e.preventDefault();
      e.stopPropagation();
      const menu = trigger.closest('.planj-card-menu');
      // Fecha outros menus abertos
      document.querySelectorAll('.planj-card-menu.is-open').forEach(m => {
        if (m !== menu) m.classList.remove('is-open');
      });
      if (menu) menu.classList.toggle('is-open');
      return;
    }
    const actionBtn = e.target.closest('[data-action="move"]');
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      const tripId = actionBtn.dataset.tripId;
      const target = actionBtn.dataset.target;
      const trip = state.trips.find(t => t.id === tripId);
      if (trip && target) promoteTrip(trip, target);
      // Fecha o menu
      const menu = actionBtn.closest('.planj-card-menu');
      if (menu) menu.classList.remove('is-open');
      return;
    }
    // Click fora de qualquer menu de card: fecha todos
    if (!e.target.closest('.planj-card-menu')) {
      document.querySelectorAll('.planj-card-menu.is-open').forEach(m => m.classList.remove('is-open'));
    }
  });

  // Status tabs
  $$('.status-btn').forEach(b => b.addEventListener('click', () => {
    state.filters.status = b.dataset.status;
    $$('.status-btn').forEach(x => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    render();
  }));

  // Continent pills
  $$('.fbtn').forEach(b => b.addEventListener('click', () => {
    state.filters.continent = b.dataset.cont;
    $$('.fbtn').forEach(x => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    render();
  }));

  // Search
  el.search.addEventListener('input', () => {
    state.filters.search = el.search.value.trim().toLowerCase();
    render();
  });

  // Advanced toggle
  el.advToggle.addEventListener('click', () => {
    const open = el.advPanel.hidden;
    el.advPanel.hidden = !open;
    el.advToggle.setAttribute('aria-expanded', String(open));
  });

  // Advanced filters
  ['filterMonth','filterDuration','filterType','filterPax'].forEach(id => {
    el[id].addEventListener('change', () => {
      state.filters[id.replace('filter','').toLowerCase()] = el[id].value;
      render();
    });
  });

  el.advClear.addEventListener('click', clearAdvanced);
  el.clearAll.addEventListener('click', clearAll);

  // Year slider
  el.yearSlider.addEventListener('input', () => {
    state.filters.maxYear = +el.yearSlider.value;
    el.sliderVal.textContent = el.yearSlider.value;
    updateSliderPct();
    render();
  });

  // Share dialog actions
  $$('[data-share-action]').forEach(b => b.addEventListener('click', () => {
    handleShareAction(b.dataset.shareAction);
  }));

  // Compare mode
  el.compareBtn.addEventListener('click', toggleCompareMode);

  // Hash routing
  window.addEventListener('hashchange', applyHash);
}

function toggleCompareMode() {
  state.compareMode = !state.compareMode;
  el.compareBtn.setAttribute('aria-pressed', String(state.compareMode));
  el.compareBtn.classList.toggle('active', state.compareMode);
  if (!state.compareMode) state.compareIds.clear();
  render();
  if (state.compareMode) {
    toast('Selecione 2 ou 3 destinos para comparar');
  }
}

function clearAdvanced() {
  state.filters.month = 'all';
  state.filters.duration = 'all';
  state.filters.type = 'all';
  state.filters.pax = 'all';
  el.filterMonth.value = 'all';
  el.filterDuration.value = 'all';
  el.filterType.value = 'all';
  el.filterPax.value = 'all';
  render();
}

function clearAll() {
  clearAdvanced();
  state.filters.search = '';
  state.filters.continent = 'all';
  state.filters.status = 'all';
  state.filters.year = 'all';
  el.search.value = '';
  $$('.fbtn').forEach(x => {
    const active = x.dataset.cont === 'all';
    x.classList.toggle('active', active);
    x.setAttribute('aria-selected', String(active));
  });
  $$('.status-btn').forEach(x => {
    const active = x.dataset.status === 'all';
    x.classList.toggle('active', active);
    x.setAttribute('aria-selected', String(active));
  });
  $$('.yl-item').forEach(x => x.classList.toggle('active', x.dataset.year === 'all'));
  render();
}

// ── Year slider ──────────────────────────────────────────────────
function initYearSlider() {
  const years = state.trips.map(t => t.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  el.yearSlider.min = min;
  el.yearSlider.max = max;
  el.yearSlider.value = max;
  state.filters.maxYear = max;
  el.sliderVal.textContent = max;
  updateSliderPct();
}
function updateSliderPct() {
  const min = +el.yearSlider.min, max = +el.yearSlider.max, v = +el.yearSlider.value;
  const pct = ((v - min) / (max - min)) * 100;
  el.yearSlider.style.setProperty('--pct', pct + '%');
}

// ── Year timeline ────────────────────────────────────────────────
function renderYearTimeline() {
  const years = [...new Set(state.trips.map(t => t.year))].sort();
  const all = document.createElement('button');
  all.className = 'yl-item active';
  all.dataset.year = 'all';
  all.innerHTML = `<span class="yl-dot">∞</span><span class="yl-yr">Tudo</span><span class="yl-count">${state.trips.length}</span>`;
  el.ytl.appendChild(all);
  years.forEach(y => {
    const item = document.createElement('button');
    item.className = 'yl-item';
    item.dataset.year = y;
    const count = state.trips.filter(t => t.year === y).length;
    item.innerHTML = `<span class="yl-dot"></span><span class="yl-yr">${y}</span><span class="yl-count">${count}</span>`;
    el.ytl.appendChild(item);
  });
  $$('.yl-item').forEach(item => {
    item.addEventListener('click', () => {
      state.filters.year = item.dataset.year;
      $$('.yl-item').forEach(x => x.classList.toggle('active', x === item));
      render();
    });
  });
}

// ── Pax filter populator ─────────────────────────────────────────
function populatePaxFilter() {
  const pax = [...new Set(state.trips.map(t => t.pax).filter(Boolean))].sort();
  pax.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
    el.filterPax.appendChild(opt);
  });
}

// ── Filtering ────────────────────────────────────────────────────
function applyFilters() {
  const f = state.filters;
  return state.trips.filter(t => {
    if (f.status !== 'all' && t.status !== f.status) return false;
    if (f.continent !== 'all' && t.continent !== f.continent) return false;
    if (f.year !== 'all' && String(t.year) !== String(f.year)) return false;
    if (f.maxYear && t.year > f.maxYear) return false;
    if (f.month !== 'all' && String(t.month) !== String(f.month)) return false;
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.pax !== 'all' && t.pax !== f.pax) return false;
    if (f.duration !== 'all') {
      const n = t.nts || 0;
      if (f.duration === 'short' && n > 5) return false;
      if (f.duration === 'medium' && (n < 6 || n > 10)) return false;
      if (f.duration === 'long' && n < 11) return false;
    }
    if (f.search) {
      const blob = [t.name, t.sub, t.pax, t.air, t.label, ...(t.highlights || [])].join(' ').toLowerCase();
      if (!blob.includes(f.search)) return false;
    }
    return true;
  });
}

// ── Render orchestrator ──────────────────────────────────────────
function render() {
  const visible = applyFilters();
  renderStats(visible);
  renderInsights(visible);
  renderSectionTitle(visible);
  renderNextTimeline(visible);
  renderCards(visible);
  renderActiveChips();
  renderMapMarkers(visible);
  updateAdvCount();
  el.secCount.textContent = `${visible.length} viage${visible.length === 1 ? 'm' : 'ns'}`;
  el.noResults.classList.toggle('show', visible.length === 0);
  renderEmptyState();
  renderCompareControl();
}

function renderEmptyState() {
  const status = state.filters.status;
  el.emptyDefault.hidden = status === 'planned' || status === 'wishlist';
  el.emptyPlanned.hidden = status !== 'planned';
  el.emptyWishlist.hidden = status !== 'wishlist';
}

function renderCompareControl() {
  el.compareBtn.hidden = !isPlanningView();
  if (!isPlanningView() && state.compareMode) {
    state.compareMode = false;
    state.compareIds.clear();
    el.compareBtn.setAttribute('aria-pressed', 'false');
    el.compareBtn.classList.remove('active');
  }
}

function renderSectionTitle(visible) {
  const f = state.filters.status;
  let icon = '📅', text = 'Linha do Tempo das Viagens';
  if (f === 'planned')  { icon = '🗺'; text = 'Próximas Viagens'; }
  else if (f === 'wishlist') { icon = '⭐'; text = 'Wishlist — Sonhos de Viagem'; }
  else if (f === 'done') { icon = '✓'; text = 'Viagens Realizadas'; }
  el.secTitleText.textContent = `${icon} ${text}`;
}

function updateAdvCount() {
  const f = state.filters;
  const n = ['month','duration','type','pax'].filter(k => f[k] !== 'all').length;
  el.advCount.hidden = n === 0;
  el.advCount.textContent = n;
}

// ── Stats ────────────────────────────────────────────────────────
function renderStats(visible) {
  const trips = visible.length;
  const countries = new Set(visible.map(t => t.name)).size;
  const continents = new Set(visible.map(t => t.continent)).size;
  const nights = visible.reduce((s, t) => s + (t.nts || 0), 0);
  const km = visible.reduce((s, t) => s + (t.km || 0), 0);
  const stats = [
    { v: trips, l: 'Viagens' },
    { v: countries, l: 'Destinos' },
    { v: continents, l: 'Continentes' },
    { v: nights, l: 'Noites' },
    { v: km.toLocaleString('pt-BR'), l: 'km voados est.' }
  ];
  el.stats.innerHTML = stats.map(s =>
    `<div class="stat" role="listitem"><div class="stat-v">${s.v}</div><div class="stat-l">${s.l}</div></div>`
  ).join('');
}

// ── Insights ─────────────────────────────────────────────────────
function renderInsights(visible) {
  if (isPlanningView()) {
    renderPlanningInsights(visible);
    return;
  }
  renderRetroInsights(visible);
}

function renderRetroInsights(visible) {
  const done = visible.filter(t => t.status === 'done');
  if (done.length === 0) {
    el.insights.innerHTML = '';
    return;
  }

  // Melhor mês = mês com mais viagens
  const monthFreq = {};
  done.forEach(t => { monthFreq[t.month] = (monthFreq[t.month] || 0) + 1; });
  const bestMonth = +Object.entries(monthFreq).sort((a,b) => b[1]-a[1])[0][0];

  // Continente menos visitado (excluindo zero)
  const continentFreq = {};
  ['Asia','Europe','Americas','Africa','Oceania'].forEach(c => continentFreq[c] = 0);
  done.forEach(t => { continentFreq[t.continent] = (continentFreq[t.continent] || 0) + 1; });
  const leastEntries = Object.entries(continentFreq).filter(([,v]) => v > 0).sort((a,b) => a[1]-b[1]);
  const leastContinent = leastEntries[0];

  // País favorito (mais reincidente, ou primeiro alfabético)
  const countryFreq = {};
  done.forEach(t => { countryFreq[t.name] = (countryFreq[t.name] || 0) + 1; });
  const favCountry = Object.entries(countryFreq).sort((a,b) => b[1]-a[1])[0];

  // Custo médio por dia (apenas viagens com custo)
  const withCost = done.filter(t => t.cost?.total && t.nts);
  let avgCost = null;
  if (withCost.length) {
    const totalCost = withCost.reduce((s,t) => s + t.cost.total, 0);
    const totalNts = withCost.reduce((s,t) => s + t.nts, 0);
    avgCost = Math.round(totalCost / totalNts);
  }

  const insights = [
    { icon: '📅', lbl: 'Mês favorito de viagem', v: `${MONTH_NAMES[bestMonth-1]} (${monthFreq[bestMonth]}×)` },
    { icon: '🌐', lbl: 'Continente menos visitado', v: leastContinent ? `${CONTINENT_NAMES[leastContinent[0]]} (${leastContinent[1]}×)` : '—' },
    { icon: '⭐', lbl: 'Destino mais visitado', v: favCountry ? `${favCountry[0]} (${favCountry[1]}×)` : '—' },
    { icon: '💰', lbl: 'Custo médio por dia (BRL)', v: avgCost ? `R$ ${avgCost.toLocaleString('pt-BR')}` : '—' }
  ];
  paintInsights(insights);
}

function renderPlanningInsights(visible) {
  const future = visible.filter(t => isFutureStatus(t.status));
  if (future.length === 0) {
    el.insights.innerHTML = '';
    return;
  }
  const sorted = [...future].sort((a, b) => (daysUntil(a) ?? 9e9) - (daysUntil(b) ?? 9e9));
  const next = sorted[0];

  // Total noites planejadas
  const totalNts = future.reduce((s, t) => s + (t.nts || 0), 0);

  // Orçamento agregado (estimativas declaradas ou heurística R$1k/dia)
  let budget = 0;
  future.forEach(t => {
    if (t.budget?.total) budget += t.budget.total;
    else if (t.cost?.total) budget += t.cost.total;
    else budget += (t.nts || 0) * 1000;
  });

  // Continente mais planejado
  const contFreq = {};
  future.forEach(t => contFreq[t.continent] = (contFreq[t.continent] || 0) + 1);
  const topCont = Object.entries(contFreq).sort((a,b) => b[1]-a[1])[0];

  const dnext = daysUntil(next);
  const insights = [
    { icon: '⏳', lbl: 'Próxima partida', v: next ? `${next.flag} ${next.name} · ${formatCountdown(dnext)}` : '—' },
    { icon: '🧭', lbl: 'Viagens planejadas', v: `${future.length} destino${future.length>1?'s':''} · ${totalNts} noites` },
    { icon: '💰', lbl: 'Orçamento agregado (est.)', v: budget ? `R$ ${budget.toLocaleString('pt-BR')}` : '—' },
    { icon: '🌐', lbl: 'Continente mais planejado', v: topCont ? `${CONTINENT_NAMES[topCont[0]]} (${topCont[1]}×)` : '—' }
  ];
  paintInsights(insights);
}

function paintInsights(insights) {
  el.insights.innerHTML = insights.map(i =>
    `<div class="insight" role="listitem">
       <div class="insight-icon" aria-hidden="true">${i.icon}</div>
       <div class="insight-body">
         <div class="insight-lbl">${i.lbl}</div>
         <div class="insight-v">${i.v}</div>
       </div>
     </div>`
  ).join('');
}

// ── Next-trips horizontal timeline ───────────────────────────────
function renderNextTimeline(visible) {
  if (!isPlanningView()) {
    el.nextTimeline.hidden = true;
    el.nextTimeline.innerHTML = '';
    return;
  }
  const future = visible
    .filter(t => isFutureStatus(t.status))
    .map(t => ({ trip: t, d: daysUntil(t) }))
    .filter(x => x.d != null && x.d >= 0)
    .sort((a, b) => a.d - b.d);

  if (future.length === 0) {
    el.nextTimeline.hidden = true;
    el.nextTimeline.innerHTML = '';
    return;
  }

  const maxD = Math.max(...future.map(x => x.d), 30);
  const items = future.map(({ trip, d }) => {
    const pct = Math.min(100, (d / maxD) * 100);
    return `
      <button class="nt-item" data-trip-id="${escapeHtml(trip.id)}" style="--pct:${pct}%; --col:${trip.color || '#0ea5e9'}">
        <span class="nt-marker" aria-hidden="true"></span>
        <span class="nt-emoji" aria-hidden="true">${trip.emoji}</span>
        <span class="nt-name">${escapeHtml(trip.name)}</span>
        <span class="nt-cd">${formatCountdown(d)}</span>
      </button>`;
  }).join('');

  el.nextTimeline.innerHTML = `
    <div class="nt-rail" aria-hidden="true">
      <span class="nt-rail-start">hoje</span>
      <span class="nt-rail-end">${maxD < 60 ? `+${maxD}d` : `+${Math.round(maxD/30)} meses`}</span>
    </div>
    <div class="nt-track">${items}</div>
  `;
  el.nextTimeline.hidden = false;

  el.nextTimeline.querySelectorAll('.nt-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tripId;
      location.hash = `trip/${id}`;
    });
  });
}

// ── Active chips ─────────────────────────────────────────────────
function renderActiveChips() {
  const f = state.filters;
  const chips = [];
  if (f.status !== 'all') chips.push({ k:'status', l:`Status: ${labelStatus(f.status)}` });
  if (f.continent !== 'all') chips.push({ k:'continent', l:`Continente: ${CONTINENT_NAMES[f.continent]}` });
  if (f.year !== 'all') chips.push({ k:'year', l:`Ano: ${f.year}` });
  if (f.month !== 'all') chips.push({ k:'month', l:`Mês: ${MONTH_NAMES[+f.month-1]}` });
  if (f.duration !== 'all') chips.push({ k:'duration', l:`Duração: ${labelDur(f.duration)}` });
  if (f.type !== 'all') chips.push({ k:'type', l:`Tipo: ${TYPE_NAMES[f.type]}` });
  if (f.pax !== 'all') chips.push({ k:'pax', l:`Com: ${f.pax}` });
  if (f.search) chips.push({ k:'search', l:`"${f.search}"` });

  el.activeChips.innerHTML = chips.map(c =>
    `<span class="chip" data-k="${c.k}">${c.l}<button aria-label="Remover filtro ${c.l}">×</button></span>`
  ).join('');

  el.activeChips.querySelectorAll('.chip button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.parentElement.dataset.k;
      if (k === 'search') { state.filters.search = ''; el.search.value = ''; }
      else if (k === 'continent') {
        state.filters.continent = 'all';
        $$('.fbtn').forEach(x => {
          const a = x.dataset.cont === 'all';
          x.classList.toggle('active', a); x.setAttribute('aria-selected', String(a));
        });
      }
      else if (k === 'status') {
        state.filters.status = 'all';
        $$('.status-btn').forEach(x => {
          const a = x.dataset.status === 'all';
          x.classList.toggle('active', a); x.setAttribute('aria-selected', String(a));
        });
      }
      else if (k === 'year') {
        state.filters.year = 'all';
        $$('.yl-item').forEach(x => x.classList.toggle('active', x.dataset.year === 'all'));
      }
      else {
        state.filters[k] = 'all';
        if (el['filter'+capitalize(k)]) el['filter'+capitalize(k)].value = 'all';
      }
      render();
    });
  });
}
function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }
function labelStatus(s) { return { done:'Realizadas', planned:'Planejadas', wishlist:'Wishlist' }[s] || s; }
function labelDur(d) { return { short:'≤5 noites', medium:'6–10 noites', long:'11+ noites' }[d] || d; }

// ── Card rendering ───────────────────────────────────────────────
function renderCards(visible) {
  el.grid.innerHTML = '';
  // Asc para planning views (mais próxima primeiro), desc para histórico
  const asc = isPlanningView();
  const sorted = [...visible].sort((a, b) => {
    if (asc) {
      const da = daysUntil(a) ?? 9e9;
      const db = daysUntil(b) ?? 9e9;
      if (da !== db) return da - db;
    }
    if (a.year !== b.year) return asc ? a.year - b.year : b.year - a.year;
    return asc ? (a.month || 0) - (b.month || 0) : (b.month || 0) - (a.month || 0);
  });
  el.grid.classList.toggle('compare-mode', state.compareMode);
  sorted.forEach(trip => {
    const node = el.tplCard.content.firstElementChild.cloneNode(true);
    hydrateCard(node, trip);
    el.grid.appendChild(node);
  });
  // Re-expand if route hash matches
  if (state.expandedTrip) {
    const card = el.grid.querySelector(`.card[data-trip-id="${state.expandedTrip}"]`);
    if (card) {
      expandCard(card, true);
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('highlight');
      setTimeout(() => card.classList.remove('highlight'), 1800);
    }
  }
}

// Tab schemas — different for done vs planned/wishlist trips
const TABS_DONE = [
  { key:'diary',     label:'📖 Diário'    },
  { key:'route',     label:'🗺 Roteiro'   },
  { key:'logistics', label:'✈ Logística'  },
  { key:'cost',      label:'💰 Custos'    },
  { key:'gallery',   label:'📸 Galeria'   }
];
const TABS_PLANNED = [
  { key:'planning',  label:'📝 Notas & Plano' },
  { key:'route',     label:'🗺 Roteiro'   },
  { key:'checklist', label:'✅ Checklist' },
  { key:'reservations', label:'🎫 Reservas' },
  { key:'budget',    label:'💰 Orçamento' },
  { key:'packing',   label:'🧳 Bagagem'   },
  { key:'inspire',   label:'💡 Inspiração' },
  { key:'context',   label:'🌦 Clima & Câmbio' }
];

function hydrateCard(node, trip) {
  const isPlanned = trip.status !== 'done';
  node.dataset.tripId = trip.id;
  node.classList.toggle('planned', isPlanned);
  node.classList.toggle('wishlist', trip.status === 'wishlist');
  node.style.setProperty('--stripe', trip.color);

  // Compare checkbox
  const cmp = node.querySelector('[data-compare-wrap]');
  if (state.compareMode && isPlanned) {
    cmp.hidden = false;
    const input = cmp.querySelector('[data-compare-input]');
    input.checked = state.compareIds.has(trip.id);
    input.addEventListener('change', () => {
      if (input.checked) {
        if (state.compareIds.size >= 3) {
          input.checked = false;
          toast('Máximo de 3 destinos para comparar');
          return;
        }
        state.compareIds.add(trip.id);
      } else {
        state.compareIds.delete(trip.id);
      }
      if (state.compareIds.size >= 2) openCompare();
    });
  }

  const hero = node.querySelector('[data-hero]');
  if (trip.photo) {
    hero.style.backgroundImage = `url(${trip.photo})`;
  } else {
    hero.style.background = `linear-gradient(135deg, ${trip.color}, ${trip.color2})`;
  }
  node.querySelector('[data-hero-emoji]').textContent = isFlagEmoji(trip.emoji) ? '' : trip.emoji;
  node.querySelector('[data-hero-flag]').textContent = trip.emoji;
  const badge = node.querySelector('[data-hero-badge]');
  if (trip.status === 'planned') { badge.hidden = false; badge.textContent = '📅 Planejada'; }
  else if (trip.status === 'wishlist') { badge.hidden = false; badge.textContent = '⭐ Wishlist'; }
  else if (trip.verified) { badge.hidden = false; badge.textContent = '✓ Confirmada'; }

  // Countdown chip in hero (only for future trips with valid date)
  const cdHero = node.querySelector('[data-hero-countdown]');
  const d = daysUntil(trip);
  if (isPlanned && d != null && d >= 0) {
    cdHero.hidden = false;
    cdHero.textContent = `⏳ ${formatCountdown(d)}`;
  }

  node.querySelector('[data-hero-name]').textContent = trip.name;
  node.querySelector('[data-hero-sub]').textContent = trip.sub;

  node.querySelector('[data-name]').textContent = trip.name;
  node.querySelector('[data-date]').textContent = trip.startDate
    ? `${formatPtDate(trip.startDate)}${trip.endDate ? ' → ' + formatPtDate(trip.endDate) : ''}`
    : trip.label;
  node.querySelector('[data-place]').textContent = trip.sub;

  const okBadge = node.querySelector('[data-badge-ok]');
  const plBadge = node.querySelector('[data-badge-planned]');
  const wsBadge = node.querySelector('[data-badge-wish]');
  if (trip.status === 'done' && trip.verified) okBadge.hidden = false;
  if (trip.status === 'planned') plBadge.hidden = false;
  if (trip.status === 'wishlist') wsBadge.hidden = false;

  node.querySelector('[data-tag-air]').textContent = '✈ ' + trip.air;
  node.querySelector('[data-tag-pax]').textContent = '👥 ' + trip.pax;
  node.querySelector('[data-tag-nts]').textContent = '🌙 ' + (trip.nts || '?') + ' noites';

  const tagCd = node.querySelector('[data-tag-countdown]');
  if (isPlanned && d != null && d >= 0) {
    tagCd.hidden = false;
    tagCd.textContent = '⏳ ' + formatCountdown(d);
  }

  // Build tabs + panels dynamically
  const tabsHost = node.querySelector('[data-tabs]');
  const panelsHost = node.querySelector('[data-panels]');
  const tabsSchema = isPlanned ? TABS_PLANNED : TABS_DONE;
  tabsHost.innerHTML = tabsSchema.map((t, i) =>
    `<button class="tab${i===0?' active':''}" role="tab" aria-selected="${i===0}" data-tab="${t.key}">${t.label}</button>`
  ).join('');
  panelsHost.innerHTML = tabsSchema.map((t, i) =>
    `<div class="tab-panel${i===0?' active':''}" role="tabpanel" data-panel="${t.key}"${i===0?'':' hidden'}></div>`
  ).join('');

  // Populate panels
  if (isPlanned) {
    populatePlanning(node, trip);
    populateRoute(node, trip);
    populateChecklist(node, trip);
    populateReservations(node, trip);
    populateBudget(node, trip);
    populatePacking(node, trip);
    populateInspiration(node, trip);
    populateContext(node, trip);
  } else {
    populateDiary(node, trip);
    populateRoute(node, trip);
    populateLogistics(node, trip);
    populateCost(node, trip);
    populateGallery(node, trip);
  }

  // Toggle expand
  const exp = node.querySelector('[data-exp]');
  const toggleBtn = node.querySelector('[data-toggle]');
  toggleBtn.addEventListener('click', () => {
    const open = exp.hidden;
    expandCard(node, open);
    if (open) {
      window.history.replaceState(null, '', `#trip/${trip.id}`);
    } else if (location.hash.startsWith('#trip/')) {
      window.history.replaceState(null, '', location.pathname);
    }
  });

  // Tab switching
  node.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      node.querySelectorAll('.tab').forEach(t => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      node.querySelectorAll('.tab-panel').forEach(p => {
        p.hidden = p.dataset.panel !== target;
        p.classList.toggle('active', p.dataset.panel === target);
      });
      if (target === 'route') {
        const miniHost = node.querySelector('[data-minimap]');
        if (miniHost && !miniHost.dataset.ready) {
          renderMiniMap(miniHost, trip);
          miniHost.dataset.ready = '1';
        }
      }
    });
  });

  // Share + permalink
  node.querySelector('[data-share]').addEventListener('click', e => {
    e.stopPropagation();
    openShare(trip);
  });
  node.querySelector('[data-permalink]').addEventListener('click', e => {
    e.stopPropagation();
    const url = `${location.origin}${location.pathname}#trip/${trip.id}`;
    copyText(url);
    toast('🔗 Link copiado!');
  });

  // Add to calendar (.ics) — only for planned/wishlist with a start date
  const icsBtn = node.querySelector('[data-ics]');
  if (isPlanned && tripStartDate(trip)) {
    icsBtn.hidden = false;
    icsBtn.addEventListener('click', e => {
      e.stopPropagation();
      downloadIcs(trip);
    });
  }

  // "Open dedicated page" for planned/wishlist
  const planBtn = node.querySelector('[data-open-plan]');
  if (isPlanned) {
    planBtn.hidden = false;
    planBtn.addEventListener('click', e => {
      e.stopPropagation();
      location.hash = `plan/${trip.id}`;
    });
  }

  // Status promotion button
  const promoBtn = node.querySelector('[data-promote]');
  const promoLbl = node.querySelector('[data-promote-label]');
  if (trip.status === 'wishlist') {
    promoBtn.hidden = false; promoLbl.textContent = '📅 Mover para Planejadas';
    promoBtn.addEventListener('click', e => { e.stopPropagation(); promoteTrip(trip, 'planned'); });
  } else if (trip.status === 'planned') {
    promoBtn.hidden = false; promoLbl.textContent = '✓ Marcar como realizada';
    promoBtn.addEventListener('click', e => { e.stopPropagation(); promoteTrip(trip, 'done'); });
  }
}

// Promote trip status (persisted in localStorage as override)
function promoteTrip(trip, toStatus) {
  trip.status = toStatus;
  saveTripState(trip.id, { statusOverride: toStatus });
  toast(`Movida para ${statusLabel(toStatus)}`);
  refreshEditsIndicator();
  // Re-render da view ativa
  const hash = location.hash.replace(/^#/, '');
  if (hash === '' || hash === 'dashboard') renderDashboard();
  else if (hash === 'memoria') renderMemoria();
  else if (hash === 'planejamento') renderPlanejamento();
  else render();
}

function statusLabel(status) {
  return ({
    done: 'Realizada',
    planned: 'Confirmada',
    em_planejamento: 'Em planejamento',
    wishlist: 'Wishlist',
  })[status] || status;
}

// ── Edições locais + exportar (Fase 7a) ────────────────────────────
function countPendingEdits() {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    let n = 0;
    for (const st of Object.values(all)) {
      if (st && st.statusOverride) n++;
    }
    return n;
  } catch { return 0; }
}

function refreshEditsIndicator() {
  if (!el.editsBtn) return;
  const n = countPendingEdits();
  el.editsBtn.hidden = n === 0;
  if (n > 0) el.editsBadgeN.textContent = String(n);
}

function buildExportList() {
  const all = (() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch { return {}; } })();
  const items = [];
  for (const [tripId, st] of Object.entries(all)) {
    if (!st || !st.statusOverride) continue;
    const trip = state.trips.find(t => t.id === tripId);
    items.push(`
      <div class="export-list-item">
        <span class="ic" aria-hidden="true">✎</span>
        <div>
          <div class="trip-name">${(trip && trip.name) || tripId}</div>
          <div class="change">status → <strong>${statusLabel(st.statusOverride)}</strong></div>
        </div>
      </div>
    `);
  }
  if (el.exportCount) el.exportCount.textContent = String(items.length);
  if (el.exportList) {
    el.exportList.innerHTML = items.length
      ? items.join('')
      : '<div class="export-list-empty">Sem edições pendentes</div>';
  }
}

function openExportDialog() {
  buildExportList();
  el.exportDialog.showModal();
}

async function downloadTripsJson() {
  try {
    const res = await fetch('data/trips.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const trip of data.trips) {
      const st = all[trip.id];
      if (st && st.statusOverride) trip.status = st.statusOverride;
    }
    data.atualizado_em = new Date().toISOString().slice(0, 10);
    const content = JSON.stringify(data, null, 2) + '\n';
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trips.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('📥 Baixado!');
  } catch (e) {
    console.error('Export falhou', e);
    toast('⚠ Falha no export');
  }
}

function clearAllEdits() {
  const n = countPendingEdits();
  if (n === 0) return;
  if (!confirm(`Descartar ${n} edição(ões) local(is)?\n\nFaça isso APENAS após exportar e aplicar no GitHub. Senão você perde as mudanças.`)) return;
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const id of Object.keys(all)) {
      if (all[id]) delete all[id].statusOverride;
    }
    localStorage.setItem(LS_KEY, JSON.stringify(all));
    location.reload();
  } catch (e) {
    console.error('Clear edits falhou', e);
  }
}

function isFlagEmoji(s) {
  return /\p{Regional_Indicator}/u.test(s || '');
}

function expandCard(card, open) {
  const exp = card.querySelector('[data-exp]');
  const btn = card.querySelector('[data-toggle]');
  exp.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  state.expandedTrip = open ? card.dataset.tripId : null;
}

function populateDiary(node, trip) {
  const hl = node.querySelector('[data-highlights]');
  hl.innerHTML = (trip.highlights || []).map(h => `<span class="hl">${escapeHtml(h)}</span>`).join('');
  node.querySelector('[data-memory]').textContent = trip.memory || '';
}

function populateLogistics(node, trip) {
  const log = trip.logistics || {};
  const ulHotels = node.querySelector('[data-log-hotels]');
  const ulRests = node.querySelector('[data-log-restaurants]');
  ulHotels.innerHTML = (log.hotels || []).map(h => `<li>${escapeHtml(h)}</li>`).join('') || '<li style="color:var(--text3)">—</li>';
  ulRests.innerHTML = (log.restaurants || []).map(h => `<li>${escapeHtml(h)}</li>`).join('') || '<li style="color:var(--text3)">—</li>';
  node.querySelector('[data-log-tips]').textContent = log.tips || '—';
}

function populateCost(node, trip) {
  const c = trip.cost || {};
  if (!c.total) {
    node.querySelector('[data-cost-total]').textContent = '—';
    node.querySelector('[data-cost-bars]').innerHTML = '<p style="color:var(--text3);font-size:.8rem">Sem dados de custo registrados.</p>';
    node.querySelector('[data-cost-curr]').textContent = '';
    node.querySelector('[data-cost-day]').textContent = '—';
    return;
  }
  node.querySelector('[data-cost-total]').textContent = formatMoney(c.total, c.currency);
  const breakdown = c.breakdown || {};
  const max = Math.max(...Object.values(breakdown), 1);
  const labels = { voos: '✈ Voos', hospedagem: '🏨 Hospedagem', passeios: '🎟 Passeios', comida: '🍴 Comida' };
  const bars = Object.entries(breakdown).map(([k, v]) => {
    const pct = (v / max) * 100;
    return `<div class="cost-bar">
      <span class="cost-bar-lbl">${labels[k] || k}</span>
      <div class="cost-bar-track"><div class="cost-bar-fill" style="width:${pct}%"></div></div>
      <span class="cost-bar-v">${formatMoney(v, c.currency)}</span>
    </div>`;
  }).join('');
  node.querySelector('[data-cost-bars]').innerHTML = bars;
  node.querySelector('[data-cost-curr]').textContent = c.currency || 'BRL';
  node.querySelector('[data-cost-day]').textContent = formatMoney(Math.round(c.total / (trip.nts || 1)), c.currency);
}

function populateGallery(node, trip) {
  const gal = node.querySelector('[data-gallery]');
  const empty = node.querySelector('[data-gallery-empty]');
  const photos = trip.gallery || [];
  if (photos.length === 0) {
    gal.hidden = true;
    empty.hidden = false;
    return;
  }
  gal.innerHTML = photos.map(src =>
    `<img loading="lazy" src="${src}" alt="Foto de ${escapeHtml(trip.name)}">`
  ).join('');
}

function populateRoute(node, trip) {
  const panel = node.querySelector('[data-panel="route"]');
  if (!panel) return;
  panel.innerHTML = `
    <div class="mini-map" data-minimap></div>
    <ol class="route-list" data-route-list></ol>
  `;
  const list = panel.querySelector('[data-route-list]');
  const stops = trip.route && trip.route.length
    ? trip.route
    : [{ name: trip.name, lat: trip.lat, lon: trip.lon }];
  list.innerHTML = stops.map(stop =>
    `<li><span>${escapeHtml(stop.name)}</span><span class="route-coord">${stop.lat.toFixed(2)}, ${stop.lon.toFixed(2)}</span></li>`
  ).join('');
}

// ── Planning content (planned/wishlist trips) ────────────────────
function populatePlanning(node, trip) {
  const panel = node.querySelector('[data-panel="planning"]');
  if (!panel) return;
  const saved = loadTripState(trip.id);
  const notes = saved.notes ?? trip.notes ?? '';
  panel.innerHTML = `
    <div class="hlights" data-highlights>${(trip.highlights || []).map(h => `<span class="hl">${escapeHtml(h)}</span>`).join('')}</div>
    <label class="plan-label" for="notes-${trip.id}">📝 Notas e expectativas</label>
    <textarea id="notes-${trip.id}" class="plan-notes" rows="4"
      placeholder="O que você espera dessa viagem? Restaurantes para tentar, fotos a tirar, presentes a comprar…">${escapeHtml(notes)}</textarea>
    <div class="plan-comments">
      <h4>💬 Comentários (locais)</h4>
      <ul class="plan-comment-list" data-comments></ul>
      <form class="plan-comment-form" data-comment-form>
        <input type="text" placeholder="Adicione um comentário…" maxlength="240" required />
        <button type="submit">Adicionar</button>
      </form>
    </div>
  `;
  const ta = panel.querySelector('textarea');
  ta.addEventListener('input', () => saveTripState(trip.id, { notes: ta.value }));

  paintComments(panel, trip);
  panel.querySelector('[data-comment-form]').addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const txt = input.value.trim();
    if (!txt) return;
    const list = loadTripState(trip.id).comments || [];
    list.push({ t: Date.now(), text: txt });
    saveTripState(trip.id, { comments: list });
    input.value = '';
    paintComments(panel, trip);
  });
}

function paintComments(panel, trip) {
  const ul = panel.querySelector('[data-comments]');
  const list = (loadTripState(trip.id).comments || []).slice().reverse();
  if (list.length === 0) {
    ul.innerHTML = `<li class="cm-empty">Sem comentários ainda.</li>`;
    return;
  }
  ul.innerHTML = list.map((c, i) => {
    const idx = list.length - 1 - i;
    const dt = new Date(c.t);
    return `<li class="cm-item">
      <div class="cm-text">${escapeHtml(c.text)}</div>
      <div class="cm-meta">${dt.toLocaleString('pt-BR')}</div>
      <button class="cm-del" data-idx="${idx}" aria-label="Remover">×</button>
    </li>`;
  }).join('');
  ul.querySelectorAll('.cm-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const all = loadTripState(trip.id).comments || [];
      all.splice(idx, 1);
      saveTripState(trip.id, { comments: all });
      paintComments(panel, trip);
    });
  });
}

function populateChecklist(node, trip) {
  const panel = node.querySelector('[data-panel="checklist"]');
  if (!panel) return;
  const saved = loadTripState(trip.id);
  const items = trip.checklist || defaultChecklist(trip);
  // Merge: manual checks (saved.checklist) OR auto-detected (trip.checklistAuto)
  const autoChecks = trip.checklistAuto || {};
  const manualChecks = saved.checklist || {};
  const checks = { ...autoChecks, ...manualChecks };
  // explicit override: if user un-checks manually, manualChecks wins
  const total = items.length;
  const doneN = items.filter(i => checks[i.id]).length;
  const pct = Math.round((doneN / total) * 100);

  panel.innerHTML = `
    <div class="cl-progress">
      <div class="cl-progress-bar"><div class="cl-progress-fill" style="width:${pct}%"></div></div>
      <span class="cl-progress-lbl">${doneN}/${total} concluídos · ${pct}%</span>
    </div>
    <ul class="cl-list">
      ${items.map(it => {
        const checked = !!checks[it.id];
        const isAuto = !!autoChecks[it.id] && manualChecks[it.id] !== false;
        const autoMeta = isAuto && typeof autoChecks[it.id] === 'object' ? autoChecks[it.id] : null;
        const due = it.due ? formatPtDate(it.due) : '';
        const overdue = it.due && new Date(it.due) < new Date() && !checked;
        const autoBadge = autoMeta
          ? `<span class="cl-auto" title="Detectado automaticamente via ${escapeHtml(autoMeta.provider || 'email')} ${autoMeta.ref ? '(' + escapeHtml(autoMeta.ref) + ')' : ''}">🔗 ${escapeHtml(autoMeta.provider || 'auto')}</span>`
          : '';
        return `<li class="cl-item${checked ? ' done' : ''}${overdue ? ' overdue' : ''}${isAuto ? ' auto' : ''}">
          <label>
            <input type="checkbox" data-id="${escapeHtml(it.id)}" ${checked ? 'checked' : ''}/>
            <span class="cl-label">${escapeHtml(it.label)}</span>
            ${autoBadge}
            ${due ? `<span class="cl-due">⏰ ${due}</span>` : ''}
          </label>
        </li>`;
      }).join('')}
    </ul>
  `;
  panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const checks2 = (loadTripState(trip.id).checklist) || {};
      checks2[cb.dataset.id] = cb.checked;
      saveTripState(trip.id, { checklist: checks2 });
      populateChecklist(node, trip); // re-render progress
    });
  });
}

function populateReservations(node, trip) {
  const panel = node.querySelector('[data-panel="reservations"]');
  if (!panel) return;
  const log = trip.logistics || {};
  const defaults = [
    { type:'flight',   label: trip.air || 'Voo', status:'researching' },
    ...(log.hotels || []).map(h => ({ type:'hotel', label:h, status:'researching' })),
    ...(log.activities || []).map(a => ({ type:'activity', label:a, status:'researching' }))
  ];
  const saved = loadTripState(trip.id).reservations || trip.reservations || defaults;
  const STATUS = {
    researching: { lbl:'🔍 Pesquisando', cls:'rs-research' },
    booked:      { lbl:'📌 Reservado',   cls:'rs-booked'   },
    paid:        { lbl:'✓ Pago',         cls:'rs-paid'     }
  };
  const ICON = { flight:'✈', hotel:'🏨', activity:'🎟', transfer:'🚖' };

  panel.innerHTML = `
    <ul class="rs-list">
      ${saved.map((r, i) => `
        <li class="rs-item ${STATUS[r.status]?.cls || ''}">
          <span class="rs-icon" aria-hidden="true">${ICON[r.type] || '📌'}</span>
          <span class="rs-label">${escapeHtml(r.label)}</span>
          ${r.price ? `<span class="rs-price">${formatMoney(r.price, r.currency || 'BRL')}</span>` : ''}
          <select class="rs-status" data-idx="${i}">
            ${Object.entries(STATUS).map(([k, v]) =>
              `<option value="${k}"${r.status === k ? ' selected' : ''}>${v.lbl}</option>`
            ).join('')}
          </select>
        </li>
      `).join('')}
    </ul>
    <p class="rs-note">Status salvo localmente neste navegador.</p>
  `;
  panel.querySelectorAll('.rs-status').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.idx;
      const list = (loadTripState(trip.id).reservations) || saved;
      list[idx] = { ...list[idx], status: sel.value };
      saveTripState(trip.id, { reservations: list });
      populateReservations(node, trip);
    });
  });
}

function populateBudget(node, trip) {
  const panel = node.querySelector('[data-panel="budget"]');
  if (!panel) return;
  // Heurística: orçamento estimado = ~R$1.000/dia se não informado
  const nts = trip.nts || 1;
  const totalEst = trip.budget?.total ?? trip.cost?.total ?? nts * 1000;
  const breakdown = trip.budget?.breakdown ?? trip.cost?.breakdown ?? {
    voos: Math.round(totalEst * 0.30),
    hospedagem: Math.round(totalEst * 0.35),
    passeios: Math.round(totalEst * 0.15),
    comida: Math.round(totalEst * 0.20)
  };
  // Merge: trip.budget.committed (auto-detected from email sync) as base,
  // user adjustments from localStorage on top.
  const committed = { ...(trip.budget?.committed || {}), ...(loadTripState(trip.id).committed || {}) };
  const totalCommitted = Object.values(committed).reduce((a,b) => a+(+b||0), 0);
  const curr = trip.budget?.currency || trip.cost?.currency || 'BRL';
  const labels = { voos:'✈ Voos', hospedagem:'🏨 Hospedagem', passeios:'🎟 Passeios', comida:'🍴 Comida' };

  panel.innerHTML = `
    <div class="bd-summary">
      <div>
        <div class="bd-summary-lbl">Orçamento total</div>
        <div class="bd-summary-v">${formatMoney(totalEst, curr)}</div>
      </div>
      <div>
        <div class="bd-summary-lbl">Comprometido</div>
        <div class="bd-summary-v" style="color:var(--accent2)">${formatMoney(totalCommitted, curr)}</div>
      </div>
      <div>
        <div class="bd-summary-lbl">Restante</div>
        <div class="bd-summary-v">${formatMoney(Math.max(0, totalEst - totalCommitted), curr)}</div>
      </div>
    </div>
    <div class="bd-rows">
      ${Object.entries(breakdown).map(([k, est]) => {
        const com = +committed[k] || 0;
        const pct = Math.min(100, est ? (com / est) * 100 : 0);
        return `<div class="bd-row">
          <span class="bd-row-lbl">${labels[k] || k}</span>
          <div class="bd-row-track"><div class="bd-row-fill" style="width:${pct}%"></div></div>
          <input type="number" class="bd-row-input" min="0" step="100"
            data-key="${k}" value="${com}" aria-label="Valor comprometido em ${labels[k] || k}"/>
          <span class="bd-row-est">/ ${formatMoney(est, curr)}</span>
        </div>`;
      }).join('')}
    </div>
    <p class="cost-note">~${formatMoney(Math.round(totalEst / nts), curr)}/dia · valores em ${curr} · comprometido salvo localmente</p>
  `;
  panel.querySelectorAll('.bd-row-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const com2 = loadTripState(trip.id).committed || {};
      com2[inp.dataset.key] = +inp.value || 0;
      saveTripState(trip.id, { committed: com2 });
      // Light re-render: update summary + bars without losing focus
      const tot = Object.values(com2).reduce((a,b) => a+(+b||0), 0);
      panel.querySelectorAll('.bd-summary-v')[1].textContent = formatMoney(tot, curr);
      panel.querySelectorAll('.bd-summary-v')[2].textContent = formatMoney(Math.max(0, totalEst - tot), curr);
      const est = breakdown[inp.dataset.key] || 1;
      const pct = Math.min(100, (com2[inp.dataset.key] / est) * 100);
      inp.parentElement.querySelector('.bd-row-fill').style.width = pct + '%';
    });
  });
}

function populatePacking(node, trip) {
  const panel = node.querySelector('[data-panel="packing"]');
  if (!panel) return;
  const items = trip.packing || defaultPacking(trip);
  const checks = loadTripState(trip.id).packing || {};
  const total = items.length;
  const doneN = items.filter(i => checks[i.id]).length;
  panel.innerHTML = `
    <div class="cl-progress">
      <div class="cl-progress-bar"><div class="cl-progress-fill" style="width:${total?(doneN/total)*100:0}%"></div></div>
      <span class="cl-progress-lbl">${doneN}/${total} itens</span>
    </div>
    <ul class="cl-list pk-list">
      ${items.map(it => `<li class="cl-item${checks[it.id] ? ' done' : ''}">
        <label>
          <input type="checkbox" data-id="${escapeHtml(it.id)}" ${checks[it.id] ? 'checked' : ''}/>
          <span class="cl-label">${escapeHtml(it.label)}</span>
        </label>
      </li>`).join('')}
    </ul>
    <form class="pk-add" data-pk-add>
      <input type="text" placeholder="Adicionar item à bagagem…" maxlength="60" required/>
      <button type="submit">+ Adicionar</button>
    </form>
  `;
  panel.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const c2 = loadTripState(trip.id).packing || {};
      c2[cb.dataset.id] = cb.checked;
      saveTripState(trip.id, { packing: c2 });
      populatePacking(node, trip);
    });
  });
  panel.querySelector('[data-pk-add]').addEventListener('submit', e => {
    e.preventDefault();
    const inp = e.target.querySelector('input');
    const txt = inp.value.trim();
    if (!txt) return;
    const custom = loadTripState(trip.id).packingCustom || [];
    const id = `c${Date.now()}`;
    custom.push({ id, label: txt });
    saveTripState(trip.id, { packingCustom: custom });
    if (!trip.packing) trip.packing = defaultPacking(trip);
    trip.packing.push({ id, label: txt });
    inp.value = '';
    populatePacking(node, trip);
  });
}

function populateInspiration(node, trip) {
  const panel = node.querySelector('[data-panel="inspire"]');
  if (!panel) return;
  const saved = loadTripState(trip.id);
  const links = saved.inspirationLinks ?? trip.inspiration?.links ?? [];
  const images = saved.inspirationImages ?? trip.inspiration?.images ?? trip.gallery ?? [];

  panel.innerHTML = `
    <div class="ins-section">
      <h4>💡 Links de referência</h4>
      <ul class="ins-links">
        ${links.length ? links.map((l, i) => `
          <li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">🔗 ${escapeHtml(l.title || l.url)}</a>
            <button class="ins-del" data-kind="links" data-idx="${i}" aria-label="Remover">×</button></li>
        `).join('') : '<li class="cm-empty">Sem links ainda.</li>'}
      </ul>
      <form class="ins-add" data-ins-add-link>
        <input type="url" placeholder="https://exemplo.com/artigo" required/>
        <input type="text" placeholder="Título (opcional)" maxlength="80"/>
        <button type="submit">+ Link</button>
      </form>
    </div>
    <div class="ins-section">
      <h4>📸 Inspirações visuais</h4>
      <div class="gallery ins-gallery">
        ${images.length ? images.map((src, i) => `
          <div class="ins-img-wrap">
            <img loading="lazy" src="${escapeHtml(src)}" alt="Inspiração para ${escapeHtml(trip.name)}"/>
            <button class="ins-del" data-kind="images" data-idx="${i}" aria-label="Remover">×</button>
          </div>
        `).join('') : '<p class="gallery-empty">Sem imagens. Cole URLs abaixo.</p>'}
      </div>
      <form class="ins-add" data-ins-add-img>
        <input type="url" placeholder="https://.../foto.jpg" required/>
        <button type="submit">+ Imagem</button>
      </form>
    </div>
  `;

  panel.querySelectorAll('.ins-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.kind, idx = +btn.dataset.idx;
      if (k === 'links') {
        const arr = (loadTripState(trip.id).inspirationLinks || links).slice();
        arr.splice(idx, 1);
        saveTripState(trip.id, { inspirationLinks: arr });
      } else {
        const arr = (loadTripState(trip.id).inspirationImages || images).slice();
        arr.splice(idx, 1);
        saveTripState(trip.id, { inspirationImages: arr });
      }
      populateInspiration(node, trip);
    });
  });
  panel.querySelector('[data-ins-add-link]').addEventListener('submit', e => {
    e.preventDefault();
    const [u, t] = e.target.querySelectorAll('input');
    const arr = (loadTripState(trip.id).inspirationLinks || links).slice();
    arr.push({ url:u.value, title:t.value });
    saveTripState(trip.id, { inspirationLinks: arr });
    populateInspiration(node, trip);
  });
  panel.querySelector('[data-ins-add-img]').addEventListener('submit', e => {
    e.preventDefault();
    const u = e.target.querySelector('input');
    const arr = (loadTripState(trip.id).inspirationImages || images).slice();
    arr.push(u.value);
    saveTripState(trip.id, { inspirationImages: arr });
    populateInspiration(node, trip);
  });
}

function populateContext(node, trip) {
  const panel = node.querySelector('[data-panel="context"]');
  if (!panel) return;
  const monthIdx = (trip.month || 1) - 1;
  const climate = trip.weather || CLIMATE_DEFAULT[trip.continent] || [];
  const rain = RAIN_HINT[trip.continent] || [];
  const fx = FX_HINT[trip.country];

  const climateRow = climate.map((c, i) => `
    <div class="wt-cell${i === monthIdx ? ' active' : ''}">
      <div class="wt-mo">${MONTH_NAMES[i]}</div>
      <div class="wt-icon">${rain[i] || '·'}</div>
      <div class="wt-tmp">${c}°</div>
    </div>
  `).join('');

  const fxBlock = fx ? `
    <div class="fx-block">
      <h4>💱 Câmbio aproximado</h4>
      <div class="fx-rate">R$ 1 ≈ ${fx.perBRL.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} ${fx.code}</div>
      <input type="number" class="fx-input" min="0" step="100" value="1000" aria-label="Valor em BRL para conversão" />
      <div class="fx-converted">R$ 1.000 ≈ <span data-fx-out>${Math.round(1000 * fx.perBRL).toLocaleString('pt-BR')}</span> ${fx.code}</div>
      <p class="cost-note">Cotação de referência — confira em tempo real antes de comprar.</p>
    </div>
  ` : '';

  panel.innerHTML = `
    <div class="wt-block">
      <h4>🌦 Clima sazonal · destaque: ${MONTH_NAMES_LONG[monthIdx]}</h4>
      <div class="wt-grid">${climateRow}</div>
      <p class="cost-note">Temperatura média mensal estimada (referência regional).</p>
    </div>
    ${fxBlock}
  `;
  if (fx) {
    const inp = panel.querySelector('.fx-input');
    const out = panel.querySelector('[data-fx-out]');
    inp.addEventListener('input', () => {
      const v = +inp.value || 0;
      out.textContent = Math.round(v * fx.perBRL).toLocaleString('pt-BR');
      panel.querySelector('.fx-converted').firstChild.textContent =
        `R$ ${v.toLocaleString('pt-BR')} ≈ `;
    });
  }
}

function formatMoney(n, c = 'BRL') {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

// ── Leaflet map ──────────────────────────────────────────────────
let map, markerCluster, routeLayer, currentTileLayer;
const TILES = {
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark:  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
};
const TILES_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function initMap() {
  map = L.map('map', {
    zoomControl: true,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 8
  }).setView([15, 0], 2);
  currentTileLayer = L.tileLayer(state.isDark ? TILES.dark : TILES.light, {
    attribution: TILES_ATTR, subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
  markerCluster = L.markerClusterGroup({
    maxClusterRadius: 40,
    iconCreateFunction: cluster => {
      const count = cluster.getChildCount();
      return L.divIcon({
        html: `<div class="cluster-icon">${count}</div>`,
        className: 'cluster-wrap',
        iconSize: [36, 36]
      });
    }
  });
  map.addLayer(markerCluster);
  routeLayer = L.layerGroup().addTo(map);
}

function updateMapTiles() {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  currentTileLayer = L.tileLayer(state.isDark ? TILES.dark : TILES.light, {
    attribution: TILES_ATTR, subdomains: 'abcd', maxZoom: 19
  }).addTo(map);
}

// Home base (used as origin for "next trips" planning lines)
const HOME_BASE = { name:'São Paulo (GRU)', lat:-23.4356, lon:-46.4731 };

function renderMapMarkers(visible) {
  if (!map) return;
  markerCluster.clearLayers();
  routeLayer.clearLayers();
  const bounds = [];

  // For planning view: scale pin size by proximity (closer = bigger ring)
  const planView = isPlanningView();
  const futureDays = visible
    .filter(t => isFutureStatus(t.status))
    .map(t => daysUntil(t))
    .filter(d => d != null && d >= 0);
  const minD = futureDays.length ? Math.min(...futureDays) : 0;
  const maxD = futureDays.length ? Math.max(...futureDays) : 1;

  visible.forEach(trip => {
    const cls = ['pin-marker'];
    if (trip.status === 'planned') cls.push('planned');
    if (trip.status === 'wishlist') cls.push('wishlist');

    let size = 22;
    if (planView && isFutureStatus(trip.status)) {
      const d = daysUntil(trip);
      if (d != null && d >= 0) {
        // Closer = bigger (range 22..34)
        const norm = maxD === minD ? 0 : (d - minD) / (maxD - minD);
        size = Math.round(34 - norm * 12);
        cls.push('near-' + (norm < 0.33 ? 'very' : norm < 0.66 ? 'mid' : 'far'));
      }
    }

    const icon = L.divIcon({
      html: `<div class="${cls.join(' ')}" style="--col:${trip.color}; width:${size}px; height:${size}px"><span class="pin-pulse"></span></div>`,
      className: 'pin-wrap',
      iconSize: [size, size],
      iconAnchor: [size/2, size/2]
    });
    const marker = L.marker([trip.lat, trip.lon], { icon, title: trip.name });
    const d = daysUntil(trip);
    const cdLine = isFutureStatus(trip.status) && d != null && d >= 0
      ? `<div class="lp-meta">⏳ ${formatCountdown(d)}</div>` : '';
    marker.bindPopup(`
      <div class="lp-name">${trip.emoji} ${escapeHtml(trip.name)}</div>
      <div class="lp-sub">${escapeHtml(trip.sub)}</div>
      <div class="lp-meta">${trip.label} · ${trip.nts || '?'} noites</div>
      ${cdLine}
      <a class="lp-link" href="#trip/${trip.id}">Ver detalhes →</a>
    `);
    marker.on('click', () => {
      window.history.replaceState(null, '', `#trip/${trip.id}`);
    });
    markerCluster.addLayer(marker);
    bounds.push([trip.lat, trip.lon]);
  });

  // Planning routes: dashed line GRU → destination for each planned/wishlist trip
  if (planView) {
    visible.filter(t => isFutureStatus(t.status)).forEach(trip => {
      const line = L.polyline(buildArc([HOME_BASE.lat, HOME_BASE.lon], [trip.lat, trip.lon], 30), {
        color: trip.color || '#0ea5e9',
        weight: 2,
        opacity: .55,
        dashArray: '4 6'
      });
      routeLayer.addLayer(line);
    });
    // Mark home base
    routeLayer.addLayer(L.circleMarker([HOME_BASE.lat, HOME_BASE.lon], {
      radius: 5, color:'#0ea5e9', fillColor:'#fff', fillOpacity:1, weight:2
    }).bindTooltip('🏠 ' + HOME_BASE.name));
  }

  // Route arcs for filtered year (historical chronological connection)
  if (state.filters.year !== 'all' && !planView) {
    const yearTrips = visible
      .filter(t => String(t.year) === String(state.filters.year))
      .sort((a, b) => (a.month || 0) - (b.month || 0));
    for (let i = 0; i < yearTrips.length - 1; i++) {
      const a = yearTrips[i], b = yearTrips[i+1];
      const line = L.polyline(buildArc([a.lat, a.lon], [b.lat, b.lon], 20), {
        color: a.color,
        weight: 2,
        opacity: .7,
        dashArray: '6 5'
      });
      routeLayer.addLayer(line);
    }
  }

  if (bounds.length && !map._userInteracted) {
    try { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 5 }); } catch(e){}
  }
}

function buildArc(p1, p2, steps = 20) {
  const [lat1, lon1] = p1, [lat2, lon2] = p2;
  const arc = [];
  const lift = Math.min(20, Math.hypot(lat2-lat1, lon2-lon1) * 0.15);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = lat1 + (lat2 - lat1) * t + Math.sin(Math.PI * t) * lift;
    const lon = lon1 + (lon2 - lon1) * t;
    arc.push([lat, lon]);
  }
  return arc;
}

// Mini-map for trip route tab
function renderMiniMap(host, trip) {
  host.style.height = '240px';
  const m = L.map(host, {
    zoomControl: false, dragging: true, scrollWheelZoom: false, doubleClickZoom: true,
    minZoom: 1, maxZoom: 14
  });
  L.tileLayer(state.isDark ? TILES.dark : TILES.light, {
    attribution: TILES_ATTR, subdomains: 'abcd'
  }).addTo(m);
  const stops = (trip.route && trip.route.length) ? trip.route : [{ name: trip.name, lat: trip.lat, lon: trip.lon }];
  const latlngs = stops.map(s => [s.lat, s.lon]);
  stops.forEach((s, i) => {
    L.marker([s.lat, s.lon], {
      title: s.name,
      icon: L.divIcon({
        html: `<div class="mini-pin" style="background:${trip.color}">${i+1}</div>`,
        className: 'mini-pin-wrap',
        iconSize: [22, 22], iconAnchor: [11, 11]
      })
    }).bindTooltip(s.name).addTo(m);
  });
  if (latlngs.length > 1) {
    L.polyline(latlngs, { color: trip.color, weight: 3, opacity: .8 }).addTo(m);
  }
  if (latlngs.length === 1) {
    m.setView(latlngs[0], 8);
  } else {
    m.fitBounds(latlngs, { padding: [20, 20] });
  }
  // Allow scroll-wheel zoom on focus
  host.addEventListener('click', () => m.scrollWheelZoom.enable());
}

// ── Share ────────────────────────────────────────────────────────
let activeShareTrip = null;
function openShare(trip) {
  activeShareTrip = trip;
  el.shareTitle.textContent = `Compartilhar: ${trip.name}`;
  if (typeof el.shareDialog.showModal === 'function') {
    el.shareDialog.showModal();
  } else {
    el.shareDialog.setAttribute('open','');
  }
}

function buildShareText(trip) {
  const url = `${location.origin}${location.pathname}#trip/${trip.id}`;
  if (trip.status === 'planned' || trip.status === 'wishlist') {
    const d = daysUntil(trip);
    const cd = d != null && d >= 0 ? `⏳ ${formatCountdown(d)}` : '';
    const air = trip.air ? `✈ ${trip.air}` : '';
    const hotels = trip.logistics?.hotels?.length ? `🏨 ${trip.logistics.hotels.join(', ')}` : '';
    const status = trip.status === 'planned' ? '📅 Planejada' : '⭐ Wishlist';
    return [
      `${trip.emoji} ${trip.name} — ${trip.sub}`,
      `${status} · ${trip.label} · ${trip.nts || '?'} noites`,
      cd,
      air,
      hotels,
      trip.highlights?.length ? `Quero ver: ${trip.highlights.join(', ')}` : '',
      '',
      url
    ].filter(Boolean).join('\n');
  }
  return `${trip.emoji} ${trip.name} — ${trip.sub}\n${trip.label} · ${trip.nts || '?'} noites\n\n"${trip.memory || ''}"\n\n${url}`;
}

// ── Calendar export (.ics) ───────────────────────────────────────
function downloadIcs(trip) {
  const start = tripStartDate(trip);
  if (!start) return;
  const end = tripEndDate(trip) || new Date(start.getFullYear(), start.getMonth(), start.getDate() + (trip.nts || 1));
  const fmt = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  // For all-day events we use VALUE=DATE
  const dateOnly = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const summary = `${trip.emoji} ${trip.name}`;
  const desc = [
    `Viagem planejada — ${trip.sub}`,
    trip.air ? `Voo: ${trip.air}` : '',
    `${trip.nts || '?'} noites`,
    `${location.origin}${location.pathname}#trip/${trip.id}`
  ].filter(Boolean).join('\\n');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Minhas Viagens//PT-BR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${trip.id}@minhasviagens`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART;VALUE=DATE:${dateOnly(start)}`,
    `DTEND;VALUE=DATE:${dateOnly(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${trip.sub}`,
    'BEGIN:VALARM',
    'TRIGGER:-P7D',
    'ACTION:DISPLAY',
    `DESCRIPTION:Lembrete: ${trip.name} em 1 semana`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${trip.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast('📆 .ics gerado — abra para adicionar à agenda');
}

// ── Compare mode (side-by-side) ──────────────────────────────────
function openCompare() {
  const trips = state.trips.filter(t => state.compareIds.has(t.id));
  if (trips.length < 2) return;
  const rows = [
    { label:'Status',       fn:t => t.status === 'planned' ? '📅 Planejada' : '⭐ Wishlist' },
    { label:'Quando',       fn:t => t.label },
    { label:'Contagem',     fn:t => { const d=daysUntil(t); return d!=null ? formatCountdown(d) : '—'; } },
    { label:'Noites',       fn:t => t.nts || '?' },
    { label:'Voo',          fn:t => t.air || '—' },
    { label:'Km est.',      fn:t => t.km ? t.km.toLocaleString('pt-BR') : '—' },
    { label:'Tipo',         fn:t => TYPE_NAMES[t.type] || t.type || '—' },
    { label:'Companhia',    fn:t => t.pax || '—' },
    { label:'Temp. média',  fn:t => {
      const c = (t.weather || CLIMATE_DEFAULT[t.continent] || [])[ (t.month||1)-1 ];
      return c != null ? `${c}°C` : '—';
    } },
    { label:'Custo/dia est.', fn:t => {
      const total = t.budget?.total ?? t.cost?.total ?? (t.nts || 1) * 1000;
      return formatMoney(Math.round(total / (t.nts || 1)), t.budget?.currency || 'BRL');
    } },
    { label:'Orçamento total', fn:t => {
      const total = t.budget?.total ?? t.cost?.total ?? (t.nts || 1) * 1000;
      return formatMoney(total, t.budget?.currency || 'BRL');
    } }
  ];
  el.compareGrid.innerHTML = `
    <table class="cmp-table">
      <thead><tr><th></th>${trips.map(t => `<th>${t.emoji} ${escapeHtml(t.name)}</th>`).join('')}</tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <th>${r.label}</th>
          ${trips.map(t => `<td>${escapeHtml(String(r.fn(t)))}</td>`).join('')}
        </tr>`).join('')}
      </tbody>
    </table>
  `;
  if (typeof el.compareDialog.showModal === 'function') el.compareDialog.showModal();
  else el.compareDialog.setAttribute('open', '');
}

function handleShareAction(action) {
  if (!activeShareTrip) return;
  const text = buildShareText(activeShareTrip);
  const url = `${location.origin}${location.pathname}#trip/${activeShareTrip.id}`;
  if (action === 'copy') {
    copyText(text);
    toast('📋 Texto copiado!');
  } else if (action === 'whatsapp') {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  } else if (action === 'x') {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${activeShareTrip.emoji} ${activeShareTrip.name} — ${activeShareTrip.label}`)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener');
  } else if (action === 'native') {
    if (navigator.share) {
      navigator.share({ title: `Minhas Viagens — ${activeShareTrip.name}`, text, url }).catch(()=>{});
    } else {
      copyText(text);
      toast('📋 Sem compartilhamento nativo — texto copiado.');
    }
  }
  el.shareDialog.close?.();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

function toast(msg) {
  el.shareToast.textContent = msg;
  el.shareToast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.shareToast.classList.remove('show'), 2200);
}

// ── Dashboard (Fase 3) ───────────────────────────────────────────
function renderDashboard() {
  const trips = state.trips || [];
  if (!trips.length) return;

  const today = new Date(); today.setHours(0,0,0,0);
  const tripStart = t => t.startDate
    ? new Date(t.startDate + 'T00:00:00')
    : (t.year && t.month ? new Date(t.year, t.month - 1, 1) : null);
  const daysTo = t => { const s = tripStart(t); return s ? Math.round((s - today) / 86400000) : null; };

  const done = trips.filter(t => t.status === 'done')
    .sort((a,b) => (b.year - a.year) || (b.month - a.month));
  const futuras = trips
    .filter(t => ['planned', 'em_planejamento'].includes(t.status))
    .filter(t => { const d = daysTo(t); return d != null && d >= 0; })
    .sort((a,b) => daysTo(a) - daysTo(b));

  // Hero — próxima viagem
  const heroEl = $('#dashHero');
  if (futuras.length) {
    const t = futuras[0];
    heroEl.hidden = false;
    const imgUrl = (t.gallery && t.gallery[0]) || `https://picsum.photos/seed/${encodeURIComponent(t.id)}/1800/1000`;
    $('#dashHeroBg').style.backgroundImage = `url(${imgUrl})`;
    $('#dashHeroEyebrow').textContent = CONTINENT_NAMES[t.continent] || '';
    $('#dashHeroName').textContent = t.name;
    $('#dashHeroDates').textContent = fmtTripDates(t);
    $('#dashHeroPlace').textContent = t.sub || '';
    const d = daysTo(t);
    if (d != null && d >= 0) {
      $('#dashHeroCd').hidden = false;
      $('#dashHeroCdN').textContent = d;
    } else {
      $('#dashHeroCd').hidden = true;
    }
  } else {
    heroEl.hidden = true;
  }

  // Stats
  const countries = new Set(done.map(t => t.country).filter(Boolean));
  const continents = new Set(done.map(t => t.continent).filter(Boolean));
  const totalKm = done.reduce((s,t) => s + (Number(t.km) || 0), 0);
  $('#dashStatTrips').textContent = done.length;
  $('#dashStatCountries').textContent = countries.size;
  $('#dashStatContinents').textContent = continents.size;
  $('#dashStatKm').textContent = Math.round(totalKm / 1000);

  // Alertas
  renderDashAlerts(trips, futuras);

  // Próximas viagens (kanban compacto)
  renderDashKanban(trips);

  // Última memória
  const lastSec = $('#dashLastSection');
  if (done.length) {
    lastSec.hidden = false;
    const t = done[0];
    const imgUrl = (t.gallery && t.gallery[0]) || `https://picsum.photos/seed/${encodeURIComponent(t.id)}/1000/1200`;
    $('#dashLastImg').style.backgroundImage = `url(${imgUrl})`;
    $('#dashLastKicker').textContent = CONTINENT_NAMES[t.continent] || '';
    $('#dashLastName').textContent = t.name;
    $('#dashLastDates').textContent = t.label || '';
    $('#dashLastMemory').textContent = t.memory || '';
  } else {
    lastSec.hidden = true;
  }
}

function fmtTripDates(t) {
  if (t.startDate && t.endDate) {
    return `${formatIsoBR(t.startDate)} → ${formatIsoBR(t.endDate)}`;
  }
  return t.label || '';
}
function formatIsoBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)} ${MONTH_NAMES[parseInt(m) - 1]} ${y}`;
}

function renderDashAlerts(trips, futuras) {
  const alerts = [];

  // Decisões pendentes em viagens futuras
  for (const t of futuras) {
    const dp = t.decisoes_pendentes || [];
    if (dp.length) {
      const critica = dp.find(d => d.criticidade === 'alta') || dp[0];
      alerts.push({
        type: 'warn', ic: '⚠',
        html: `<strong>${t.name}</strong>: ${critica.titulo}`,
        link: { href: `#plan/${t.id}`, label: 'Abrir viagem →' }
      });
    }
  }

  // Viagens em_planejamento sem hospedagem
  const semHotel = futuras.filter(t => t.status === 'em_planejamento'
    && (!t.hospedagem || t.hospedagem.length === 0));
  for (const t of semHotel) {
    const d = daysToTrip(t);
    alerts.push({
      type: 'warn', ic: '🏨',
      html: `<strong>${t.name}</strong> sem hospedagem confirmada (faltam ${d != null ? d + ' dias' : '?'})`,
      link: { href: `#plan/${t.id}`, label: 'Definir →' }
    });
  }

  // Passaporte sem validade conhecida
  if (futuras.some(t => t.country && t.country !== 'Brasil')) {
    alerts.push({
      type: 'info', ic: '🛂',
      html: 'Validade do passaporte ainda não cadastrada — necessária para liberar o Auditor de viagens internacionais.',
    });
  }

  const list = $('#dashAlertsList');
  const sec = $('#dashAlerts');
  if (!alerts.length) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  list.innerHTML = alerts.slice(0, 6).map(a => `
    <div class="dash-alert ${a.type}">
      <span class="dash-alert-ic" aria-hidden="true">${a.ic}</span>
      <div class="dash-alert-text">
        ${a.html}
        ${a.link ? `<br><a class="dash-alert-link" href="${a.link.href}">${a.link.label}</a>` : ''}
      </div>
    </div>
  `).join('');
}

function daysToTrip(t) {
  const today = new Date(); today.setHours(0,0,0,0);
  const s = t.startDate
    ? new Date(t.startDate + 'T00:00:00')
    : (t.year && t.month ? new Date(t.year, t.month - 1, 1) : null);
  return s ? Math.round((s - today) / 86400000) : null;
}

function renderDashKanban(trips) {
  const confirmadas = trips.filter(t => t.status === 'planned')
    .sort((a,b) => (daysToTrip(a) ?? 9e9) - (daysToTrip(b) ?? 9e9));
  const planejando  = trips.filter(t => t.status === 'em_planejamento')
    .sort((a,b) => (daysToTrip(a) ?? 9e9) - (daysToTrip(b) ?? 9e9));
  const wish        = trips.filter(t => t.status === 'wishlist');

  const cd = t => {
    const d = daysToTrip(t);
    if (d == null) return '';
    if (d < 90)   return `${d}d`;
    if (d < 365)  return `${Math.round(d/30)}m`;
    return `${(d/365).toFixed(1)}a`;
  };

  const card = t => {
    const distant = (daysToTrip(t) ?? 0) >= 90;
    return `
      <a class="dash-mini" href="#plan/${t.id}">
        <div class="dash-mini-top">
          <span class="dash-mini-flag"><span class="flag">${t.flag || '📍'}</span>${CONTINENT_NAMES[t.continent] || ''}</span>
          <span class="dash-mini-cd ${distant ? 'distant' : ''}">${cd(t)}</span>
        </div>
        <div class="dash-mini-name">${t.name}</div>
        <div class="dash-mini-meta">${t.label || ''}${t.sub ? ' · ' + t.sub : ''}</div>
      </a>
    `;
  };

  const col = (title, dotClass, ic, items, limit = 3) => `
    <div class="dash-col ${dotClass}">
      <div class="dash-col-head">
        <div class="dash-col-h"><span class="ic ${dotClass}">${ic}</span>${title}</div>
        <div class="dash-col-count">${items.length}</div>
      </div>
      ${items.length
        ? items.slice(0, limit).map(card).join('')
        : '<div class="dash-col-empty">vazio por enquanto</div>'
      }
    </div>
  `;

  $('#dashKanban').innerHTML =
    col('Confirmadas',    'confirmed', '✓', confirmadas) +
    col('Em planejamento','planning',  '◐', planejando) +
    col('Wishlist',       'wish',      '★', wish);
}

// ── Modo Memória (Fase 4a) ───────────────────────────────────────
let memMap, memTileLayer;

function renderMemoria() {
  const trips = state.trips || [];
  const done = trips.filter(t => t.status === 'done')
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));

  // Meta no header
  const countries = new Set(done.map(t => t.country).filter(Boolean));
  const continents = new Set(done.map(t => t.continent).filter(Boolean));
  const totalKm = done.reduce((s, t) => s + (Number(t.km) || 0), 0);
  const meta = $('#memMeta');
  if (meta) meta.textContent =
    `${done.length} viagens · ${countries.size} países · ${continents.size} continentes · ${Math.round(totalKm/1000)} mil km`;

  // Mapa
  if (!memMap) initMemMap(done);
  else { memMap.invalidateSize(); syncMemTile(); }

  // Timeline narrativa
  renderMemTimeline(done);
}

function initMemMap(done) {
  const container = document.getElementById('memMap');
  if (!container || typeof L === 'undefined') return;
  memMap = L.map('memMap', { zoomControl: true, scrollWheelZoom: false, worldCopyJump: true });
  memMap.setView([15, 0], 2);
  syncMemTile();
  done.forEach(t => {
    if (typeof t.lat !== 'number' || typeof t.lon !== 'number') return;
    const icon = L.divIcon({
      className: '',
      html: '<div class="mem-pin"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
    L.marker([t.lat, t.lon], { icon })
      .bindPopup(`<div style="font-weight:700">${t.flag || ''} ${t.name}</div><div style="font-size:11px;opacity:.65">${t.label || ''}</div>`)
      .addTo(memMap);
  });
  // Garante render após view virar visível (Leaflet precisa do container medido)
  setTimeout(() => memMap.invalidateSize(), 100);
}

function syncMemTile() {
  if (!memMap || typeof L === 'undefined') return;
  if (memTileLayer) memMap.removeLayer(memTileLayer);
  memTileLayer = L.tileLayer(state.isDark ? TILES.dark : TILES.light, {
    attribution: TILES_ATTR,
    subdomains: 'abcd',
    maxZoom: 18,
  }).addTo(memMap);
}

function renderMemTimeline(done) {
  const container = $('#memTimeline');
  if (!container) return;

  const porAno = {};
  for (const t of done) (porAno[t.year] ||= []).push(t);
  const anos = Object.keys(porAno).map(Number).sort((a, b) => b - a);

  let altCount = 0;
  container.innerHTML = anos.map(ano => {
    const ents = porAno[ano];
    const entriesHtml = ents.map(t => {
      const side = altCount++ % 2 === 0 ? 'right' : 'left';
      const imgUrl = (t.gallery && t.gallery[0])
        || `https://picsum.photos/seed/${encodeURIComponent(t.id)}/800/600`;
      return `
        <article class="mem-entry ${side}">
          <a class="mem-entry-photo" href="#plan/${t.id}" style="background-image:url(${imgUrl})" aria-label="Abrir ${t.name}"></a>
          <div class="mem-entry-meta">
            <div class="mem-entry-kicker">${t.label || ''} · ${CONTINENT_NAMES[t.continent] || ''}</div>
            <h3 class="mem-entry-name"><a href="#plan/${t.id}">${t.name}</a></h3>
            <div class="mem-entry-sub">${t.sub || ''}</div>
            ${t.memory ? `<p class="mem-entry-memory">${t.memory}</p>` : ''}
            <div class="mem-entry-tags">
              ${t.nts ? `<span class="mem-entry-tag">${t.nts} noites</span>` : ''}
              ${t.pax ? `<span class="mem-entry-tag">${t.pax}</span>` : ''}
              ${t.km ? `<span class="mem-entry-tag">${fmtNumBR(t.km)} km</span>` : ''}
            </div>
          </div>
        </article>
      `;
    }).join('');
    return `
      <div class="mem-year-block">
        <div class="mem-year-marker">
          <span class="mem-year-n">${ano}</span>
          <div class="mem-year-narrative">${yearNarrative(ano, ents)}</div>
        </div>
        ${entriesHtml}
      </div>
    `;
  }).join('');
}

function yearNarrative(year, ents) {
  const continentes = new Set(ents.map(t => CONTINENT_NAMES[t.continent]).filter(Boolean));
  const km = ents.reduce((s, t) => s + (Number(t.km) || 0), 0);
  const tipos = new Set(ents.map(t => t.type).filter(Boolean));
  const parts = [`${ents.length} ${ents.length === 1 ? 'viagem' : 'viagens'}`];
  if (continentes.size) parts.push(`${continentes.size} ${continentes.size === 1 ? 'continente' : 'continentes'}`);
  if (km >= 1000) parts.push(`${fmtNumBR(Math.round(km/1000))} mil km`);
  if (tipos.has('adventure')) parts.push('aventura');
  if (tipos.has('festival')) parts.push('festivais');
  if (tipos.has('luxury')) parts.push('refúgio');
  return parts.join(' · ');
}

function fmtNumBR(n) { return new Intl.NumberFormat('pt-BR').format(n); }

// ── Modo Planejamento (Fase 4b) ──────────────────────────────────
function renderPlanejamento() {
  const trips = state.trips || [];
  const wish        = trips.filter(t => t.status === 'wishlist');
  const planning    = trips.filter(t => t.status === 'em_planejamento');
  const planned     = trips.filter(t => t.status === 'planned');

  // Próximas: planned + daysUntil <= 90 (e >= 0)
  // Confirmadas: planned + daysUntil > 90 (ou daysUntil null = sem data firme)
  const proximas    = planned.filter(t => { const d = daysToTrip(t); return d != null && d >= 0 && d <= 90; })
    .sort((a, b) => (daysToTrip(a) ?? 9e9) - (daysToTrip(b) ?? 9e9));
  const confirmadas = planned.filter(t => !proximas.includes(t))
    .sort((a, b) => (daysToTrip(a) ?? 9e9) - (daysToTrip(b) ?? 9e9));

  // Meta no header
  const meta = $('#planjMeta');
  const total = wish.length + planning.length + planned.length;
  if (meta) meta.textContent =
    `${total} viagens no horizonte · ${proximas.length} próximas · ${confirmadas.length} confirmadas · ${planning.length} em planejamento · ${wish.length} wishlist`;

  // Summary strip — próximo deadline + alertas críticos
  renderPlanjSummary(proximas, confirmadas, planning);

  // Kanban
  const kanban = $('#planjKanban');
  if (kanban) {
    kanban.innerHTML =
      planjCol('Próximas',         'imminent',  '⚡', proximas) +
      planjCol('Confirmadas',      'confirmed', '✓', confirmadas) +
      planjCol('Em planejamento',  'planning',  '◐', planning.sort((a, b) => (daysToTrip(a) ?? 9e9) - (daysToTrip(b) ?? 9e9))) +
      planjCol('Wishlist',         'wish',      '★', wish);

    // Animar progress bars
    setTimeout(() => {
      kanban.querySelectorAll('.planj-card-progress-bar > div').forEach(el => {
        el.style.width = (el.dataset.pct || 0) + '%';
      });
    }, 100);
  }
}

function planjCol(title, dotClass, ic, items) {
  return `
    <div class="planj-col ${dotClass}">
      <div class="planj-col-head">
        <div class="planj-col-h"><span class="ic ${dotClass}">${ic}</span>${title}</div>
        <div class="planj-col-count">${items.length}</div>
      </div>
      ${items.length
        ? items.map(planjCard).join('')
        : '<div class="planj-col-empty">vazio por enquanto</div>'
      }
    </div>
  `;
}

function planjCard(t) {
  const d = daysToTrip(t);
  const cd = d == null ? '' : d < 90 ? `${d}d` : d < 365 ? `${Math.round(d/30)}m` : `${(d/365).toFixed(1)}a`;
  const cdClass = d != null && d <= 90 ? '' : 'distant';
  const imgUrl = (t.gallery && t.gallery[0])
    || `https://picsum.photos/seed/${encodeURIComponent(t.id)}/600/340`;

  // % checklist real (decisões + hospedagem + documentos como proxy de progresso)
  const pct = calcProgress(t);

  // Badges
  const badges = [];
  const decisoes = (t.decisoes_pendentes || []).length;
  if (decisoes) badges.push(`<span class="planj-badge alert">⚠ ${decisoes} decis${decisoes === 1 ? 'ão' : 'ões'}</span>`);

  if (t.status === 'em_planejamento' && (!t.hospedagem || t.hospedagem.length === 0))
    badges.push('<span class="planj-badge warn">🏨 Sem hotel</span>');
  else if (t.hospedagem && t.hospedagem.length > 0)
    badges.push(`<span class="planj-badge ok">🏨 ${t.hospedagem.length}</span>`);

  const docs = (t.documentos_necessarios || []);
  const docsPend = docs.filter(d => !d.obtido).length;
  if (docsPend) badges.push(`<span class="planj-badge info">🛂 ${docsPend} doc${docsPend === 1 ? '' : 's'}</span>`);

  const dates = t.startDate && t.endDate
    ? `${formatIsoBR(t.startDate)} → ${formatIsoBR(t.endDate)}`
    : (t.label || '');

  const targets = ['planned', 'em_planejamento', 'wishlist'].filter(s => s !== t.status);
  const menuItems = targets.map(s => {
    const ic = s === 'planned' ? '✓' : s === 'em_planejamento' ? '◐' : '★';
    return `<button class="planj-action-btn" data-action="move" data-target="${s}" data-trip-id="${t.id}">${ic} Mover para ${statusLabel(s)}</button>`;
  }).join('');

  return `
    <a class="planj-card" href="#plan/${t.id}">
      <div class="planj-card-menu">
        <button class="planj-card-menu-trigger" aria-label="Mais ações" data-action="toggle-menu">⋯</button>
        <div class="planj-card-menu-panel">${menuItems}</div>
      </div>
      <div class="planj-card-photo" style="background-image:url(${imgUrl})">
        ${cd ? `<span class="planj-card-cd-badge ${cdClass}">${cd}</span>` : ''}
      </div>
      <div class="planj-card-body">
        <span class="planj-card-flag"><span class="flag">${t.flag || '📍'}</span>${CONTINENT_NAMES[t.continent] || ''}</span>
        <h4 class="planj-card-name">${t.name}</h4>
        ${t.sub ? `<div class="planj-card-sub">${t.sub}</div>` : ''}
        <div class="planj-card-dates">${dates}</div>
        ${t.status !== 'wishlist' ? `
          <div class="planj-card-progress">
            <div class="planj-card-progress-bar"><div style="width:0%" data-pct="${pct}"></div></div>
            <div class="planj-card-progress-l">Checklist · ${pct}%</div>
          </div>
        ` : ''}
        ${badges.length ? `<div class="planj-card-badges">${badges.join('')}</div>` : ''}
      </div>
    </a>
  `;
}

function renderPlanjSummary(proximas, confirmadas, planning) {
  const sec = $('#planjSummary');
  if (!sec) return;
  const cards = [];

  // Próxima a embarcar
  const todas = [...proximas, ...confirmadas, ...planning]
    .filter(t => { const d = daysToTrip(t); return d != null && d >= 0; })
    .sort((a, b) => daysToTrip(a) - daysToTrip(b));
  if (todas.length) {
    const t = todas[0];
    const d = daysToTrip(t);
    cards.push(`
      <div class="planj-summary-card">
        <span class="planj-summary-ic" aria-hidden="true">⚡</span>
        <div class="planj-summary-text">
          <strong>${t.name}</strong> — próxima a embarcar<br>
          <span class="big">${d}</span> dias · ${t.label || ''}
        </div>
      </div>
    `);
  }

  // Decisões críticas pendentes (criticidade alta)
  const decisoesCritic = todas
    .flatMap(t => (t.decisoes_pendentes || []).filter(d => d.criticidade === 'alta').map(d => ({ trip: t, dec: d })))
    .slice(0, 1);
  if (decisoesCritic.length) {
    const { trip, dec } = decisoesCritic[0];
    cards.push(`
      <div class="planj-summary-card warn">
        <span class="planj-summary-ic" aria-hidden="true">⚠</span>
        <div class="planj-summary-text">
          <strong>${trip.name}</strong>: ${dec.titulo}<br>
          Decisão crítica em aberto
        </div>
      </div>
    `);
  }

  // Em planejamento sem hospedagem
  const semHotel = planning.filter(t => !t.hospedagem || t.hospedagem.length === 0);
  if (semHotel.length) {
    cards.push(`
      <div class="planj-summary-card warn">
        <span class="planj-summary-ic" aria-hidden="true">🏨</span>
        <div class="planj-summary-text">
          <span class="big">${semHotel.length}</span> em planejamento sem hospedagem<br>
          <strong>${semHotel.map(t => t.name).slice(0, 2).join(', ')}${semHotel.length > 2 ? '…' : ''}</strong>
        </div>
      </div>
    `);
  }

  if (cards.length === 0) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  sec.innerHTML = cards.join('');
}

function calcProgress(t) {
  // Heurística: peso de signs de "pronto":
  //  - hospedagem confirmada: +35%
  //  - sem decisoes_pendentes: +25%
  //  - todos documentos_necessarios.obtido: +25%
  //  - transporte definido: +15%
  let p = 0;
  if (t.hospedagem && t.hospedagem.some(h => h.confirmada)) p += 35;
  else if (t.hospedagem && t.hospedagem.length) p += 15;

  const dp = (t.decisoes_pendentes || []).length;
  if (dp === 0) p += 25;
  else if (dp <= 2) p += 10;

  const docs = (t.documentos_necessarios || []);
  if (docs.length && docs.every(d => d.obtido)) p += 25;
  else if (docs.length === 0 && t.country === 'Brasil') p += 25;

  if (t.transporte && t.transporte.length > 0) p += 15;
  else if (t.air) p += 8;

  return Math.min(100, Math.max(0, p));
}

// ── Routing (hash) ───────────────────────────────────────────────
function initRouting() { applyHash(); }

function showView(name) {
  // name: 'dashboard' | 'memoria' | 'planejamento' | 'timeline' | 'plan'
  if (el.dashboardView)     el.dashboardView.hidden     = name !== 'dashboard';
  if (el.timelineView)      el.timelineView.hidden      = name !== 'timeline';
  if (el.memoriaView)       el.memoriaView.hidden       = name !== 'memoria';
  if (el.planejamentoView)  el.planejamentoView.hidden  = name !== 'planejamento';
  // planPage controlled by openPlanPage/closePlanPage
}

function applyHash() {
  const h = location.hash.replace(/^#/, '');

  // Plan page tem precedência
  if (h.startsWith('plan/')) {
    const id = h.slice(5);
    const trip = state.trips.find(t => t.id === id);
    if (trip) { openPlanPage(trip); return; }
  }
  if (state.activePlanId && !h.startsWith('plan/')) closePlanPage();

  // Trip card expandido (timeline)
  if (h.startsWith('trip/')) {
    const id = h.slice(5);
    if (state.trips.find(t => t.id === id)) {
      showView('timeline');
      state.filters.status = 'all';
      syncStatusButtons('all');
      render();
      state.expandedTrip = id;
      const card = el.grid.querySelector(`.card[data-trip-id="${id}"]`);
      if (card) {
        expandCard(card, true);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight');
        setTimeout(() => card.classList.remove('highlight'), 1800);
      }
    }
    return;
  }

  // Modo Memória — view dedicada (Fase 4a)
  if (h === 'memoria') {
    showView('memoria');
    renderMemoria();
    return;
  }

  // Timeline antiga com filtros completos (acessível via "ver tudo com filtros")
  if (h === 'linha-do-tempo' || h === 'timeline') {
    showView('timeline');
    state.filters.status = 'all';
    syncStatusButtons('all');
    render();
    return;
  }

  // Modo Planejamento — Kanban dedicado (Fase 4b)
  if (h === 'planejamento') {
    showView('planejamento');
    renderPlanejamento();
    return;
  }

  // Status diretos (compatibilidade)
  if (h === 'planned' || h === 'wishlist' || h === 'done') {
    showView('timeline');
    state.filters.status = h;
    syncStatusButtons(h);
    render();
    return;
  }

  // Default: dashboard
  showView('dashboard');
  renderDashboard();
}

function syncStatusButtons(status) {
  $$('.status-btn').forEach(x => {
    const a = x.dataset.status === status;
    x.classList.toggle('active', a);
    x.setAttribute('aria-selected', String(a));
  });
}

// ── Dedicated full-screen plan page ──────────────────────────────
function openPlanPage(trip) {
  state.activePlanId = trip.id;
  const tl = document.getElementById('timelineView');
  const pp = document.getElementById('planPage');
  if (!tl || !pp) return;
  tl.hidden = true;
  pp.hidden = false;
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.body.classList.add('plan-page-open');
  hydratePlanPage(trip);
}

function closePlanPage() {
  state.activePlanId = null;
  const tl = document.getElementById('timelineView');
  const pp = document.getElementById('planPage');
  if (!tl || !pp) return;
  pp.hidden = true;
  tl.hidden = false;
  document.body.classList.remove('plan-page-open');
}

function hydratePlanPage(trip) {
  const isWish = trip.status === 'wishlist';
  // Header
  document.getElementById('planPageTitle').textContent = trip.name;
  document.getElementById('planHeroFlag').textContent = trip.emoji || trip.flag || '📍';
  document.getElementById('planHeroSub').textContent = trip.sub || '';

  const start = trip.startDate, end = trip.endDate;
  document.getElementById('planHeroDates').textContent = start
    ? `${formatPtDate(start)}${end ? ' → ' + formatPtDate(end) : ''}` + ` · ${trip.nts || '?'} noites`
    : `${trip.label || ''} · ${trip.nts || '?'} noites`;

  const heroBg = document.getElementById('planHeroBg');
  if (trip.photo) heroBg.style.backgroundImage = `url(${trip.photo})`;
  else heroBg.style.background = `linear-gradient(135deg, ${trip.color || '#0ea5e9'}, ${trip.color2 || '#0369a1'})`;

  // Countdown
  const d = daysUntil(trip);
  const cdN = document.getElementById('planCdN');
  const cdL = document.getElementById('planCdL');
  if (d == null) {
    cdN.textContent = '—'; cdL.textContent = isWish ? 'sem data definida' : '';
  } else if (d < 0) {
    cdN.textContent = Math.abs(d); cdL.textContent = `dias atrás`;
  } else if (d === 0) {
    cdN.textContent = '🎉'; cdL.textContent = 'hoje!';
  } else {
    cdN.textContent = d; cdL.textContent = d === 1 ? 'dia até embarcar' : 'dias até embarcar';
  }

  // Quick stats
  renderPlanQuickstats(trip);

  // Sections
  renderPlanMap(trip);
  renderPlanContext(trip);
  renderPlanChecklist(trip);
  renderPlanReservations(trip);
  renderPlanBudget(trip);
  renderPlanPlanning(trip);
  renderPlanPacking(trip);
  renderPlanInspire(trip);

  // Header actions
  const promo = document.getElementById('ppPromote');
  if (trip.status === 'wishlist') {
    promo.hidden = false; promo.textContent = '📅 Mover para Planejadas';
    promo.onclick = () => { promoteTrip(trip, 'planned'); hydratePlanPage(trip); };
  } else if (trip.status === 'planned') {
    promo.hidden = false; promo.textContent = '✓ Marcar como realizada';
    promo.onclick = () => { promoteTrip(trip, 'done'); closePlanPage(); location.hash = ''; };
  } else {
    promo.hidden = true;
  }

  // Wire generic header actions once
  if (!state.planActionsBound) {
    document.querySelectorAll('[data-pp-action]').forEach(b => {
      b.addEventListener('click', () => {
        const t = state.trips.find(x => x.id === state.activePlanId);
        if (!t) return;
        const action = b.dataset.ppAction;
        if (action === 'ics') downloadIcs(t);
        else if (action === 'share') openShare(t);
        else if (action === 'link') {
          const url = `${location.origin}${location.pathname}#plan/${t.id}`;
          copyText(url); toast('🔗 Link da página copiado!');
        }
      });
    });
    document.getElementById('planBack').addEventListener('click', () => {
      location.hash = '';
    });
    // Extra tabs
    document.querySelectorAll('#planExtraTabs .tab').forEach(t => {
      t.addEventListener('click', () => {
        const target = t.dataset.ppTab;
        document.querySelectorAll('#planExtraTabs .tab').forEach(x => {
          const a = x === t; x.classList.toggle('active', a); x.setAttribute('aria-selected', String(a));
        });
        document.querySelectorAll('[data-pp-panel]').forEach(p => {
          p.hidden = p.dataset.ppPanel !== target;
          p.classList.toggle('active', p.dataset.ppPanel === target);
        });
      });
    });
    state.planActionsBound = true;
  }
}

function renderPlanQuickstats(trip) {
  const host = document.getElementById('planQuickstats');
  const saved = loadTripState(trip.id);

  // Checklist progress
  const items = trip.checklist || defaultChecklist(trip);
  const checks = { ...(saved.checklist || {}), ...(trip.checklistAuto || {}) };
  const doneN = items.filter(i => checks[i.id]).length;
  const total = items.length;
  const pct = total ? Math.round((doneN / total) * 100) : 0;

  // Budget progress
  const nts = trip.nts || 1;
  const totalEst = trip.budget?.total ?? trip.cost?.total ?? nts * 1000;
  const committed = { ...(trip.budget?.committed || {}), ...(saved.committed || {}) };
  const totC = Object.values(committed).reduce((a,b) => a+(+b||0), 0);
  const budgetPct = totalEst ? Math.round((totC / totalEst) * 100) : 0;
  const curr = trip.budget?.currency || trip.cost?.currency || 'BRL';

  // Next pending action
  let pending = items.find(i => !checks[i.id]);

  const stats = [
    { icon:'✅', lbl:'Checklist', v:`${doneN}/${total}`, sub:`${pct}% concluído` },
    { icon:'💰', lbl:'Comprometido', v:formatMoney(totC, curr), sub:`${budgetPct}% de ${formatMoney(totalEst, curr)}` },
    { icon:'🎯', lbl:'Próxima ação', v: pending ? pending.label : '✓ Tudo pronto', sub: pending?.due ? `prazo ${formatPtDate(pending.due)}` : '' },
    { icon:'📍', lbl:'Destino', v:`${trip.flag || ''} ${(trip.country || '').trim()}`, sub:`${CONTINENT_NAMES[trip.continent] || ''}` }
  ];
  host.innerHTML = stats.map(s => `
    <div class="qs" role="listitem">
      <div class="qs-icon" aria-hidden="true">${s.icon}</div>
      <div class="qs-body">
        <div class="qs-lbl">${s.lbl}</div>
        <div class="qs-v">${escapeHtml(String(s.v))}</div>
        <div class="qs-sub">${escapeHtml(s.sub || '')}</div>
      </div>
    </div>
  `).join('');
}

function renderPlanMap(trip) {
  const host = document.getElementById('planMiniMap');
  const list = document.getElementById('planRouteList');
  host.innerHTML = ''; host.dataset.ready = '';
  list.innerHTML = '';
  if (trip.lat == null || trip.lon == null) {
    host.innerHTML = '<p class="cost-note" style="padding:14px">Sem coordenadas para esta viagem.</p>';
    return;
  }
  // Defer leaflet init (offsetParent may be 0 if hidden)
  setTimeout(() => renderMiniMap(host, trip), 50);
  const stops = trip.route && trip.route.length
    ? trip.route
    : [{ name: trip.name, lat: trip.lat, lon: trip.lon }];
  list.innerHTML = stops.map(stop =>
    `<li><span>${escapeHtml(stop.name)}</span><span class="route-coord">${stop.lat.toFixed(2)}, ${stop.lon.toFixed(2)}</span></li>`
  ).join('');
}

function renderPlanContext(trip) {
  // Reuse same logic as the card tab — temporary node + extract innerHTML
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="context"></div>';
  populateContext(tmp, trip);
  document.getElementById('planContext').innerHTML = tmp.firstChild.innerHTML;
  // Re-bind fx input
  const inp = document.querySelector('#planContext .fx-input');
  if (inp) {
    const fx = FX_HINT[trip.country];
    if (fx) {
      const out = document.querySelector('#planContext [data-fx-out]');
      const conv = document.querySelector('#planContext .fx-converted');
      inp.addEventListener('input', () => {
        const v = +inp.value || 0;
        out.textContent = Math.round(v * fx.perBRL).toLocaleString('pt-BR');
        conv.firstChild.textContent = `R$ ${v.toLocaleString('pt-BR')} ≈ `;
      });
    }
  }
}

function renderPlanChecklist(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="checklist"></div>';
  populateChecklist(tmp, trip);
  document.getElementById('planChecklist').innerHTML = tmp.firstChild.innerHTML;
  // Rewire checkboxes
  document.querySelectorAll('#planChecklist input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const c = (loadTripState(trip.id).checklist) || {};
      c[cb.dataset.id] = cb.checked;
      saveTripState(trip.id, { checklist: c });
      renderPlanChecklist(trip);
      renderPlanQuickstats(trip);
    });
  });
}

function renderPlanReservations(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="reservations"></div>';
  populateReservations(tmp, trip);
  document.getElementById('planReservations').innerHTML = tmp.firstChild.innerHTML;
  document.querySelectorAll('#planReservations .rs-status').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = +sel.dataset.idx;
      const list = (loadTripState(trip.id).reservations) || trip.reservations || [];
      list[idx] = { ...list[idx], status: sel.value };
      saveTripState(trip.id, { reservations: list });
      renderPlanReservations(trip);
    });
  });
}

function renderPlanBudget(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="budget"></div>';
  populateBudget(tmp, trip);
  document.getElementById('planBudget').innerHTML = tmp.firstChild.innerHTML;
  document.querySelectorAll('#planBudget .bd-row-input').forEach(inp => {
    inp.addEventListener('input', () => {
      const com = loadTripState(trip.id).committed || {};
      com[inp.dataset.key] = +inp.value || 0;
      saveTripState(trip.id, { committed: com });
      renderPlanQuickstats(trip);
    });
  });
}

function renderPlanPlanning(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="planning"></div>';
  populatePlanning(tmp, trip);
  document.getElementById('planPlanning').innerHTML = tmp.firstChild.innerHTML;
  const ta = document.querySelector('#planPlanning textarea');
  if (ta) ta.addEventListener('input', () => saveTripState(trip.id, { notes: ta.value }));
  // rewire comments
  const form = document.querySelector('#planPlanning [data-comment-form]');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const txt = input.value.trim();
      if (!txt) return;
      const list = loadTripState(trip.id).comments || [];
      list.push({ t: Date.now(), text: txt });
      saveTripState(trip.id, { comments: list });
      input.value = '';
      renderPlanPlanning(trip);
    });
  }
  document.querySelectorAll('#planPlanning .cm-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const all = loadTripState(trip.id).comments || [];
      all.splice(idx, 1);
      saveTripState(trip.id, { comments: all });
      renderPlanPlanning(trip);
    });
  });
}

// Cards de introdução dos agentes (Fase 3) — injetados a cada render
// porque os panels reescrevem innerHTML completo.
const AGENT_INTRO = {
  bagagem: {
    storageKey: 'agent-bagagem-intro-dismissed',
    icon: '🧳',
    title: 'Bagagem',
    what: 'Monta uma lista de bagagem personalizada para sua viagem.',
    when: '1 a 2 semanas antes do embarque.',
    why: 'Evita esquecer itens críticos como passaporte, adaptador e remédios.',
  },
  inspiracao: {
    storageKey: 'agent-inspiracao-intro-dismissed',
    icon: '💡',
    title: 'Inspiração',
    what: 'Sugere destinos com base no seu humor, orçamento e tempo disponível.',
    when: 'Quando bater aquela vontade de viajar mas sem saber para onde.',
    why: 'Transforma vontade vaga em opções concretas de destino.',
  },
};
const agentIntroOpen = { bagagem: false, inspiracao: false };

function mountAgentIntro(panelEl, agentKey) {
  if (!panelEl) return;
  const cfg = AGENT_INTRO[agentKey];
  if (!cfg) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(cfg.storageKey) === 'true'; } catch {}
  const showCard = !dismissed || agentIntroOpen[agentKey];

  const wrap = document.createElement('div');
  wrap.className = 'agent-intro-wrap';
  wrap.innerHTML = `
    <button type="button" class="agent-intro-help" data-agent-help="${agentKey}"
      aria-label="Reabrir explicação sobre o agente ${cfg.title}"
      data-tooltip="O que faz este agente?"
      ${showCard ? 'hidden' : ''}>?</button>
    <section class="agent-intro-card" role="note"
      aria-label="Introdução ao agente ${cfg.title}"
      ${showCard ? '' : 'hidden'}>
      <header class="agent-intro-head">
        <h4 class="agent-intro-title"><span aria-hidden="true">${cfg.icon}</span> Agente ${cfg.title}</h4>
        <button type="button" class="agent-intro-close" data-agent-close="${agentKey}"
          aria-label="Fechar introdução">×</button>
      </header>
      <dl class="agent-intro-list">
        <div><dt>O que faz</dt><dd>${cfg.what}</dd></div>
        <div><dt>Quando usar</dt><dd>${cfg.when}</dd></div>
        <div><dt>Por que existe</dt><dd>${cfg.why}</dd></div>
      </dl>
      <button type="button" class="agent-intro-dismiss" data-agent-dismiss="${agentKey}">
        Entendi, não mostrar mais
      </button>
    </section>
  `;
  panelEl.prepend(wrap);

  wrap.querySelector(`[data-agent-help="${agentKey}"]`)?.addEventListener('click', () => {
    agentIntroOpen[agentKey] = true;
    const card = wrap.querySelector('.agent-intro-card');
    const help = wrap.querySelector('.agent-intro-help');
    card.hidden = false; help.hidden = true;
    card.querySelector('.agent-intro-close')?.focus();
  });
  wrap.querySelector(`[data-agent-close="${agentKey}"]`)?.addEventListener('click', () => {
    agentIntroOpen[agentKey] = false;
    const card = wrap.querySelector('.agent-intro-card');
    const help = wrap.querySelector('.agent-intro-help');
    card.hidden = true;
    help.hidden = !(localStorage.getItem(cfg.storageKey) === 'true');
    if (!help.hidden) help.focus();
  });
  wrap.querySelector(`[data-agent-dismiss="${agentKey}"]`)?.addEventListener('click', () => {
    try { localStorage.setItem(cfg.storageKey, 'true'); } catch {}
    agentIntroOpen[agentKey] = false;
    const card = wrap.querySelector('.agent-intro-card');
    const help = wrap.querySelector('.agent-intro-help');
    card.hidden = true; help.hidden = false;
    help.focus();
  });
}

function renderPlanPacking(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="packing"></div>';
  populatePacking(tmp, trip);
  document.getElementById('planPacking').innerHTML = tmp.firstChild.innerHTML;
  mountAgentIntro(document.getElementById('planPacking'), 'bagagem');
  document.querySelectorAll('#planPacking input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => {
      const c = loadTripState(trip.id).packing || {};
      c[cb.dataset.id] = cb.checked;
      saveTripState(trip.id, { packing: c });
      renderPlanPacking(trip);
    });
  });
  const form = document.querySelector('#planPacking [data-pk-add]');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const inp = e.target.querySelector('input');
      const txt = inp.value.trim();
      if (!txt) return;
      const custom = loadTripState(trip.id).packingCustom || [];
      const id = `c${Date.now()}`;
      custom.push({ id, label: txt });
      saveTripState(trip.id, { packingCustom: custom });
      if (!trip.packing) trip.packing = defaultPacking(trip);
      trip.packing.push({ id, label: txt });
      inp.value = '';
      renderPlanPacking(trip);
    });
  }
}

function renderPlanInspire(trip) {
  const tmp = document.createElement('div');
  tmp.innerHTML = '<div data-panel="inspire"></div>';
  populateInspiration(tmp, trip);
  document.getElementById('planInspire').innerHTML = tmp.firstChild.innerHTML;
  mountAgentIntro(document.getElementById('planInspire'), 'inspiracao');
  // Rewire forms/buttons inside
  document.querySelectorAll('#planInspire .ins-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.kind, idx = +btn.dataset.idx;
      const key = k === 'links' ? 'inspirationLinks' : 'inspirationImages';
      const arr = (loadTripState(trip.id)[key] || []).slice();
      arr.splice(idx, 1);
      saveTripState(trip.id, { [key]: arr });
      renderPlanInspire(trip);
    });
  });
  const fL = document.querySelector('#planInspire [data-ins-add-link]');
  if (fL) fL.addEventListener('submit', e => {
    e.preventDefault();
    const [u, t] = e.target.querySelectorAll('input');
    const arr = (loadTripState(trip.id).inspirationLinks || []).slice();
    arr.push({ url: u.value, title: t.value });
    saveTripState(trip.id, { inspirationLinks: arr });
    renderPlanInspire(trip);
  });
  const fI = document.querySelector('#planInspire [data-ins-add-img]');
  if (fI) fI.addEventListener('submit', e => {
    e.preventDefault();
    const u = e.target.querySelector('input');
    const arr = (loadTripState(trip.id).inspirationImages || []).slice();
    arr.push(u.value);
    saveTripState(trip.id, { inspirationImages: arr });
    renderPlanInspire(trip);
  });
}

// ── PWA ──────────────────────────────────────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // v2.0: SW migrado para Workbox em src/pwa/sw-workbox.js (registrado por src/main.js).
    // O sw.js antigo virou stub auto-destrutivo — não registramos mais aqui.
  });
}

let deferredPrompt = null;
function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    el.installBtn.hidden = false;
  });
  el.installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') el.installBtn.hidden = true;
    deferredPrompt = null;
  });
  window.addEventListener('appinstalled', () => {
    el.installBtn.hidden = true;
  });
}

// ── Cluster icon styles (injected) ───────────────────────────────
const injStyle = document.createElement('style');
injStyle.textContent = `
.cluster-wrap { background: transparent; }
.cluster-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: linear-gradient(135deg, #0ea5e9, #0369a1);
  color: white;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: .82rem;
  border: 3px solid white;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
}
.pin-wrap, .mini-pin-wrap { background: transparent; border: 0; }
.mini-pin {
  width: 22px; height: 22px; border-radius: 50%;
  color: white; font-weight: 700; font-size: .68rem;
  display: flex; align-items: center; justify-content: center;
  border: 2.5px solid white;
  box-shadow: 0 2px 4px rgba(0,0,0,.3);
}
`;
document.head.appendChild(injStyle);

// Track if user interacted with map to avoid auto-fitBounds resetting view
function trackMapInteraction() {
  if (!map) return;
  ['dragstart','zoomstart'].forEach(evt => map.on(evt, () => { map._userInteracted = true; }));
}
setTimeout(trackMapInteraction, 100);

// ── Tour guiado (Fase 4) ─────────────────────────────────────────
const TOUR_STEPS = [
  {
    type: 'welcome',
    title: 'Olá!',
    body: 'Esse é o portfólio de viagens do Eduardo. Quer um tour rápido de 30 segundos pelo site?',
    primary: 'Sim, me mostre',
    secondary: 'Já conheço, obrigado',
  },
  {
    selector: '.dash-stats',
    title: '📊 Visão geral',
    body: 'Aqui você vê quantas viagens já aconteceram, quantos países foram visitados e quantos quilômetros voei.',
    position: 'bottom',
  },
  {
    selector: '.dash-mode-memoria',
    title: '📖 Modo Memória',
    body: 'O modo Memória reúne tudo o que já aconteceu: mapa interativo (pins coloridos = realizadas, tracejados = planejadas/wishlist) e a linha do tempo cronológica das viagens.',
    position: 'top',
  },
  {
    selector: '.dash-mode-plano',
    title: '🗺 Modo Planejamento',
    body: 'O modo Planejamento mostra as próximas viagens em formato kanban, com filtros por continente, duração, tipo e companhia. Útil quando o portfólio cresce.',
    position: 'top',
  },
  {
    type: 'desc',
    title: '🧳 Bagagem e 💡 Inspiração',
    body: 'Ao abrir qualquer viagem (clique num card ou pin do mapa), você encontra os agentes Bagagem (monta lista de mala personalizada) e Inspiração (sugere destinos com base em humor, orçamento e tempo).',
  },
  {
    type: 'desc',
    title: '⚖ Comparar destinos',
    body: 'Em qualquer lista de viagens, o botão ⚖ Comparar coloca duas ou mais viagens lado a lado. Ótimo para decidir o próximo destino.',
  },
  {
    selector: '#tourBtn',
    title: 'Pronto! 🎉',
    body: 'Agora é explorar. Esse botão 🎬 Tour no menu superior fica sempre disponível se quiser rever a apresentação.',
    position: 'bottom',
    final: true,
  },
];

const TourState = { idx: 0, els: null, active: false, lastFocused: null };

function tourBuildEls() {
  const spotlight = document.createElement('div');
  spotlight.className = 'tour-spotlight';
  spotlight.hidden = true;
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay-only';
  overlay.hidden = true;
  overlay.addEventListener('click', (e) => { e.stopPropagation(); });
  const balloon = document.createElement('div');
  balloon.className = 'tour-balloon';
  balloon.setAttribute('role', 'dialog');
  balloon.setAttribute('aria-live', 'polite');
  balloon.setAttribute('aria-modal', 'true');
  balloon.setAttribute('aria-labelledby', 'tour-balloon-title');
  document.body.append(overlay, spotlight, balloon);
  TourState.els = { overlay, spotlight, balloon };
}

function tourFocusables() {
  if (!TourState.els) return [];
  return Array.from(
    TourState.els.balloon.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((n) => !n.hasAttribute('disabled') && n.offsetParent !== null);
}

function tourTearDown() {
  document.removeEventListener('keydown', tourOnKey);
  window.removeEventListener('resize', tourReposition);
  window.removeEventListener('scroll', tourReposition);
  if (TourState.els) {
    TourState.els.overlay.remove();
    TourState.els.spotlight.remove();
    TourState.els.balloon.remove();
    TourState.els = null;
  }
  TourState.active = false;
  // Devolve o foco para o elemento que abriu o tour.
  if (TourState.lastFocused && typeof TourState.lastFocused.focus === 'function') {
    try { TourState.lastFocused.focus(); } catch {}
  }
  TourState.lastFocused = null;
}

function tourEnd({ completed = false } = {}) {
  try {
    localStorage.setItem(completed ? 'tour-completed' : 'tour-skipped', 'true');
  } catch {}
  tourTearDown();
}

function tourPositionBalloon(targetRect, position) {
  const b = TourState.els.balloon;
  b.style.left = ''; b.style.top = ''; b.style.right = ''; b.style.bottom = '';
  b.removeAttribute('data-tour-modal');
  if (!targetRect) {
    b.setAttribute('data-tour-modal', 'true');
    return;
  }
  const margin = 14;
  const bw = b.offsetWidth || 320;
  const bh = b.offsetHeight || 180;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top, left;
  const placeBelow = position === 'bottom' || (position !== 'top' && targetRect.top < vh / 2);
  if (placeBelow && targetRect.bottom + margin + bh < vh) {
    top = targetRect.bottom + margin;
  } else if (targetRect.top - margin - bh > 0) {
    top = targetRect.top - margin - bh;
  } else {
    top = Math.max(margin, vh - bh - margin);
  }
  left = targetRect.left + (targetRect.width / 2) - (bw / 2);
  left = Math.max(margin, Math.min(left, vw - bw - margin));
  b.style.top = `${Math.round(top)}px`;
  b.style.left = `${Math.round(left)}px`;
}

function tourPositionSpotlight(rect) {
  const s = TourState.els.spotlight;
  if (!rect) { s.hidden = true; return; }
  s.hidden = false;
  const pad = 6;
  s.style.top = `${rect.top - pad}px`;
  s.style.left = `${rect.left - pad}px`;
  s.style.width = `${rect.width + pad * 2}px`;
  s.style.height = `${rect.height + pad * 2}px`;
}

function tourReposition() {
  if (!TourState.active || !TourState.els) return;
  const step = TOUR_STEPS[TourState.idx];
  if (!step) return;
  if (step.type === 'welcome' || step.type === 'desc') {
    TourState.els.spotlight.hidden = true;
    TourState.els.overlay.hidden = false;
    tourPositionBalloon(null);
    return;
  }
  const target = step.selector && document.querySelector(step.selector);
  if (!target || target.offsetParent === null) {
    TourState.els.spotlight.hidden = true;
    TourState.els.overlay.hidden = false;
    tourPositionBalloon(null);
    return;
  }
  const rect = target.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    requestAnimationFrame(() => requestAnimationFrame(tourReposition));
    return;
  }
  TourState.els.overlay.hidden = true;
  tourPositionSpotlight(rect);
  tourPositionBalloon(rect, step.position);
}

function tourRender() {
  const step = TOUR_STEPS[TourState.idx];
  if (!step) return;
  const b = TourState.els.balloon;
  const total = TOUR_STEPS.length;
  const isFirst = TourState.idx === 0;
  const isLast = !!step.final;
  const primaryLabel = step.primary || (isLast ? 'Concluir' : 'Próximo');
  const secondaryLabel = step.secondary || 'Anterior';
  b.innerHTML = `
    ${isFirst ? '' : '<button type="button" class="tour-skip" data-tour-act="skip">Sair do tour ✕</button>'}
    <h4 id="tour-balloon-title">${step.title}</h4>
    <p>${step.body}</p>
    <div class="tour-meta">
      <span class="tour-counter">${TourState.idx + 1} de ${total}</span>
      <div class="tour-btns">
        ${isFirst
          ? `<button type="button" class="tour-btn" data-tour-act="end">${secondaryLabel}</button>`
          : (TourState.idx > 0
              ? `<button type="button" class="tour-btn" data-tour-act="prev">${secondaryLabel}</button>`
              : '')}
        <button type="button" class="tour-btn tour-btn-primary" data-tour-act="next">${primaryLabel}</button>
      </div>
    </div>
  `;
  b.querySelectorAll('[data-tour-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.tourAct;
      if (act === 'next') return tourNext();
      if (act === 'prev') return tourPrev();
      if (act === 'skip') return tourEnd({ completed: false });
      if (act === 'end') return tourEnd({ completed: false });
    });
  });
  tourReposition();
  setTimeout(() => b.querySelector('.tour-btn-primary')?.focus(), 50);
}

function tourNext() {
  const step = TOUR_STEPS[TourState.idx];
  if (step?.final) return tourEnd({ completed: true });
  if (TourState.idx < TOUR_STEPS.length - 1) {
    TourState.idx++;
    tourRender();
  } else {
    tourEnd({ completed: true });
  }
}
function tourPrev() {
  if (TourState.idx > 0) {
    TourState.idx--;
    tourRender();
  }
}
function tourOnKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); tourEnd({ completed: false }); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); tourPrev(); return; }
  if (e.key === 'Tab') {
    const items = tourFocusables();
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && (current === first || !items.includes(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !items.includes(current))) {
      e.preventDefault();
      first.focus();
    }
  }
}
function startTour({ force = false } = {}) {
  if (TourState.active) return;
  if (location.hash && location.hash !== '#dashboard' && location.hash !== '#') {
    location.hash = '#dashboard';
  }
  TourState.lastFocused = document.activeElement;
  setTimeout(() => {
    TourState.idx = 0;
    TourState.active = true;
    tourBuildEls();
    tourRender();
    document.addEventListener('keydown', tourOnKey);
    window.addEventListener('resize', tourReposition);
    window.addEventListener('scroll', tourReposition, { passive: true });
  }, force ? 50 : 200);
}
function maybeStartTourFirstVisit() {
  try {
    if (localStorage.getItem('tour-completed') === 'true') return;
    if (localStorage.getItem('tour-skipped') === 'true') return;
  } catch { return; }
  if (location.hash && location.hash !== '#dashboard' && location.hash !== '#') return;
  setTimeout(() => {
    const dash = document.getElementById('dashboardView');
    if (dash && !dash.hidden) startTour({ force: true });
  }, 900);
}
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('tourBtn');
  if (btn) btn.addEventListener('click', () => startTour({ force: true }));
});

// ── Help dialog (Fase 5) ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('helpBtn');
  const dlg = document.getElementById('helpDialog');
  if (!btn || !dlg) return;
  btn.addEventListener('click', () => {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  // Fechar ao clicar no backdrop (fora do .help-sheet)
  dlg.addEventListener('click', (e) => {
    const sheet = dlg.querySelector('.help-sheet');
    if (!sheet) return;
    const r = sheet.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right
                && e.clientY >= r.top  && e.clientY <= r.bottom;
    if (!inside) dlg.close();
  });
});

// ── Tooltips em mobile (Fase 2) ──────────────────────────────────
// Touch dispara tooltip por ~2s via classe .tt-show; em desktop o
// :hover/:focus-visible do CSS já cuida sozinho.
(() => {
  let activeEl = null;
  let activeTimer = null;
  const hide = () => {
    if (activeEl) activeEl.classList.remove('tt-show');
    activeEl = null;
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
  };
  document.addEventListener('touchstart', (e) => {
    const el = e.target.closest('[data-tooltip]');
    if (!el) { hide(); return; }
    if (activeEl && activeEl !== el) hide();
    activeEl = el;
    el.classList.add('tt-show');
    if (activeTimer) clearTimeout(activeTimer);
    activeTimer = setTimeout(hide, 2000);
  }, { passive: true });
  document.addEventListener('scroll', hide, { passive: true, capture: true });
})();

// ── Go! ──────────────────────────────────────────────────────────
boot().then(() => maybeStartTourFirstVisit()).catch(() => maybeStartTourFirstVisit());
