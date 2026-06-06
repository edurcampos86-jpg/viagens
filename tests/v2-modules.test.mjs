// Testes funcionais dos módulos puros da v2.0
// Roda em Node 22 sem dependências extras.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}\n  ${e.message}`);
    failed++;
  }
}

// ── schema.js ────────────────────────────────────────────────────────
const schema = await import(`${ROOT}/src/core/schema.js`);

test('schema.getDates: v2 trip with dates', () => {
  const trip = { dates: { start: '2026-07-14', end: '2026-07-26' } };
  const d = schema.getDates(trip);
  assert.equal(d.start, '2026-07-14');
  assert.equal(d.end, '2026-07-26');
  assert.equal(d.nts, 12);
  assert.equal(d.source, 'v2');
});

test('schema.getDates: v1 legacy trip (year/month/nts)', () => {
  const trip = { year: 2021, month: 6, nts: 4 };
  const d = schema.getDates(trip);
  assert.equal(d.start, '2021-06-01');
  assert.equal(d.end, '2021-06-05');
  assert.equal(d.source, 'v1');
});

test('schema.getDates: canônico startDate/endDate tem precedência sobre year/month (ADR-003)', () => {
  // europa-tomorrowland: startDate preciso 07-17 coexiste com year/month=07.
  const trip = { startDate: '2026-07-17', endDate: '2026-07-28', year: 2026, month: 7, nts: 11 };
  const d = schema.getDates(trip);
  assert.equal(d.start, '2026-07-17'); // dia exato, NÃO 2026-07-01
  assert.equal(d.end, '2026-07-28');
  assert.equal(d.nts, 11);
  assert.equal(d.source, 'canonical');
});

test('schema.getDates: empty trip', () => {
  const d = schema.getDates({});
  assert.equal(d.start, null);
  assert.equal(d.source, 'unknown');
});

test('schema.validateTrip: valid v2 trip', () => {
  const r = schema.validateTrip({
    id: 'test-2026',
    name: 'Teste',
    status: 'planned',
    lat: -23, lon: -46,
    dates: { start: '2026-07-14', end: '2026-07-26' },
  });
  assert.equal(r.valid, true);
  assert.equal(r.errors.length, 0);
});

test('schema.validateTrip: rejects start > end', () => {
  const r = schema.validateTrip({
    id: 't', name: 'X', status: 'planned', lat: 0, lon: 0,
    dates: { start: '2026-07-26', end: '2026-07-14' },
  });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.includes('start > dates.end')));
});

test('schema.getBookings: v2 with bookings', () => {
  const b = schema.getBookings({
    bookings: { flights: [{ from: 'GRU' }], stays: [], experiences: [] },
  });
  assert.equal(b.flights.length, 1);
  assert.equal(b.source, 'v2');
});

test('schema.getBookings: v1 legacy hospedagem', () => {
  const b = schema.getBookings({
    id: 'old', hospedagem: [{ nome: 'Aman' }],
  });
  assert.equal(b.stays.length, 1);
  assert.equal(b.stays[0].name, 'Aman');
  assert.equal(b.source, 'v1');
});

// ── dates.js ─────────────────────────────────────────────────────────
const dates = await import(`${ROOT}/src/core/dates.js`);

test('dates.deriveDatesFromBookings: from flights', () => {
  const inferred = dates.deriveDatesFromBookings({
    flights: [
      { departure: '2026-07-14T22:30:00', arrival: '2026-07-15T10:00:00' },
      { departure: '2026-07-26T08:00:00', arrival: '2026-07-26T18:00:00' },
    ],
    stays: [],
    experiences: [],
  });
  assert.equal(inferred.start, '2026-07-14');
  assert.equal(inferred.end, '2026-07-26');
  assert.equal(inferred.nts, 12);
  assert.equal(inferred.computed_from, 'flight');
});

test('dates.deriveDatesFromBookings: from stays only', () => {
  const inferred = dates.deriveDatesFromBookings({
    flights: [],
    stays: [
      { check_in: '2026-08-01', check_out: '2026-08-05' },
      { check_in: '2026-08-05', check_out: '2026-08-10' },
    ],
  });
  assert.equal(inferred.start, '2026-08-01');
  assert.equal(inferred.end, '2026-08-10');
  assert.equal(inferred.computed_from, 'stay');
});

test('dates.deriveDatesFromBookings: empty returns null', () => {
  assert.equal(dates.deriveDatesFromBookings({ flights: [], stays: [] }), null);
  assert.equal(dates.deriveDatesFromBookings(null), null);
});

// ── dates.js — espelhos legacy canônicos (ADR-003 / B3.1) ────────────
test('dates.deriveLegacyDateFields: deriva year/month/nts de start/end', () => {
  const d = dates.deriveLegacyDateFields('2026-10-09', '2026-10-17');
  assert.equal(d.startDate, '2026-10-09');
  assert.equal(d.endDate, '2026-10-17');
  assert.equal(d.year, 2026);
  assert.equal(d.month, 10);
  assert.equal(d.nts, 8);
});

test('dates.deriveLegacyDateFields: só start → year/month, nts null', () => {
  const d = dates.deriveLegacyDateFields('2026-07-17', null);
  assert.equal(d.year, 2026);
  assert.equal(d.month, 7);
  assert.equal(d.nts, null);
  assert.equal(d.endDate, null);
});

test('dates.deriveLegacyDateFields: sem datas → tudo null', () => {
  const d = dates.deriveLegacyDateFields(null, null);
  assert.equal(d.startDate, null);
  assert.equal(d.year, null);
  assert.equal(d.month, null);
  assert.equal(d.nts, null);
});

