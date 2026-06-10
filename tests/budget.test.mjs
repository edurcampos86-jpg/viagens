// Testes de computeActualFromBookings — Fase 3 do schema (port do extrato,
// Etapa 4): bookings[*].valor em BRL passa a alimentar budget.actual, com
// precedência sobre price_brl. Mesmo harness leve de trips-api.test.mjs.
//
// Hoje 0 viagens em produção têm `valor`, então a precedência não altera
// nenhum número existente — estes testes fixam o contrato para os imports
// de extrato (source:'extrato') que começam a gravar valor/moeda.

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

const { computeActualFromBookings } = await import(`${ROOT}/src/components/budget.js`);

test('só price_brl: soma como antes da Fase 3', () => {
  const actual = computeActualFromBookings({
    flights: [{ price_brl: 1000 }, { price_brl: 250.5 }],
    stays: [{ price_brl: 300 }],
    experiences: [],
  });
  assert.deepEqual(actual, { flights: 1250.5, stays: 300, experiences: 0 });
});

test('só valor BRL: soma alimenta budget.actual (Fase 3)', () => {
  const actual = computeActualFromBookings({
    flights: [{ valor: 1234.56, moeda: 'BRL', source: 'extrato' }],
    stays: [{ valor: 890.5, moeda: 'BRL' }],
    experiences: [{ valor: 150, moeda: 'BRL' }],
  });
  assert.deepEqual(actual, { flights: 1234.56, stays: 890.5, experiences: 150 });
});

test('valor E price_brl no mesmo booking: valor vence', () => {
  const actual = computeActualFromBookings({
    flights: [{ valor: 1100, moeda: 'BRL', price_brl: 999 }],
    stays: [],
    experiences: [],
  });
  assert.equal(actual.flights, 1100, 'precedência: valor BRL > price_brl');
});

test('valor sem moeda: tratado como BRL (default do schema)', () => {
  const actual = computeActualFromBookings({
    flights: [],
    stays: [{ valor: 500 }],
    experiences: [],
  });
  assert.equal(actual.stays, 500);
});

test('valor em USD sem price_brl: fica fora da soma BRL (0)', () => {
  const actual = computeActualFromBookings({
    flights: [{ valor: 1500, moeda: 'USD' }],
    stays: [],
    experiences: [],
  });
  assert.equal(actual.flights, 0, 'sem conversão de câmbio — não soma US$ como R$');
});

test('valor em USD com price_brl: cai para price_brl', () => {
  const actual = computeActualFromBookings({
    flights: [{ valor: 1500, moeda: 'USD', price_brl: 7800 }],
    stays: [],
    experiences: [],
  });
  assert.equal(actual.flights, 7800);
});

test('arrays vazios, undefined e bookings ausentes: tudo 0', () => {
  assert.deepEqual(computeActualFromBookings({ flights: [], stays: [], experiences: [] }), {
    flights: 0,
    stays: 0,
    experiences: 0,
  });
  assert.deepEqual(computeActualFromBookings({}), { flights: 0, stays: 0, experiences: 0 });
  assert.deepEqual(computeActualFromBookings(undefined), { flights: 0, stays: 0, experiences: 0 });
});

test('booking malformado (valor/price_brl não numéricos) não quebra nem soma', () => {
  const actual = computeActualFromBookings({
    flights: [{ valor: '1000', moeda: 'BRL' }, { price_brl: 'abc' }, null, {}],
    stays: [],
    experiences: [],
  });
  assert.equal(actual.flights, 0);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
