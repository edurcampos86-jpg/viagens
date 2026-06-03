// Testes do detector de lacunas — Sprint Radar · Etapa A.
// node --test tests/readiness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeReadiness, isFutureTrip, computeDaysUntil } from '../src/core/readiness.js';

const TODAY = '2026-06-03';

// Viagem 100% completa (todos os slots aplicáveis em 'ok').
const tripCompleta = {
  id: 'completa-2026',
  status: 'planned',
  startDate: '2026-09-01',
  highlights: ['Mergulho em Fernando de Noronha', 'Trilha do pôr do sol'],
  bookings: {
    flights: [{ titulo: 'GRU→FEN', status: 'confirmado', confirmada: true }],
    stays: [{ titulo: 'Pousada Maravilha', status: 'confirmado' }],
    experiences: [{ titulo: 'Passeio de barco', status: 'confirmado' }],
  },
  budget: { planned: { voos: 2500, hospedagem: 4000 }, actual: {} },
};

// Espelha europa-tomorrowland-2026: voo pendente, sem stays, sem eventos.
const tripEuropa = {
  id: 'europa-tomorrowland-2026',
  status: 'planned',
  startDate: '2026-07-17',
  highlights: ['Tomorrowland 2026 (já contratado)', 'Bruxelas', 'Antuérpia'],
  bookings: {
    flights: [{ titulo: 'GRU→BRU', status: 'pendente', confirmada: false }],
    stays: [],
    experiences: [],
  },
  budget: { planned: {}, actual: {}, currency: 'BRL' },
};

test('viagem 100% completa → score 1, sem faltas', async () => {
  const r = await computeReadiness(tripCompleta, {
    today: TODAY,
    eventosLoader: async () => [{ id: 'ev1', status: 'confirmado' }],
  });
  assert.equal(r.score, 1);
  assert.equal(r.faltando.length, 0);
  assert.equal(r.future, true);
  for (const slot of r.slots) {
    assert.notEqual(slot.status, 'faltando', `slot ${slot.id} não deveria faltar`);
  }
});

test('viagem sem hospedagem (Europa hoje) → hospedagem e eventos nas faltas', async () => {
  const r = await computeReadiness(tripEuropa, {
    today: TODAY,
    eventosLoader: async () => [], // sem arquivo data/eventos/<id>.json
  });

  const byId = Object.fromEntries(r.slots.map((s) => [s.id, s.status]));
  assert.equal(byId.hospedagem, 'faltando');
  assert.equal(byId.eventos, 'faltando');
  assert.equal(byId.voo, 'faltando'); // voo pendente, não confirmado
  assert.equal(byId.roteiro, 'ok'); // highlights reais
  assert.equal(byId.orcamento, 'faltando'); // budget vazio
  assert.equal(byId.locomocao, 'na'); // sem experiences/transporte → excluído do score

  const faltaIds = r.faltando.map((f) => f.id);
  assert.ok(faltaIds.includes('hospedagem'));
  assert.ok(faltaIds.includes('eventos'));

  // 5 aplicáveis (locomoção é 'na'), 1 ok (roteiro) → 0.2
  assert.equal(r.score, 1 / 5);
  assert.equal(r.daysUntil, 44); // 03/06 → 17/07
  assert.equal(r.future, true);
});

test('viagem sem arquivo de eventos → eventos faltando', async () => {
  // Tudo ok, exceto eventos (loader retorna []), como um 404 de data/eventos/.
  const r = await computeReadiness(tripCompleta, {
    today: TODAY,
    eventosLoader: async () => [],
  });
  const byId = Object.fromEntries(r.slots.map((s) => [s.id, s.status]));
  assert.equal(byId.eventos, 'faltando');
  assert.ok(r.faltando.some((f) => f.id === 'eventos'));
  assert.ok(r.score < 1);
});

test('sem loader de eventos → slot eventos é "na" (não conta como falta)', async () => {
  const r = await computeReadiness(tripCompleta, { today: TODAY });
  const ev = r.slots.find((s) => s.id === 'eventos');
  assert.equal(ev.status, 'na');
  assert.ok(!r.faltando.some((f) => f.id === 'eventos'));
});

test('isFutureTrip e computeDaysUntil', () => {
  assert.equal(isFutureTrip({ status: 'done', startDate: '2020-01-01' }, TODAY), false);
  assert.equal(isFutureTrip({ status: 'planned' }, TODAY), true);
  assert.equal(isFutureTrip({ status: 'done', startDate: '2026-12-25' }, TODAY), true);
  assert.equal(computeDaysUntil({ startDate: '2026-06-04' }, TODAY), 1);
  assert.equal(computeDaysUntil({ startDate: 'sem-data' }, TODAY), null);
});
