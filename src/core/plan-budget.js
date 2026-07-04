// Lógica pura da página #plan (legacy assets/app.js) para ler o schema
// canônico ADR-001 — bookings.{flights,stays,experiences} e budget.planned —
// com fallback total para os campos legacy (budget.committed, breakdown,
// heurística nts×1000). Frente 1 do PLANO-BOOKINGS-VIVOS (decisões D1/D2).
//
// Sem DOM aqui: assets/app.js renderiza, este módulo só calcula (mesmo
// padrão de next-action.js / checklist-order.js).

import { computeActualFromBookings } from '../components/budget.js';

// Chaves canônicas v2 com rótulo PT na UI (D2). `legacy` é o alias aceito
// na LEITURA de budget.committed e do localStorage antigo; a escrita nova
// usa sempre a chave v2.
export const PLAN_BUDGET_CATS = [
  { key: 'flights', legacy: 'voos', label: '✈ Voos' },
  { key: 'stays', legacy: 'hospedagem', label: '🏨 Hospedagem' },
  { key: 'experiences', legacy: 'passeios', label: '🎟 Passeios' },
  { key: 'food', legacy: 'comida', label: '🍴 Comida' },
];

function num(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
}

// Heurística legada, idêntica ao comportamento anterior do widget:
// breakdown explícito (budget/cost) > percentuais fixos do total estimado.
function legacyBreakdown(trip) {
  const nts = trip?.nts || 1;
  const totalEst = trip?.budget?.total ?? trip?.cost?.total ?? nts * 1000;
  const bd = trip?.budget?.breakdown ?? trip?.cost?.breakdown ?? {};
  return {
    flights: num(bd.voos) ?? Math.round(totalEst * 0.3),
    stays: num(bd.hospedagem) ?? Math.round(totalEst * 0.35),
    experiences: num(bd.passeios) ?? Math.round(totalEst * 0.15),
    food: num(bd.comida) ?? Math.round(totalEst * 0.2),
  };
}

// computePlanBudget(trip, savedCommitted) → { rows, totalEst, totalCommitted,
//   currency, anyPlanned }
//
// Por categoria:
//   est       ← budget.planned[key] numérico (canônico) ?? heurística legada.
//               Objetos em planned (ex.: `voos` detalhado) são ignorados.
//   committed ← ajuste manual salvo (localStorage, chave v2 ou alias legacy)
//               ?? budget.committed (chave v2 ou alias) ?? soma de
//               bookings[*].valor em BRL (D1).
export function computePlanBudget(trip, savedCommitted = {}) {
  const planned = trip?.budget?.planned || {};
  const fallback = legacyBreakdown(trip);
  const fromBookings = computeActualFromBookings(trip?.bookings);
  const canon = trip?.budget?.committed || {};

  const rows = PLAN_BUDGET_CATS.map(({ key, legacy, label }) => {
    const plannedNum = num(planned[key]);
    const est = plannedNum ?? fallback[key];
    const committed =
      num(savedCommitted[key]) ??
      num(savedCommitted[legacy]) ??
      num(canon[key]) ??
      num(canon[legacy]) ??
      num(fromBookings[key]) ??
      0;
    return { key, legacy, label, est, estFromPlanned: plannedNum != null, committed };
  });

  // "Outros" só entra quando tem dado — paridade visual com o widget antigo
  // nas viagens que nunca usaram a categoria.
  const otherEst = num(planned.other);
  const otherCommitted =
    num(savedCommitted.other) ?? num(savedCommitted.outros) ?? num(canon.other) ?? num(canon.outros);
  if (otherEst != null || otherCommitted != null) {
    rows.push({
      key: 'other',
      legacy: 'outros',
      label: '✚ Outros',
      est: otherEst ?? 0,
      estFromPlanned: otherEst != null,
      committed: otherCommitted ?? 0,
    });
  }

  return {
    rows,
    totalEst: rows.reduce((a, r) => a + r.est, 0),
    totalCommitted: rows.reduce((a, r) => a + r.committed, 0),
    currency: trip?.budget?.currency || trip?.cost?.currency || 'BRL',
    anyPlanned: rows.some((r) => r.estFromPlanned),
  };
}

// ── Aba Reservas ────────────────────────────────────────────────────────

const BOOKING_TYPE = { flights: 'flight', stays: 'hotel', experiences: 'activity' };

export function hasCanonicalBookings(trip) {
  const b = trip?.bookings || {};
  return ['flights', 'stays', 'experiences'].some((k) => (b[k] || []).length > 0);
}

// Chave estável do override de status no localStorage: id do booking quando
// existe, senão categoria:índice (melhor que congelar a lista inteira, que
// era o bug do formato antigo — snapshot escondia bookings novos).
export function reservationKey(cat, booking, index) {
  return booking?.id || `${cat}:${index}`;
}

export function bookingDefaultStatus(b) {
  return b?.confirmada === true || b?.status === 'confirmado' || b?.status === 'confirmada'
    ? 'booked'
    : 'researching';
}

// buildReservationItems(trip, savedById) → itens renderizáveis da aba
// Reservas a partir dos bookings canônicos. Cancelados ficam de fora.
export function buildReservationItems(trip, savedById = {}) {
  const bookings = trip?.bookings || {};
  const items = [];
  for (const cat of ['flights', 'stays', 'experiences']) {
    (bookings[cat] || []).forEach((b, i) => {
      if (!b || b.status === 'cancelado') return;
      const key = reservationKey(cat, b, i);
      items.push({
        key,
        type: BOOKING_TYPE[cat],
        label: b.titulo || '(sem título)',
        price: num(b.valor) > 0 ? b.valor : null,
        currency: b.moeda || 'BRL',
        status: savedById[key] || bookingDefaultStatus(b),
      });
    });
  }
  return items;
}
