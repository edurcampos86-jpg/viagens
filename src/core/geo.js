// Utilitários de geo: bandeira via ISO alpha-2, slug, busca Nominatim.
// Nominatim policy: máx 1 req/seg, sem repetição de queries em rajada.
// https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';

let lastNominatimAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastNominatimAt;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastNominatimAt = Date.now();
}

export function flagFromCountryCode(code) {
  if (!code || typeof code !== 'string') return '';
  const cc = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(
    0x1f1e6 + (cc.charCodeAt(0) - 0x41),
    0x1f1e6 + (cc.charCodeAt(1) - 0x41)
  );
}

export function slugify(input) {
  if (!input) return '';
  return String(input)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function tripIdFrom(name, isoDate) {
  const slug = slugify(name);
  if (!slug) return '';
  if (!isoDate) return slug;
  const m = String(isoDate).match(/^(\d{4})-(\d{2})/);
  if (!m) return slug;
  return `${slug}-${m[1]}-${m[2]}`;
}

export async function nominatimSearch(query, { signal } = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  await throttle();
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'pt-BR,en');
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  return data.map((row) => ({
    display: row.display_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    country: row.address?.country || '',
    country_code: (row.address?.country_code || '').toUpperCase(),
    city:
      row.address?.city ||
      row.address?.town ||
      row.address?.village ||
      row.address?.municipality ||
      '',
    type: row.type,
  }));
}
