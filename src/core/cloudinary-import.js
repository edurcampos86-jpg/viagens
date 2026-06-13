// Núcleo PURO da ingestão iPhone→Cloudinary — sem DOM, sem fetch.
// Roda em Node para teste. A parte de rede/canvas/UI vive em
// src/components/cloudinary-picker.js.
//
// Modelo: mídia cheia vive no CDN (Cloudinary); o repo guarda só um POSTER
// leve (.webp). O item resultante é memory_video/memory_photo (schema Fase 1):
//   src    = URL de entrega do CDN (vídeo .mp4 transcodificado / foto f_auto)
//   poster = caminho LOCAL do .webp commitado em media/<trip>/ (placeholder)
//   thumb  = poster (compat com o grid legado: renderAlbumItem usa thumb||src)
//
// CONFIG PÚBLICA (não é segredo): cloud_name + unsigned upload preset são
// projetados para uso client-side; a proteção vem do preset unsigned restrito
// no painel do Cloudinary (pasta/limites), não de sigilo. Por isso ficam no repo.

import { sanitizeIdTail, isoToDate, MAX_GALLERY_ITEMS } from './photos-import.js';

export { MAX_GALLERY_ITEMS };

export const CLOUDINARY = {
  cloudName: 'ddskumzp3',
  uploadPreset: 'vida-carreira-memorias',
};

const RES_BASE = 'https://res.cloudinary.com';
const API_BASE = 'https://api.cloudinary.com/v1_1';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100MB — acima disso, pula
export const POSTER_WIDTH = 640; // largura do poster local (.webp leve)

// Aspectos comuns para "snap" (tolerância 3%); fora disso, reduz por gcd.
const COMMON_ASPECTS = [
  [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [4, 5], [5, 4], [1, 1], [21, 9],
];

// video → resource_type 'video'; qualquer outro (incl. HEIC) → 'image'.
export function resourceTypeForFile(file) {
  return String(file?.type || '').startsWith('video/') ? 'video' : 'image';
}

// Endpoint de upload UNSIGNED (a UI faz POST com FormData {file, upload_preset}).
export function cloudinaryUploadUrl(resourceType, cloud = CLOUDINARY.cloudName) {
  return `${API_BASE}/${cloud}/${resourceType}/upload`;
}

// URL de ENTREGA (src do item). Vídeo: força .mp4 (h264) — cross-browser,
// transcodifica HEVC/.mov. Imagem: f_auto,q_auto (webp/avif conforme browser).
export function cloudinaryDeliveryUrl(publicId, resourceType, cloud = CLOUDINARY.cloudName) {
  const id = String(publicId || '');
  if (resourceType === 'video') return `${RES_BASE}/${cloud}/video/upload/q_auto/${id}.mp4`;
  return `${RES_BASE}/${cloud}/image/upload/f_auto,q_auto/${id}`;
}

// URL do POSTER (.webp) gerado pelo Cloudinary — a UI baixa e commita local.
// Vídeo: frame em 0s (so_0). Imagem: redimensiona p/ POSTER_WIDTH.
export function cloudinaryPosterUrl(publicId, resourceType, width = POSTER_WIDTH, cloud = CLOUDINARY.cloudName) {
  const id = String(publicId || '');
  if (resourceType === 'video') {
    return `${RES_BASE}/${cloud}/video/upload/so_0,w_${width},f_webp,q_auto/${id}.webp`;
  }
  return `${RES_BASE}/${cloud}/image/upload/w_${width},f_webp,q_auto/${id}.webp`;
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a || 1;
}

// "W:H" para o layout do modo memória. Snap a um aspecto comum (≤3% de erro)
// ou reduz por gcd. Dimensões inválidas → null.
export function aspectRatio(w, h) {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const r = w / h;
  for (const [aw, ah] of COMMON_ASPECTS) {
    if (Math.abs(r - aw / ah) / (aw / ah) <= 0.03) return `${aw}:${ah}`;
  }
  const g = gcd(Math.round(w), Math.round(h));
  return `${Math.round(w) / g}:${Math.round(h) / g}`;
}

// Item de media.gallery[] no shape do schema (additionalProperties:false).
// Produz memory_video/memory_photo. thumb=poster para compat com o grid legado.
export function galleryItemFromCdn({
  resourceType,
  publicId,
  src,
  poster,
  width,
  height,
  caption,
  date,
  accent,
  aspect,
} = {}) {
  const isVideo = resourceType === 'video';
  const item = {
    type: isVideo ? 'memory_video' : 'memory_photo',
    src,
    poster,
    thumb: poster, // compat: renderAlbumItem usa thumb||src → mostra o poster, não o .mp4
    provider: 'cloudinary',
    origin: 'ajustado',
    source_id: publicId,
  };
  const asp = aspect || aspectRatio(width, height);
  if (asp) item.aspect = asp;
  if (typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent)) item.accent = accent;
  if (Number.isInteger(width) && width > 0) item.width = width;
  if (Number.isInteger(height) && height > 0) item.height = height;
  if (caption) item.caption = String(caption).slice(0, 280);
  const d = isoToDate(date) || (/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : null);
  if (d) item.date = d;
  return item;
}

// Reexport util de path do poster (mesma convenção determinística do picker).
export { posterFilePath } from './photos-import.js';
export { sanitizeIdTail };
