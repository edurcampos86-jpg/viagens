// Modo Memória durável — VIEW (Fase 2).
//
// Palco cinematográfico que renderiza media.gallery como memórias: palco
// twilight + Ambilight (glow da cor 'accent' atrás da mídia ativa), crossfade
// entre memórias, Ken Burns nas fotos, vídeo autoplay mudo em loop (do 'src'),
// e o ANEL DE TEMPO luminoso (assinatura) varrendo o intervalo de cada item.
//
// SÓ RENDERIZA. Não ingere, não faz upload, não escreve em trips.json. Lê o
// contrato PLANO mergeado na Fase 1 (data/schemas/trip.schema.json):
//   type    : memory_video | memory_photo | video_link | image | video
//   src     : URL do CDN (vídeo OU imagem; o 'type' desambigua) ou path local
//   poster  : placeholder local
//   caption : título · place/date : strings · accent : '#rrggbb' · aspect
//   ► video_link tem href MORTO → POSTER-ONLY, nunca navega.
//
// Virtualização: instancia só a mídia ATIVA (durante o crossfade, ativa ± 1).
// Vídeo que sai da janela é pausado e descarregado (src='' + load()); vídeo
// inativo nunca dá load/play. O filmstrip usa <img loading="lazy"> leves.
//
// Tokens/fontes ESCOPADOS em .mm- — nada vaza para o resto do site.

import { getTripsFile } from '../core/trips-api.js';
import * as settings from '../core/settings.js';

// Tipos da gallery que o palco sabe renderizar (contrato plano da Fase 1).
const RENDERABLE = new Set(['memory_video', 'memory_photo', 'video_link', 'image', 'video']);
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_ACCENT = '#6d63ff'; // twilight quando o item não traz accent
const STILL_DWELL_MS = 7000;
const VIDEO_DWELL_MS = 9000;

