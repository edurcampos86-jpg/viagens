// ──────────────────────────────────────────────────────────
// sketchy-hero.js — Fase 3: hero layout
// - Mapa gigante no topo com países pintados + rotas animadas + clusters
// - Linha do tempo horizontal estilo régua
// - Próxima viagem em destaque
// - Cards colapsados
// - Suporte a álbum compartilhado (iCloud / Google Fotos)
// ──────────────────────────────────────────────────────────

(function () {
  // Silence ResizeObserver loop warning (benign, Leaflet triggers it on init)
  const origErr = window.onerror;
  window.addEventListener('error', e => {
    if (e?.message && /ResizeObserver loop/.test(e.message)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      return true;
    }
  }, true);

  // Default ON
  if (!document.documentElement.getAttribute('data-layout')) {
    const saved = localStorage.getItem('sk-layout');
    document.documentElement.setAttribute('data-layout', saved === 'classic' ? 'classic' : 'hero');
  }

  // Mapping: trip.name (PT) → ISO_A3 country codes
  // Used to paint countries on the world map
  const COUNTRY_ISO = {
    'Tailândia': ['THA'],
    'África do Sul': ['ZAF'],
    'Mykonos': ['GRC'],
    'Japão': ['JPN'],
    'Havaí': ['USA'],
    'Espanha + Ibiza': ['ESP'],
    'Alemanha': ['DEU'],
    'Amsterdã + Bélgica': ['NLD', 'BEL'],
    'Roma + Vaticano': ['ITA', 'VAT'],
    'Praga + Budapeste': ['CZE', 'HUN'],
    'Houston': ['USA'],
    'Lisboa': ['PRT'],
    'Nova Iorque': ['USA'],
    'Nova Iorque ': ['USA'],
    'Ilhas ABC + Puerto Rico': ['ABW', 'CUW', 'PRI'],
    'Cartagena': ['COL'],
    'Florida': ['USA'],
    'Argentina': ['ARG'],
    'Atacama': ['CHL'],
    'Foz do Iguaçu': ['BRA'],
    'Nova Zelândia': ['NZL'],
    'Marrocos': ['MAR'],
    'Patagônia Chilena': ['CHL'],
    'Vietnã + Camboja': ['VNM', 'KHM'],
  };

  // Countries we'll cache here for performance
  let countriesGeo = null;
  let bigMap = null;
  let countryLayer = null;
  let routeLayer = null;
  let pinsLayer = null;

  // ── 1. Build hero scaffold ────────────────────────────
  function buildHero() {
    if (document.querySelector('.sk-hero-stack')) return;
    const main = document.querySelector('main');
    if (!main) return;

    const stack = document.createElement('div');
    stack.className = 'sk-hero-stack';
    stack.innerHTML = `
      <div class="sk-bigmap-wrap">
        <div class="sk-bigmap" id="sk-bigmap"></div>
        <div class="sk-bigmap-overlay">📍 onde já estive</div>
        <div class="sk-bigmap-stats" id="sk-bigmap-stats"></div>
        <div class="sk-bigmap-legend">
          <span><span class="leg-dot" style="background:var(--accent)"></span>visitado</span>
          <span><span class="leg-dot" style="background:transparent;border-style:dashed;border-color:var(--future)"></span>planejado</span>
          <span><span class="leg-line"></span>rota cronológica</span>
        </div>
      </div>
      <div class="sk-next-trip" id="sk-next-trip"></div>
      <div class="sk-rail-wrap">
        <div class="sk-rail-header">
          <div class="sk-rail-title">📜 Linha do tempo</div>
          <div class="sk-rail-sub">arraste para os lados →</div>
        </div>
        <div class="sk-rail-scroll" id="sk-rail-scroll">
          <div class="sk-rail" id="sk-rail"></div>
        </div>
      </div>
    `;

    // Insert before the existing .layout
    const layout = main.querySelector('.layout');
    if (layout) main.insertBefore(stack, layout);
    else main.appendChild(stack);
  }

  // ── 2. Build big map (Leaflet) ───────────────────────
  function buildBigMap() {
    const el = document.getElementById('sk-bigmap');
    if (!el || bigMap) return;
    bigMap = L.map(el, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 8,
      worldCopyJump: true,
      attributionControl: false,
      zoomControl: true,
    });

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 8 }
    ).addTo(bigMap);

    L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
      { subdomains: 'abcd', maxZoom: 8, pane: 'shadowPane', opacity: 0.7 }
    ).addTo(bigMap);

    countryLayer = L.layerGroup().addTo(bigMap);
    routeLayer = L.layerGroup().addTo(bigMap);
    pinsLayer = L.markerClusterGroup({
      iconCreateFunction: cluster => L.divIcon({
        html: `<div class="sk-cluster-icon">${cluster.getChildCount()}</div>`,
        className: '',
        iconSize: [36, 36]
      }),
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 32,
    }).addTo(bigMap);

    window.__skBigMap = bigMap;
  }

  // ── 3. Fetch GeoJSON countries (cached) ──────────────
  async function loadCountries() {
    if (countriesGeo) return countriesGeo;
    // Try simplified sources in order (110m natural earth is ~250KB w/ ISO_A3)
    const SOURCES = [
      'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson',
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
      'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson',
    ];
    for (const url of SOURCES) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) {
          console.warn('[sketchy-hero] geojson source', url, 'status', res.status);
          continue;
        }
        const data = await res.json();
        if (data && data.features && data.features.length) {
          countriesGeo = data;
          console.log('[sketchy-hero] loaded geojson from', url, '·', data.features.length, 'features');
          return countriesGeo;
        }
      } catch (e) {
        console.warn('[sketchy-hero] geojson source failed', url, e?.name || e?.message);
      }
    }
    countriesGeo = { features: [] };
    return countriesGeo;
  }

  // ── 4. Paint countries ───────────────────────────────
  async function paintCountries() {
    if (!bigMap || !countryLayer) return;
    const trips = window.__trips || [];
    if (!trips.length) return;

    // Build trip → ISO maps
    const visitedIso = new Set();
    const futureIso = new Set();
    const isoToTrips = {};
    trips.forEach(t => {
      const isos = COUNTRY_ISO[t.name];
      if (!isos) return;
      isos.forEach(iso => {
        const status = t.status === 'done' ? 'visited' : 'future';
        if (status === 'visited') visitedIso.add(iso);
        else if (!visitedIso.has(iso)) futureIso.add(iso);
        (isoToTrips[iso] = isoToTrips[iso] || []).push(t);
      });
    });

    // Update stats overlay immediately — independent of geojson load
    const statsEl = document.getElementById('sk-bigmap-stats');
    if (statsEl) {
      const doneTrips = trips.filter(t => t.status === 'done');
      statsEl.innerHTML = `
        <div class="sk-bigmap-stat"><strong>${visitedIso.size}</strong>países</div>
        <div class="sk-bigmap-stat"><strong>${doneTrips.length}</strong>viagens</div>
        <div class="sk-bigmap-stat"><strong>${new Set(doneTrips.map(t => t.continent)).size}</strong>continentes</div>
      `;
    }

    let geo;
    try {
      geo = await loadCountries();
    } catch (e) {
      console.warn('[sketchy-hero] paintCountries: geojson load failed', e);
      return;
    }

    if (!geo?.features?.length) {
      console.warn('[sketchy-hero] no features in geojson');
      return;
    }

    countryLayer.clearLayers();

    let painted = 0;
    geo.features.forEach(feat => {
      try {
        const props = feat.properties || {};
        const iso = props.ISO_A3 || props.iso_a3 || props.ADM0_A3 || feat.id;
        const isVisited = visitedIso.has(iso);
        const isFuture = futureIso.has(iso);
        if (!isVisited && !isFuture) return;

        const tripsHere = isoToTrips[iso] || [];
        const lastTrip = tripsHere[tripsHere.length - 1];

        const fillColor = isVisited ? '#c2422a' : '#2f6a6e';
        const layer = L.geoJSON(feat, {
          style: () => ({
            fillColor,
            fillOpacity: isVisited ? 0.32 : 0.18,
            color: isVisited ? '#8e2e1c' : '#2f6a6e',
            weight: 1.4,
            dashArray: isVisited ? null : '6 4',
            className: 'sk-country-fill' + (isFuture && !isVisited ? ' future' : ''),
          })
        });

        // Tooltip
        const name = props.ADMIN || props.name || props.NAME || iso;
        const tipHtml = `
          <div class="tip-flag">${(lastTrip?.emoji) || '🌍'}</div>
          <div class="tip-title">${name}</div>
          <div class="tip-meta">${tripsHere.length} viagem${tripsHere.length > 1 ? 's' : ''} · ${tripsHere.map(t => t.label || t.year).join(', ')}</div>
          ${lastTrip?.highlights?.length ? `<div class="tip-hl">"${lastTrip.highlights[0]}"</div>` : ''}
        `;
        layer.bindTooltip(tipHtml, {
          className: 'sk-country-tip',
          sticky: true,
          offset: [10, 0],
          opacity: 1,
        });

        layer.on('click', () => {
          try {
            bigMap.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 5, animate: true });
          } catch (_) {}
          if (lastTrip) scrollToCard(lastTrip.id);
        });

        layer.addTo(countryLayer);
        painted++;
      } catch (e) {
        console.warn('[sketchy-hero] paint failed for feature', e);
      }
    });
    console.log('[sketchy-hero] painted countries:', painted);
  }

  // ── 5. Draw chronological route line ─────────────────
  function drawRoutes() {
    if (!routeLayer) return;
    routeLayer.clearLayers();

    const trips = (window.__trips || []).slice()
      .filter(t => t.lat && t.lon)
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    if (trips.length < 2) return;

    const doneCoords = [];
    const futureCoords = [];
    let inFuture = false;

    trips.forEach(t => {
      if (t.status === 'done') {
        if (inFuture) return; // skip mixing
        doneCoords.push([t.lat, t.lon]);
      } else {
        inFuture = true;
        // Connect last done → first future for continuity
        if (futureCoords.length === 0 && doneCoords.length > 0) {
          futureCoords.push(doneCoords[doneCoords.length - 1]);
        }
        futureCoords.push([t.lat, t.lon]);
      }
    });

    if (doneCoords.length > 1) {
      const line = L.polyline(doneCoords, {
        className: 'sk-route-line',
        color: '#1d1a16',
        weight: 2.5,
        dashArray: '6 5',
      }).addTo(routeLayer);
    }
    if (futureCoords.length > 1) {
      L.polyline(futureCoords, {
        className: 'sk-route-line sk-route-future',
        color: '#2f6a6e',
        weight: 2,
        dashArray: '4 4',
      }).addTo(routeLayer);
    }
  }

  // ── 6. Add pins (clustered) ──────────────────────────
  function addPins() {
    if (!pinsLayer) return;
    pinsLayer.clearLayers();
    const trips = window.__trips || [];

    trips.forEach(trip => {
      if (!trip.lat || !trip.lon) return;
      const isFuture = trip.status !== 'done';
      const icon = L.divIcon({
        html: `<div class="sk-pin-icon ${isFuture ? 'future' : ''}"></div>`,
        className: '',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = L.marker([trip.lat, trip.lon], { icon });
      marker.bindPopup(`
        <div style="font-family:'Patrick Hand'; min-width:160px;">
          <div style="font-family:'Caveat'; font-size:1.4rem; font-weight:700;">${trip.emoji || ''} ${trip.name}</div>
          <div style="font-family:'IBM Plex Mono'; font-size:0.62rem; text-transform:uppercase; letter-spacing:1px; color:#666; margin-top:2px;">${trip.label || trip.year}</div>
          ${trip.highlights?.length ? `<div style="font-style:italic; color:#555; margin-top:6px;">"${trip.highlights[0]}"</div>` : ''}
          <button data-trip-jump="${trip.id}" style="margin-top:8px; background:#c2422a; color:#f5efde; border:1.4px solid #1d1a16; padding:4px 10px; font-family:'IBM Plex Mono'; font-size:0.62rem; text-transform:uppercase; letter-spacing:1px; cursor:pointer;">ver detalhe ↓</button>
        </div>
      `);
      marker.on('popupopen', e => {
        e.popup._contentNode.querySelector('[data-trip-jump]')?.addEventListener('click', () => {
          scrollToCard(trip.id);
        });
      });
      pinsLayer.addLayer(marker);
    });
  }

  // ── 7. Build horizontal timeline rail ─────────────────
  function buildRail() {
    const rail = document.getElementById('sk-rail');
    if (!rail) return;
    rail.innerHTML = '';
    const trips = (window.__trips || []).slice()
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));
    if (!trips.length) return;

    const minYear = Math.min(...trips.map(t => t.year));
    const maxYear = Math.max(...trips.map(t => t.year));
    const today = new Date();
    const thisYear = today.getFullYear();
    const yearCol = {};

    for (let y = minYear; y <= maxYear; y++) {
      const col = document.createElement('div');
      col.className = 'sk-year';
      col.dataset.year = y;
      const tripsY = trips.filter(t => t.year === y);
      col.innerHTML = `
        <div class="sk-year-tick">
          <div class="tick-mark"></div>
          <div class="tick-label">${y}</div>
          <div class="tick-sub">${tripsY.length} viage${tripsY.length === 1 ? 'm' : 'ns'}</div>
        </div>
        <div class="sk-year-trips"></div>
      `;
      rail.appendChild(col);
      yearCol[y] = col.querySelector('.sk-year-trips');
    }

    trips.forEach(t => {
      const list = yearCol[t.year];
      if (!list) return;
      const btn = document.createElement('button');
      btn.className = 'sk-rail-trip' + (t.status !== 'done' ? ' future' : '');
      btn.dataset.tripId = t.id;
      btn.innerHTML = `
        <span class="trip-flag">${t.emoji || '📍'}</span>
        <div class="trip-info">
          <div class="trip-title">${t.name}</div>
          <div class="trip-meta">${t.label || t.year} · ${t.nts || '?'}n</div>
        </div>
      `;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sk-rail-trip.active').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        flyToTrip(t);
        scrollToCard(t.id);
      });
      list.appendChild(btn);
    });

    // Add "HOJE" marker
    const totalCols = maxYear - minYear + 1;
    const colWidth = 220 + 24; // min-width + padding
    const fractionalYear = thisYear + (today.getMonth() / 12);
    const offsetCols = fractionalYear - minYear;
    if (offsetCols >= 0 && offsetCols <= totalCols) {
      const now = document.createElement('div');
      now.className = 'sk-rail-now';
      now.style.left = `${offsetCols * colWidth + 12}px`;
      rail.appendChild(now);
    }
  }

  // ── 8. Next trip hero card ───────────────────────────
  function buildNextTrip() {
    const el = document.getElementById('sk-next-trip');
    if (!el) return;
    const trips = window.__trips || [];
    const today = new Date();
    const upcoming = trips
      .filter(t => t.status === 'planned' || t.status === 'wishlist')
      .map(t => ({ ...t, _d: new Date(t.year, (t.month || 1) - 1, 1) }))
      .filter(t => t._d > today)
      .sort((a, b) => a._d - b._d);
    const next = upcoming[0];
    if (!next) {
      el.style.display = 'none';
      return;
    }
    const days = Math.ceil((next._d - today) / (1000 * 60 * 60 * 24));
    el.innerHTML = `
      <div>
        <div class="sk-next-title">${next.emoji || ''} ${next.name}</div>
        <div class="sk-next-sub">${next.sub || ''}</div>
        <div class="sk-next-meta">
          <span class="sk-next-chip">📅 ${next.label || next.year}</span>
          <span class="sk-next-chip">✈ ${next.air || '—'}</span>
          <span class="sk-next-chip">🏨 ${next.nts || '?'} noites</span>
          <span class="sk-next-chip">👥 ${next.pax || '—'}</span>
        </div>
      </div>
      <div class="sk-next-countdown">
        <span class="days">${days}</span>
        <span class="lbl">dias até embarcar</span>
      </div>
    `;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      flyToTrip(next);
      scrollToCard(next.id);
    });
  }

  // ── 9. Helpers ───────────────────────────────────────
  function flyToTrip(trip) {
    if (!bigMap || !trip.lat || !trip.lon) return;
    bigMap.flyTo([trip.lat, trip.lon], 5, { duration: 1.2 });
  }
  function scrollToCard(tripId) {
    const card = document.querySelector(`.card[data-trip-id="${tripId}"], #trip-${tripId}, [data-id="${tripId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Auto-expand
    const toggle = card.querySelector('[data-toggle]');
    if (toggle && toggle.getAttribute('aria-expanded') === 'false') toggle.click();
    card.classList.add('expanded');
    // Highlight briefly
    card.style.transition = 'box-shadow .4s';
    card.style.boxShadow = '0 0 0 4px var(--accent), 4px 6px 0 rgba(0,0,0,0.2)';
    setTimeout(() => { card.style.boxShadow = ''; }, 1500);
  }

  // Card click → fly to country
  function wireCards() {
    document.body.addEventListener('click', e => {
      const tg = e.target.closest('[data-toggle]');
      if (!tg) return;
      const card = tg.closest('.card');
      if (!card) return;
      // Toggle the .expanded marker class
      setTimeout(() => {
        const expanded = tg.getAttribute('aria-expanded') === 'true';
        card.classList.toggle('expanded', expanded);
      }, 50);
      // Fly map
      const tripId = card.dataset.tripId;
      const trip = (window.__trips || []).find(t => t.id === tripId);
      if (trip) flyToTrip(trip);
    });
  }

  // ── 10. Album link feature ───────────────────────────
  function loadAlbum(tripId) {
    return localStorage.getItem('sk-album-' + tripId) || '';
  }
  function saveAlbum(tripId, url) {
    if (url) localStorage.setItem('sk-album-' + tripId, url);
    else localStorage.removeItem('sk-album-' + tripId);
  }
  function detectProvider(url) {
    if (/photos\.app\.goo\.gl|photos\.google\.com/i.test(url)) return { icon: '📷', name: 'Google Fotos' };
    if (/icloud\.com\/sharedalbum|share\.icloud/i.test(url)) return { icon: '☁', name: 'iCloud Fotos' };
    if (/flickr\.com/i.test(url)) return { icon: '📸', name: 'Flickr' };
    return { icon: '🔗', name: 'Álbum' };
  }
  function injectAlbumWidget() {
    const trips = window.__trips || [];
    document.querySelectorAll('.card').forEach(card => {
      const tripId = card.dataset.tripId || card.dataset.id;
      if (!tripId) return;
      if (card.querySelector('.sk-album-widget')) return;
      const galPanel = card.querySelector('[data-panel="gallery"]');
      if (!galPanel) return;

      const widget = document.createElement('div');
      widget.className = 'sk-album-widget';
      widget.style.marginTop = '12px';

      const url = loadAlbum(tripId);
      if (url) {
        const p = detectProvider(url);
        widget.innerHTML = `
          <a href="${url}" target="_blank" rel="noopener" class="sk-album-card">
            <div class="alb-icon">${p.icon}</div>
            <div class="alb-info">
              <div class="alb-title">Abrir álbum no ${p.name}</div>
              <div class="alb-sub">${url.replace(/^https?:\/\//, '')}</div>
            </div>
            <div class="alb-arrow">→</div>
          </a>
          <div class="sk-album-input" style="margin-top:6px">
            <button class="sk-album-clear" type="button" style="background:none;color:var(--text2);border:1px solid var(--border2);padding:4px 8px;font-family:'IBM Plex Mono';font-size:0.6rem;text-transform:uppercase;letter-spacing:1px;cursor:pointer;">× remover álbum</button>
          </div>
        `;
        widget.querySelector('.sk-album-clear').addEventListener('click', e => {
          e.stopPropagation();
          saveAlbum(tripId, '');
          card.querySelector('.sk-album-widget').remove();
          injectAlbumWidget();
        });
      } else {
        widget.innerHTML = `
          <div class="sk-album-input">
            <input type="url" placeholder="Cole o link do álbum compartilhado (Google Fotos / iCloud)…" />
            <button type="button">Salvar</button>
          </div>
        `;
        const input = widget.querySelector('input');
        const btn = widget.querySelector('button');
        const save = () => {
          const v = input.value.trim();
          if (!v) return;
          saveAlbum(tripId, v);
          card.querySelector('.sk-album-widget').remove();
          injectAlbumWidget();
        };
        btn.addEventListener('click', e => { e.stopPropagation(); save(); });
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      }
      galPanel.appendChild(widget);
    });
  }

  // ── 11. Layout toggle button ─────────────────────────
  function buildLayoutToggle() {
    const hdr = document.querySelector('.hdr-right');
    if (!hdr || hdr.querySelector('.sk-layout-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'icon-btn sk-layout-toggle';
    btn.setAttribute('aria-label', 'Alternar layout');
    const cur = document.documentElement.getAttribute('data-layout');
    btn.innerHTML = `<span aria-hidden="true">▤</span> <span class="btn-label">${cur === 'hero' ? 'Hero' : 'Clássico'}</span>`;
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-layout') === 'hero' ? 'classic' : 'hero';
      document.documentElement.setAttribute('data-layout', next);
      localStorage.setItem('sk-layout', next);
      btn.querySelector('.btn-label').textContent = next === 'hero' ? 'Hero' : 'Clássico';
      if (next === 'hero') {
        const stack = document.querySelector('.sk-hero-stack');
        if (!stack) { boot(); }
        else { stack.style.display = ''; }
        setTimeout(() => bigMap?.invalidateSize(), 100);
      } else {
        const stack = document.querySelector('.sk-hero-stack');
        if (stack) stack.style.display = 'none';
      }
    });
    hdr.insertBefore(btn, hdr.firstChild);
  }

  // ── Boot ─────────────────────────────────────────────
  async function boot() {
    if (document.documentElement.getAttribute('data-layout') !== 'hero') {
      buildLayoutToggle();
      return;
    }

    buildLayoutToggle();
    buildHero();

    // Wait for Leaflet + trips
    let waits = 0;
    const tick = () => {
      if (typeof L === 'undefined' || !(window.__trips || []).length) {
        if (++waits < 60) setTimeout(tick, 200);
        return;
      }
      // Run synchronous stuff first — these don't depend on the geojson fetch
      try { buildBigMap(); } catch (e) { console.error('buildBigMap', e); }
      try { drawRoutes(); } catch (e) { console.error('drawRoutes', e); }
      try { addPins(); } catch (e) { console.error('addPins', e); }
      try { buildRail(); } catch (e) { console.error('buildRail', e); }
      try { buildNextTrip(); } catch (e) { console.error('buildNextTrip', e); }
      try { injectAlbumWidget(); } catch (e) { console.error('injectAlbumWidget', e); }
      try { wireCards(); } catch (e) { console.error('wireCards', e); }

      // Paint countries async (won't block other features)
      paintCountries().catch(e => console.error('paintCountries', e));

      // Watch for card additions
      const grid = document.getElementById('grid');
      if (grid) new MutationObserver(() => injectAlbumWidget()).observe(grid, { childList: true });

      // Auto-scroll rail to current year
      setTimeout(() => {
        const today = new Date();
        const yearTick = document.querySelector(`.sk-year[data-year="${today.getFullYear()}"]`);
        yearTick?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
      }, 800);
    };
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
