// =================================================================
// Minhas Viagens — app.js
// =================================================================

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const CONTINENT_NAMES = {
  Asia: 'Ásia', Europe: 'Europa', Americas: 'Américas',
  Africa: 'África', Oceania: 'Oceania'
};
const TYPE_NAMES = {
  leisure: 'Lazer', business: 'Trabalho/Evento',
  festival: 'Festival', adventure: 'Aventura'
};

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
  document.documentElement.setAttribute('data-dark', String(state.isDark));
  el.darkBtn.setAttribute('aria-pressed', String(state.isDark));
  el.darkIcon.textContent = state.isDark ? '☀' : '🌙';
  el.darkLbl.textContent = state.isDark ? 'Claro' : 'Escuro';
}
function toggleTheme() {
  state.isDark = !state.isDark;
  localStorage.setItem('theme', state.isDark ? 'dark' : 'light');
  applyTheme();
  if (map) updateMapTiles();
}

// ── Events ───────────────────────────────────────────────────────
function bindEvents() {
  el.darkBtn.addEventListener('click', toggleTheme);

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

  // Hash routing
  window.addEventListener('hashchange', applyHash);
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
  renderCards(visible);
  renderActiveChips();
  renderMapMarkers(visible);
  updateAdvCount();
  el.secCount.textContent = `${visible.length} viage${visible.length === 1 ? 'm' : 'ns'}`;
  el.noResults.classList.toggle('show', visible.length === 0);
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
  const sorted = [...visible].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return (b.month || 0) - (a.month || 0);
  });
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

function hydrateCard(node, trip) {
  node.dataset.tripId = trip.id;
  node.classList.toggle('planned', trip.status !== 'done');
  node.style.setProperty('--stripe', trip.color);

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
  node.querySelector('[data-hero-name]').textContent = trip.name;
  node.querySelector('[data-hero-sub]').textContent = trip.sub;

  node.querySelector('[data-name]').textContent = trip.name;
  node.querySelector('[data-date]').textContent = trip.label;
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

  // Tab content (lazy for route/cost/etc.)
  const exp = node.querySelector('[data-exp]');
  populateDiary(node, trip);
  populateLogistics(node, trip);
  populateCost(node, trip);
  populateGallery(node, trip);
  populateRouteList(node, trip);

  // Toggle expand
  const toggleBtn = node.querySelector('[data-toggle]');
  toggleBtn.addEventListener('click', () => {
    const open = exp.hidden;
    expandCard(node, open);
    if (open) {
      window.history.replaceState(null, '', `#trip/${trip.id}`);
      // Lazy mini-map when route tab opens later
    } else if (location.hash.startsWith('#trip/')) {
      window.history.replaceState(null, '', location.pathname);
    }
  });

  // Tabs
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
        if (!miniHost.dataset.ready) {
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

function populateRouteList(node, trip) {
  const list = node.querySelector('[data-route-list]');
  list.innerHTML = (trip.route || []).map(stop =>
    `<li><span>${escapeHtml(stop.name)}</span><span class="route-coord">${stop.lat.toFixed(2)}, ${stop.lon.toFixed(2)}</span></li>`
  ).join('');
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

function renderMapMarkers(visible) {
  if (!map) return;
  markerCluster.clearLayers();
  routeLayer.clearLayers();
  const bounds = [];
  visible.forEach(trip => {
    const cls = ['pin-marker'];
    if (trip.status === 'planned') cls.push('planned');
    if (trip.status === 'wishlist') cls.push('wishlist');
    const icon = L.divIcon({
      html: `<div class="${cls.join(' ')}" style="--col:${trip.color}"><span class="pin-pulse"></span></div>`,
      className: 'pin-wrap',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
    const marker = L.marker([trip.lat, trip.lon], { icon, title: trip.name });
    marker.bindPopup(`
      <div class="lp-name">${trip.emoji} ${escapeHtml(trip.name)}</div>
      <div class="lp-sub">${escapeHtml(trip.sub)}</div>
      <div class="lp-meta">${trip.label} · ${trip.nts || '?'} noites</div>
      <a class="lp-link" href="#trip/${trip.id}">Ver detalhes →</a>
    `);
    marker.on('click', () => {
      window.history.replaceState(null, '', `#trip/${trip.id}`);
    });
    markerCluster.addLayer(marker);
    bounds.push([trip.lat, trip.lon]);
  });

  // Route arcs for filtered year
  if (state.filters.year !== 'all') {
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
  return `${trip.emoji} ${trip.name} — ${trip.sub}\n${trip.label} · ${trip.nts || '?'} noites\n\n"${trip.memory || ''}"\n\n${url}`;
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

// ── Routing (hash) ───────────────────────────────────────────────
function initRouting() { applyHash(); }
function applyHash() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('trip/')) {
    const id = h.slice(5);
    if (state.trips.find(t => t.id === id)) {
      state.expandedTrip = id;
      const card = el.grid.querySelector(`.card[data-trip-id="${id}"]`);
      if (card) {
        expandCard(card, true);
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight');
        setTimeout(() => card.classList.remove('highlight'), 1800);
      }
    }
  } else if (h === 'planned' || h === 'wishlist' || h === 'done') {
    state.filters.status = h;
    $$('.status-btn').forEach(x => {
      const a = x.dataset.status === h;
      x.classList.toggle('active', a); x.setAttribute('aria-selected', String(a));
    });
    render();
  }
}

// ── PWA ──────────────────────────────────────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW register fail', err));
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

// ── Go! ──────────────────────────────────────────────────────────
boot();