// ── guarda anti-drift de datas (ADR-003 / B3.3) ──────────────────────
// Falha se algum registro tiver dates.* divergente de startDate/endDate (ou
// dates.* órfão sem o canônico). startDate/endDate é a forma canônica; dates.*
// é deprecado e não deve mais ser escrito. Hoje 0 registros usam dates.*.
test('guarda B3.3: nenhum registro com drift dates.* × startDate/endDate', () => {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'data/trips.json'), 'utf8'));
  const trips = Array.isArray(raw) ? raw : raw.trips;
  const drift = [];
  for (const t of trips) {
    const ds = t.dates?.start || null;
    const de = t.dates?.end || null;
    if (!ds && !de) continue; // sem dates.* → ok (canônico)
    const ss = t.startDate || null;
    const se = t.endDate || null;
    if ((ss && ds && ds !== ss) || (se && de && de !== se) || (ds && !ss) || (de && !se)) {
      drift.push(t.id);
    }
  }
  assert.equal(drift.length, 0, `registros com drift de datas: ${drift.join(', ')}`);
});

// ── geo.js ───────────────────────────────────────────────────────────
const geo = await import(`${ROOT}/src/core/geo.js`);

test('geo.flagFromCountryCode: BR -> 🇧🇷', () => {
  assert.equal(geo.flagFromCountryCode('BR'), '🇧🇷');
  assert.equal(geo.flagFromCountryCode('us'), '🇺🇸');
  assert.equal(geo.flagFromCountryCode(''), '');
  assert.equal(geo.flagFromCountryCode('XYZ'), '');
});

test('geo.slugify: handles accents/special chars', () => {
  assert.equal(geo.slugify('Bruxelas + Tomorrowland'), 'bruxelas-tomorrowland');
  assert.equal(geo.slugify('São Paulo, Brasil'), 'sao-paulo-brasil');
  assert.equal(geo.slugify(''), '');
});

test('geo.tripIdFrom: name + ISO date', () => {
  assert.equal(geo.tripIdFrom('Bruxelas Trip', '2026-07-14'), 'bruxelas-trip-2026-07');
  assert.equal(geo.tripIdFrom('Foo', null), 'foo');
});

// ── geo.js — coordenadas manuais (B1) ────────────────────────────────
test('geo.isValidLat/isValidLon: ranges', () => {
  assert.equal(geo.isValidLat(-12.5775), true);
  assert.equal(geo.isValidLat(90), true);
  assert.equal(geo.isValidLat(91), false);
  assert.equal(geo.isValidLat('-12'), false); // string não conta
  assert.equal(geo.isValidLon(-38.0064), true);
  assert.equal(geo.isValidLon(-181), false);
  assert.equal(geo.isValidLon(NaN), false);
});

// ── geo.js — viés de região + trava de confiança (B2) ────────────────
test('geo.rankByRegion: prefere BR mantendo importonce como desempate', () => {
  const ranked = geo.rankByRegion([
    { display: 'San Island Resort, Maldivas', country_code: 'MV', importance: 0.6 },
    { display: 'Praia do Forte, BA', country_code: 'BR', importance: 0.4 },
  ]);
  assert.equal(ranked[0].country_code, 'BR'); // BR sobe apesar de importonce menor
});

test('geo.assessGeoTrust: BR de alta relevância → confiável', () => {
  const t = geo.assessGeoTrust([
    { country_code: 'BR', importance: 0.7 },
  ]);
  assert.equal(t.trusted, true);
  assert.equal(t.confirm, false);
});

test('geo.assessGeoTrust: fora da região (San Island → Maldivas) → confirmar', () => {
  const t = geo.assessGeoTrust([
    { country_code: 'MV', importance: 0.7 },
  ]);
  assert.equal(t.trusted, false);
  assert.equal(t.confirm, true);
  assert.ok(t.reasons.includes('fora-da-região'));
});

test('geo.assessGeoTrust: baixa relevância → confirmar', () => {
  const t = geo.assessGeoTrust([{ country_code: 'BR', importance: 0.1 }]);
  assert.equal(t.confirm, true);
  assert.ok(t.reasons.includes('baixa-relevância'));
});

test('geo.assessGeoTrust: lista vazia → confirmar', () => {
  const t = geo.assessGeoTrust([]);
  assert.equal(t.confirm, true);
});

// ── schema.js — proveniência de geo (B1) + range ─────────────────────
test('schema.getGeoSource: manual/nominatim/legacy', () => {
  assert.equal(schema.getGeoSource({ geo_source: 'manual' }).source, 'manual');
  assert.equal(schema.getGeoSource({ geo_source: 'nominatim' }).known, true);
  assert.equal(schema.getGeoSource({}).source, 'unknown');
  assert.equal(schema.getGeoSource({}).known, false);
});

test('schema.validateTrip: rejeita lat/lon fora do range e geo_source inválido', () => {
  assert.equal(schema.validateTrip({ id: 'x', name: 'X', lat: 95 }).valid, false);
  assert.equal(schema.validateTrip({ id: 'x', name: 'X', lon: -200 }).valid, false);
  assert.equal(schema.validateTrip({ id: 'x', name: 'X', geo_source: 'gmail' }).valid, false);
  assert.equal(schema.validateTrip({ id: 'x', name: 'X', lat: -12.5, lon: -38, geo_source: 'manual' }).valid, true);
});

// ── decision-matrix.js (computeScores) ────────────────────────────────
const dm = await import(`${ROOT}/src/components/decision-matrix.js`);

test('decision.computeScores: ranks correctly with weights', () => {
  const decision = {
    options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    criteria: [
      { id: 'c1', label: 'C1', weight: 5 },
      { id: 'c2', label: 'C2', weight: 1 },
    ],
    scores: {
      a: { c1: 5, c2: 0 },    // 5*5 + 0*1 = 25
      b: { c1: 0, c2: 5 },    // 0*5 + 5*1 = 5
    },
  };
  const r = dm.computeScores(decision);
  assert.equal(r.best.option.id, 'a');
  assert.equal(r.results[0].option.id, 'a');
  assert.equal(r.results[0].raw, 25);
});

