// Validação e leitura de trips em ambos os formatos (v1 legacy e v2).
//
// Princípio: a fonte canônica é v2 (bookings, budget, checklist, notes.general).
//
// DATAS (ADR-003, opção B): a forma CANÔNICA é `startDate`/`endDate` top-level
// (+ espelhos derivados year/month/nts). É onde os dados moram (42 registros) e
// o que todo o pipeline Python e o assets/app.js leem. O objeto aninhado
// `dates.{start,end,computed_from}` está DEPRECADO: serve só como alias de
// leitura tolerante e NÃO deve mais ser escrito (o editor grava o canônico).
// `getDates()` é o leitor tolerante único — lê dates.* OU startDate/endDate OU
// year/month, nessa ordem de preferência.
//
// Importante: nunca lance erro só porque um campo legacy está faltando — o
// site precisa renderizar 100% do histórico mesmo antes da migration rodar.

export const SCHEMA_VERSION = 2;

const VALID_STATUSES = new Set(['planned', 'in_progress', 'done', 'wishlist', 'em_planejamento']);

export function validateTrip(trip, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!trip || typeof trip !== 'object') {
    errors.push('trip não é um objeto');
    return { valid: false, errors, warnings };
  }
  if (!trip.id || typeof trip.id !== 'string') errors.push('id ausente ou inválido');
  if (!trip.name || typeof trip.name !== 'string') errors.push('name obrigatório');
  if (trip.status && !VALID_STATUSES.has(trip.status))
    errors.push(`status inválido: ${trip.status}`);
  if (trip.lat != null && typeof trip.lat !== 'number')
    errors.push('lat deve ser number');
  else if (typeof trip.lat === 'number' && (trip.lat < -90 || trip.lat > 90))
    errors.push('lat fora do intervalo -90..90');
  if (trip.lon != null && typeof trip.lon !== 'number')
    errors.push('lon deve ser number');
  else if (typeof trip.lon === 'number' && (trip.lon < -180 || trip.lon > 180))
    errors.push('lon fora do intervalo -180..180');
  if (trip.geo_source != null && !['manual', 'nominatim'].includes(trip.geo_source))
    errors.push(`geo_source inválido: ${trip.geo_source}`);

  if (trip.dates) {
    if (trip.dates.start && !/^\d{4}-\d{2}-\d{2}$/.test(trip.dates.start))
      errors.push('dates.start: formato ISO YYYY-MM-DD esperado');
    if (trip.dates.end && !/^\d{4}-\d{2}-\d{2}$/.test(trip.dates.end))
      errors.push('dates.end: formato ISO YYYY-MM-DD esperado');
    if (trip.dates.start && trip.dates.end && trip.dates.start > trip.dates.end)
      errors.push('dates.start > dates.end');
  } else if (strict) {
    warnings.push('sem dates (modo strict exige v2)');
  }

  if (strict && !trip.bookings) warnings.push('sem bookings (v2)');
  if (strict && !trip.budget) warnings.push('sem budget (v2)');

  return { valid: errors.length === 0, errors, warnings };
}

// ── Getters tolerantes a v1/v2 ──────────────────────────────────────────

export function getDates(trip) {
  if (!trip) return { start: null, end: null, nts: null, source: 'unknown' };
  if (trip.dates?.start) {
    const start = trip.dates.start;
    const end = trip.dates.end || null;
    let nts = null;
    if (start && end) {
      const dStart = new Date(start);
      const dEnd = new Date(end);
      nts = Math.round((dEnd - dStart) / 86400000);
    }
    return { start, end, nts: nts ?? trip.nts ?? null, source: 'v2' };
  }
  // Canônico (ADR-003): startDate/endDate top-level — dia exato, preferido
  // sobre year/month (que só tem o mês). É a forma que o editor grava.
  if (trip.startDate) {
    const start = trip.startDate;
    const end = trip.endDate || null;
    let nts = null;
    if (start && end) {
      nts = Math.round((new Date(end) - new Date(start)) / 86400000);
    }
    return { start, end, nts: nts ?? trip.nts ?? null, source: 'canonical' };
  }
  // Fallback v1: year/month sem dia exato.
  const y = trip.year,
    m = trip.month,
    nts = trip.nts ?? null;
  if (typeof y === 'number' && typeof m === 'number') {
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    let end = null;
    if (typeof nts === 'number') {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + nts);
      end = d.toISOString().slice(0, 10);
    }
    return { start, end, nts, source: 'v1' };
  }
  return { start: null, end: null, nts, source: 'unknown' };
}

// Proveniência de país/coords (B1). Espelha getDates: tolerante a registros
// legacy que não têm o campo (source='unknown'). 'manual' nunca é sobrescrito
// por geocoding automático.
export function getGeoSource(trip) {
  const v = trip?.geo_source;
  if (v === 'manual' || v === 'nominatim') return { source: v, known: true };
  return { source: 'unknown', known: false };
}

export function getBookings(trip) {
  if (trip?.bookings) {
    return {
      flights: trip.bookings.flights || [],
      stays: trip.bookings.stays || [],
      experiences: trip.bookings.experiences || [],
      source: 'v2',
    };
  }
  // v1: só `hospedagem` solta → mapeia como stays sem datas precisas
  const stays = Array.isArray(trip?.hospedagem)
    ? trip.hospedagem.map((h, i) => ({
        id: `legacy-${trip.id}-stay-${i}`,
        name: h.nome || h.name || 'Hospedagem',
        platform: 'direct',
        source: 'manual',
      }))
    : [];
  return { flights: [], stays, experiences: [], source: 'v1' };
}

export function getBudget(trip) {
  if (trip?.budget) {
    return {
      planned: trip.budget.planned || {},
      actual: trip.budget.actual || {},
      currency: trip.budget.currency || 'BRL',
      source: 'v2',
    };
  }
  return { planned: {}, actual: {}, currency: 'BRL', source: 'v1' };
}

export function getChecklist(trip) {
  if (Array.isArray(trip?.checklist)) return trip.checklist;
  return [];
}

export function getNotesText(trip) {
  if (typeof trip?.notes === 'string') return trip.notes;
  if (typeof trip?.notes?.general === 'string') return trip.notes.general;
  return trip?.memory || '';
}

export function isMigrated(trip) {
  return trip?._schema === SCHEMA_VERSION;
}
