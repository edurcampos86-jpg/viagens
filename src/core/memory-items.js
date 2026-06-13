// Helpers PUROS de item de memória, compartilhados entre o Modo Memória
// (src/components/memory-mode.js, palco .mm-) e o Herói da home
// (src/components/memory-hero.js, .mh-). Sem DOM, sem fetch, sem estado —
// para não duplicar a "linguagem de item" da gallery entre os dois.
//
// Contrato plano da gallery (Fase 1): item.{type,src,poster,thumb,accent,duration}.

export const DEFAULT_ACCENT = '#6d63ff'; // twilight quando o item não traz accent
export const HEX6 = /^#[0-9a-fA-F]{6}$/;

const STILL_DWELL_MS = 7000;
const VIDEO_DWELL_MS = 9000;

export const isVideoItem = (it) => it?.type === 'memory_video' || it?.type === 'video';
export const isPosterOnly = (it) => it?.type === 'video_link'; // href morto → não navega
export const posterOf = (it) => it?.poster || it?.thumb || it?.src || '';
export const accentOf = (it) => (HEX6.test(it?.accent || '') ? it.accent : DEFAULT_ACCENT);

// Quanto tempo cada item fica em cena (anel de tempo). Vídeo: usa a duração real
// (clampada 4–20s) ou um default; foto/poster: dwell fixo.
export const dwellOf = (it) => {
  if (isVideoItem(it)) {
    const d = Number(it?.duration);
    return Number.isFinite(d) && d > 0 ? Math.max(4000, Math.min(d * 1000, 20000)) : VIDEO_DWELL_MS;
  }
  return STILL_DWELL_MS;
};