// ── benchmark.js (compareTrip) ────────────────────────────────────────
const bm = await import(`${ROOT}/src/components/benchmark.js`);

test('benchmark.compareTrip: no data returns has_data=false', () => {
  const r = bm.compareTrip(
    { continent: 'Europe' },
    { by_continent: {}, by_country: {}, hotels: [] }
  );
  assert.equal(r.has_data, false);
});

test('benchmark.compareTrip: continent stats present', () => {
  const r = bm.compareTrip(
    { continent: 'Europa', budget: { actual: { flights: 5000 } } },
    {
      by_continent: { Europa: { daily: { avg: 1200, n: 3 }, flight: { avg: 4500 } } },
      by_country: {},
      hotels: [],
    }
  );
  assert.equal(r.has_data, true);
  assert.ok(r.lines[0].includes('Europa'));
  assert.ok(r.lines.some((l) => l.includes('11%')));  // 5000 vs 4500 ≈ +11%
});

// ── wizard.js (nextStep) ──────────────────────────────────────────────
const wizard = await import(`${ROOT}/src/components/wizard.js`);

test('wizard.nextStep: D > 90 → flight', () => {
  const today = new Date('2026-01-01');
  const trip = { dates: { start: '2026-07-14' } };
  const p = wizard.nextStep(trip, today);
  assert.equal(p.id, 'flight');
  assert.equal(p.daysToStart, 194);
});

test('wizard.nextStep: D in 14..30 → compliance', () => {
  const today = new Date('2026-06-25');
  const trip = { dates: { start: '2026-07-14' } };
  const p = wizard.nextStep(trip, today);
  assert.equal(p.id, 'compliance');
});

test('wizard.nextStep: post-trip → done', () => {
  const today = new Date('2026-12-01');
  const trip = { dates: { start: '2026-07-14' } };
  const p = wizard.nextStep(trip, today);
  assert.equal(p.id, 'done');
});

// ── checklist.js (injectChecklistItems) ───────────────────────────────
const cl = await import(`${ROOT}/src/components/checklist.js`);
const rules = JSON.parse(
  readFileSync(new URL('../data/destination_rules.json', import.meta.url), 'utf8'),
);

test('checklist: Tailândia injeta visto + febre amarela', () => {
  const items = cl.injectChecklistItems([], { country_code: 'TH', country: 'Tailandia' }, rules);
  const labels = items.map((it) => it.item).join(' | ');
  assert.ok(labels.toLowerCase().includes('visto'), `nao achou visto: ${labels}`);
  assert.ok(labels.toLowerCase().includes('febre amarela'), `nao achou febre amarela: ${labels}`);
  assert.ok(items.every((it) => it.auto_added === true));
});

test('checklist: Brasil doméstico não pede visto', () => {
  const items = cl.injectChecklistItems([], { country_code: 'BR', country: 'Brasil' }, rules);
  const labels = items.map((it) => it.item).join(' | ').toLowerCase();
  assert.ok(!labels.includes('visto'), `BR doméstico não deveria ter visto: ${labels}`);
  assert.ok(labels.includes('rg') || labels.includes('cnh'));
});

test('checklist: Schengen genérico (FR) via applies_to', () => {
  const items = cl.injectChecklistItems([], { country_code: 'FR', country: 'França' }, rules);
  const labels = items.map((it) => it.item).join(' | ').toLowerCase();
  assert.ok(labels.includes('etias') || labels.includes('schengen'), `FR deveria pegar schengen: ${labels}`);
});

test('checklist: injeção idempotente', () => {
  const trip = { country_code: 'TH', country: 'Tailandia' };
  const first = cl.injectChecklistItems([], trip, rules);
  const second = cl.injectChecklistItems(first, trip, rules);
  assert.equal(first.length, second.length, 'segunda chamada não deveria duplicar');
});

test('checklist B7: sp-junho matchea br-sp-junho (region SP + mês 6 + festival)', () => {
  const trip = {
    country_code: 'BR',
    country: 'Brasil',
    sub: 'São Paulo · SP',
    startDate: '2026-06-13',
    type: 'festival',
  };
  const items = cl.injectChecklistItems([], trip, rules);
  const labels = items.map((it) => it.item).join(' | ').toLowerCase();
  assert.ok(labels.includes('casaco'), `esperava casaco em SP no inverno: ${labels}`);
  assert.ok(labels.includes('uber') || labels.includes('99'), `esperava ride-hailing: ${labels}`);
});

test('checklist B7: trip BR genérico não pega br-sp-junho (sem region)', () => {
  const trip = {
    country_code: 'BR',
    country: 'Brasil',
    sub: 'Brasilia · DF',
    startDate: '2026-06-15',
    type: 'event',
  };
  const items = cl.injectChecklistItems([], trip, rules);
  const labels = items.map((it) => it.item).join(' | ').toLowerCase();
  assert.ok(!labels.includes('casaco medio'), `Brasília não deveria pegar regra SP: ${labels}`);
});

// ── customs.js (run for international trip) ───────────────────────────
// Não testamos a UI; só a função pura `run` retornando estrutura esperada.
const customs = await import(`${ROOT}/src/agents/customs.js`);

await asyncTest('customs.run: viagem doméstica reporta só voltagem/direção', async () => {
  // Para domésticas, passaporte/visto/vacinas/seguro são puladas (returns null);
  // voltagem e direção continuam aparecendo como info útil.
  const result = await customs.run({
    trip: { country_code: 'BR', country: 'Brasil' },
    profile: null,
    rulesDoc: rules,
  });
  assert.equal(result.international, false);
  const ids = result.items.map((it) => it.id).sort();
  // Aceita voltagem + direção; nunca deve ter passport/visa/vaccines/insurance
  for (const forbidden of ['passport', 'visa', 'vaccines', 'insurance']) {
    assert.ok(!ids.includes(forbidden), `domestica nao deveria ter ${forbidden}: ${ids}`);
  }
});

