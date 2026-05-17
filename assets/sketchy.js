// ──────────────────────────────────────────────────────────
// sketchy.js — enhancement layer for the passport/sketch theme
// Runs after app.js. Doesn't replace it — adds:
//   1. SVG roughen filter (for CSS filter: url(#sk-rough))
//   2. Google Fonts (Caveat / Patrick Hand / Plex Mono)
//   3. Theme toggle (sketchy ↔ original)
//   4. Milestones strip (5 anos da promessa, contadores etc.)
//   5. Planned trips: checklist + progress + countdown injected into card
// ──────────────────────────────────────────────────────────

(function () {
  // 1. Inject SVG roughen filter ──────────────────────────
  if (!document.getElementById('sk-defs')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'sk-defs';
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute'; svg.style.pointerEvents = 'none';
    svg.innerHTML = `
      <defs>
        <filter id="sk-rough" x="-2%" y="-2%" width="104%" height="104%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3"/>
          <feDisplacementMap in="SourceGraphic" scale="1.4"/>
        </filter>
        <filter id="sk-rough-strong" x="-3%" y="-3%" width="106%" height="106%">
          <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="2" seed="7"/>
          <feDisplacementMap in="SourceGraphic" scale="2.6"/>
        </filter>
      </defs>`;
    document.body.appendChild(svg);
  }

  // 2. Google Fonts ───────────────────────────────────────
  if (!document.querySelector('link[data-sk-font]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.skFont = '1';
    link.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Patrick+Hand&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }

  // 3. Theme toggle ───────────────────────────────────────
  const SAVED = localStorage.getItem('sk-theme');
  const isSketchy = SAVED !== 'off';
  document.documentElement.setAttribute('data-theme', isSketchy ? 'sketchy' : 'clean');

  function buildToggle() {
    const hdrRight = document.querySelector('.hdr-right');
    if (!hdrRight || hdrRight.querySelector('.theme-toggle')) return;
    const btn = document.createElement('button');
    btn.className = 'theme-toggle icon-btn';
    btn.setAttribute('aria-label', 'Alternar entre tema sketchy e limpo');
    btn.innerHTML = '<span aria-hidden="true">✎</span> <span class="btn-label">Sketchy</span>';
    btn.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'sketchy' ? 'clean' : 'sketchy';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('sk-theme', next === 'sketchy' ? 'on' : 'off');
      btn.querySelector('.btn-label').textContent = next === 'sketchy' ? 'Sketchy' : 'Limpo';
    });
    hdrRight.insertBefore(btn, hdrRight.firstChild);
  }

  // 4. Milestones strip ───────────────────────────────────
  function buildMilestones() {
    if (document.querySelector('.sk-milestones')) return;
    const main = document.querySelector('main');
    if (!main) return;

    const trips = (window.__trips || []);
    if (!trips.length) return;

    const start = new Date('2021-01-01');
    const today = new Date();
    const yearsSince = ((today - start) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);

    const done = trips.filter(t => t.status === 'done');
    const planned = trips.filter(t => t.status === 'planned' || t.status === 'wishlist');
    const countries = new Set(done.map(t => t.name)).size;
    const continents = new Set(done.map(t => t.continent)).size;

    // Next trip
    const future = trips
      .filter(t => t.status === 'planned')
      .map(t => ({ ...t, _d: new Date(t.year, (t.month || 1) - 1, 1) }))
      .filter(t => t._d > today)
      .sort((a, b) => a._d - b._d);
    const next = future[0];

    const items = [];
    items.push(`<span class="sk-milestone"><span class="star">★</span> ${done.length} viagens em ${yearsSince} anos</span>`);
    items.push(`<span class="sk-milestone"><span class="star">★</span> ${continents} continentes · ${countries} destinos</span>`);
    items.push(`<span class="sk-milestone"><span class="star">★</span> uma a cada ~${Math.round((yearsSince * 12) / Math.max(done.length, 1))} meses</span>`);
    if (next) {
      const days = Math.ceil((next._d - today) / (1000 * 60 * 60 * 24));
      items.push(`<span class="sk-milestone" style="background:var(--future-soft); border-color:var(--future); color:var(--future)"><span class="star" style="color:var(--future)">◐</span> próxima: ${next.name} em ${days} dias</span>`);
    }
    items.push(`<span class="sk-milestone"><span class="star">★</span> ${planned.length} planos no horizonte</span>`);

    const strip = document.createElement('div');
    strip.className = 'sk-milestones';
    strip.setAttribute('aria-label', 'Marcos pessoais');
    strip.innerHTML = items.join('');

    // Insert after stats-section
    const stats = main.querySelector('.stats-section');
    if (stats && stats.nextSibling) {
      main.insertBefore(strip, stats.nextSibling);
    } else {
      main.prepend(strip);
    }
  }

  // 5. Checklist for planned trips ────────────────────────
  // Default checklist items (per current spec)
  const CHECKLIST = [
    ['passagem', 'Passagem'],
    ['hotel', 'Hotel'],
    ['shows', 'Shows / eventos'],
    ['transporte', 'Transporte local'],
    ['doc', 'Documentos / visto'],
    ['seguro', 'Seguro viagem'],
    ['roteiro', 'Roteiro'],
    ['cambio', 'Câmbio'],
    ['mala', 'Mala feita'],
  ];

  function loadChecklist(tripId) {
    try { return JSON.parse(localStorage.getItem('sk-checklist-' + tripId)) || {}; }
    catch { return {}; }
  }
  function saveChecklist(tripId, data) {
    localStorage.setItem('sk-checklist-' + tripId, JSON.stringify(data));
  }

  function injectChecklists() {
    const trips = window.__trips || [];
    document.querySelectorAll('.card').forEach(card => {
      const tripId = card.dataset.tripId || card.dataset.id || card.id?.replace('trip-', '');
      if (!tripId) return;
      const trip = trips.find(t => t.id === tripId);
      if (!trip || (trip.status !== 'planned' && trip.status !== 'wishlist')) return;
      if (card.querySelector('.sk-checklist')) return;

      const exp = card.querySelector('[data-exp]');
      const body = card.querySelector('.card-body');
      if (!body) return;

      const userState = loadChecklist(tripId);
      const autoState = trip.checklistAuto || {};
      // Merge: auto-detected (from email sync) wins UNLESS user explicitly unchecked.
      // userState[k] === false means the user manually unchecked an auto item.
      const state = {};
      CHECKLIST.forEach(([k]) => {
        if (userState[k] === false) state[k] = false;
        else if (autoState[k]) state[k] = true;
        else state[k] = !!userState[k];
      });
      const total = CHECKLIST.length;
      const done = CHECKLIST.filter(([k]) => state[k]).length;
      const pct = Math.round((done / total) * 100);

      // Countdown
      const tripDate = new Date(trip.year, (trip.month || 1) - 1, 1);
      const today = new Date();
      const days = Math.ceil((tripDate - today) / (1000 * 60 * 60 * 24));
      const countdown = days > 0 ? `${days} dias até embarcar` : 'em breve';

      const wrap = document.createElement('div');
      wrap.className = 'sk-checklist';
      wrap.innerHTML = `
        <h5>
          <span>📋 Checklist · ${done}/${total} prontos</span>
          <span class="sk-countdown">${countdown}</span>
        </h5>
        <div class="sk-progress"><div class="sk-progress-fill" style="width:${pct}%"></div></div>
        <ul>
          ${CHECKLIST.map(([k, label]) => {
            const auto = autoState[k];
            const autoBadge = auto && typeof auto === 'object'
              ? `<span class="sk-auto" title="Detectado via ${auto.provider || 'email'}${auto.ref ? ' (' + auto.ref + ')' : ''}${auto.amount ? ' · R$ ' + auto.amount.toFixed(2) : ''}">🔗 ${auto.provider || 'auto'}</span>`
              : '';
            return `
            <li class="${state[k] ? 'done' : ''}${auto ? ' auto' : ''}">
              <input type="checkbox" data-k="${k}" ${state[k] ? 'checked' : ''} aria-label="${label}"/>
              <span>${label}</span>${autoBadge}
            </li>
          `;
          }).join('')}
        </ul>
      `;

      // Inject right after card-toggle button, before tab panels
      const toggle = card.querySelector('[data-toggle]');
      if (toggle && exp) {
        exp.insertBefore(wrap, exp.firstChild);
      } else {
        body.appendChild(wrap);
      }

      wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('click', e => e.stopPropagation());
        cb.addEventListener('change', () => {
          const k = cb.dataset.k;
          state[k] = cb.checked;
          saveChecklist(tripId, state);
          cb.closest('li').classList.toggle('done', cb.checked);
          // refresh count
          const newDone = CHECKLIST.filter(([kk]) => state[kk]).length;
          const newPct = Math.round((newDone / total) * 100);
          wrap.querySelector('.sk-progress-fill').style.width = newPct + '%';
          wrap.querySelector('h5 span').textContent = `📋 Checklist · ${newDone}/${total} prontos`;
        });
      });
    });
  }

  // ── Wire-up ────────────────────────────────────────────
  // Fetch trips data directly (app.js is a module — its fetch already ran
  // before this script. We don't piggy-back; we load our own copy.)
  function loadTrips() {
    if (window.__trips && window.__trips.length) {
      return Promise.resolve(window.__trips);
    }
    return fetch('data/trips.json', { cache: 'no-cache' })
      .then(r => r.json())
      .then(d => {
        window.__trips = d.trips || [];
        return window.__trips;
      })
      .catch(() => []);
  }

  // Observe DOM changes to inject checklists when cards are re-rendered
  const obs = new MutationObserver(() => {
    if (window.__trips && window.__trips.length) injectChecklists();
  });

  function boot() {
    buildToggle();
    const grid = document.getElementById('grid');
    if (grid) obs.observe(grid, { childList: true, subtree: false });

    loadTrips().then(() => {
      // Try a few times — cards may not be in the DOM yet on first paint
      let tries = 0;
      const tick = () => {
        buildMilestones();
        injectChecklists();
        if (++tries < 20 && !document.querySelector('.card')) {
          setTimeout(tick, 150);
        }
      };
      tick();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
