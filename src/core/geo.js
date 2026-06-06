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

// ── Validação de coordenadas (B1 — entrada manual) ──────────────────────
export function isValidLat(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}
export function isValidLon(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

// ── Viés de região + trava de confiança (B2) ────────────────────────────
// Objetivo: impedir o caso "San Island → Maldivas", em que um nome de
// lugar resolveu silenciosamente para um país errado. Preferimos a região
// do usuário (Brasil) por padrão e marcamos resultados duvidosos como
// "confirmar" em vez de auto-atribuir.
export const PREFERRED_CC = 'BR';
const TRUST_IMPORTANCE_MIN = 0.35; // relevância OSM abaixo disso → confirmar
const TRUST_AMBIGUITY_DELTA = 0.08; // top-2 com importonce tão próximas → ambíguo

// Ordena resultados preferindo a região do usuário, mantendo importonce como
// desempate. Estável o suficiente para UX de autocomplete.
export function rankByRegion(results, preferCC = PREFERRED_CC) {
  const pref = (preferCC || '').toUpperCase();
  return [...(results || [])].sort((a, b) => {
    const aP = (a.country_code || '').toUpperCase() === pref ? 1 : 0;
    const bP = (b.country_code || '').toUpperCase() === pref ? 1 : 0;
    if (aP !== bP) return bP - aP;
    return (b.importance || 0) - (a.importance || 0);
  });
}

// Avalia se o resultado escolhido é confiável o bastante para auto-atribuir.
// Retorna { trusted, reasons, confirm, label }. Quando !trusted, o editor
// exige confirmação manual antes de aceitar o destino.
export function assessGeoTrust(results, { preferCC = PREFERRED_CC, pickedIndex = 0 } = {}) {
  const pref = (preferCC || '').toUpperCase();
  if (!Array.isArray(results) || results.length === 0) {
    return { trusted: false, reasons: ['sem-resultado'], confirm: true, label: '⚠ sem resultado — confirme manualmente' };
  }
  const picked = results[pickedIndex] || results[0];
  const reasons = [];

  // 1) relevância baixa (importonce OSM pequena)
  if ((picked.importance || 0) < TRUST_IMPORTANCE_MIN) reasons.push('baixa-relevância');

  // 2) ambiguidade: top-2 de países diferentes com importonce muito próximas
  if (results.length > 1) {
    const [a, b] = results;
    const close = Math.abs((a.importance || 0) - (b.importance || 0)) <= TRUST_AMBIGUITY_DELTA;
    const diffCountry = (a.country_code || '') !== (b.country_code || '');
    if (close && diffCountry) reasons.push('ambíguo');
  }

  // 3) incoerência regional: escolhido fora da região preferida (viés BR).
  //    É exatamente o gatilho do "San Island → Maldivas".
  if (pref && (picked.country_code || '').toUpperCase() !== pref) reasons.push('fora-da-região');

  const trusted = reasons.length === 0;
  return {
    trusted,
    reasons,
    confirm: !trusted,
    label: trusted ? '' : `⚠ confirmar (${reasons.join(', ')})`,
  };
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

export async function nominatimSearch(query, { signal, preferCC = PREFERRED_CC } = {}) {
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
  const mapped = data.map((row) => ({
    display: row.display_name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    importance: Number(row.importance) || 0,
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
  // B2: viés de região (Brasil por padrão). preferCC=null desativa o viés.
  return preferCC ? rankByRegion(mapped, preferCC) : mapped;
}