await asyncTest('customs.run: viagem internacional reporta itens', async () => {
  const result = await customs.run({
    trip: {
      country_code: 'TH', country: 'Tailandia',
      dates: { start: '2026-12-01', end: '2026-12-10' },
    },
    profile: null,
    rulesDoc: rules,
  });
  assert.ok(result.items.length >= 4, `esperava 4+ itens, veio ${result.items.length}`);
  assert.ok(result.items.every((it) => it.id && it.label && it.status && it.message));
  assert.ok(['green', 'yellow', 'red'].includes(result.overall));
});

// ── next-action.js (B3 — decideNextAction) ────────────────────────────
const na = await import(`${ROOT}/src/core/next-action.js`);

test('decideNextAction: wishlist → definir datas', () => {
  const r = na.decideNextAction({ status: 'wishlist', d: null });
  assert.match(r.label, /Definir datas e destino/);
  assert.equal(r.severity, 'warn');
  assert.equal(r.cta.kind, 'edit-dates');
});

test('decideNextAction: d > 90 → pesquisar voos e hospedagem', () => {
  const r = na.decideNextAction({ status: 'planned', d: 120 });
  assert.match(r.label, /Pesquisar voos e hospedagem/);
});

test('decideNextAction: 60 < d <= 90 sem voos confirmados → comprar voos', () => {
  const r = na.decideNextAction({ status: 'planned', d: 75, confirmedFlights: 0 });
  assert.match(r.label, /Comprar voos/);
  assert.equal(r.severity, 'warn');
});

test('decideNextAction: 30 < d <= 60 sem stays → reservar hospedagem', () => {
  const r = na.decideNextAction({ status: 'planned', d: 45, confirmedFlights: 2, hasStays: false });
  assert.match(r.label, /Reservar hospedagem/);
});

test('decideNextAction: d < 0 sem memória → registrar lembranças', () => {
  const r = na.decideNextAction({ status: 'done', d: -5, hasMemory: false });
  assert.match(r.label, /Registrar lembranças/);
});

test('decideNextAction: pendingChecks anexa sufixo (exceto done)', () => {
  const r = na.decideNextAction({ status: 'planned', d: 120, pendingChecks: 3 });
  assert.match(r.label, /\(3 itens pendentes\)/);
  const done = na.decideNextAction({ status: 'done', d: -10, hasMemory: true, pendingChecks: 3 });
  assert.equal(done.severity, 'done');
  assert.ok(!/pendente/.test(done.label));
});

// ── overlay.js (U4 — POIs + integração Fase 1) ────────────────────────
// Shim mínimo de localStorage p/ exercitar read/write (node não tem).
globalThis.localStorage = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
  removeItem(k) { delete this.store[k]; },
};
const overlay = await import(`${ROOT}/src/core/overlay.js`);

test('overlay.writeOverlay/readOverlay: round-trip grava e devolve igual', () => {
  overlay.writeOverlay('t-rt', { checklist: { a: true }, _topLevel: { startDate: '2026-06-13' } });
  const r = overlay.readOverlay('t-rt');
  assert.equal(r.checklist.a, true);
  assert.equal(r._topLevel.startDate, '2026-06-13');
});

test('overlay.writeOverlay: merge de _topLevel preserva campos + sub-seções coexistem', () => {
  overlay.writeOverlay('t-merge', { _topLevel: { startDate: '2026-06-13', nts: 9 } });
  overlay.writeOverlay('t-merge', { _topLevel: { endDate: '2026-06-22' } }); // só adiciona
  overlay.writeOverlay('t-merge', { checklist: { x: true } });               // sub-seção
  const r = overlay.readOverlay('t-merge');
  assert.equal(r._topLevel.startDate, '2026-06-13'); // preservado
  assert.equal(r._topLevel.nts, 9);                  // preservado
  assert.equal(r._topLevel.endDate, '2026-06-22');   // adicionado
  assert.equal(r.checklist.x, true);                 // sub-seção coexiste
});

test('overlay.clearOverlay: remove só a trip alvo', () => {
  overlay.writeOverlay('t-keep', { _topLevel: { nts: 3 } });
  overlay.writeOverlay('t-del', { _topLevel: { nts: 5 } });
  overlay.clearOverlay('t-del');
  assert.deepEqual(overlay.readOverlay('t-del'), {});            // removida
  assert.equal(overlay.readOverlay('t-keep')._topLevel.nts, 3);  // intacta
});

test('overlay.normalizePoi: POI válido normaliza com kind', () => {
  const p = overlay.normalizePoi({ name: ' Ibirapuera ', lat: -23.587, lon: -46.657, kind: 'viewpoint' });
  assert.deepEqual(p, { name: 'Ibirapuera', lat: -23.587, lon: -46.657, kind: 'viewpoint' });
});

test('overlay.normalizePoi: name vazio → null', () => {
  assert.equal(overlay.normalizePoi({ name: '   ', lat: 0, lon: 0 }), null);
});

test('overlay.normalizePoi: lat fora de range → null', () => {
  assert.equal(overlay.normalizePoi({ name: 'x', lat: 91, lon: 0 }), null);
  assert.equal(overlay.normalizePoi({ name: 'x', lat: 0, lon: 181 }), null);
});

test('overlay.normalizePoi: lat/lon não-numérico → null', () => {
  assert.equal(overlay.normalizePoi({ name: 'x', lat: 'abc', lon: 0 }), null);
});

test('overlay.normalizePoi: kind desconhecido cai para place', () => {
  const p = overlay.normalizePoi({ name: 'x', lat: 0, lon: 0, kind: 'spaceship' });
  assert.equal(p.kind, 'place');
});

