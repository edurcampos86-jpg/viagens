// Detector de lacunas de planejamento — módulo PURO (sem DOM, sem rede).
//
// Sprint Radar · Etapa A. Dado um trip (formato cru de data/trips.json) e um
// carregador de eventos injetável, devolve um "estado de prontidão": quais
// slots de planejamento estão ok / faltando / não-aplicáveis, um score
// (slots ok / slots aplicáveis) e quantos dias faltam para a viagem.
//
// Princípios:
//   - NUNCA lê o DOM nem faz fetch. O carregamento de eventos é injetado
//     (eventosLoader) para manter o módulo testável em Node sem rede.
//   - Hospedagem canônica = bookings.stays[] (ADR-001). O legado hospedagem[]
//     NÃO é fonte primária aqui.
//   - Campo que não existe no schema => slot 'na' (não conta como falta).
//   - Nunca lança: entrada inválida resolve para um estado vazio coerente.
//
// Uso (browser):
//   import { computeReadiness } from '../core/readiness.js';
//   import { loadEventos } from './eventos-data.js';
//   const r = await computeReadiness(trip, { eventosLoader: loadEventos });
//
// Uso (teste/Node):
//   const r = await computeReadiness(trip, { eventos: [...], today: '2026-06-03' });

const FUTURE_STATUSES = new Set(['planned', 'wishlist', 'draft', 'em_planejamento']);

// Marcadores de texto-placeholder num "roteiro" (highlights) ainda não real.
const PLACEHOLDER_RE = /placeholder|lorem|\btbd\b|\btodo\b|a definir|^\s*\?+\s*$|xxx+/i;

const SLOT_DEFS = [
  { id: 'voo', label: 'Voo' },
  { id: 'hospedagem', label: 'Hospedagem' },
  { id: 'eventos', label: 'Eventos/ingressos' },
  { id: 'locomocao', label: 'Locomoção' },
  { id: 'roteiro', label: 'Roteiro' },
  { id: 'orcamento', label: 'Orçamento' },
];

function arr(x) {
  return Array.isArray(x) ? x : [];
}

// YYYY-MM-DD -> timestamp UTC à meia-noite (parsing manual; evita drift de fuso).
function parseISODateUTC(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function todayUTC(today) {
  const d = today instanceof Date ? today : today ? new Date(today) : new Date();
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function computeDaysUntil(trip, today) {
  const start = parseISODateUTC(trip && trip.startDate);
  const base = todayUTC(today);
  if (start == null || base == null) return null;
  return Math.round((start - base) / 86400000);
}

export function isFutureTrip(trip, today) {
  if (!trip || typeof trip !== 'object') return false;
  if (FUTURE_STATUSES.has(trip.status)) return true;
  const d = computeDaysUntil(trip, today);
  return d != null && d >= 0;
}

// ── Regras por slot (cada uma devolve 'ok' | 'faltando' | 'na') ───────────

function slotVoo(trip) {
  const flights = arr(trip && trip.bookings && trip.bookings.flights);
  if (flights.length === 0) return 'faltando';
  const ok = flights.some((f) => f && (f.confirmada === true || f.status === 'confirmado'));
  return ok ? 'ok' : 'faltando';
}

function slotHospedagem(trip) {
  // Lar canônico (ADR-001): bookings.stays[]. NÃO usa hospedagem[] legado.
  return arr(trip && trip.bookings && trip.bookings.stays).length > 0 ? 'ok' : 'faltando';
}

function slotEventos(eventos) {
  if (eventos == null) return 'na'; // sem loader/dados => indeterminável
  const ok = arr(eventos).some((e) => e && e.status === 'confirmado');
  return ok ? 'ok' : 'faltando';
}

function slotLocomocao(trip) {
  const exp = arr(trip && trip.bookings && trip.bookings.experiences);
  const transp = arr(trip && trip.transporte);
  return exp.length > 0 || transp.length > 0 ? 'ok' : 'na';
}

function slotRoteiro(trip) {
  const hs = arr(trip && trip.highlights).filter((h) => typeof h === 'string' && h.trim());
  if (hs.length === 0) return 'faltando';
  if (hs.some((h) => PLACEHOLDER_RE.test(h))) return 'faltando';
  return 'ok';
}

function slotOrcamento(trip) {
  if (!trip || trip.budget == null) return 'na'; // campo inexistente
  const b = trip.budget;
  const buckets = [b.planned, b.actual].filter((x) => x && typeof x === 'object');
  const hasValue = buckets.some((bk) =>
    Object.values(bk).some((v) => typeof v === 'number' && v > 0)
  );
  return hasValue ? 'ok' : 'faltando';
}

// ── API pública ───────────────────────────────────────────────────────────

export async function computeReadiness(trip, opts = {}) {
  const { eventosLoader, eventos: eventosArg, today } = opts || {};

  let eventos = eventosArg != null ? eventosArg : null;
  if (eventos == null && typeof eventosLoader === 'function') {
    try {
      eventos = await eventosLoader(trip && trip.id);
    } catch {
      eventos = [];
    }
  }

  const statusById = {
    voo: slotVoo(trip),
    hospedagem: slotHospedagem(trip),
    eventos: slotEventos(eventos),
    locomocao: slotLocomocao(trip),
    roteiro: slotRoteiro(trip),
    orcamento: slotOrcamento(trip),
  };

  const slots = SLOT_DEFS.map((s) => ({ id: s.id, label: s.label, status: statusById[s.id] }));
  const applicable = slots.filter((s) => s.status !== 'na');
  const okCount = applicable.filter((s) => s.status === 'ok').length;
  const score = applicable.length ? okCount / applicable.length : 1;
  const faltando = slots
    .filter((s) => s.status === 'faltando')
    .map((s) => ({ id: s.id, label: s.label }));

  return {
    id: (trip && trip.id) || null,
    score,
    daysUntil: computeDaysUntil(trip, today),
    future: isFutureTrip(trip, today),
    slots,
    faltando,
  };
}