let cssInjected = false;
const CSS = `
@property --mm-accent { syntax: '<color>'; inherits: true; initial-value: ${DEFAULT_ACCENT}; }

.mm-overlay {
  --mm-accent: ${DEFAULT_ACCENT};
  --mm-twilight-0: #0a0a14;
  --mm-twilight-1: #14111f;
  --mm-ink: #f4f2ff;
  --mm-ink-soft: #b9b4d4;
  --mm-font-ui: var(--vc-font-ui, 'Inter', system-ui, sans-serif);
  --mm-font-display: var(--vc-font-display, 'Inter', system-ui, sans-serif);
  position: fixed; inset: 0; z-index: 10000;
  background: radial-gradient(ellipse at 50% 30%, var(--mm-twilight-1), var(--mm-twilight-0) 75%);
  color: var(--mm-ink); font: 14px var(--mm-font-ui);
  display: flex; flex-direction: column; overflow: hidden;
  transition: --mm-accent .8s ease;
}
.mm-overlay * { box-sizing: border-box; }

.mm-topbar { display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  position: relative; z-index: 4; }
.mm-title { font: 600 13px var(--mm-font-ui); color: var(--mm-ink-soft);
  letter-spacing: .04em; text-transform: uppercase; margin-right: auto;
  display: flex; align-items: center; gap: 8px; }
.mm-select { font: inherit; color: var(--mm-ink); background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 6px 10px; }
.mm-select option { color: #111; }
.mm-close { background: rgba(255,255,255,.06); color: var(--mm-ink); border: 0;
  width: 36px; height: 36px; border-radius: 50%; font-size: 20px; cursor: pointer;
  line-height: 1; }
.mm-close:hover { background: rgba(255,255,255,.14); }

.mm-stage { position: relative; flex: 1; min-height: 0; overflow: hidden;
  display: flex; align-items: center; justify-content: center; }

/* Ambilight: glow da cor accent atrás da mídia ativa */
.mm-ambilight { position: absolute; inset: -12%; z-index: 0; pointer-events: none;
  background: radial-gradient(circle at 50% 45%, var(--mm-accent), transparent 62%);
  filter: blur(70px); opacity: .55;
  transition: opacity .8s ease; }

.mm-layers { position: absolute; inset: 0; z-index: 1; }
.mm-layer { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; opacity: 0; transition: opacity .9s ease; }
.mm-layer.mm-on { opacity: 1; }
.mm-layer img, .mm-layer video { max-width: 92%; max-height: 100%;
  object-fit: contain; border-radius: 10px;
  box-shadow: 0 30px 80px -20px rgba(0,0,0,.8); background: #000; }

/* Ken Burns nas fotos/posters */
.mm-kenburns { animation: mm-kenburns 14s ease-out both; }
@keyframes mm-kenburns {
  from { transform: scale(1.02) translate3d(0,0,0); }
  to   { transform: scale(1.12) translate3d(-1.5%, -1%, 0); }
}

.mm-vbadge { position: absolute; top: 10px; left: 10px; z-index: 3;
  font: 600 11px var(--mm-font-ui); color: var(--mm-ink);
  background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.2);
  padding: 3px 9px; border-radius: 999px; pointer-events: none; }

.mm-caption { position: absolute; left: 0; right: 0; bottom: 18px; z-index: 3;
  text-align: center; padding: 0 18px; pointer-events: none;
  text-shadow: 0 2px 18px rgba(0,0,0,.85); }
.mm-cap-title { font: 600 clamp(18px, 3.4vw, 30px) var(--mm-font-display);
  color: #fff; line-height: 1.15; }
.mm-cap-meta { margin-top: 4px; font: 500 13px var(--mm-font-ui);
  color: var(--mm-ink-soft); letter-spacing: .02em; }

.mm-empty { position: relative; z-index: 2; color: var(--mm-ink-soft);
  text-align: center; max-width: 320px; line-height: 1.5; }

/* Filmstrip */
.mm-filmstrip { display: flex; gap: 8px; overflow-x: auto; padding: 10px 16px;
  position: relative; z-index: 4; scrollbar-width: thin; }
.mm-thumb { flex: 0 0 auto; width: 64px; height: 44px; border-radius: 6px;
  overflow: hidden; border: 2px solid transparent; cursor: pointer;
  background: rgba(255,255,255,.05); padding: 0; opacity: .55;
  transition: opacity .25s ease, border-color .25s ease; }
.mm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-thumb.mm-cur { opacity: 1; border-color: var(--mm-accent); }
.mm-thumb:hover { opacity: .85; }

/* Controles + anel de tempo (assinatura) */
.mm-controls { display: flex; align-items: center; justify-content: center; gap: 18px;
  padding: 6px 16px 18px; position: relative; z-index: 4; }
.mm-btn { background: rgba(255,255,255,.07); color: var(--mm-ink); border: 0;
  width: 46px; height: 46px; border-radius: 50%; font-size: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; line-height: 1; }
.mm-btn:hover { background: rgba(255,255,255,.16); }
.mm-btn:focus-visible { outline: 2px solid var(--mm-accent); outline-offset: 2px; }

.mm-ring-wrap { position: relative; width: 72px; height: 72px; flex: 0 0 auto; }
.mm-ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.mm-ring-track { fill: none; stroke: rgba(255,255,255,.12); stroke-width: 4; }
.mm-ring-bar { fill: none; stroke: var(--mm-accent); stroke-width: 4;
  stroke-linecap: round; filter: drop-shadow(0 0 6px var(--mm-accent)); }
.mm-playpause { position: absolute; inset: 0; margin: auto; width: 52px; height: 52px;
  border-radius: 50%; border: 0; cursor: pointer; font-size: 20px;
  background: rgba(255,255,255,.1); color: #fff;
  display: flex; align-items: center; justify-content: center; }
.mm-playpause:hover { background: rgba(255,255,255,.2); }

@media (max-width: 640px) {
  .mm-layer img, .mm-layer video { max-width: 100%; border-radius: 0; }
  .mm-controls { gap: 12px; }
  .mm-btn { width: 52px; height: 52px; } /* alvo de toque maior no iPhone */
}

@media (prefers-reduced-motion: reduce) {
  .mm-layer { transition: none; }
  .mm-ambilight { transition: none; }
  .mm-overlay { transition: none; }
  .mm-kenburns { animation: none; }
}
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'mm-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// Mesmo padrão de photos-picker/statement-import: com PAT lê via API (fresco),
// sem PAT lê o trips.json público. Render-only — nunca escreve.
async function loadAllTrips() {
  if (settings.isUnlocked()) {
    const { content } = await getTripsFile({ token: settings.getToken() });
    return content.trips || [];
  }
  const res = await fetch('data/trips.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha lendo trips.json');
  const data = await res.json();
  return data.trips || [];
}

// ── Helpers de item ────────────────────────────────────────────────────────
const isVideoItem = (it) => it.type === 'memory_video' || it.type === 'video';
const isPosterOnly = (it) => it.type === 'video_link'; // href morto → não navega
const posterOf = (it) => it.poster || it.thumb || it.src || '';
const accentOf = (it) => (HEX6.test(it.accent || '') ? it.accent : DEFAULT_ACCENT);
const dwellOf = (it) => {
  if (isVideoItem(it)) {
    const d = Number(it.duration);
    return Number.isFinite(d) && d > 0 ? Math.max(4000, Math.min(d * 1000, 20000)) : VIDEO_DWELL_MS;
  }
  return STILL_DWELL_MS;
};

function renderableItems(trip) {
  const gallery = trip?.media?.gallery || [];
  return gallery.filter((it) => RENDERABLE.has(it?.type) && (it.src || it.poster || it.thumb));
}

// ── Componente ───────────────────────────────────────────────────────────
export function openMemoryMode({ trips = null, defaultTripId = null } = {}) {
  ensureCss();

  const state = {
    trips: trips || [],
    tripId: null,
    items: [],
    index: 0,
    playing: true,
    activeLayer: 0, // 0/1 — qual .mm-layer está visível
    raf: 0,
    ringStart: 0,
    ringElapsed: 0, // ms acumulados (para pausar/retomar)
    closed: false,
  };

  const overlay = document.createElement('div');
  overlay.className = 'mm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Modo Memória');
  overlay.innerHTML = `
    <div class="mm-topbar">
      <span class="mm-title">🎞 Modo Memória</span>
      <select class="mm-select" aria-label="Escolher viagem"></select>
      <button type="button" class="mm-close" aria-label="Fechar (Esc)">×</button>
    </div>
    <div class="mm-stage">
      <div class="mm-ambilight"></div>
      <div class="mm-layers">
        <div class="mm-layer" data-layer="0"></div>
        <div class="mm-layer" data-layer="1"></div>
      </div>
      <div class="mm-caption" hidden>
        <div class="mm-cap-title"></div>
        <div class="mm-cap-meta"></div>
      </div>
    </div>
    <div class="mm-filmstrip" role="tablist" aria-label="Memórias"></div>
    <div class="mm-controls">
      <button type="button" class="mm-btn" data-act="prev" aria-label="Anterior">⏮</button>
      <div class="mm-ring-wrap">
        <svg class="mm-ring" viewBox="0 0 72 72" aria-hidden="true">
          <circle class="mm-ring-track" cx="36" cy="36" r="32"></circle>
          <circle class="mm-ring-bar" cx="36" cy="36" r="32"></circle>
        </svg>
        <button type="button" class="mm-playpause" data-act="toggle" aria-label="Pausar/Tocar">⏸</button>
      </div>
      <button type="button" class="mm-btn" data-act="next" aria-label="Próxima">⏭</button>
      <button type="button" class="mm-btn" data-act="shuffle" aria-label="Aleatório">🔀</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const stage = overlay.querySelector('.mm-stage');
  const layers = [...overlay.querySelectorAll('.mm-layer')];
  const capBox = overlay.querySelector('.mm-caption');
  const capTitle = overlay.querySelector('.mm-cap-title');
  const capMeta = overlay.querySelector('.mm-cap-meta');
  const filmstrip = overlay.querySelector('.mm-filmstrip');
  const select = overlay.querySelector('.mm-select');
  const ringBar = overlay.querySelector('.mm-ring-bar');
  const playBtn = overlay.querySelector('.mm-playpause');

  const RING_R = 32;
  const RING_C = 2 * Math.PI * RING_R;
  ringBar.style.strokeDasharray = String(RING_C);
  ringBar.style.strokeDashoffset = String(RING_C);

  // ── Virtualização: descarrega o vídeo de um layer ────────────────────────
  function unloadLayer(layerEl) {
    const v = layerEl.querySelector('video');
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load(); // libera o buffer; vídeo inativo não segura rede/memória
    }
    layerEl.innerHTML = '';
  }

  function buildMedia(item) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
    if (isVideoItem(item)) {
      const v = document.createElement('video');
      v.muted = true; // autoplay exige mudo
      v.loop = true;
      v.playsInline = true;
      v.autoplay = true;
      v.preload = 'auto';
      if (item.poster) v.poster = item.poster;
      v.src = item.src; // só a mídia ATIVA recebe src (virtualização)
      v.play?.().catch(() => { /* autoplay pode ser bloqueado; segue mudo */ });
      wrap.appendChild(v);
    } else {
      // memory_photo / image / video_link(poster-only): still com Ken Burns.
      const img = document.createElement('img');
      img.alt = item.caption || '';
      img.decoding = 'async';
      img.src = isPosterOnly(item) ? posterOf(item) : (item.src || posterOf(item));
      if (!prefersReducedMotion()) img.className = 'mm-kenburns';
      wrap.appendChild(img);
      if (isPosterOnly(item)) {
        const badge = document.createElement('span');
        badge.className = 'mm-vbadge';
        badge.textContent = '▶ vídeo';
        wrap.appendChild(badge);
      }
    }
    return wrap;
  }

  function updateCaption(item) {
    const title = item.caption || '';
    const meta = [item.place, item.date].filter(Boolean).join(' · ');
    if (!title && !meta) {
      capBox.hidden = true;
      return;
    }
    capBox.hidden = false;
    capTitle.textContent = title;
    capTitle.hidden = !title;
    capMeta.textContent = meta;
    capMeta.hidden = !meta;
  }

  function markFilmstrip() {
    [...filmstrip.children].forEach((el, i) => {
      el.classList.toggle('mm-cur', i === state.index);
      if (i === state.index) el.setAttribute('aria-selected', 'true');
      else el.removeAttribute('aria-selected');
    });
    filmstrip.children[state.index]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  // ── Anel de tempo (assinatura) ───────────────────────────────────────────
  function stopRing() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
  function setRing(progress) {
    ringBar.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, Math.max(0, progress))));
  }
  function runRing() {
    stopRing();
    const dwell = dwellOf(state.items[state.index]);
    state.ringStart = performance.now() - state.ringElapsed;
    const tick = (now) => {
      if (state.closed) return;
      state.ringElapsed = now - state.ringStart;
      const progress = state.ringElapsed / dwell;
      setRing(progress);
      if (progress >= 1) {
        state.ringElapsed = 0;
        advance(1);
        return;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  // ── Mostrar item (crossfade + virtualização) ─────────────────────────────
  function show(index, { resetRing = true } = {}) {
    if (!state.items.length) return;
    state.index = ((index % state.items.length) + state.items.length) % state.items.length;
    const item = state.items[state.index];

    const incoming = (state.activeLayer + 1) % 2;
    const incomingEl = layers[incoming];
    const outgoingEl = layers[state.activeLayer];

    unloadLayer(incomingEl);
    incomingEl.appendChild(buildMedia(item));

    overlay.style.setProperty('--mm-accent', accentOf(item));
    updateCaption(item);

    // crossfade
    incomingEl.classList.add('mm-on');
    outgoingEl.classList.remove('mm-on');
    state.activeLayer = incoming;

    // após o fade, descarrega o layer que saiu (vídeo inativo → unload)
    const cleanupDelay = prefersReducedMotion() ? 0 : 950;
    window.setTimeout(() => {
      if (!state.closed && layers[state.activeLayer] !== outgoingEl) unloadLayer(outgoingEl);
    }, cleanupDelay);

    markFilmstrip();
    if (resetRing) state.ringElapsed = 0;
    if (state.playing) runRing();
    else { stopRing(); setRing(state.ringElapsed / dwellOf(item)); }
  }

  function advance(dir) {
    state.ringElapsed = 0;
    show(state.index + dir);
  }

  function setPlaying(p) {
    state.playing = p;
    playBtn.textContent = p ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', p ? 'Pausar' : 'Tocar');
    // pausa/retoma os vídeos do layer ativo junto com o anel
    const v = layers[state.activeLayer].querySelector('video');
    if (v) { p ? v.play?.().catch(() => {}) : v.pause(); }
    if (p) runRing();
    else stopRing();
  }

  function shuffle() {
    if (state.items.length < 2) return;
    let next = state.index;
    while (next === state.index) next = Math.floor(Math.random() * state.items.length);
    advance(next - state.index);
  }

  // ── Filmstrip + select ────────────────────────────────────────────────────
  function buildFilmstrip() {
    filmstrip.innerHTML = state.items
      .map(
        (it, i) =>
          `<button type="button" class="mm-thumb" role="tab" data-i="${i}" aria-label="Memória ${i + 1}">
             <img src="${esc(posterOf(it))}" alt="" loading="lazy"/>
           </button>`,
      )
      .join('');
    filmstrip.querySelectorAll('.mm-thumb').forEach((el) =>
      el.addEventListener('click', () => { state.ringElapsed = 0; show(Number(el.dataset.i)); }),
    );
  }

  function loadTrip(tripId) {
    const trip = state.trips.find((t) => t.id === tripId);
    state.tripId = tripId;
    state.items = renderableItems(trip);
    state.index = 0;
    state.ringElapsed = 0;
    layers.forEach(unloadLayer);
    layers.forEach((l) => l.classList.remove('mm-on'));
    if (!state.items.length) {
      capBox.hidden = true;
      filmstrip.innerHTML = '';
      stage.querySelector('.mm-empty')?.remove();
      const empty = document.createElement('div');
      empty.className = 'mm-empty';
      empty.textContent = 'Esta viagem ainda não tem memórias na galeria (media.gallery).';
      stage.appendChild(empty);
      setRing(0);
      return;
    }
    stage.querySelector('.mm-empty')?.remove();
    buildFilmstrip();
    show(0);
  }

  function fillSelect() {
    const withItems = state.trips.filter((t) => renderableItems(t).length > 0);
    const pool = withItems.length ? withItems : state.trips;
    select.innerHTML = pool
      .map((t) => `<option value="${esc(t.id)}">${esc(t.name || t.id)}</option>`)
      .join('');
    const initial =
      (defaultTripId && pool.some((t) => t.id === defaultTripId) && defaultTripId) ||
      pool[0]?.id ||
      null;
    if (initial) {
      select.value = initial;
      loadTrip(initial);
    }
  }

  // ── Eventos ────────────────────────────────────────────────────────────────
  function close() {
    if (state.closed) return;
    state.closed = true;
    stopRing();
    layers.forEach(unloadLayer);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === 'Escape') { close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); advance(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); advance(-1); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  }
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.mm-close').addEventListener('click', close);
  select.addEventListener('change', (e) => { setPlaying(true); loadTrip(e.target.value); });
  overlay.querySelector('.mm-controls').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') advance(-1);
    else if (act === 'next') advance(1);
    else if (act === 'toggle') setPlaying(!state.playing);
    else if (act === 'shuffle') shuffle();
  });

  // ── Boot ────────────────────────────────────────────────────────────────
  (async () => {
    try {
      if (!state.trips.length) state.trips = await loadAllTrips();
      if (state.closed) return;
      fillSelect();
    } catch (e) {
      const empty = document.createElement('div');
      empty.className = 'mm-empty';
      empty.textContent = `Falha carregando viagens: ${e.message}`;
      stage.appendChild(empty);
    }
  })();

  return { close };
}
