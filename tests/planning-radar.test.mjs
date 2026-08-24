// Testes de src/core/planning-radar.js — Fase A do radar de planejamento.
// Mesmo harness leve de budget.test.mjs / plan-budget.test.mjs.

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

const {
  RADAR_STATUSES,
  allBookings,
  classifyPendencias,
  countdown,
  daysBetween,
  getPendencias,
  nonRefundable,
  origensDado,
  pendenciaBadges,
  tripCosts,
  parseRefundDeadline,
  refundSeal,
} = await import(`${ROOT}/src/core/planning-radar.js`);

const { computeActualFromBookings } = await import(`${ROOT}/src/components/budget.js`);

const HOJE = '2026-08-24';

// Espelho reduzido das duas viagens novas de data/trips.json.
const MACEIO = {
  id: 'maceio-2026',
  status: 'em_planejamento',
  startDate: '2026-11-06',
  endDate: '2026-11-08',
  pendencias: ['voos SSA⇄MCZ'],
  bookings: {
    flights: [],
    stays: [
      {
        titulo: 'Hilton Garden Inn Maceió · 2 noites',
        status: 'confirmado',
        valor: 750.48,
        moeda: 'BRL',
        reembolsavel: false,
        reembolso_nota: 'Tarifa não reembolsável (Hoteis.com).',
        origem_dado: 'gmail-2026-08-24',
      },
    ],
    experiences: [],
  },
};

const FLEX = '100% via LATAM Flex até 7 dias antes do 1º voo — limite ~18/12/2026; depois disso, não reembolsável';

const REVEILLON = {
  id: 'floripa-reveillon-2026',
  status: 'em_planejamento',
  startDate: '2026-12-25',
  endDate: '2027-01-06',
  pendencias: ['sem hotel'],
  custo_pago: 933.36,
  bookings: {
    flights: [
      { titulo: 'LA3625 SSA→CGH', status: 'confirmado', valor: 933.36, moeda: 'BRL', reembolsavel: true, reembolso_nota: FLEX },
      { titulo: 'LA3064 CGH→FLN', status: 'confirmado', reembolsavel: true, reembolso_nota: FLEX },
    ],
    stays: [],
    experiences: [],
  },
};

const FLORIPA = {
  id: 'floripa-2026',
  status: 'draft',
  pendencias: ['datas e horários dos voos (aguardando e-mail detalhado LATAM)', 'hospedagem'],
  bookings: {
    flights: [
      { titulo: 'LATAM · FGCIPY', status: 'confirmado', origem_dado: 'gmail-2026-08-24' },
      { titulo: 'LATAM · FHTODW', status: 'confirmado', origem_dado: 'gmail-2026-08-24' },
    ],
    stays: [],
    experiences: [],
  },
};

// ── statuses do radar ───────────────────────────────────────────────────

test('RADAR_STATUSES cobre planned, em_planejamento e draft (e não wishlist/done)', () => {
  assert.ok(RADAR_STATUSES.has('planned'));
  assert.ok(RADAR_STATUSES.has('em_planejamento'));
  assert.ok(RADAR_STATUSES.has('draft'));
  assert.ok(!RADAR_STATUSES.has('wishlist'));
  assert.ok(!RADAR_STATUSES.has('done'));
});

// ── pendências ──────────────────────────────────────────────────────────

test('getPendencias: entrada ausente/inválida vira [] (nunca lança)', () => {
  assert.deepEqual(getPendencias(undefined), []);
  assert.deepEqual(getPendencias({}), []);
  assert.deepEqual(getPendencias({ pendencias: 'voos' }), []);
  assert.deepEqual(getPendencias({ pendencias: ['  ', 'voos', 42] }), ['voos']);
});

test('Maceió: hotel confirmado → só badge de voo', () => {
  const badges = pendenciaBadges(MACEIO).map((b) => b.kind);
  assert.deepEqual(badges, ['voo']);
});

test('Floripa: voos comprados → nunca "sem voo"; falta hospedagem → só badge de hotel', () => {
  const badges = pendenciaBadges(FLORIPA).map((b) => b.kind);
  assert.deepEqual(badges, ['hotel']);
});

test('reserva confirmada VETA o badge, mesmo com pendência textual na categoria', () => {
  const t = {
    pendencias: ['rever hospedagem — hotel pode mudar'],
    bookings: { stays: [{ titulo: 'X', status: 'confirmado' }], flights: [{ status: 'confirmado' }] },
  };
  assert.ok(!classifyPendencias(t).semHotel);
  assert.ok(!classifyPendencias(t).semVoo);
  assert.deepEqual(pendenciaBadges(t), []);
});

