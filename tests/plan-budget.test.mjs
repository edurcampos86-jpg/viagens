// Testes de src/core/plan-budget.js — Frente 1 do PLANO-BOOKINGS-VIVOS.
// A página #plan (legacy assets/app.js) passa a ler o canônico ADR-001
// (budget.planned + bookings.*) com fallback legacy total. Mesmo harness
// leve de budget.test.mjs.

import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;

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

const { computePlanBudget, buildReservationItems, hasCanonicalBookings, bookingDefaultStatus, reservationKey } =
  await import(`${ROOT}/src/core/plan-budget.js`);

// ── computePlanBudget ───────────────────────────────────────────────────

test('sem planned: heurística legada intacta (nts×1000, 30/35/15/20)', () => {
  const pb = computePlanBudget({ nts: 10 });
  const by = Object.fromEntries(pb.rows.map(r => [r.key, r.est]));
  assert.deepEqual(by, { flights: 3000, stays: 3500, experiences: 1500, food: 2000 });
  assert.equal(pb.totalEst, 10000);
  assert.equal(pb.anyPlanned, false);
  assert.equal(pb.rows.length, 4); // sem linha "Outros" sem dado
});

test('planned.flights numérico substitui só a categoria dele', () => {
  const pb = computePlanBudget({ nts: 11, budget: { planned: { flights: 2920 } } });
  const by = Object.fromEntries(pb.rows.map(r => [r.key, r.est]));
  assert.equal(by.flights, 2920);
  assert.equal(by.stays, Math.round(11000 * 0.35));
  assert.equal(pb.anyPlanned, true);
  assert.equal(pb.rows.find(r => r.key === 'flights').estFromPlanned, true);
  assert.equal(pb.rows.find(r => r.key === 'stays').estFromPlanned, false);
});

test('planned.voos OBJETO (detalhamento) é ignorado sem NaN', () => {
  const pb = computePlanBudget({
    nts: 11,
    budget: { planned: { flights: 2920, voos: { BRL: 2920, milhas_tap: null } } },
  });
  assert.ok(Number.isFinite(pb.totalEst));
  assert.equal(pb.rows.find(r => r.key === 'flights').est, 2920);
});

test('breakdown legacy explícito segue valendo como fallback', () => {
  const pb = computePlanBudget({ budget: { breakdown: { voos: 5000, hospedagem: 1, passeios: 2, comida: 3 } } });
  assert.equal(pb.rows.find(r => r.key === 'flights').est, 5000);
});

test('committed: soma de bookings[*].valor em BRL quando não há override', () => {
  const pb = computePlanBudget({
    bookings: { flights: [{ valor: 1460 }, { valor: 1460 }], stays: [{ valor: 800, moeda: 'EUR' }] },
  });
  assert.equal(pb.rows.find(r => r.key === 'flights').committed, 2920);
  assert.equal(pb.rows.find(r => r.key === 'stays').committed, 0); // EUR fora da soma BRL
});

test('committed: precedência localStorage > budget.committed > bookings', () => {
  const trip = {
    budget: { committed: { voos: 100, stays: 200 } },
    bookings: { flights: [{ valor: 999 }], stays: [{ valor: 999 }], experiences: [{ valor: 999 }] },
  };
  const pb = computePlanBudget(trip, { flights: 50 });
  assert.equal(pb.rows.find(r => r.key === 'flights').committed, 50);   // override manual (chave v2)
  assert.equal(pb.rows.find(r => r.key === 'stays').committed, 200);    // budget.committed (chave v2)
  assert.equal(pb.rows.find(r => r.key === 'experiences').committed, 999); // soma dos bookings
});

test('committed: alias legacy (voos) aceito na leitura do localStorage', () => {
  const pb = computePlanBudget({}, { voos: 777 });
  assert.equal(pb.rows.find(r => r.key === 'flights').committed, 777);
});

test('linha "Outros" só aparece com dado (planned.other ou committed)', () => {
  assert.equal(computePlanBudget({}).rows.length, 4);
  const pb = computePlanBudget({ budget: { planned: { other: 300 } } });
  assert.equal(pb.rows.length, 5);
  assert.equal(pb.rows[4].est, 300);
});

// ── Reservas ────────────────────────────────────────────────────────────

test('hasCanonicalBookings: false sem bookings, true com qualquer categoria', () => {
  assert.equal(hasCanonicalBookings({}), false);
  assert.equal(hasCanonicalBookings({ bookings: { flights: [], stays: [], experiences: [] } }), false);
  assert.equal(hasCanonicalBookings({ bookings: { stays: [{ titulo: 'x', status: 'pendente' }] } }), true);
});

test('buildReservationItems: confirmado→booked, pendente→researching, cancelado some', () => {
  const items = buildReservationItems({
    bookings: {
      flights: [
        { id: 'f1', titulo: 'TP28 SSA→LIS', status: 'confirmado' },
        { id: 'f2', titulo: 'XX1', status: 'cancelado' },
      ],
      stays: [{ id: 's1', titulo: 'Hotel Boom', status: 'pendente' }],
    },
  });
  assert.deepEqual(items.map(i => [i.key, i.type, i.status]), [
    ['f1', 'flight', 'booked'],
    ['s1', 'hotel', 'researching'],
  ]);
});

test('buildReservationItems: override de status por id + preço de valor/moeda', () => {
  const items = buildReservationItems(
    { bookings: { experiences: [{ id: 'e1', titulo: 'Tomorrowland', status: 'confirmado', valor: 4500, moeda: 'EUR' }] } },
    { e1: 'paid' }
  );
  assert.equal(items[0].status, 'paid');
  assert.equal(items[0].price, 4500);
  assert.equal(items[0].currency, 'EUR');
});

test('reservationKey: cai pra categoria:índice sem id (override estável)', () => {
  assert.equal(reservationKey('flights', {}, 2), 'flights:2');
  assert.equal(reservationKey('flights', { id: 'abc' }, 2), 'abc');
});

test('bookingDefaultStatus: confirmada=true legacy também vira booked', () => {
  assert.equal(bookingDefaultStatus({ confirmada: true, status: 'pendente' }), 'booked');
  assert.equal(bookingDefaultStatus({ status: 'em_andamento' }), 'researching');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