test('overlay.normalizePoi: note opcional é trimada; vazia some', () => {
  assert.equal(overlay.normalizePoi({ name: 'x', lat: 0, lon: 0, note: '   ' }).note, undefined);
  assert.equal(overlay.normalizePoi({ name: 'x', lat: 0, lon: 0, note: ' oi ' }).note, 'oi');
});

test('overlay.mergeOverlayIntoTrip: aplica pois sem corromper campos Fase 1', () => {
  const trip = { id: 't', startDate: '2026-06-13', nts: 9, name: 'SP' };
  const ov = { _topLevel: { pois: [{ name: 'A', lat: 1, lon: 2, kind: 'hotel' }] } };
  const merged = overlay.mergeOverlayIntoTrip(trip, ov);
  assert.equal(merged.startDate, '2026-06-13'); // Fase 1 intacto
  assert.equal(merged.nts, 9);
  assert.equal(merged.pois.length, 1);
  assert.equal(merged.pois[0].kind, 'hotel');
  assert.equal(trip.pois, undefined); // não muta o original
});

test('overlay.diffOverlayVsTrip + buildPatchSnippet: pois entram no snippet', () => {
  const trip = { id: 't', startDate: '2026-06-13' };
  const ov = { _topLevel: { pois: [{ name: 'A', lat: 1, lon: 2, kind: 'place' }] } };
  const diff = overlay.diffOverlayVsTrip(trip, ov);
  assert.equal(diff.hasChanges, true);
  assert.ok(diff.fields.some((f) => f.key === 'pois'));
  const snip = overlay.buildPatchSnippet('t', ov);
  assert.equal(snip.id, 't');
  assert.equal(snip.pois.length, 1);
});

// H1 (B5) regression guard: diffOverlayVsTrip DEVE receber a trip canônica
// como primeiro argumento. Passar a trip já mesclada com overlay causa o
// bug histórico — diff sempre retorna hasChanges=false porque trip[field]
// já espelha override. Esse teste falha se alguém reverter o contrato.
test('overlay.diffOverlayVsTrip: contrato canonical-vs-merged (regressão B5)', () => {
  const canonical = { id: 't-b5', startDate: '2026-06-13', endDate: '2026-06-22', nts: 9 };
  const ov = { _topLevel: { startDate: '2026-06-14', nts: 8 } };
  const merged = overlay.mergeOverlayIntoTrip(canonical, ov);
  // Chamada CORRETA: trip canônica primeiro.
  const correct = overlay.diffOverlayVsTrip(canonical, ov);
  assert.equal(correct.hasChanges, true);
  assert.equal(correct.fields.length, 2);
  // Chamada INCORRETA (era o bug): passar a merged trip. Diff vai dar vazio
  // porque merged.startDate === ov._topLevel.startDate. O teste documenta
  // explicitamente esse comportamento pra ninguém repetir o erro.
  const wrong = overlay.diffOverlayVsTrip(merged, ov);
  assert.equal(wrong.hasChanges, false, 'merged trip não pode substituir trip canônica');
});

test('overlay.diffOverlayVsTrip: sem overlay → diff vazio', () => {
  const trip = { id: 't', startDate: '2026-06-13', endDate: '2026-06-22', nts: 9 };
  assert.equal(overlay.diffOverlayVsTrip(trip, {}).hasChanges, false);
  assert.equal(overlay.diffOverlayVsTrip(trip, { _topLevel: {} }).hasChanges, false);
});

test('overlay.diffOverlayVsTrip: 1 campo editado → 1 field só', () => {
  const trip = { id: 't', startDate: '2026-06-13', endDate: '2026-06-22', nts: 9 };
  const diff = overlay.diffOverlayVsTrip(trip, { _topLevel: { startDate: '2026-06-14' } });
  assert.equal(diff.fields.length, 1);
  assert.equal(diff.fields[0].key, 'startDate');
  assert.equal(diff.fields[0].original, '2026-06-13');
  assert.equal(diff.fields[0].override, '2026-06-14');
});

// ── checklist-order.js (F5 — ordem + prazos) ──────────────────────────
const clo = await import(`${ROOT}/src/core/checklist-order.js`);

test('applyChecklistOrder: respeita ordem salva; desconhecidos ao fim (estável)', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'novo' }];
  const out = clo.applyChecklistOrder(items, ['c', 'a']);
  assert.deepEqual(out.map((i) => i.id), ['c', 'a', 'b', 'novo']);
});

test('applyChecklistOrder: sem ordem salva devolve cópia na ordem original', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const out = clo.applyChecklistOrder(items, []);
  assert.deepEqual(out.map((i) => i.id), ['a', 'b']);
  assert.notEqual(out, items); // cópia
});

