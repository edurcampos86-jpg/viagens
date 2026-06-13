// Herói cinematográfico da "Última memória" na home (Frente B). Mesma
// linguagem visual do Modo Memória (.mm-), mas MONTADO numa seção da home
// (não é overlay fullscreen) e alimentado por um feed pronto de memórias
// (ver src/core/recent-memories.js). SÓ RENDERIZA — não ingere, não escreve.
//
// Assinaturas reaproveitadas: Ambilight repintando o accent ao redor do palco,
// Ken Burns nas fotos, crossfade entre memórias, ANEL de tempo de auto-avanço,
// dots + filmstrip e CTA "Ver álbum". Vídeo é poster-first, mudo, autoplay e só
// o item ATIVO recebe src (virtualização — vídeo inativo é pausado/descarregado).
//
// Conservador: qualquer falha de render deve estourar para o caller (app.js),
// que cai no card legado. Tokens/fontes escopados em .mh- — nada vaza.

import {
  DEFAULT_ACCENT,
  isVideoItem,
  posterOf,
  accentOf,
  dwellOf,
} from '../core/memory-items.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function prettyDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${+m[3]} ${MESES[+m[2] - 1]} ${m[1]}` : '';
}

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

let cssInjected = false;
const CSS = `
@property --mh-accent { syntax: '<color>'; inherits: true; initial-value: ${DEFAULT_ACCENT}; }

.mh-hero {
  --mh-accent: ${DEFAULT_ACCENT};
  --mh-ink: #f4f2ff;
  --mh-ink-soft: #c4bfdd;
  position: relative;
  font-family: var(--vc-font-ui, 'Manrope', system-ui, sans-serif);
  border-radius: 18px;
  isolation: isolate;
}
.mh-hero * { box-sizing: border-box; }

/* Ambilight: glow do accent que sangra ao redor do palco (repinta a página) */
.mh-ambilight {
  position: absolute; inset: -34px; z-index: 0; pointer-events: none;
  border-radius: 28px;
  background: radial-gradient(58% 58% at 50% 38%, var(--mh-accent), transparent 72%);
  filter: blur(58px); opacity: .5;
  transition: --mh-accent .8s ease, opacity .8s ease;
}

.mh-stage {
  position: relative; z-index: 1; overflow: hidden;
  border-radius: 18px;
  aspect-ratio: 16 / 9; max-height: 60vh; width: 100%;
  background: radial-gradient(ellipse at 50% 22%, #15111f, #0a0a13 82%);
  box-shadow: 0 24px 70px -28px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.05) inset;
  display: flex; align-items: center; justify-content: center;
}

.mh-layers { position: absolute; inset: 0; z-index: 1; }
.mh-layer {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .9s ease;
}
.mh-layer.mh-on { opacity: 1; }
.mh-layer img, .mh-layer video {
  max-width: 94%; max-height: 96%; object-fit: contain; border-radius: 8px;
  box-shadow: 0 24px 60px -22px rgba(0,0,0,.85); background: #000;
}
.mh-kenburns { animation: mh-kenburns 14s ease-out both; }
@keyframes mh-kenburns {
  from { transform: scale(1.02) translate3d(0,0,0); }
  to   { transform: scale(1.12) translate3d(-1.4%, -1%, 0); }
}

.mh-vbadge {
  position: absolute; top: 12px; left: 12px; z-index: 3;
  font: 600 11px var(--vc-font-ui, 'Manrope', sans-serif); color: var(--mh-ink);
  background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.22);
  padding: 3px 9px; border-radius: 999px; pointer-events: none;
}

/* Scrim + legenda */
.mh-scrim {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: linear-gradient(to top, rgba(5,5,12,.82) 0%, rgba(5,5,12,.18) 38%, transparent 60%);
}
.mh-cap {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 3;
  padding: 20px 22px; pointer-events: none; text-shadow: 0 2px 18px rgba(0,0,0,.7);
}
.mh-cap-kicker {
  font: 700 11px var(--vc-font-ui, 'Manrope', sans-serif); color: var(--mh-ink-soft);
  letter-spacing: .12em; text-transform: uppercase; margin-bottom: 6px;
}
.mh-cap-title {
  margin: 0; color: #fff; line-height: 1.1;
  font: 600 clamp(22px, 3.6vw, 38px) var(--vc-font-display, 'Fraunces', Georgia, serif);
  letter-spacing: -.01em;
}
.mh-cap-meta { margin-top: 6px; font: 500 13px var(--vc-font-ui, 'Manrope', sans-serif);
  color: var(--mh-ink-soft); }

/* Anel de tempo (assinatura) — auto-avanço */
.mh-ring-wrap { position: absolute; top: 14px; right: 14px; z-index: 4; width: 44px; height: 44px; }
.mh-ring { position: absolute; inset: 0; transform: rotate(-90deg); }
.mh-ring-track { fill: none; stroke: rgba(255,255,255,.16); stroke-width: 3; }
.mh-ring-bar { fill: none; stroke: var(--mh-accent); stroke-width: 3; stroke-linecap: round;
  filter: drop-shadow(0 0 5px var(--mh-accent)); }
.mh-playpause {
  position: absolute; inset: 0; margin: auto; width: 32px; height: 32px;
  border: 0; border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1;
  background: rgba(0,0,0,.42); color: #fff;
  display: flex; align-items: center; justify-content: center;
}
.mh-playpause:hover { background: rgba(0,0,0,.6); }

/* Setas de navegação sobre o palco */
.mh-nav {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 4;
  width: 44px; height: 44px; border: 0; border-radius: 50%; cursor: pointer;
  background: rgba(10,8,20,.42); color: #fff; font-size: 26px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .25s ease;
}
.mh-stage:hover .mh-nav, .mh-nav:focus-visible { opacity: 1; }
.mh-prev { left: 12px; }
.mh-next { right: 12px; }

/* Dots */
.mh-dots {
  position: absolute; left: 0; right: 0; bottom: 12px; z-index: 4;
  display: flex; gap: 7px; justify-content: center; pointer-events: auto;
}
.mh-dot {
  width: 8px; height: 8px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: rgba(255,255,255,.34); transition: background .25s ease, transform .25s ease;
}
.mh-dot.mh-cur { background: var(--mh-accent); transform: scale(1.35); }

/* Rail abaixo do palco: filmstrip + CTA */
.mh-rail {
  position: relative; z-index: 1;
  display: flex; align-items: center; gap: 14px; margin-top: 14px;
}
.mh-strip { display: flex; gap: 8px; overflow-x: auto; flex: 1; min-width: 0;
  scrollbar-width: thin; padding-bottom: 2px; }
.mh-thumb {
  flex: 0 0 auto; width: 62px; height: 44px; border-radius: 7px; overflow: hidden;
  border: 2px solid transparent; cursor: pointer; padding: 0; opacity: .5;
  background: rgba(0,0,0,.06); transition: opacity .25s ease, border-color .25s ease;
}
.mh-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mh-thumb.mh-cur { opacity: 1; border-color: var(--mh-accent); }
.mh-thumb:hover { opacity: .85; }
.mh-cta {
  flex: 0 0 auto; cursor: pointer;
  font: 600 14px var(--vc-font-ui, 'Manrope', sans-serif);
  color: #fff; background: var(--mh-accent);
  border: 0; border-radius: 999px; padding: 11px 20px;
  box-shadow: 0 8px 24px -10px var(--mh-accent);
  transition: filter .2s ease, --mh-accent .8s ease;
}
.mh-cta:hover { filter: brightness(1.08); }

.mh-hero :focus-visible { outline: 2px solid var(--mh-accent); outline-offset: 3px; }

@media (max-width: 720px) {
  .mh-stage { aspect-ratio: 4 / 5; max-height: 72vh; }
  .mh-nav { opacity: 1; width: 40px; height: 40px; } /* sempre visível no toque */
  .mh-cap-title { font-size: clamp(20px, 6vw, 28px); }
  .mh-rail { flex-direction: column; align-items: stretch; }
  .mh-cta { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .mh-layer { transition: none; }
  .mh-ambilight, .mh-hero .mh-cta { transition: none; }
  .mh-kenburns { animation: none; }
}
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'mh-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

// Monta o herói em `container`. Devolve { destroy }. Lança se memories vazio
// (o caller trata como sinal de fallback).
export function mountMemoryHero(container, { memories = [], onSeeAlbum = null } = {}) {
  if (!container) throw new Error('memory-hero: container ausente');
  const items = Array.isArray(memories) ? memories.filter((m) => m && (m.src || m.poster || m.thumb)) : [];
  if (!items.length) throw new Error('memory-hero: sem memórias');

  ensureCss();

  const multi = items.length > 1;
  const state = {
    index: 0,
    playing: !prefersReducedMotion() && multi, // reduced-motion ou item único → sem auto-avanço
    activeLayer: 0,
    raf: 0,
    ringStart: 0,
    ringElapsed: 0,
    destroyed: false,
  };

  const root = document.createElement('section');
  root.className = 'mh-hero';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Última memória');
  root.innerHTML = `
    <div class="mh-ambilight" aria-hidden="true"></div>
    <div class="mh-stage">
      <div class="mh-layers">
        <div class="mh-layer" data-layer="0"></div>
        <div class="mh-layer" data-layer="1"></div>
      </div>
      <div class="mh-scrim" aria-hidden="true"></div>
      <div class="mh-cap">
        <div class="mh-cap-kicker"></div>
        <h3 class="mh-cap-title"></h3>
        <div class="mh-cap-meta"></div>
      </div>
      <div class="mh-ring-wrap" ${multi ? '' : 'hidden'}>
        <svg class="mh-ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle class="mh-ring-track" cx="22" cy="22" r="19"></circle>
          <circle class="mh-ring-bar" cx="22" cy="22" r="19"></circle>
        </svg>
        <button type="button" class="mh-playpause" data-act="toggle" aria-label="Pausar"></button>
      </div>
      <button type="button" class="mh-nav mh-prev" data-act="prev" aria-label="Memória anterior" ${multi ? '' : 'hidden'}>‹</button>
      <button type="button" class="mh-nav mh-next" data-act="next" aria-label="Próxima memória" ${multi ? '' : 'hidden'}>›</button>
      <div class="mh-dots" role="tablist" aria-label="Memórias" ${multi ? '' : 'hidden'}></div>
    </div>
    <div class="mh-rail">
      <div class="mh-strip" ${multi ? '' : 'hidden'}></div>
      <button type="button" class="mh-cta" data-act="album">Ver álbum →</button>
    </div>
  `;
  container.replaceChildren(root);

  const layers = [...root.querySelectorAll('.mh-layer')];
  const capKicker = root.querySelector('.mh-cap-kicker');
  const capTitle = root.querySelector('.mh-cap-title');
  const capMeta = root.querySelector('.mh-cap-meta');
  const ringBar = root.querySelector('.mh-ring-bar');
  const playBtn = root.querySelector('.mh-playpause');
  const dotsBox = root.querySelector('.mh-dots');
  const strip = root.querySelector('.mh-strip');

  const RING_R = 19;
  const RING_C = 2 * Math.PI * RING_R;
  ringBar.style.strokeDasharray = String(RING_C);
  ringBar.style.strokeDashoffset = String(RING_C);

  function unloadLayer(layerEl) {
    const v = layerEl.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    layerEl.replaceChildren();
  }

  function buildMedia(item) {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;';
    if (isVideoItem(item)) {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'auto';
      if (posterOf(item)) v.poster = posterOf(item);
      v.src = item.src; // só a mídia ATIVA recebe src (virtualização)
      v.play?.().catch(() => { /* autoplay pode ser bloqueado; segue com poster */ });
      wrap.appendChild(v);
    } else {
      const img = document.createElement('img');
      img.alt = item.caption || item.tripName || '';
      img.decoding = 'async';
      img.src = item.src || posterOf(item);
      if (!prefersReducedMotion()) img.className = 'mh-kenburns';
      wrap.appendChild(img);
    }
    return wrap;
  }

  function updateCaption(item) {
    capKicker.textContent = item.tripName || '';
    capKicker.hidden = !item.tripName;
    capTitle.textContent = item.caption || item.tripName || 'Memória';
    capMeta.textContent = prettyDate(item.date);
    capMeta.hidden = !capMeta.textContent;
  }

  function markActive() {
    [...dotsBox.children].forEach((d, i) => d.classList.toggle('mh-cur', i === state.index));
    [...strip.children].forEach((t, i) => {
      t.classList.toggle('mh-cur', i === state.index);
      if (i === state.index) t.setAttribute('aria-selected', 'true');
      else t.removeAttribute('aria-selected');
    });
    strip.children[state.index]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }

  function stopRing() { if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; }
  function setRing(p) {
    ringBar.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, Math.max(0, p))));
  }
  function runRing() {
    stopRing();
    if (!multi) return;
    const dwell = dwellOf(items[state.index]);
    state.ringStart = performance.now() - state.ringElapsed;
    const tick = (now) => {
      if (state.destroyed) return;
      state.ringElapsed = now - state.ringStart;
      const p = state.ringElapsed / dwell;
      setRing(p);
      if (p >= 1) { state.ringElapsed = 0; advance(1); return; }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }

  function show(index, { resetRing = true } = {}) {
    const n = items.length;
    state.index = ((index % n) + n) % n;
    const item = items[state.index];

    const incoming = (state.activeLayer + 1) % 2;
    const incomingEl = layers[incoming];
    const outgoingEl = layers[state.activeLayer];

    unloadLayer(incomingEl);
    incomingEl.appendChild(buildMedia(item));

    root.style.setProperty('--mh-accent', accentOf(item));
    updateCaption(item);

    incomingEl.classList.add('mh-on');
    outgoingEl.classList.remove('mh-on');
    state.activeLayer = incoming;

    const cleanupDelay = prefersReducedMotion() ? 0 : 950;
    window.setTimeout(() => {
      if (!state.destroyed && layers[state.activeLayer] !== outgoingEl) unloadLayer(outgoingEl);
    }, cleanupDelay);

    markActive();
    if (resetRing) state.ringElapsed = 0;
    if (state.playing) runRing();
    else { stopRing(); setRing(state.ringElapsed / dwellOf(item)); }
  }

  function advance(dir) { state.ringElapsed = 0; show(state.index + dir); }

  function setPlaying(p) {
    state.playing = p && multi;
    playBtn.textContent = state.playing ? '❙❙' : '►';
    playBtn.setAttribute('aria-label', state.playing ? 'Pausar' : 'Tocar');
    const v = layers[state.activeLayer].querySelector('video');
    if (v) { state.playing ? v.play?.().catch(() => {}) : v.pause(); }
    if (state.playing) runRing();
    else stopRing();
  }

  function buildChrome() {
    if (!multi) return;
    dotsBox.innerHTML = items
      .map((_, i) => `<button type="button" class="mh-dot" role="tab" data-i="${i}" aria-label="Memória ${i + 1}"></button>`)
      .join('');
    strip.innerHTML = items
      .map(
        (it, i) =>
          `<button type="button" class="mh-thumb" role="tab" data-i="${i}" aria-label="Memória ${i + 1}">
             <img src="${esc(posterOf(it))}" alt="" loading="lazy"/>
           </button>`,
      )
      .join('');
    const jump = (i) => { state.ringElapsed = 0; show(i); };
    dotsBox.querySelectorAll('.mh-dot').forEach((d) =>
      d.addEventListener('click', () => jump(Number(d.dataset.i))),
    );
    strip.querySelectorAll('.mh-thumb').forEach((t) =>
      t.addEventListener('click', () => jump(Number(t.dataset.i))),
    );
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'prev') advance(-1);
    else if (act === 'next') advance(1);
    else if (act === 'toggle') setPlaying(!state.playing);
    else if (act === 'album') {
      const item = items[state.index];
      if (typeof onSeeAlbum === 'function') onSeeAlbum(item.tripId, item);
    }
  }
  root.addEventListener('click', onClick);

  buildChrome();
  playBtn.textContent = state.playing ? '❙❙' : '►';
  playBtn.setAttribute('aria-label', state.playing ? 'Pausar' : 'Tocar');
  show(0);

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    stopRing();
    layers.forEach(unloadLayer);
    root.removeEventListener('click', onClick);
    root.remove();
  }

  return { destroy };
}
