// Testes do núcleo puro do importador Google Photos Picker
// (src/core/photos-import.js). Mesmo harness leve de budget.test.mjs.
//
// Import via URL relativa (não ${ROOT}/string): o path do repo tem espaço
// ("09 - VIAGENS") e URL.pathname vira %20 — a guarda B3.3 já documentou
// essa armadilha no Windows.

import assert from 'node:assert/strict';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    failed++;
  }
}

const {
  MAX_GALLERY_ITEMS,
  durationToMs,
  sanitizeIdTail,
  mediaFilePath,
  thumbFilePath,
  posterFilePath,
  imageDownloadUrl,
  videoDownloadUrl,
  normalizePickerItem,
  isoToDate,
  galleryItemFromPicker,
  mergeGallery,
  galleryStats,
} = await import(new URL('../src/core/photos-import.js', import.meta.url));

// ── durationToMs (protobuf Duration do pollingConfig) ────────────────────
test('durationToMs: "5s" → 5000', () => assert.equal(durationToMs('5s'), 5000));
test('durationToMs: "5.0s" e "1800s"', () => {
  assert.equal(durationToMs('5.0s'), 5000);
  assert.equal(durationToMs('1800s'), 1_800_000);
});
test('durationToMs: lixo cai no fallback', () => {
  assert.equal(durationToMs(undefined, 7000), 7000);
  assert.equal(durationToMs('abc', 7000), 7000);
});

// ── nomes de arquivo determinísticos ─────────────────────────────────────
test('sanitizeIdTail: remove chars inválidos e baixa caixa', () => {
  // limpo: 'AbC123xyzXYZ_-99' → últimos 12 → minúsculo
  assert.equal(sanitizeIdTail('AbC/+=123xyzXYZ_-99'), '23xyzxyz_-99');
  assert.equal(sanitizeIdTail(''), 'item');
});
test('paths: mesmo source_id ⇒ mesmo arquivo (re-import não duplica)', () => {
  const a = mediaFilePath('sp-junho-2026', 'ABCDEF123456789', 'webp');
  const b = mediaFilePath('sp-junho-2026', 'ABCDEF123456789', 'webp');
  assert.equal(a, b);
  assert.match(a, /^media\/sp-junho-2026\/gp-[a-z0-9_-]+\.webp$/);
  assert.match(thumbFilePath('t', 'X1'), /-thumb\.webp$/);
  assert.match(posterFilePath('t', 'X1'), /-poster\.webp$/);
});

// ── URLs de download (baseUrl exige parâmetro de renderização) ───────────
test('imageDownloadUrl/videoDownloadUrl', () => {
  assert.equal(imageDownloadUrl('https://x/y', 1600), 'https://x/y=w1600-h1600');
  assert.equal(videoDownloadUrl('https://x/y'), 'https://x/y=dv');
});

// ── normalização do mediaItem ────────────────────────────────────────────
test('normalizePickerItem: achata o shape do Picker', () => {
  const n = normalizePickerItem({
    id: 'ID1',
    type: 'PHOTO',
    createTime: '2026-06-05T18:22:00Z',
    mediaFile: {
      baseUrl: 'https://lh3/abc',
      mimeType: 'image/jpeg',
      filename: 'IMG_1.jpg',
      mediaFileMetadata: { width: '4032', height: '3024' },
    },
  });
  assert.deepEqual(n, {
    id: 'ID1', type: 'image', createTime: '2026-06-05T18:22:00Z',
    baseUrl: 'https://lh3/abc', mimeType: 'image/jpeg', filename: 'IMG_1.jpg',
    width: 4032, height: 3024,
  });
});
test('normalizePickerItem: VIDEO → video; sem baseUrl → null', () => {
  assert.equal(normalizePickerItem({ id: 'v', type: 'VIDEO', mediaFile: { baseUrl: 'u' } }).type, 'video');
  assert.equal(normalizePickerItem({ id: 'x', mediaFile: {} }), null);
  assert.equal(normalizePickerItem(null), null);
});

