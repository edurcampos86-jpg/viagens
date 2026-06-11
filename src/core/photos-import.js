// Núcleo PURO do importador Google Photos Picker — sem DOM, sem fetch.
// Tudo aqui roda em Node para os testes (tests/photos-import.test.mjs);
// a parte de rede/canvas/UI vive em src/components/photos-picker.js.
//
// Contratos que este módulo fixa:
//   - normalização do mediaItem do Picker (picker → forma interna estável)
//   - nome determinístico do arquivo em media/<tripId>/ (re-import não
//     duplica arquivo: mesmo source_id ⇒ mesmo path)
//   - item de media.gallery no shape do schema (origin:'ajustado' +
//     source_id — campos aditivos, ver trip.schema.json)
//   - merge com dedup por source_id/src e teto de 30 itens (hard no schema)

export const MAX_GALLERY_ITEMS = 30;
export const IMAGE_MAX_DIM = 1600;
export const THUMB_MAX_DIM = 320;
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024; // acima disso, pulamos o vídeo

// "5s" / "5.0s" / "1800s" (protobuf Duration) → ms. Tolerante: qualquer
// coisa não-parseável cai no fallback.
export function durationToMs(d, fallbackMs = 5000) {
  if (typeof d === 'number' && Number.isFinite(d) && d >= 0) return d * 1000;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(String(d || '').trim());
  if (!m) return fallbackMs;
  return Math.round(parseFloat(m[1]) * 1000);
}

// Sufixo estável e seguro para nome de arquivo a partir do id (longo,
// base64url) do mediaItem. Últimos N chars válidos, minúsculos.
export function sanitizeIdTail(id, len = 12) {
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  const tail = clean.slice(-len).toLowerCase();
  return tail || 'item';
}

// Paths determinísticos no repo. Re-import do mesmo mediaItem sobrescreve o
// mesmo arquivo em vez de acumular cópias.
export function mediaFilePath(tripId, sourceId, ext) {
  return `media/${tripId}/gp-${sanitizeIdTail(sourceId)}.${ext}`;
}
export function thumbFilePath(tripId, sourceId) {
  return `media/${tripId}/gp-${sanitizeIdTail(sourceId)}-thumb.webp`;
}
export function posterFilePath(tripId, sourceId) {
  return `media/${tripId}/gp-${sanitizeIdTail(sourceId)}-poster.webp`;
}

// baseUrls do Picker exigem Authorization e parâmetro de renderização:
//   imagens: =w{W}-h{H} (limita o maior lado); vídeos: =dv (bytes do vídeo).
export function imageDownloadUrl(baseUrl, maxDim = IMAGE_MAX_DIM) {
  return `${baseUrl}=w${maxDim}-h${maxDim}`;
}
export function videoDownloadUrl(baseUrl) {
  return `${baseUrl}=dv`;
}

// mediaItem cru do Picker → forma interna estável (achatada). Não lança:
// item sem baseUrl/id volta null (a UI pula e avisa).
export function normalizePickerItem(raw) {
  const id = raw?.id;
  const file = raw?.mediaFile || {};
  if (!id || !file.baseUrl) return null;
  const meta = file.mediaFileMetadata || {};
  return {
    id,
    type: raw.type === 'VIDEO' ? 'video' : 'image',
    createTime: raw.createTime || null,
    baseUrl: file.baseUrl,
    mimeType: file.mimeType || '',
    filename: file.filename || '',
    width: Number(meta.width) || null,
    height: Number(meta.height) || null,
  };
}

// createTime ISO → 'YYYY-MM-DD' (formato `date` do schema). Inválido → null.
export function isoToDate(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T/.exec(String(iso || ''));
  return m ? m[1] : null;
}

// Item no shape de media.gallery[] do schema (additionalProperties:false —
// só os campos permitidos). origin/source_id são os campos aditivos da
// proveniência (decisão "A" do ciclo 7).
export function galleryItemFromPicker(norm, files = {}) {
  const item = {
    type: norm.type,
    src: files.src,
    origin: 'ajustado',
    source_id: norm.id,
  };
  if (files.thumb) item.thumb = files.thumb;
  if (norm.type === 'video' && files.poster) item.poster = files.poster;
  const date = isoToDate(norm.createTime);
  if (date) item.date = date;
  if (files.width) item.width = files.width;
  if (files.height) item.height = files.height;
  if (files.duration) item.duration = files.duration;
  if (files.caption) item.caption = String(files.caption).slice(0, 280);
  return item;
}

// Merge com dedup e teto. Dedup: mesmo source_id (preferência) ou mesmo src.
// Itens existentes NUNCA são removidos/reordenados; incoming entra no fim.
// Acima do teto, o excedente fica em `overflow` (a UI avisa — nada silencioso).
export function mergeGallery(existing = [], incoming = [], max = MAX_GALLERY_ITEMS) {
  const gallery = [...existing];
  const seenIds = new Set(existing.map((m) => m.source_id).filter(Boolean));
  const seenSrcs = new Set(existing.map((m) => m.src).filter(Boolean));
  const added = [];
  const dupes = [];
  const overflow = [];
  for (const item of incoming) {
    if ((item.source_id && seenIds.has(item.source_id)) || seenSrcs.has(item.src)) {
      dupes.push(item);
      continue;
    }
    if (gallery.length >= max) {
      overflow.push(item);
      continue;
    }
    gallery.push(item);
    added.push(item);
    if (item.source_id) seenIds.add(item.source_id);
    if (item.src) seenSrcs.add(item.src);
  }
  return { gallery, added, dupes, overflow };
}

// Stats consistentes com o renderer do álbum (assets/app.js calcula o
// fallback do mesmo jeito; gravamos para poupar o cliente).
export function galleryStats(gallery = []) {
  return {
    photos: gallery.filter((m) => m.type === 'image').length,
    videos: gallery.filter((m) => m.type === 'video').length,
  };
}
