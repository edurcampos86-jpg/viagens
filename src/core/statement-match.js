// Matching de transações do extrato com viagens e bookings.
//
// Decisões da Etapa 2 do port do extrato:
//   - Granularidade por booking: a transação casada preenche
//     bookings.{flights|stays|experiences}[i].valor/.moeda + proveniência
//     extra source:'extrato' e fitid. A APLICAÇÃO é da Etapa 3 — aqui só
//     apontamos o alvo via bookingPath.
//   - Transação sem match NUNCA vira booking automaticamente; fica no
//     statement-store aguardando revisão explícita no modal.
//   - Câmbio fora de escopo: valor + moeda originais, sem conversão.
//
// Funções puras, sem DOM. Datas via getDates() — o leitor tolerante único
// (ADR-003): canônico startDate/endDate flat, com fallback year/month
// (45 das 52 viagens não têm startDate).

import { getDates, getBookings } from './schema.js';

const DAY_MS = 86400000;
const CATEGORIES = ['flights', 'stays', 'experiences'];

const CENT_TOLERANCE = 0.011; // tolerância de centavos, com folga p/ float
const DATE_TOLERANCE_DAYS = 3;

function isoToUTC(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function addDays(iso, days) {
  const t = isoToUTC(iso);
  if (t === null) return null;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
}

// 'YYYY-MM-qualquer' → último dia do mês ('YYYY-MM-31'/'30'/'29'/'28').
function lastDayOfMonth(iso) {
  const t = isoToUTC(iso);
  if (t === null) return null;
  const d = new Date(t);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

// Janela de datas da viagem para casar transações. Buffer só PRÉ-viagem
// (passagem/hotel se compra antes; gasto depois do fim não é da viagem).
// Fim ausente: deriva de nts quando houver. No fallback year/month
// (source 'v1'), o dia '01' do start é SINTÉTICO — a viagem pode ter sido
// em qualquer semana do mês — então a janela fecha NO MÍNIMO no fim do
// mês, mesmo com nts (senão start+nts excluiria o histórico real de quem
// viajou depois do dia 1). Retorna null se a viagem não tem data alguma.
export function tripWindow(trip, { bufferDays = 30 } = {}) {
  const { start, end, nts, source } = getDates(trip);
  if (!start) return null;
  let windowEnd = end;
  if (!windowEnd && typeof nts === 'number') windowEnd = addDays(start, nts);
  if (source === 'v1') {
    const eom = lastDayOfMonth(start);
    if (!windowEnd || windowEnd < eom) windowEnd = eom;
  }
  if (!windowEnd) windowEnd = start;
  return { start: addDays(start, -bufferDays), end: windowEnd, tripStart: start, source };
}

// Filtra as transações que caem na janela da viagem.
// Retorna { window, matches } — window exposta para a UI da Etapa 3
// mostrar o critério usado (e o source: canonical | v1 | v2).
export function matchTxnsToTrip(txns, trip, { bufferDays = 30 } = {}) {
  const window = tripWindow(trip, { bufferDays });
  if (!window) return { window: null, matches: [] };
  const matches = (Array.isArray(txns) ? txns : []).filter(
    (t) => t && t.date && t.date >= window.start && t.date <= window.end,
  );
  return { window, matches };
}

function dayDiff(a, b) {
  const ta = isoToUTC(a);
  const tb = isoToUTC(b);
  if (ta === null || tb === null) return null;
  return Math.abs(ta - tb) / DAY_MS;
}

// Similaridade rudimentar para desempate: proporção de tokens (>2 letras,
// sem acentos) da descrição presentes no título do booking.
function titleSimilarity(description, titulo) {
  const norm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
  const tokens = norm(description);
  const target = new Set(norm(titulo));
  if (!tokens.length || !target.size) return 0;
  return tokens.filter((w) => target.has(w)).length / tokens.length;
}

// Casa UMA transação com um booking existente da viagem:
//   |valor da txn| == booking.valor (tolerância de centavos)
//   + data ±3 dias quando o booking tem `data` (sem `data`, casa só por
//     valor — candidato com data sempre vence um sem data)
//   + moedas compatíveis (txn.currency vs booking.moeda, default 'BRL' em
//     ambos — US$ 1.500 não é R$ 1.500; sem conversão, mismatch descarta).
// Crédito/estorno (amount >= 0) NÃO casa por padrão — um estorno
// reconciliaria o booking como pago e bloquearia o débito verdadeiro;
// para fatura de cartão onde gastos vêm positivos, use allowCredits:true.
// Bookings sem `valor` numérico não casam (não há o que conferir) e
// bookings que já têm `fitid` são pulados (reconciliados em import
// anterior). Empate: maior similaridade de título vence.
//
// IMPORTANTE (contrato com a Etapa 3): a função é por-txn e não vê as
// outras transações do lote — para não apontar duas txns ao MESMO
// booking, aplique incrementalmente (gravando fitid no booking entre
// chamadas) OU passe em `exclude` os paths já consumidos no lote, no
// formato 'category:index'.
// Retorna { bookingPath: { category, index } | null }.
export function matchTxnToBooking(txn, trip, { allowCredits = false, exclude } = {}) {
  if (!txn || typeof txn.amount !== 'number' || !txn.date) {
    return { bookingPath: null };
  }
  if (txn.amount >= 0 && !allowCredits) return { bookingPath: null };
  const txnCurrency = txn.currency || 'BRL';
  const bookings = getBookings(trip);
  const candidates = [];
  for (const category of CATEGORIES) {
    (bookings[category] || []).forEach((bk, index) => {
      if (!bk || typeof bk.valor !== 'number' || bk.fitid) return;
      if (exclude && exclude.has(`${category}:${index}`)) return;
      if ((bk.moeda || 'BRL') !== txnCurrency) return;
      if (Math.abs(Math.abs(txn.amount) - bk.valor) > CENT_TOLERANCE) return;
      const dated = Boolean(bk.data);
      if (dated) {
        const diff = dayDiff(txn.date, bk.data);
        if (diff === null || diff > DATE_TOLERANCE_DAYS) return;
      }
      candidates.push({
        category,
        index,
        dated,
        sim: titleSimilarity(txn.description, bk.titulo),
      });
    });
  }
  if (!candidates.length) return { bookingPath: null };
  candidates.sort((a, b) => Number(b.dated) - Number(a.dated) || b.sim - a.sim);
  const best = candidates[0];
  return { bookingPath: { category: best.category, index: best.index } };
}