test('moveItem: insere antes do alvo', () => {
  assert.deepEqual(clo.moveItem(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
});

test('moveItem: toId null move pro fim; no-op se id ausente', () => {
  assert.deepEqual(clo.moveItem(['a', 'b', 'c'], 'a', null), ['b', 'c', 'a']);
  assert.deepEqual(clo.moveItem(['a', 'b'], 'x', 'a'), ['a', 'b']);
});

test('isItemOverdue: vencido só se tem prazo, não-checado e antes de hoje', () => {
  const today = new Date('2026-06-15T12:00:00Z');
  assert.equal(clo.isItemOverdue('2026-06-10', false, today), true);
  assert.equal(clo.isItemOverdue('2026-06-10', true, today), false);  // checado
  assert.equal(clo.isItemOverdue('2026-06-15', false, today), false); // vence hoje
  assert.equal(clo.isItemOverdue('2026-06-20', false, today), false); // futuro
  assert.equal(clo.isItemOverdue('', false, today), false);           // sem prazo
});

// ── overlay-tracked.js (H1.5 — multi-branch diff/sync) ────────────────
const ot = await import(`${ROOT}/src/core/overlay-tracked.js`);

// Defs reproduzem (em forma compacta) o TRACKED_BRANCHES do app.js:
// _topLevel para campos diretos da trip, committed para trip.budget.committed.
const H15_DEFS = [
  {
    branch: '_topLevel',
    listFields: (st) => Object.keys(st?._topLevel || {}),
    canonicalGetter: (trip, field) => trip[field],
    overrideGetter: (st, field) => st?._topLevel?.[field],
    applyToCanonical: (out, field, value) => { out[field] = value; },
    clear: (st) => { delete st._topLevel; },
  },
  {
    branch: 'committed',
    listFields: (st) => Object.keys(st?.committed || {}),
    canonicalGetter: (trip, field) => +(trip?.budget?.committed?.[field] || 0),
    overrideGetter: (st, field) => +(st?.committed?.[field] || 0),
    applyToCanonical: (out, field, value) => {
      out.budget = out.budget || {};
      out.budget.committed = out.budget.committed || {};
      out.budget.committed[field] = value;
    },
    clear: (st) => { delete st.committed; },
  },
];

test('computeTrackedEdits: committed.voos editado → item com path "committed.voos"', () => {
  const trip = { id: 'sp', budget: { committed: { voos: 0 } } };
  const st = { committed: { voos: 800 } };
  const { items, snippet } = ot.computeTrackedEdits(trip, st, H15_DEFS);
  assert.equal(items.length, 1);
  assert.equal(items[0].path, 'committed.voos');
  assert.equal(items[0].branch, 'committed');
  assert.equal(items[0].field, 'voos');
  assert.equal(items[0].original, 0);
  assert.equal(items[0].override, 800);
  assert.deepEqual(snippet, { id: 'sp', budget: { committed: { voos: 800 } } });
});

test('computeTrackedEdits: count incrementa com edits em _topLevel E committed', () => {
  const trip = {
    id: 'sp',
    startDate: '2026-06-13',
    budget: { committed: { voos: 0, hospedagem: 5000 } },
  };
  const st = {
    _topLevel: { startDate: '2026-06-14' },
    committed: { voos: 800, hospedagem: 5000 }, // hospedagem inalterada — não conta
  };
  const { items, snippet } = ot.computeTrackedEdits(trip, st, H15_DEFS);
  assert.equal(items.length, 2);
  const paths = items.map((i) => i.path).sort();
  assert.deepEqual(paths, ['_topLevel.startDate', 'committed.voos']);
  // Snippet deve combinar os dois ramos no formato canônico do trips.json:
  assert.equal(snippet.startDate, '2026-06-14');
  assert.equal(snippet.budget.committed.voos, 800);
});

test('computeTrackedEdits: sem mudanças → items vazio + snippet null', () => {
  const trip = { id: 'sp', startDate: '2026-06-13', budget: { committed: { voos: 100 } } };
  const st = { _topLevel: { startDate: '2026-06-13' }, committed: { voos: 100 } };
  const { items, snippet } = ot.computeTrackedEdits(trip, st, H15_DEFS);
  assert.equal(items.length, 0);
  assert.equal(snippet, null);
});

test('clearTrackedBranches: limpa committed também (REGRESSÃO do bug do iPad)', () => {
  // Cenário reportado pelo Eduardo: descartar edições removia _topLevel mas
  // committed.voos persistia silenciosamente. Esse teste garante que a
  // varredura genérica limpa todos os ramos rastreados.
  const st = {
    statusOverride: 'planned',
    _topLevel: { startDate: '2026-06-14' },
    committed: { voos: 800 },
    checklist: { flights: true },  // sub-seção NÃO rastreada — deve sobreviver
    notes: 'lembrar de levar adaptador',
  };
  ot.clearTrackedBranches(st, H15_DEFS);
  assert.equal(st._topLevel, undefined, '_topLevel deve sumir');
  assert.equal(st.committed, undefined, 'committed deve sumir (era o bug)');
  assert.equal(st.statusOverride, 'planned', 'statusOverride fora do scope dos defs — preservado');
  assert.deepEqual(st.checklist, { flights: true }, 'sub-seção runtime preservada');
  assert.equal(st.notes, 'lembrar de levar adaptador', 'notes preservadas');
});

test('applyTrackedEdits: in-place no trip canônico aplica committed.* corretamente', () => {
  // Simula o que downloadTripsJson faz: pega trip do trips.json, aplica
  // overrides do localStorage in-place.
  const trip = {
    id: 'sp',
    startDate: '2026-06-13',
    budget: { committed: { voos: 0 } },
  };
  const st = {
    _topLevel: { startDate: '2026-06-14' },
    committed: { voos: 800, comida: 2000 },
  };
  ot.applyTrackedEdits(trip, st, H15_DEFS);
  assert.equal(trip.startDate, '2026-06-14');
  assert.equal(trip.budget.committed.voos, 800);
  assert.equal(trip.budget.committed.comida, 2000);
});

test('computeTrackedEdits: defaults benignos para inputs inválidos', () => {
  assert.deepEqual(ot.computeTrackedEdits(null, {}, H15_DEFS), { items: [], snippet: null });
  assert.deepEqual(ot.computeTrackedEdits({ id: 't' }, null, H15_DEFS), { items: [], snippet: null });
  assert.deepEqual(ot.computeTrackedEdits({ id: 't' }, {}, null), { items: [], snippet: null });
});

// ── Teste de INTEGRAÇÃO com seed real do data/trips.json ──────────────
// Garante que os defs do app.js (replicados em H15_DEFS_REAL abaixo)
// detectam corretamente startDate, pois e committed.voos num trip
// concreto do trips.json — o caso reportado pelo Eduardo no Chrome
// desktop em 2026-05-25 que parecia regressão.
const tripsJsonPath = fileURLToPath(new URL('../data/trips.json', import.meta.url));
const tripsData = JSON.parse(readFileSync(tripsJsonPath, 'utf8'));
const realTrip = tripsData.trips.find((t) => t.id === 'sp-junho-2026');

// Defs do app.js, replicados aqui. overlay.TOP_LEVEL_FIELDS importado real.
const H15_DEFS_REAL = [
  {
    branch: '_topLevel',
    listFields: (st) => {
      // Aceita ambos os formatos: dentro de _topLevel (UI) ou na raiz
      // (overlays órfãos / console). União de fields candidatos.
      const inWrapper = Object.keys(st?._topLevel || {}).filter((k) => overlay.TOP_LEVEL_FIELDS.includes(k));
      const onRoot = Object.keys(st || {}).filter((k) => overlay.TOP_LEVEL_FIELDS.includes(k));
      return [...new Set([...inWrapper, ...onRoot])];
    },
    canonicalGetter: (trip, field) => trip[field],
    overrideGetter: (st, field) => (st?._topLevel?.[field] !== undefined ? st._topLevel[field] : st?.[field]),
    applyToCanonical: (out, field, value) => { out[field] = value; },
    clear: (st) => {
      delete st._topLevel;
      for (const k of overlay.TOP_LEVEL_FIELDS) delete st[k];
    },
  },
  {
    branch: 'committed',
    listFields: (st) => Object.keys(st?.committed || {}),
    canonicalGetter: (trip, field) => +(trip?.budget?.committed?.[field] || 0),
    overrideGetter: (st, field) => +(st?.committed?.[field] || 0),
    applyToCanonical: (out, field, value) => {
      out.budget = out.budget || {};
      out.budget.committed = out.budget.committed || {};
      out.budget.committed[field] = value;
    },
    clear: (st) => { delete st.committed; },
  },
];

test('REGRESSÃO H1.5: seed real + overlay UI (com wrapper _topLevel)', () => {
  assert.ok(realTrip, 'sp-junho-2026 deve existir em data/trips.json');
  const st = {
    _topLevel: {
      startDate: '2026-06-14',
      pois: [{ name: 'Hotel Tivoli', kind: 'hotel', lat: -23.55, lon: -46.63 }],
    },
    committed: { voos: 999 },
  };
  const { items, snippet } = ot.computeTrackedEdits(realTrip, st, H15_DEFS_REAL);
  const paths = items.map((i) => i.path).sort();
  assert.deepEqual(paths, ['_topLevel.pois', '_topLevel.startDate', 'committed.voos']);
  assert.equal(snippet.startDate, '2026-06-14');
  assert.equal(snippet.pois.length, 1);
  assert.equal(snippet.budget.committed.voos, 999);
});

test('REGRESSÃO H1.5: seed real + overlay RAW (campos na raiz, sem wrapper)', () => {
  // Esse é o overlay EXATO reportado pelo Eduardo no Chrome desktop —
  // gravado fora da UI (console manual, migração, teste antigo). O fix
  // deve tolerar esse formato e detectar as 3 edições mesmo assim.
  const st = {
    startDate: '2026-06-14',
    pois: [{ name: 'Hotel Tivoli', kind: 'hotel', lat: -23.55, lng: -46.63 }],
    committed: { voos: 999 },
  };
  const { items, snippet } = ot.computeTrackedEdits(realTrip, st, H15_DEFS_REAL);
  const paths = items.map((i) => i.path).sort();
  assert.deepEqual(
    paths,
    ['_topLevel.pois', '_topLevel.startDate', 'committed.voos'],
    'overlay com fields na raiz (formato console) também deve ser detectado'
  );
  assert.equal(snippet.startDate, '2026-06-14');
  assert.equal(snippet.budget.committed.voos, 999);
});

test('REGRESSÃO H1.5: clearTrackedBranches limpa overlay RAW também', () => {
  // O Eduardo reportou: "Descartar edições locais" não limpava nem
  // committed nem _topLevel quando os campos estavam na raiz. Esse
  // teste garante que o clear cobre os 3 formatos.
  const st = {
    statusOverride: 'planned',          // fora do scope (preservar)
    startDate: '2026-06-14',            // raw — limpar
    pois: [{ name: 'X', lat: 0, lon: 0, kind: 'place' }],  // raw — limpar
    _topLevel: { endDate: '2026-06-23' },  // wrapper — limpar
    committed: { voos: 999 },           // committed — limpar
    checklist: { flights: true },       // sub-seção (preservar)
  };
  ot.clearTrackedBranches(st, H15_DEFS_REAL);
  assert.equal(st.startDate, undefined, 'startDate raw deve sumir');
  assert.equal(st.pois, undefined, 'pois raw deve sumir');
  assert.equal(st._topLevel, undefined, '_topLevel wrapper deve sumir');
  assert.equal(st.committed, undefined, 'committed deve sumir');
  assert.equal(st.statusOverride, 'planned', 'statusOverride preservado');
  assert.deepEqual(st.checklist, { flights: true }, 'checklist preservado');
});

// ── components/eventos.js (Sprint 3A · Etapa 2) ──────────────────────────
const eventos = await import(`${ROOT}/src/components/eventos.js`);

// Fixtures mínimas no formato de evento.schema.json (fora de ordem de propósito).
const EV_FIXTURES = [
  {
    id: 'ev-c',
    titulo: 'Show C',
    tipo: 'show',
    data: '2026-06-06',
    ingresso: { necessita_ingresso: true, status: 'comprado' },
  },
  {
    id: 'ev-a',
    titulo: 'Festival A',
    tipo: 'festival',
    data: '2026-06-04',
    horario_inicio: '15:30',
    ingresso: { necessita_ingresso: true, status: 'vendido' },
  },
  {
    id: 'ev-b',
    titulo: 'Festa B',
    tipo: 'festa',
    data: '2026-06-05',
    ingresso: { necessita_ingresso: true, status: 'comprado' },
  },
];

test('eventos.sortEventos: ordena por data ascendente', () => {
  const ids = eventos.sortEventos(EV_FIXTURES).map((e) => e.id);
  assert.deepEqual(ids, ['ev-a', 'ev-b', 'ev-c']);
});

test('eventos.sortEventos: não muta o array de entrada', () => {
  const original = EV_FIXTURES.map((e) => e.id);
  eventos.sortEventos(EV_FIXTURES);
  assert.deepEqual(
    EV_FIXTURES.map((e) => e.id),
    original
  );
});

test('eventos.renderEventos: rende N eventos em ordem', () => {
  const html = eventos.renderEventos(EV_FIXTURES);
  const matches = html.match(/class="ev-item/g) || [];
  assert.equal(matches.length, 3, 'deve renderizar 3 itens');
  // Ordem no HTML segue a data: A antes de B antes de C.
  assert.ok(
    html.indexOf('Festival A') < html.indexOf('Festa B') &&
      html.indexOf('Festa B') < html.indexOf('Show C'),
    'itens devem aparecer ordenados por data'
  );
  assert.ok(html.includes('04/06/2026'), 'deve formatar a data DD/MM/YYYY');
});

test('eventos.renderEventos: lista vazia → estado vazio', () => {
  const html = eventos.renderEventos([]);
  assert.ok(html.includes('ev-timeline--empty'), 'deve marcar estado vazio');
  assert.ok(html.includes('Sem eventos'), 'deve mostrar texto vazio');
  assert.ok(!html.includes('class="ev-item'), 'não deve haver itens');
});

test('eventos.renderEventos: entrada inválida (null) → estado vazio', () => {
  const html = eventos.renderEventos(null);
  assert.ok(html.includes('ev-timeline--empty'));
});

test('eventos.renderEventos: evento sem campos opcionais não quebra', () => {
  const minimo = [{ id: 'min', titulo: 'Mínimo', tipo: 'outro', data: '2026-07-01' }];
  const html = eventos.renderEventos(minimo);
  assert.ok(html.includes('Mínimo'), 'título renderizado');
  assert.ok(html.includes('01/07/2026'), 'data renderizada');
  assert.ok(html.includes('class="ev-item'), 'item renderizado mesmo sem ingresso/horario');
});

test('eventos.renderEventos: ingresso vendido/trocado → indicação neutra', () => {
  const html = eventos.renderEventos([EV_FIXTURES[1]]); // status vendido
  assert.ok(html.includes('ev-ingresso--repassado'), 'marca vendido como repassado');
  assert.ok(html.includes('Vendido'), 'rótulo Vendido');
});

test('eventos.renderEventos: evento sem data vai para o fim', () => {
  const comSemData = [
    { id: 'sem-data', titulo: 'Sem data', tipo: 'outro' },
    { id: 'com-data', titulo: 'Com data', tipo: 'show', data: '2026-06-04' },
  ];
  const html = eventos.renderEventos(comSemData);
  assert.ok(html.indexOf('Com data') < html.indexOf('Sem data'), 'com data vem antes');
  assert.ok(html.includes('Data a definir'), 'evento sem data mostra placeholder');
});

test('eventos.renderEventos: escapa HTML no título (XSS-safe)', () => {
  const html = eventos.renderEventos([
    { id: 'x', titulo: '<img src=x onerror=alert(1)>', tipo: 'outro', data: '2026-06-04' },
  ]);
  assert.ok(!html.includes('<img src=x'), 'tag crua não deve aparecer');
  assert.ok(html.includes('&lt;img'), 'deve estar escapado');
});

// ── core/eventos-data.js (Sprint 3A · Etapa 3a) ──────────────────────────
const eventosData = await import(`${ROOT}/src/core/eventos-data.js`);

// Fake fetch injetável: mapeia URL -> resposta. Sem rede.
function fakeFetch(map) {
  return async (url) => {
    if (Object.prototype.hasOwnProperty.call(map, url)) return map[url];
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const okJson = (data) => ({ ok: true, status: 200, json: async () => data });

await asyncTest('eventos-data.loadEventos: arquivo válido → array de eventos', async () => {
  eventosData.clearEventosCache();
  const evs = [{ id: 'a', titulo: 'A', tipo: 'show', data: '2026-06-04' }];
  const got = await eventosData.loadEventos('viagem-ok', {
    fetchImpl: fakeFetch({ 'data/eventos/viagem-ok.json': okJson(evs) }),
  });
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'a');
});

await asyncTest('eventos-data.loadEventos: 404 → [] (estado vazio)', async () => {
  eventosData.clearEventosCache();
  const got = await eventosData.loadEventos('sem-arquivo', { fetchImpl: fakeFetch({}) });
  assert.deepEqual(got, []);
});

await asyncTest('eventos-data.loadEventos: JSON não-array → []', async () => {
  eventosData.clearEventosCache();
  const got = await eventosData.loadEventos('ruim', {
    fetchImpl: fakeFetch({ 'data/eventos/ruim.json': okJson({ nao: 'array' }) }),
  });
  assert.deepEqual(got, []);
});

await asyncTest('eventos-data.loadEventos: fetch lança → [] (nunca quebra)', async () => {
  eventosData.clearEventosCache();
  const got = await eventosData.loadEventos('explode', {
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(got, []);
});

await asyncTest('eventos-data.loadEventos: id inválido → [] sem fetch', async () => {
  eventosData.clearEventosCache();
  let called = false;
  const got = await eventosData.loadEventos('', {
    fetchImpl: async () => {
      called = true;
      return okJson([]);
    },
  });
  assert.deepEqual(got, []);
  assert.equal(called, false, 'não deve chamar fetch para id vazio');
});

// ── Sumário ───────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