// ── item de media.gallery (shape do schema, decisão "A") ─────────────────
test('galleryItemFromPicker: origin ajustado + source_id + date', () => {
  const norm = { id: 'SRC9', type: 'image', createTime: '2026-06-04T10:00:00Z' };
  const item = galleryItemFromPicker(norm, {
    src: 'media/sp-junho-2026/gp-src9.webp',
    thumb: 'media/sp-junho-2026/gp-src9-thumb.webp',
    width: 1600, height: 1200, caption: 'Pride na Paulista',
  });
  assert.deepEqual(item, {
    type: 'image',
    src: 'media/sp-junho-2026/gp-src9.webp',
    origin: 'ajustado',
    source_id: 'SRC9',
    thumb: 'media/sp-junho-2026/gp-src9-thumb.webp',
    date: '2026-06-04',
    width: 1600,
    height: 1200,
    caption: 'Pride na Paulista',
  });
});
test('galleryItemFromPicker: caption respeita maxLength 280 do schema', () => {
  const item = galleryItemFromPicker({ id: 'a', type: 'image' }, { src: 's', caption: 'x'.repeat(400) });
  assert.equal(item.caption.length, 280);
});
test('galleryItemFromPicker: vídeo leva poster; campos ausentes ficam fora', () => {
  const item = galleryItemFromPicker({ id: 'v1', type: 'video', createTime: null }, {
    src: 'media/t/gp-v1.mp4', poster: 'media/t/gp-v1-poster.webp', duration: 12.5,
  });
  assert.equal(item.poster, 'media/t/gp-v1-poster.webp');
  assert.equal(item.duration, 12.5);
  assert.ok(!('date' in item), 'sem createTime não inventa date');
  assert.ok(!('width' in item));
});
test('isoToDate: só aceita ISO com T', () => {
  assert.equal(isoToDate('2026-06-07T01:02:03Z'), '2026-06-07');
  assert.equal(isoToDate('ontem'), null);
});

// ── merge com dedup e teto de 30 ─────────────────────────────────────────
const mk = (sid, src) => ({ type: 'image', src: src || `media/t/gp-${sid}.webp`, origin: 'ajustado', source_id: sid });

test('mergeGallery: adiciona no fim, preserva existentes', () => {
  const existing = [mk('a'), mk('b')];
  const { gallery, added } = mergeGallery(existing, [mk('c')]);
  assert.equal(gallery.length, 3);
  assert.deepEqual(gallery.slice(0, 2), existing);
  assert.equal(added.length, 1);
});
test('mergeGallery: dedup por source_id (re-import idempotente)', () => {
  const { gallery, added, dupes } = mergeGallery([mk('a')], [mk('a'), mk('b')]);
  assert.equal(gallery.length, 2);
  assert.equal(added.length, 1);
  assert.equal(dupes.length, 1);
});
test('mergeGallery: dedup por src quando legado não tem source_id', () => {
  const legacy = [{ type: 'image', src: 'media/t/01.webp' }];
  const { gallery, dupes } = mergeGallery(legacy, [mk('z', 'media/t/01.webp')]);
  assert.equal(gallery.length, 1);
  assert.equal(dupes.length, 1);
});
test('mergeGallery: teto de 30 vai para overflow (nada silencioso)', () => {
  const existing = Array.from({ length: 28 }, (_, i) => mk(`e${i}`));
  const incoming = Array.from({ length: 5 }, (_, i) => mk(`n${i}`));
  const { gallery, added, overflow } = mergeGallery(existing, incoming);
  assert.equal(gallery.length, MAX_GALLERY_ITEMS);
  assert.equal(added.length, 2);
  assert.equal(overflow.length, 3);
});

// ── stats coerentes com o renderer do álbum ──────────────────────────────
test('galleryStats: conta image/video como o app.js', () => {
  assert.deepEqual(
    galleryStats([mk('a'), { type: 'video', src: 'v.mp4' }, mk('b')]),
    { photos: 2, videos: 1 },
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