test('destaque do rótulo segue a ordem em que o humano escreveu a pendência', () => {
  const semNada = { bookings: { flights: [], stays: [] } };
  assert.equal(classifyPendencias({ ...semNada, pendencias: ['hospedagem', 'voos'] }).destaque, 'hotel');
  assert.equal(classifyPendencias({ ...semNada, pendencias: ['voos', 'hospedagem'] }).destaque, 'voo');
  // Sem menção textual, voo tem prioridade sobre hotel.
  assert.equal(classifyPendencias({ ...semNada, pendencias: ['transfer'] }).destaque, 'voo');
});

test('booking pendente NÃO conta como resolvido (buraco continua aberto)', () => {
  const t = { bookings: { flights: [{ titulo: 'X', status: 'pendente' }] } };
  assert.ok(classifyPendencias(t).semVoo);
});

test('booking cancelado é ignorado em todo o módulo', () => {
  const t = {
    bookings: { stays: [{ titulo: 'X', status: 'cancelado', valor: 999, reembolsavel: false }] },
  };
  assert.equal(allBookings(t).length, 0);
  assert.ok(classifyPendencias(t).semHotel);
  assert.equal(tripCosts(t).pago, 0);
  assert.deepEqual(nonRefundable(t), []);
});

test('confirmada legada (confirmada:true sem status) conta como resolvida', () => {
  const t = { bookings: { flights: [{ titulo: 'X', confirmada: true }] } };
  assert.ok(!classifyPendencias(t).semVoo);
});

// ── contagem regressiva ─────────────────────────────────────────────────

test('daysBetween: ISO inválido ou ausente → null', () => {
  assert.equal(daysBetween(HOJE, undefined), null);
  assert.equal(daysBetween(HOJE, '06/11/2026'), null);
  assert.equal(daysBetween('2026-11-06', '2026-11-08'), 2);
});

test('Maceió em 24/08: faltam 74 dias, tom violeta, rótulo com "e sem voo"', () => {
  const cd = countdown(MACEIO, HOJE);
  assert.equal(cd.days, 74);
  assert.equal(cd.tone, 'violeta');
  assert.equal(cd.label, 'faltam 74 dias e sem voo');
});

test('tons: >60 violeta · 60 e 30 ameixa · 29 vermelho', () => {
  const at = (d) => countdown({ startDate: d, bookings: { flights: [{ status: 'confirmado' }], stays: [{ status: 'confirmado' }] } }, '2026-01-01');
  assert.equal(at('2026-03-03').tone, 'violeta'); // 61 dias
  assert.equal(at('2026-03-02').tone, 'ameixa'); // 60 dias
  assert.equal(at('2026-01-31').tone, 'ameixa'); // 30 dias
  assert.equal(at('2026-01-30').tone, 'vermelho'); // 29 dias
});

test('countdown: singular em 1 dia e null para data passada ou ausente', () => {
  const base = { bookings: { flights: [{ status: 'confirmado' }], stays: [{ status: 'confirmado' }] } };
  assert.equal(countdown({ ...base, startDate: '2026-01-02' }, '2026-01-01').label, 'falta 1 dia');
  assert.equal(countdown({ ...base, startDate: '2025-12-31' }, '2026-01-01'), null);
  assert.equal(countdown(FLORIPA, HOJE), null); // rascunho sem startDate
});

// ── selo e proveniência ─────────────────────────────────────────────────

test('nonRefundable: só reembolsavel:false explícito; ausente não acende', () => {
  assert.equal(nonRefundable(MACEIO).length, 1);
  assert.deepEqual(nonRefundable(FLORIPA), []);
  assert.deepEqual(nonRefundable({ bookings: { stays: [{ titulo: 'X', reembolsavel: true }] } }), []);
});

test('origensDado: únicas, ordenadas, e [] quando nenhum booking declara', () => {
  assert.deepEqual(origensDado(FLORIPA), ['gmail-2026-08-24']);
  assert.deepEqual(origensDado({ bookings: { flights: [{ titulo: 'X' }] } }), []);
  assert.deepEqual(
    origensDado({
      bookings: {
        flights: [{ origem_dado: 'latam-2026-08-23' }],
        stays: [{ origem_dado: 'gmail-2026-08-24' }],
      },
    }),
    ['gmail-2026-08-24', 'latam-2026-08-23'],
  );
});

// ── mini-resumo financeiro ──────────────────────────────────────────────

test('Maceió: R$ 750,48 pago, nada a comprometer', () => {
  const c = tripCosts(MACEIO);
  assert.equal(c.pago, 750.48);
  assert.equal(c.restante, 0);
  assert.equal(c.moeda, 'BRL');
  assert.equal(c.fromOverride, false);
});

test('pago vs restante seguem o status do booking', () => {
  const t = {
    bookings: {
      flights: [{ status: 'confirmado', valor: 1000 }, { status: 'pendente', valor: 400 }],
      stays: [{ status: 'em_andamento', valor: 250 }],
    },
  };
  assert.equal(tripCosts(t).pago, 1000);
  assert.equal(tripCosts(t).restante, 650);
});

