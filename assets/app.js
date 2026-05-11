/* ═══════════════════════════════════════════════════════════════
   VIAGENS APP — Main Module
   Eduardo Campos · Investment Advisor · Traveler
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────
let allTrips = [];
let filteredTrips = [];
let mainMap = null;
let markerLayer = null;
let miniMaps = {};
let deferredInstall = null;
let activeFilters = {
  status:    'all',
  year:      null,
  continent: 'all',
  search:    '',
  month:     '',
  duration:  '',
  type:      '',
  pax:       '',
  maxYear:   2027,
};

const CONTINENT_COLORS = {
  Americas: '#22c55e',
  Europe:   '#3b82f6',
  Asia:     '#06b6d4',
  Africa:   '#f97316',
  Oceania:  '#a855f7',
};

// ── DOM helpers ───────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function fmt(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'k';
  return String(n);
}

function flagForCountry(country) {
  const flags = {
    Brasil: '🇧🇷', Chile: '🇨🇱', Argentina: '🇦🇷', Colombia: '🇨🇴',
    México: '🇲🇽', Portugal: '🇵🇹', Grécia: '🇬🇷', Uruguay: '🇺🇾',
    Indonesia: '🇮🇩', Thailand: '🇹🇭', Italy: '🇮🇹', Japan: '🇯🇵',
    Peru: '🇵🇪', 'Costa Rica': '🇨🇷', 'South Africa': '🇿🇦',
    Morocco: '🇲🇦', Norway: '🇳🇴',
  };
  return flags[country] || '🌍';
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  restoreDarkMode();
  restoreTheme();
  setupPWA();

  try {
    const res = await fetch('data/trips.json');
    const data = await res.json();
    allTrips = data.trips || [];
    window.__trips = allTrips;
  } catch (e) {
    console.error('Failed to load trips.json:', e);
    allTrips = [];
    window.__trips = [];
  }

  initMap();
  renderStats();
  renderYearTimeline();
  renderCards();
  setupControls();
  setupShareDialog();
  setupScrollToTop();
  checkPermalink();
}

// ── Dark Mode ─────────────────────────────────────────────────────
function restoreDarkMode() {
  const dark = localStorage.getItem('darkMode') === 'true';
  document.documentElement.setAttribute('data-dark', dark ? 'true' : 'false');
  const btn = $('dark-toggle');
  if (btn) btn.textContent = dark ? '☀️ Claro' : '🌙 Escuro';
}

function toggleDark() {
  const html = document.documentElement;
  const isDark = html.getAttribute('data-dark') === 'true';
  html.setAttribute('data-dark', isDark ? 'false' : 'true');
  localStorage.setItem('darkMode', !isDark);
  const btn = $('dark-toggle');
  if (btn) btn.textContent = !isDark ? '☀️ Claro' : '🌙 Escuro';
}

// ── Theme (sketchy) ───────────────────────────────────────────────
function restoreTheme() {
  const theme = localStorage.getItem('theme') || 'default';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('theme-toggle');
  if (btn) btn.textContent = theme === 'sketchy' ? '🗺️ Normal' : '✏️ Diário';
}

function toggleTheme() {
  const html = document.documentElement;
  const current = html.getAttribute('data-theme') || 'default';
  const next = current === 'sketchy' ? 'default' : 'sketchy';
  html.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = $('theme-toggle');
  if (btn) btn.textContent = next === 'sketchy' ? '🗺️ Normal' : '✏️ Diário';
  if (window.sketchy && typeof window.sketchy.onThemeChange === 'function') {
    window.sketchy.onThemeChange(next);
  }
}

// ── Stats ─────────────────────────────────────────────────────────
function renderStats() {
  const done = allTrips.filter(t => t.status === 'done');
  const countries = new Set(done.map(t => t.country)).size;
  const continents = new Set(done.map(t => t.continent)).size;
  const nights = done.reduce((s, t) => s + (t.nts || 0), 0);
  const km = done.reduce((s, t) => s + (t.km || 0), 0);
  const planned = allTrips.filter(t => t.status === 'planned' || t.status === 'wishlist').length;

  setStatEl('stat-trips',      done.length);
  setStatEl('stat-countries',  countries);
  setStatEl('stat-continents', continents);
  setStatEl('stat-nights',     nights);
  setStatEl('stat-km',         fmt(km));
  setStatEl('stat-planned',    planned);
}

function setStatEl(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

// ── Leaflet Main Map ──────────────────────────────────────────────
function initMap() {
  if (!window.L) { console.warn('Leaflet not loaded'); return; }

  mainMap = L.map('map', {
    center: [15, 10], zoom: 2,
    zoomControl: true, scrollWheelZoom: false,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap',
  }).addTo(mainMap);

  L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
    .addTo(mainMap);

  markerLayer = L.layerGroup().addTo(mainMap);
  renderMapMarkers(allTrips);
}

function renderMapMarkers(trips) {
  if (!mainMap || !markerLayer) return;
  markerLayer.clearLayers();

  trips.forEach(trip => {
    if (!trip.lat || !trip.lon) return;
    const col = trip.col || CONTINENT_COLORS[trip.continent] || '#888';
    const isDash = trip.status !== 'done';

    const icon = L.divIcon({
      className: '',
      html: `<div class="custom-marker ${isDash ? trip.status : ''}"
               style="background:${col};${isDash ? `border:3px dashed ${col};background:transparent;color:${col}` : ''}"
               title="${trip.name}">${trip.flag || trip.emoji || '📍'}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -16],
    });

    const marker = L.marker([trip.lat, trip.lon], { icon });

    marker.bindPopup(`
      <div style="min-width:140px">
        <div style="font-weight:700;font-size:.88rem">${trip.flag || ''} ${trip.name}</div>
        <div style="color:var(--text3);font-size:.72rem">${trip.label}</div>
        <div style="font-size:.75rem;margin-top:.3rem">${trip.sub}</div>
        ${trip.nts ? `<div style="font-size:.7rem;margin-top:.25rem">🌙 ${trip.nts} noites</div>` : ''}
      </div>
    `, { maxWidth: 220 });

    marker.on('click', () => {
      const card = document.querySelector(`[data-trip-id="${trip.id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (!card.classList.contains('expanded')) toggleCard(card);
      }
    });

    markerLayer.addLayer(marker);
  });
}

// ── Mini Maps ─────────────────────────────────────────────────────
function initMiniMap(containerId, trip) {
  if (!window.L || miniMaps[containerId]) return;

  const el = $(containerId);
  if (!el) return;

  const m = L.map(containerId, {
    center: [trip.lat, trip.lon], zoom: 6,
    zoomControl: false, attributionControl: false,
    dragging: false, touchZoom: false, scrollWheelZoom: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m);

  const col = trip.col || CONTINENT_COLORS[trip.continent] || '#888';
  L.circleMarker([trip.lat, trip.lon], {
    radius: 8, fillColor: col, color: '#fff',
    weight: 2, fillOpacity: 1,
  }).addTo(m);

  miniMaps[containerId] = m;
  setTimeout(() => m.invalidateSize(), 100);
}

// ── Year Timeline ─────────────────────────────────────────────────
function renderYearTimeline() {
  const container = $('ytl-track');
  if (!container) return;

  const years = [...new Set(
    allTrips.filter(t => t.status === 'done').map(t => t.year)
  )].sort();

  container.innerHTML = years.map(yr => {
    const count = allTrips.filter(t => t.year === yr && t.status === 'done').length;
    return `
      <div class="ytl-dot" data-year="${yr}" title="${count} viagem(ns) em ${yr}">
        <div class="ytl-circle">${count}</div>
        <div class="ytl-year">${yr}</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.ytl-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const yr = parseInt(dot.dataset.year);
      if (activeFilters.year === yr) {
        activeFilters.year = null;
        dot.classList.remove('active');
      } else {
        activeFilters.year = yr;
        container.querySelectorAll('.ytl-dot').forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
      }
      applyFilters();
    });
  });
}

// ── Render Cards ──────────────────────────────────────────────────
function renderCards() {
  const tpl = $('tpl-trip-card');
  const grid = $('trip-grid');
  const noRes = $('no-results');
  const secCount = $('sec-count');

  if (!grid) return;

  grid.innerHTML = '';

  const trips = filteredTrips.length || activeFiltersActive() ? filteredTrips : allTrips;

  if (secCount) secCount.textContent = trips.length;

  if (!trips.length) {
    if (noRes) noRes.style.display = 'block';
    return;
  }
  if (noRes) noRes.style.display = 'none';

  trips.forEach((trip, idx) => {
    let card;
    if (tpl) {
      card = tpl.content.cloneNode(true).querySelector('.card');
    } else {
      card = buildCardElement(trip);
    }
    if (!card) return;

    fillCard(card, trip);
    card.style.animationDelay = `${idx * 30}ms`;
    grid.appendChild(card);
  });
}

function activeFiltersActive() {
  return activeFilters.status !== 'all'
    || activeFilters.year !== null
    || activeFilters.continent !== 'all'
    || activeFilters.search !== ''
    || activeFilters.month !== ''
    || activeFilters.duration !== ''
    || activeFilters.type !== ''
    || activeFilters.pax !== '';
}

function buildCardElement(trip) {
  const div = document.createElement('div');
  div.innerHTML = `
    <article class="card" data-trip-id="${trip.id}" data-status="${trip.status}">
      <div class="card-stripe" style="--stripe-col:${trip.col || '#22c55e'}"></div>
      <div class="card-body">
        <div class="card-hero">
          <div class="card-emoji">${trip.emoji || '🌍'}</div>
          <div class="card-info" style="flex:1;min-width:0">
            <button class="card-toggle" aria-expanded="false" aria-controls="exp-${trip.id}">
              <div class="card-row1">
                <span class="card-name">${trip.name}</span>
                <span class="card-chevron">▼</span>
              </div>
              <div class="card-date">${trip.label} · ${trip.flag || ''} ${trip.country}</div>
              <div class="card-place">${trip.sub}</div>
            </button>
            <div class="card-tags">
              <span class="ct ct-${(trip.continent || '').toLowerCase()}">${trip.continent}</span>
              <span class="ct ct-${trip.type}">${trip.type}</span>
              ${trip.nts ? `<span class="ct ct-nights">🌙 ${trip.nts}n</span>` : ''}
              <span class="ct ${statusClass(trip.status)}">${statusLabel(trip.status)}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="card-exp" id="exp-${trip.id}" role="region" aria-label="Detalhes de ${trip.name}">
        <div class="tabs" role="tablist">
          <button class="tab active" role="tab" data-tab="highlights">✦ Destaques</button>
          <button class="tab" role="tab" data-tab="route">🗺️ Rota</button>
          <button class="tab" role="tab" data-tab="logistics">🏨 Logística</button>
          <button class="tab" role="tab" data-tab="gallery">📷 Galeria</button>
        </div>
        <div class="tab-panel active" data-panel="highlights">
          ${buildHighlights(trip)}
        </div>
        <div class="tab-panel" data-panel="route">
          ${buildRoute(trip)}
        </div>
        <div class="tab-panel" data-panel="logistics">
          ${buildLogistics(trip)}
        </div>
        <div class="tab-panel" data-panel="gallery">
          ${buildGallery(trip)}
        </div>
        <div class="card-actions">
          <button class="share-btn" data-share-id="${trip.id}">🔗 Compartilhar</button>
          <button class="link-btn" data-permalink="${trip.id}"># Link</button>
        </div>
      </div>
    </article>
  `;
  return div.querySelector('.card');
}

function fillCard(card, trip) {
  // If card came from template, fill data attributes
  card.dataset.tripId = trip.id;
  card.dataset.status = trip.status;

  const set = (sel, val, attr = 'textContent') => {
    const el = card.querySelector(sel);
    if (!el) return;
    if (attr === 'textContent') el.textContent = val;
    else if (attr === 'innerHTML') el.innerHTML = val;
    else el.setAttribute(attr, val);
  };

  // Try to fill template slots, or build from scratch if card is bare
  if (!card.querySelector('.card-name')) {
    // Card was built fresh by buildCardElement — already filled
  }

  setupCardListeners(card, trip);
}

function buildHighlights(trip) {
  const hl = (trip.highlights || []).map(h => `<li>${h}</li>`).join('');
  const mem = trip.memory ? `<div class="memory">${trip.memory}</div>` : '';
  return `
    <ul class="hlights">${hl}</ul>
    ${mem}
  `;
}

function buildRoute(trip) {
  const mapId = `mini-map-${trip.id}`;
  return `
    <div class="mini-map" id="${mapId}"></div>
    <ul class="route-list">
      ${trip.air ? `<li><span class="route-icon">✈️</span> <strong>Voo:</strong> ${trip.air}</li>` : ''}
      ${trip.km  ? `<li><span class="route-icon">📏</span> <strong>Distância:</strong> ~${fmt(trip.km)} km</li>` : ''}
      ${trip.nts ? `<li><span class="route-icon">🌙</span> <strong>Noites:</strong> ${trip.nts}</li>` : ''}
      ${trip.pax ? `<li><span class="route-icon">👥</span> <strong>Com quem:</strong> ${trip.pax}</li>` : ''}
    </ul>
  `;
}

function buildLogistics(trip) {
  const log = trip.logistics || {};
  const hotels = (log.hotels || []).map(h => `<li><span class="log-icon">🏨</span>${h}</li>`).join('');
  const rests  = (log.restaurants || []).map(r => `<li><span class="log-icon">🍽️</span>${r}</li>`).join('');
  const tips   = log.tips ? `<div class="log-tips"><strong>💡 Dica:</strong> ${log.tips}</div>` : '';
  return `
    ${hotels ? `<div class="log-section"><h6>Hospedagem</h6><ul class="log-list">${hotels}</ul></div>` : ''}
    ${rests  ? `<div class="log-section"><h6>Restaurantes</h6><ul class="log-list">${rests}</ul></div>` : ''}
    ${tips}
  `;
}

function buildGallery(trip) {
  // Placeholder gallery using emojis as stand-ins
  const emojis = ['🏔️', '🌅', '🍽️', '🏛️', '🌊', '🛫'];
  const items = emojis.map(e => `<div class="gallery-item">${e}</div>`).join('');
  return `
    <div class="gallery">${items}</div>
    <p style="font-size:.72rem;color:var(--text3);margin-top:.5rem;text-align:center">
      Adicione fotos às pastas de viagem para exibir aqui.
    </p>
  `;
}

function statusClass(s) {
  if (s === 'done')    return 'ct badge-ok';
  if (s === 'planned') return 'ct badge-planned';
  return 'ct badge-wish';
}

function statusLabel(s) {
  if (s === 'done')    return '✓ Feita';
  if (s === 'planned') return '📅 Planejada';
  return '💭 Wishlist';
}

// ── Card Setup ────────────────────────────────────────────────────
function setupCardListeners(card, trip) {
  // Toggle expand
  const toggle = card.querySelector('.card-toggle');
  if (toggle) {
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      toggleCard(card);
    });
  }

  // Card click (anywhere) also toggles
  card.addEventListener('click', () => {
    if (!card.classList.contains('expanded')) toggleCard(card);
  });

  // Tabs
  card.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', e => {
      e.stopPropagation();
      const panel = tab.dataset.tab;
      card.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      card.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const pEl = card.querySelector(`[data-panel="${panel}"]`);
      if (pEl) pEl.classList.add('active');
      if (panel === 'route') {
        const mapId = `mini-map-${trip.id}`;
        setTimeout(() => initMiniMap(mapId, trip), 50);
      }
    });
  });

  // Share button
  const shareBtn = card.querySelector('.share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', e => {
      e.stopPropagation();
      openShareDialog(trip);
    });
  }

  // Permalink
  const linkBtn = card.querySelector('.link-btn');
  if (linkBtn) {
    linkBtn.addEventListener('click', e => {
      e.stopPropagation();
      const url = `${location.href.split('#')[0]}#${trip.id}`;
      copyToClipboard(url);
      showToast('🔗 Link copiado!');
    });
  }
}

function toggleCard(card) {
  const isExpanded = card.classList.contains('expanded');
  // Collapse all others
  $$('.card.expanded').forEach(c => {
    if (c !== card) {
      c.classList.remove('expanded');
      const t = c.querySelector('.card-toggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    }
  });

  card.classList.toggle('expanded', !isExpanded);
  const toggle = card.querySelector('.card-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', !isExpanded ? 'true' : 'false');

  if (!isExpanded) {
    // Update URL hash
    const tripId = card.dataset.tripId;
    history.replaceState(null, '', `#${tripId}`);

    // Fly map to this trip
    const trip = allTrips.find(t => t.id === tripId);
    if (trip && mainMap && trip.lat) {
      mainMap.flyTo([trip.lat, trip.lon], 5, { duration: 1.2 });
    }
  } else {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

// ── Filters ───────────────────────────────────────────────────────
function applyFilters() {
  let result = allTrips.slice();

  // Status
  if (activeFilters.status !== 'all') {
    result = result.filter(t => t.status === activeFilters.status);
  }

  // Year (from timeline dot)
  if (activeFilters.year !== null) {
    result = result.filter(t => t.year === activeFilters.year);
  }

  // Max year (from slider)
  result = result.filter(t => t.year <= activeFilters.maxYear);

  // Continent
  if (activeFilters.continent !== 'all') {
    result = result.filter(t => t.continent === activeFilters.continent);
  }

  // Search
  if (activeFilters.search) {
    const q = activeFilters.search.toLowerCase();
    result = result.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.sub.toLowerCase().includes(q) ||
      t.country.toLowerCase().includes(q) ||
      (t.highlights || []).some(h => h.toLowerCase().includes(q))
    );
  }

  // Month
  if (activeFilters.month) {
    result = result.filter(t => t.month === parseInt(activeFilters.month));
  }

  // Duration
  if (activeFilters.duration) {
    const [min, max] = activeFilters.duration.split('-').map(Number);
    result = result.filter(t => t.nts >= min && t.nts <= (max || 99));
  }

  // Type
  if (activeFilters.type) {
    result = result.filter(t => t.type === activeFilters.type);
  }

  // Pax
  if (activeFilters.pax) {
    result = result.filter(t => t.pax === activeFilters.pax);
  }

  filteredTrips = result;
  renderCards();
  renderMapMarkers(filteredTrips.length ? filteredTrips : allTrips);
  renderActiveChips();
  updateFilterCount();
}

function renderActiveChips() {
  const container = $('active-chips');
  if (!container) return;
  const chips = [];

  if (activeFilters.status !== 'all')
    chips.push({ key: 'status', label: `Status: ${activeFilters.status}` });
  if (activeFilters.year !== null)
    chips.push({ key: 'year', label: `Ano: ${activeFilters.year}` });
  if (activeFilters.continent !== 'all')
    chips.push({ key: 'continent', label: `Continente: ${activeFilters.continent}` });
  if (activeFilters.search)
    chips.push({ key: 'search', label: `"${activeFilters.search}"` });
  if (activeFilters.month) {
    const months = ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    chips.push({ key: 'month', label: `Mês: ${months[activeFilters.month] || activeFilters.month}` });
  }
  if (activeFilters.duration)
    chips.push({ key: 'duration', label: `Duração: ${activeFilters.duration}n` });
  if (activeFilters.type)
    chips.push({ key: 'type', label: `Tipo: ${activeFilters.type}` });
  if (activeFilters.pax)
    chips.push({ key: 'pax', label: `Com: ${activeFilters.pax}` });

  container.innerHTML = chips.map(c => `
    <div class="chip">
      <span>${c.label}</span>
      <span class="chip-remove" data-remove="${c.key}" title="Remover" role="button" tabindex="0">×</span>
    </div>
  `).join('');

  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFilter(btn.dataset.remove));
    btn.addEventListener('keydown', e => { if (e.key === 'Enter') removeFilter(btn.dataset.remove); });
  });
}

function removeFilter(key) {
  if (key === 'status')    { activeFilters.status = 'all'; syncStatusBtns(); }
  if (key === 'year')      {
    activeFilters.year = null;
    $$('.ytl-dot').forEach(d => d.classList.remove('active'));
  }
  if (key === 'continent') { activeFilters.continent = 'all'; syncContinentSelect(); }
  if (key === 'search')    { activeFilters.search = ''; const el = $('search-input'); if (el) el.value = ''; }
  if (key === 'month')     { activeFilters.month = ''; syncAdvSelect('month-select', ''); }
  if (key === 'duration')  { activeFilters.duration = ''; syncAdvSelect('duration-select', ''); }
  if (key === 'type')      { activeFilters.type = ''; syncAdvSelect('type-select', ''); }
  if (key === 'pax')       { activeFilters.pax = ''; syncAdvSelect('pax-select', ''); }
  applyFilters();
}

function syncStatusBtns() {
  $$('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === activeFilters.status);
  });
}

function syncContinentSelect() {
  const sel = $('continent-select');
  if (sel) sel.value = activeFilters.continent;
}

function syncAdvSelect(id, val) {
  const el = $(id);
  if (el) el.value = val;
}

function updateFilterCount() {
  const el = $('adv-count');
  if (el) el.textContent = `${filteredTrips.length} / ${allTrips.length} viagens`;
}

// ── Controls Setup ────────────────────────────────────────────────
function setupControls() {
  // Dark mode
  const darkBtn = $('dark-toggle');
  if (darkBtn) darkBtn.addEventListener('click', toggleDark);

  // Theme toggle
  const themeBtn = $('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // Status filter buttons
  $$('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeFilters.status = btn.dataset.status || 'all';
      syncStatusBtns();
      applyFilters();
    });
  });

  // Search input
  const searchInput = $('search-input');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        activeFilters.search = searchInput.value.trim();
        applyFilters();
      }, 200);
    });
  }

  // Advanced toggle
  const advToggle = $('advanced-toggle');
  const advPanel = $('adv-panel');
  if (advToggle && advPanel) {
    advToggle.addEventListener('click', () => {
      advPanel.classList.toggle('open');
      advToggle.setAttribute('aria-expanded', advPanel.classList.contains('open'));
    });
  }

  // Advanced selects
  const setupSelect = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      activeFilters[key] = el.value;
      applyFilters();
    });
  };
  setupSelect('month-select',    'month');
  setupSelect('duration-select', 'duration');
  setupSelect('type-select',     'type');
  setupSelect('pax-select',      'pax');
  setupSelect('continent-select','continent');

  // Clear advanced
  const clearBtn = $('adv-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      activeFilters.month = activeFilters.duration = activeFilters.type = activeFilters.pax = '';
      ['month-select','duration-select','type-select','pax-select'].forEach(id => {
        const el = $(id); if (el) el.value = '';
      });
      applyFilters();
    });
  }

  // Year slider
  const slider = $('year-slider');
  const slVal  = $('sl-val');
  if (slider) {
    slider.addEventListener('input', () => {
      activeFilters.maxYear = parseInt(slider.value);
      if (slVal) slVal.textContent = `até ${slider.value}`;
      applyFilters();
    });
  }

  // Continent select (also in the filter row)
  const contSelect = $('continent-select');
  if (contSelect) {
    contSelect.addEventListener('change', () => {
      activeFilters.continent = contSelect.value;
      applyFilters();
    });
  }

  // Initial filter apply
  filteredTrips = allTrips.slice();
  applyFilters();
}

// ── Share ─────────────────────────────────────────────────────────
let _shareTrip = null;

function setupShareDialog() {
  const dialog = $('share-dialog');
  if (!dialog) return;

  $('share-close')?.addEventListener('click', () => {
    dialog.classList.remove('open');
  });
  dialog.addEventListener('click', e => {
    if (e.target === dialog) dialog.classList.remove('open');
  });

  $('share-copy')?.addEventListener('click', () => {
    const url = shareUrl();
    copyToClipboard(url);
    showToast('🔗 Link copiado!');
    dialog.classList.remove('open');
  });

  $('share-wa')?.addEventListener('click', () => {
    const url = shareUrl();
    const text = `Olha essa viagem: ${_shareTrip?.name} — ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  });

  $('share-x')?.addEventListener('click', () => {
    const url = shareUrl();
    const text = `${_shareTrip?.emoji || '✈️'} ${_shareTrip?.name} — minha viagem ao/à ${_shareTrip?.country}!`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank');
  });

  $('share-native')?.addEventListener('click', async () => {
    if (!navigator.share) { showToast('Compartilhamento não suportado'); return; }
    try {
      await navigator.share({
        title: _shareTrip?.name,
        text: `${_shareTrip?.emoji || '✈️'} ${_shareTrip?.name} — ${_shareTrip?.sub}`,
        url: shareUrl(),
      });
    } catch {}
  });
}

function openShareDialog(trip) {
  _shareTrip = trip;
  const dialog = $('share-dialog');
  const titleEl = $('share-trip-name');
  if (dialog) dialog.classList.add('open');
  if (titleEl) titleEl.textContent = `${trip.flag || '✈️'} ${trip.name}`;
}

function shareUrl() {
  return `${location.origin}${location.pathname}#${_shareTrip?.id || ''}`;
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg) {
  const toast = $('share-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Clipboard ─────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text; document.body.appendChild(el);
    el.select(); document.execCommand('copy');
    document.body.removeChild(el);
  }
}

// ── PWA ───────────────────────────────────────────────────────────
function setupPWA() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    const btn = $('install-btn');
    if (btn) btn.style.display = 'flex';
  });

  const btn = $('install-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      await deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === 'accepted') {
        btn.style.display = 'none';
        deferredInstall = null;
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

// ── Permalink ─────────────────────────────────────────────────────
function checkPermalink() {
  const hash = location.hash.replace('#', '');
  if (!hash) return;
  setTimeout(() => {
    const card = document.querySelector(`[data-trip-id="${hash}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      if (!card.classList.contains('expanded')) toggleCard(card);
    }, 500);
  }, 600);
}

// ── Scroll to Top ─────────────────────────────────────────────────
function setupScrollToTop() {
  const btn = $('scroll-top');
  if (!btn) return;
  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 400);
  }, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ── Keyboard navigation ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $$('.card.expanded').forEach(c => {
      c.classList.remove('expanded');
      const t = c.querySelector('.card-toggle');
      if (t) t.setAttribute('aria-expanded', 'false');
    });
    const dialog = $('share-dialog');
    if (dialog) dialog.classList.remove('open');
    history.replaceState(null, '', location.pathname + location.search);
  }
});

// ── Start ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ── Public API (for sketchy.js) ───────────────────────────────────
window.viagensApp = {
  getTrips:     () => allTrips,
  getFiltered:  () => filteredTrips,
  applyFilters,
  toggleCard,
  showToast,
  openShareDialog,
};
