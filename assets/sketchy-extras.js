// ──────────────────────────────────────────────────────────
// sketchy-extras.js — phase 2: 5y banner, diário, lightbox,
// galeria editável, países pintados no mapa, importador.
// Loads AFTER sketchy.js. Depends on window.__trips.
// ──────────────────────────────────────────────────────────

(function () {
  // ── 1. 5-year promise banner ──────────────────────────
  function build5yBanner() {
    if (document.querySelector('.sk-5y-banner')) return;
    const main = document.querySelector('main');
    const trips = window.__trips || [];
    if (!trips.length || !main) return;

    const start = new Date('2021-01-01');
    const fiveY = new Date('2026-01-01');
    const today = new Date();
    if (today < fiveY) return; // not yet 5 years

    const done = trips.filter(t => t.status === 'done');
    const countries = new Set(done.map(t => t.name)).size;
    const continents = new Set(done.map(t => t.continent)).size;
    const nights = done.reduce((s, t) => s + (t.nts || 0), 0);
    const km = done.reduce((s, t) => s + (t.km || 0), 0);

    const banner = document.createElement('div');
    banner.className = 'sk-5y-banner';
    banner.innerHTML = `
      <div>
        <div class="sk-5y-title">5 anos da promessa, cumpridos ✓</div>
        <div class="sk-5y-sub">2021 → hoje · uma viagem a cada dois meses</div>
      </div>
      <div class="sk-5y-stamps">
        <span class="sk-5y-stamp">${done.length}<small>viagens</small></span>
        <span class="sk-5y-stamp">${countries}<small>destinos</small></span>
        <span class="sk-5y-stamp">${continents}<small>continentes</small></span>
        <span class="sk-5y-stamp">${nights}<small>noites</small></span>
        <span class="sk-5y-stamp">${km.toLocaleString('pt-BR')}<small>km voados</small></span>
      </div>
    `;

    // Insert before .sk-milestones (or after stats)
    const milestones = main.querySelector('.sk-milestones');
    if (milestones) main.insertBefore(banner, milestones);
    else {
      const stats = main.querySelector('.stats-section');
      if (stats && stats.nextSibling) main.insertBefore(banner, stats.nextSibling);
      else main.prepend(banner);
    }
  }

  // ── 2. Lightbox ───────────────────────────────────────
  let lbState = { imgs: [], idx: 0 };
  function ensureLightbox() {
    if (document.querySelector('.sk-lightbox')) return;
    const lb = document.createElement('div');
    lb.className = 'sk-lightbox';
    lb.innerHTML = `
      <button class="sk-lightbox-close" aria-label="Fechar">×</button>
      <button class="sk-lightbox-nav prev" aria-label="Anterior">‹</button>
      <img class="sk-lightbox-img" alt=""/>
      <button class="sk-lightbox-nav next" aria-label="Próxima">›</button>
      <div class="sk-lightbox-caption"></div>
    `;
    document.body.appendChild(lb);
    lb.querySelector('.sk-lightbox-close').addEventListener('click', closeLb);
    lb.querySelector('.prev').addEventListener('click', () => navLb(-1));
    lb.querySelector('.next').addEventListener('click', () => navLb(1));
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', e => {
      if (!lb.classList.contains('show')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft') navLb(-1);
      if (e.key === 'ArrowRight') navLb(1);
    });
  }
  function openLb(imgs, idx, caption) {
    ensureLightbox();
    lbState = { imgs, idx, caption };
    paintLb();
    document.querySelector('.sk-lightbox').classList.add('show');
  }
  function closeLb() { document.querySelector('.sk-lightbox').classList.remove('show'); }
  function navLb(d) {
    const n = lbState.imgs.length;
    lbState.idx = (lbState.idx + d + n) % n;
    paintLb();
  }
  function paintLb() {
    const lb = document.querySelector('.sk-lightbox');
    lb.querySelector('.sk-lightbox-img').src = lbState.imgs[lbState.idx];
    lb.querySelector('.sk-lightbox-caption').textContent =
      `${lbState.caption || ''} · ${lbState.idx + 1}/${lbState.imgs.length}`;
    const showNav = lbState.imgs.length > 1;
    lb.querySelector('.prev').style.display = showNav ? '' : 'none';
    lb.querySelector('.next').style.display = showNav ? '' : 'none';
  }

  // ── 3. Galeria editável + diário ──────────────────────
  function loadGallery(id) {
    try { return JSON.parse(localStorage.getItem('sk-gal-' + id)) || []; }
    catch { return []; }
  }
  function saveGallery(id, arr) {
    localStorage.setItem('sk-gal-' + id, JSON.stringify(arr));
  }
  function loadDiary(id) {
    return localStorage.getItem('sk-diary-' + id) || '';
  }
  function saveDiary(id, text) {
    localStorage.setItem('sk-diary-' + id, text);
  }

  function enhanceCard(card) {
    const tripId = card.dataset.tripId || card.dataset.id;
    if (!tripId) return;
    if (card.dataset.skEnhanced) return;
    const trip = (window.__trips || []).find(t => t.id === tripId);
    if (!trip) return;

    // Gallery upgrade
    const galPanel = card.querySelector('[data-panel="gallery"]');
    if (galPanel && !galPanel.querySelector('.sk-gallery-grid')) {
      const existing = trip.gallery || [];
      const stored = loadGallery(tripId);
      const imgs = existing.length ? existing : stored;
      renderGallery(galPanel, tripId, trip.name, imgs, stored.length > 0);
    }

    // Diary upgrade — add editable diary below memory
    const diaryPanel = card.querySelector('[data-panel="diary"]');
    if (diaryPanel && !diaryPanel.querySelector('.sk-diary')) {
      const wrap = document.createElement('div');
      wrap.className = 'sk-diary';
      const stored = loadDiary(tripId);
      wrap.innerHTML = `
        <div class="sk-diary-text" contenteditable="true">${escapeHtml(stored)}</div>
        <div class="sk-diary-meta">
          <span>Salva automático no navegador</span>
          <span class="sk-diary-count">${stored.length} chars</span>
        </div>
      `;
      diaryPanel.appendChild(wrap);
      const ta = wrap.querySelector('.sk-diary-text');
      const counter = wrap.querySelector('.sk-diary-count');
      let timer;
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const text = ta.innerText;
          saveDiary(tripId, text);
          counter.textContent = `${text.length} chars · salvo ✓`;
        }, 400);
      });
      ta.addEventListener('click', e => e.stopPropagation());
    }

    card.dataset.skEnhanced = '1';
  }

  function renderGallery(panel, tripId, tripName, imgs, isCustom) {
    const empty = panel.querySelector('[data-gallery-empty]');
    if (empty) empty.hidden = true;
    const galleryEl = panel.querySelector('[data-gallery]');
    if (!galleryEl) return;

    const grid = document.createElement('div');
    grid.className = 'sk-gallery-grid';
    if (imgs.length === 0) {
      grid.innerHTML = `<div class="sk-gallery-item empty">📸<br/>sem fotos<br/>ainda</div>`;
    } else {
      grid.innerHTML = imgs.map((src, i) => `
        <div class="sk-gallery-item" data-i="${i}">
          <img src="${src}" alt="${tripName} ${i+1}" loading="lazy"
            onerror="this.parentElement.innerHTML='<div style=&quot;padding:8px;font-size:.65rem;text-align:center;color:var(--text3)&quot;>imagem não carregou</div>'"/>
          ${isCustom ? `<button class="sk-gal-del" data-del="${i}" title="Remover">×</button>` : ''}
        </div>
      `).join('');
    }
    galleryEl.innerHTML = '';
    galleryEl.appendChild(grid);

    // Add image input
    const addBtn = document.createElement('button');
    addBtn.className = 'sk-gallery-add';
    addBtn.textContent = '+ adicionar foto (URL)';
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const url = prompt('Cole a URL da imagem:');
      if (!url) return;
      const cur = loadGallery(tripId);
      cur.push(url);
      saveGallery(tripId, cur);
      renderGallery(panel, tripId, tripName, cur, true);
    });
    galleryEl.appendChild(addBtn);

    // Click → lightbox
    grid.querySelectorAll('.sk-gallery-item:not(.empty)').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.matches('.sk-gal-del')) return;
        e.stopPropagation();
        const idx = +item.dataset.i;
        openLb(imgs, idx, tripName);
      });
    });
    // Delete buttons
    grid.querySelectorAll('.sk-gal-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const i = +btn.dataset.del;
        const cur = loadGallery(tripId);
        cur.splice(i, 1);
        saveGallery(tripId, cur);
        renderGallery(panel, tripId, tripName, cur, true);
      });
    });
  }

  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── 4. Países pintados no mapa (Leaflet halos) ────────
  let mapHalos = [];
  function paintCountries() {
    const trips = window.__trips || [];
    // Wait for Leaflet map
    if (!window.L) return;
    // Try to find the global map instance
    const mapEl = document.getElementById('map');
    if (!mapEl) return;
    // Leaflet stores instance in element under _leaflet_map (varies); we try a hack:
    const mapInstance = findLeafletMap(mapEl);
    if (!mapInstance) return;

    // Clear old
    mapHalos.forEach(h => mapInstance.removeLayer(h));
    mapHalos = [];

    // Group done trips by country name to avoid overlapping halos on the same place
    const seen = new Set();
    trips.filter(t => t.status === 'done').forEach(t => {
      if (!t.lat || !t.lon) return;
      if (seen.has(t.name)) return;
      seen.add(t.name);
      const halo = L.circle([t.lat, t.lon], {
        radius: 380000, // ~380km soft glow
        color: t.color || '#c2422a',
        weight: 0,
        fillColor: t.color || '#c2422a',
        fillOpacity: 0.18,
        className: 'sk-country-halo'
      }).addTo(mapInstance);
      mapHalos.push(halo);
    });
  }
  function findLeafletMap(el) {
    // Walk through Leaflet's internal map registry
    for (const key in el) {
      if (el[key] && el[key]._leaflet_id) {
        // Not the map itself
      }
    }
    // Use L's internal: L._lastMap doesn't exist. Iterate over known L instances stored:
    // Leaflet keeps map ref on the container as ._leaflet_id; the actual Map instance is in L.Map._instances? No.
    // Pragmatic: use L's mapPane to find map.
    if (window.__skMap) return window.__skMap;
    // Try MutationObserver-less probe: leaflet stores map on container as _leaflet_id; we need to look up via L.DomUtil
    // Workaround: monkey-patch L.Map to capture instance.
    return null;
  }
  // Monkey-patch L.Map to capture map instance on creation
  function patchLeaflet() {
    if (!window.L || L.Map._skPatched) return;
    const origInit = L.Map.prototype.initialize;
    L.Map.prototype.initialize = function () {
      origInit.apply(this, arguments);
      window.__skMap = this;
      // Once trips are loaded, paint
      setTimeout(paintCountries, 400);
    };
    L.Map._skPatched = true;
  }

  // ── 5. Importer modal ─────────────────────────────────
  function buildImporter() {
    if (document.querySelector('.sk-fab')) return;

    const fab = document.createElement('button');
    fab.className = 'sk-fab';
    fab.innerHTML = '<span class="plus">+</span> <span class="label">Nova viagem</span>';
    document.body.appendChild(fab);

    const modal = document.createElement('div');
    modal.className = 'sk-modal';
    modal.innerHTML = `
      <div class="sk-modal-card">
        <button class="sk-modal-close" aria-label="Fechar">×</button>
        <h3>Nova viagem</h3>
        <div class="sk-modal-sub">Preencha e gere o JSON para colar em <code>data/trips.json</code></div>
        <form class="sk-form-grid" id="sk-trip-form">
          <label class="full">Nome do destino
            <input name="name" required placeholder="Ex: Tóquio"/>
          </label>
          <label class="full">Subtítulo (cidades, marcos)
            <input name="sub" placeholder="Ex: Shibuya · Asakusa · Kyoto"/>
          </label>
          <label>Emoji/Bandeira
            <input name="emoji" placeholder="🇯🇵"/>
          </label>
          <label>Continente
            <select name="continent">
              <option value="Asia">Ásia</option>
              <option value="Europe">Europa</option>
              <option value="Americas">Américas</option>
              <option value="Africa">África</option>
              <option value="Oceania">Oceania</option>
            </select>
          </label>
          <label>Ano
            <input name="year" type="number" min="2020" max="2035" value="2026"/>
          </label>
          <label>Mês
            <select name="month">
              <option value="1">Jan</option><option value="2">Fev</option>
              <option value="3">Mar</option><option value="4">Abr</option>
              <option value="5">Mai</option><option value="6">Jun</option>
              <option value="7">Jul</option><option value="8">Ago</option>
              <option value="9">Set</option><option value="10">Out</option>
              <option value="11">Nov</option><option value="12">Dez</option>
            </select>
          </label>
          <label>Status
            <select name="status">
              <option value="done">Realizada</option>
              <option value="planned">Planejada</option>
              <option value="wishlist">Wishlist</option>
            </select>
          </label>
          <label>Tipo
            <select name="type">
              <option value="leisure">Lazer</option>
              <option value="business">Trabalho/Evento</option>
              <option value="festival">Festival</option>
              <option value="adventure">Aventura</option>
            </select>
          </label>
          <label>Companhia
            <input name="pax" value="Jodson Oliveira"/>
          </label>
          <label>Cia. aérea
            <input name="air" placeholder="LATAM + ..."/>
          </label>
          <label>Noites
            <input name="nts" type="number" min="1" value="7"/>
          </label>
          <label>Km voados (estimado)
            <input name="km" type="number" min="0" value="10000"/>
          </label>
          <label>Latitude
            <input name="lat" type="number" step="0.01" placeholder="35.68"/>
          </label>
          <label>Longitude
            <input name="lon" type="number" step="0.01" placeholder="139.69"/>
          </label>
          <label class="full">Highlights (separe com ;)
            <textarea name="highlights" placeholder="Cruzamento de Shibuya; Templo Senso-ji; Geishas em Kyoto"></textarea>
          </label>
          <label class="full">Memória/lembrança
            <textarea name="memory" placeholder="O que ficou dessa viagem…"></textarea>
          </label>
          <label>Custo total (BRL)
            <input name="cost" type="number" min="0" value="0"/>
          </label>
          <label>Cor de destaque
            <input name="color" type="color" value="#c2422a"/>
          </label>
        </form>
        <div class="sk-form-actions">
          <button class="sk-btn ghost" id="sk-trip-cancel">Cancelar</button>
          <button class="sk-btn" id="sk-trip-generate">Gerar JSON</button>
          <button class="sk-btn" id="sk-trip-copy" style="display:none">📋 Copiar</button>
        </div>
        <pre class="sk-import-output" id="sk-output"></pre>
        <div class="sk-import-output-help">Cole esse trecho dentro do array <code>"trips"</code> em <code>data/trips.json</code> e dê commit no GitHub.</div>
      </div>
    `;
    document.body.appendChild(modal);

    fab.addEventListener('click', () => modal.classList.add('show'));
    modal.querySelector('.sk-modal-close').addEventListener('click', () => modal.classList.remove('show'));
    modal.querySelector('#sk-trip-cancel').addEventListener('click', e => {
      e.preventDefault();
      modal.classList.remove('show');
    });
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });

    const form = modal.querySelector('#sk-trip-form');
    const out = modal.querySelector('#sk-output');
    const copyBtn = modal.querySelector('#sk-trip-copy');

    modal.querySelector('#sk-trip-generate').addEventListener('click', e => {
      e.preventDefault();
      const fd = new FormData(form);
      const name = fd.get('name')?.trim();
      if (!name) { alert('Nome é obrigatório'); return; }
      const id = name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') + '-' + fd.get('year');
      const month = +fd.get('month');
      const monthLbl = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][month-1];
      const highlights = (fd.get('highlights') || '').split(';').map(s => s.trim()).filter(Boolean);
      const trip = {
        id,
        name,
        sub: fd.get('sub') || '',
        emoji: fd.get('emoji') || '',
        year: +fd.get('year'),
        month,
        label: `${monthLbl} ${fd.get('year')}`,
        lat: parseFloat(fd.get('lat')) || 0,
        lon: parseFloat(fd.get('lon')) || 0,
        color: fd.get('color') || '#c2422a',
        color2: fd.get('color') || '#c2422a',
        continent: fd.get('continent'),
        pax: fd.get('pax') || '',
        air: fd.get('air') || '',
        nts: +fd.get('nts') || 0,
        km: +fd.get('km') || 0,
        status: fd.get('status'),
        verified: false,
        type: fd.get('type'),
        highlights,
        memory: fd.get('memory') || '',
        photo: null,
        route: [],
        logistics: { hotels: [], restaurants: [], tips: '' },
        cost: {
          total: +fd.get('cost') || 0,
          currency: 'BRL',
          breakdown: { voos: 0, hospedagem: 0, passeios: 0, comida: 0 }
        }
      };
      out.textContent = JSON.stringify(trip, null, 2) + ',';
      out.classList.add('show');
      copyBtn.style.display = '';
    });

    copyBtn.addEventListener('click', e => {
      e.preventDefault();
      navigator.clipboard.writeText(out.textContent).then(() => {
        copyBtn.textContent = '✓ copiado';
        setTimeout(() => { copyBtn.textContent = '📋 Copiar'; }, 1500);
      });
    });
  }

  // ── Wire-up ───────────────────────────────────────────
  function tryEnhance() {
    document.querySelectorAll('.card').forEach(enhanceCard);
  }

  function boot() {
    patchLeaflet();
    buildImporter();
    ensureLightbox();

    // Wait for trips data
    let tries = 0;
    const tick = () => {
      if (window.__trips && window.__trips.length) {
        build5yBanner();
        paintCountries();
        tryEnhance();
      }
      if (++tries < 40) setTimeout(tick, 200);
    };
    tick();

    // Watch for new cards
    const grid = document.getElementById('grid');
    if (grid) {
      new MutationObserver(() => tryEnhance()).observe(grid, { childList: true });
    }
    // Watch for tab clicks to enhance newly-shown panels
    document.body.addEventListener('click', e => {
      if (e.target.matches('[data-toggle], .tab, [data-tab]')) {
        setTimeout(tryEnhance, 50);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