test('pago + restante = total de computeActualFromBookings (mesma convenção BRL)', () => {
  const t = {
    bookings: {
      flights: [{ status: 'confirmado', valor: 1000 }, { status: 'pendente', price_brl: 400 }],
      stays: [{ status: 'confirmado', valor: 900, moeda: 'USD', price_brl: 4800 }],
      experiences: [{ status: 'pendente', valor: 120 }],
    },
  };
  const c = tripCosts(t);
  const a = computeActualFromBookings(t.bookings);
  assert.equal(c.pago + c.restante, a.flights + a.stays + a.experiences);
  assert.equal(c.pago, 1000 + 4800); // valor em USD não entra; cai para price_brl
});

test('custo_pago/custo_estimado_restante sobrescrevem o cálculo e marcam fromOverride', () => {
  const t = { ...MACEIO, custo_pago: 800, custo_estimado_restante: 1200 };
  const c = tripCosts(t);
  assert.equal(c.pago, 800);
  assert.equal(c.restante, 1200);
  assert.equal(c.fromOverride, true);
});

test('override negativo/não numérico é ignorado (cai no cálculo)', () => {
  assert.equal(tripCosts({ ...MACEIO, custo_pago: -5 }).pago, 750.48);
  assert.equal(tripCosts({ ...MACEIO, custo_pago: 'muito' }).pago, 750.48);
});

test('trip vazia/undefined não quebra nada', () => {
  for (const t of [undefined, null, {}, { bookings: null }]) {
    assert.deepEqual(pendenciaBadges(t).map((b) => b.kind), ['voo', 'hotel']);
    assert.equal(countdown(t, HOJE), null);
    assert.equal(tripCosts(t).pago, 0);
    assert.deepEqual(origensDado(t), []);
  }
});

// ── Selo de reembolso ───────────────────────────────────────────────────

test('parseRefundDeadline: extrai a data mesmo com ruído em volta', () => {
  assert.equal(parseRefundDeadline(FLEX), '2026-12-18');
  assert.equal(parseRefundDeadline('cancelamento livre até 5/1/2027'), '2027-01-05');
});

test('parseRefundDeadline: sem data, data impossível ou não-string → null', () => {
  assert.equal(parseRefundDeadline('sem prazo definido'), null);
  assert.equal(parseRefundDeadline('31/02/2026'), null);
  assert.equal(parseRefundDeadline('30/13/2026'), null);
  assert.equal(parseRefundDeadline(undefined), null);
  assert.equal(parseRefundDeadline(42), null);
});

test('selo vermelho: reembolsavel:false vence qualquer nota', () => {
  const s = refundSeal(MACEIO, HOJE);
  assert.equal(s.tone, 'vermelho');
  assert.equal(s.label, 'não reembolsável');
  assert.equal(s.deadline, null);
});

test('selo verde: prazo ainda aberto vira "protegida até DD/MM"', () => {
  const s = refundSeal(REVEILLON, HOJE);
  assert.equal(s.tone, 'verde');
  assert.equal(s.label, 'protegida até 18/12');
  assert.equal(s.deadline, '2026-12-18');
});

test('selo verde vira vermelho quando o prazo vence — sem afirmar não-reembolsável', () => {
  const s = refundSeal(REVEILLON, '2026-12-19');
  assert.equal(s.tone, 'vermelho');
  assert.equal(s.label, 'proteção expirada em 18/12');
});

test('no dia do prazo a proteção ainda vale', () => {
  assert.equal(refundSeal(REVEILLON, '2026-12-18').tone, 'verde');
});

test('com vários prazos, vale o que vence primeiro', () => {
  const t = {
    bookings: {
      flights: [{ titulo: 'A', reembolsavel: true, reembolso_nota: 'até 20/12/2026' }],
      stays: [{ titulo: 'B', reembolsavel: true, reembolso_nota: 'até 05/12/2026' }],
    },
  };
  assert.equal(refundSeal(t, HOJE).label, 'protegida até 05/12');
});

test('sem reembolsavel:false e sem prazo reconhecível → nenhum selo', () => {
  assert.equal(refundSeal(FLORIPA, HOJE), null);
  assert.equal(refundSeal({ bookings: { flights: [{ titulo: 'X', reembolso_nota: 'consultar' }] } }, HOJE), null);
  assert.equal(refundSeal(undefined, HOJE), null);
});

test('booking cancelado não gera selo', () => {
  const t = { bookings: { stays: [{ titulo: 'X', status: 'cancelado', reembolsavel: true, reembolso_nota: 'até 05/12/2026' }] } };
  assert.equal(refundSeal(t, HOJE), null);
});

test('custo_pago das três viagens novas vem do override declarado', () => {
  assert.equal(tripCosts(REVEILLON).pago, 933.36);
  assert.equal(tripCosts(REVEILLON).fromOverride, true);
});

console.log(`\n${passed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
