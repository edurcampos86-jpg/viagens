// Inferência de datas da viagem a partir de bookings (F2.5 base).
//
// Regra:
//   - Se há voos, dates.start = data do primeiro departure;
//     dates.end = data do último arrival ou último check_out (o que for maior).
//   - Se só há stays, dates.start = menor check_in, dates.end = maior check_out.
//   - Caso contrário, retorna null e o trip mantém suas datas anteriores.
//
// Saída: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', nts: number, computed_from }

function dayOnly(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const dA = new Date(a);
  const dB = new Date(b);
  if (isNaN(dA) || isNaN(dB)) return null;
  return Math.round((dB - dA) / 86400000);
}

export function deriveDatesFromBookings(bookings) {
  if (!bookings) return null;
  const flights = bookings.flights || [];
  const stays = bookings.stays || [];
  let start = null;
  let end = null;
  let computed_from = null;

  if (flights.length) {
    const departures = flights.map((f) => dayOnly(f.departure)).filter(Boolean).sort();
    const arrivals = flights.map((f) => dayOnly(f.arrival)).filter(Boolean).sort();
    if (departures.length) {
      start = departures[0];
      end = arrivals.length ? arrivals[arrivals.length - 1] : null;
      computed_from = 'flight';
    }
  }

  if (stays.length) {
    const checkIns = stays.map((s) => dayOnly(s.check_in)).filter(Boolean).sort();
    const checkOuts = stays.map((s) => dayOnly(s.check_out)).filter(Boolean).sort();
    if (!start && checkIns.length) {
      start = checkIns[0];
      computed_from = 'stay';
    }
    if (checkOuts.length) {
      const last = checkOuts[checkOuts.length - 1];
      if (!end || last > end) end = last;
    }
  }

  if (!start && !end) return null;
  return {
    start,
    end,
    nts: daysBetween(start, end),
    computed_from: computed_from || 'manual',
  };
}

// ADR-003 (opção B): startDate/endDate top-level é a forma CANÔNICA de datas.
// Deriva os espelhos legacy (year/month/nts) a partir de start/end. Campos não
// deriváveis voltam null (o chamador decide preservar o valor anterior).
export function deriveLegacyDateFields(start, end) {
  const out = { startDate: start || null, endDate: end || null, year: null, month: null, nts: null };
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
    out.year = Number(start.slice(0, 4));
    out.month = Number(start.slice(5, 7));
  }
  if (start && end) {
    const d = daysBetween(start, end);
    if (d != null) out.nts = d;
  }
  return out;
}

// Atualização in-place do objeto trip (não muda referência).
export function applyInferredDates(trip) {
  const inferred = deriveDatesFromBookings(trip?.bookings);
  if (!inferred) return null;
  trip.dates = {
    ...(trip.dates || {}),
    start: inferred.start || trip.dates?.start || null,
    end: inferred.end || trip.dates?.end || null,
    computed_from: inferred.computed_from,
  };
  if (inferred.nts != null) trip.nts = inferred.nts;
  return inferred;
}
