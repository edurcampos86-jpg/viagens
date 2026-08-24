// Radar de planejamento — módulo PURO (sem DOM, sem rede, sem Date.now()).
//
// Deriva os sinais que o card do modo Planejamento exibe a partir do
// canônico ADR-001 (bookings.{flights,stays,experiences}) mais os campos
// aditivos da Fase A (pendencias, reembolsavel, origem_dado,
// custo_pago/custo_estimado_restante).
//
// Princípios (mesmos de readiness.js / next-action.js / plan-budget.js):
//   - Nunca lê o DOM nem faz fetch; `today` é injetado como 'YYYY-MM-DD'.
//   - Nunca lança: entrada inválida resolve para um estado vazio coerente.
//   - NÃO produz score nem ranking — só badges, prazo e valores absolutos.
//   - data/trips.json continua sendo a fonte da verdade editada por humanos:
//     tudo aqui é computado na renderização, nada é escrito de volta.

// Status que ocupam o radar de planejamento. `em_planejamento` e `draft`
// entraram aqui na Fase A — antes o kanban só olhava planned/wishlist e as
// viagens nesses dois status ficavam invisíveis.
export const RADAR_STATUSES = new Set(['planned', 'em_planejamento', 'draft']);

// Janelas da contagem regressiva (dias até a data de início).
export const COUNTDOWN_VIOLETA_MIN = 60; // > 60 dias
export const COUNTDOWN_AMEIXA_MIN = 30; // 30–60 dias

const RE_VOO = /\bvoo?s?\b|\bpassage(m|ns)\b|\baére[oa]s?\b/i;
const RE_HOTEL = /\bhot[eé]l?(is|es)?\b|\bhospedage(m|ns)\b|\bairbnb\b|\bpousada\b|\bstay\b/i;

const CATS = ['flights', 'stays', 'experiences'];

function arr(x) {
  return Array.isArray(x) ? x : [];
}

function num(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : null;
}

// Mesma convenção de components/budget.js#computeActualFromBookings: a soma
// é em BRL — `valor` só entra quando a moeda é BRL (ausente = BRL), senão
// cai para `price_brl`. Mantém o mini-resumo do card coerente com o widget
// de orçamento da página #plan.
function amountBRL(b) {
  if (typeof b?.valor === 'number' && (b.moeda || 'BRL') === 'BRL') return b.valor;
  return typeof b?.price_brl === 'number' ? b.price_brl : 0;
}

function isPaid(b) {
  return b?.status === 'confirmado' || b?.confirmada === true;
}

// Todos os bookings da viagem, achatados, sem os cancelados.
export function allBookings(trip) {
  const bookings = trip?.bookings || {};
  const out = [];
  for (const cat of CATS) {
    for (const b of arr(bookings[cat])) {
      if (b && typeof b === 'object' && b.status !== 'cancelado') out.push({ ...b, _cat: cat });
    }
  }
  return out;
}

// ── Pendências ──────────────────────────────────────────────────────────

// Lista de pendências declaradas à mão em trip.pendencias (strings).
export function getPendencias(trip) {
  return arr(trip?.pendencias).filter((p) => typeof p === 'string' && p.trim() !== '');
}

// Um booking "resolvido" é o que já está fechado (confirmado) — pendente ou
// em_andamento ainda conta como buraco no radar.
function hasResolved(trip, cat) {
  return allBookings(trip).some((b) => b._cat === cat && isPaid(b));
}

// classifyPendencias(trip) → { semVoo, semHotel, itens, destaque }
//
// Uma reserva CONFIRMADA na categoria veta o badge — o radar nunca diz "sem
// voo" para uma viagem cujos voos já foram comprados, mesmo que
// trip.pendencias mencione voo. É o caso de floripa-2026: os voos LATAM
// estão fechados, só faltam datas/horários/valores; a pendência é real, mas
// "sem voo" seria falso. Booking pendente/em_andamento NÃO veta: continua
// sendo buraco.
//
// O texto de trip.pendencias entra na ESCOLHA do destaque — qual pendência o
// rótulo da contagem regressiva nomeia ("faltam 74 dias e sem voo"). Vence a
// que o humano escreveu primeiro; sem menção, voo tem prioridade sobre hotel.
export function classifyPendencias(trip) {
  const itens = getPendencias(trip);
  const texto = itens.join(' · ');
  const semVoo = !hasResolved(trip, 'flights');
  const semHotel = !hasResolved(trip, 'stays');

  const iVoo = semVoo ? texto.search(RE_VOO) : -1;
  const iHotel = semHotel ? texto.search(RE_HOTEL) : -1;
  let destaque = null;
  if (iVoo >= 0 && iHotel >= 0) destaque = iVoo <= iHotel ? 'voo' : 'hotel';
  else if (iVoo >= 0) destaque = 'voo';
  else if (iHotel >= 0) destaque = 'hotel';
  else if (semVoo) destaque = 'voo';
  else if (semHotel) destaque = 'hotel';

  return { itens, semVoo, semHotel, destaque };
}

// pendenciaBadges(trip) → [{ kind, label }] para "⚠ sem voo" / "⚠ sem hotel".
export function pendenciaBadges(trip) {
  const { semVoo, semHotel } = classifyPendencias(trip);
  const out = [];
  if (semVoo) out.push({ kind: 'voo', label: '⚠ sem voo' });
  if (semHotel) out.push({ kind: 'hotel', label: '⚠ sem hotel' });
  return out;
}

// ── Contagem regressiva ─────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUTC(iso) {
  if (typeof iso !== 'string' || !ISO_DATE.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

export function daysBetween(fromISO, toISO) {
  const a = toUTC(fromISO);
  const b = toUTC(toISO);
  if (a == null || b == null) return null;
  return Math.round((b - a) / 86400000);
}

// countdown(trip, today) → { days, tone, label } | null
//
// tone: 'violeta' (> 60 dias) · 'ameixa' (30–60) · 'vermelho' (< 30).
// O rótulo anexa a pendência mais crítica ("faltam 74 dias e sem voo").
// Sem startDate (ex.: viagem em rascunho) devolve null — nada a contar.
export function countdown(trip, today) {
  const days = daysBetween(today, trip?.startDate);
  if (days == null || days < 0) return null;

  const tone =
    days > COUNTDOWN_VIOLETA_MIN ? 'violeta' : days >= COUNTDOWN_AMEIXA_MIN ? 'ameixa' : 'vermelho';

  const { destaque } = classifyPendencias(trip);
  const falta = destaque === 'voo' ? 'sem voo' : destaque === 'hotel' ? 'sem hotel' : null;
  const base = `${days === 1 ? 'falta' : 'faltam'} ${days} ${days === 1 ? 'dia' : 'dias'}`;

  return { days, tone, label: falta ? `${base} e ${falta}` : base };
}

// ── Reembolso e proveniência ────────────────────────────────────────────

// Reservas explicitamente marcadas reembolsavel:false. Ausência do campo
// NÃO vira "não reembolsável" — só o `false` explícito acende o selo.
export function nonRefundable(trip) {
  return allBookings(trip).filter((b) => b.reembolsavel === false);
}

// Origens declaradas em bookings[].origem_dado ("fonte-AAAA-MM-DD"), únicas
// e ordenadas — vão para o rodapé/tooltip do detalhe, nunca para o card.
export function origensDado(trip) {
  const set = new Set();
  for (const b of allBookings(trip)) {
    if (typeof b.origem_dado === 'string' && b.origem_dado.trim()) set.add(b.origem_dado.trim());
  }
  return [...set].sort();
}

// ── Mini-resumo financeiro ──────────────────────────────────────────────

// tripCosts(trip) → { pago, restante, moeda, fromOverride }
//
// Computado a partir de bookings[].valor (decisão de modelagem: os campos
// custo_pago/custo_estimado_restante existem no schema como override manual,
// mas NÃO são persistidos pela app — o número vem sempre das reservas):
//   pago      = Σ valor dos bookings já confirmados;
//   restante  = Σ valor dos bookings ainda pendentes/em andamento.
// Cancelados ficam de fora dos dois. pago + restante equivale ao total de
// components/budget.js#computeActualFromBookings sobre os não-cancelados.
export function tripCosts(trip) {
  let pago = 0;
  let restante = 0;
  for (const b of allBookings(trip)) {
    if (isPaid(b)) pago += amountBRL(b);
    else restante += amountBRL(b);
  }

  const overridePago = num(trip?.custo_pago);
  const overrideRestante = num(trip?.custo_estimado_restante);

  return {
    pago: overridePago ?? pago,
    restante: overrideRestante ?? restante,
    moeda: trip?.budget?.currency || 'BRL',
    fromOverride: overridePago != null || overrideRestante != null,
  };
}

// ── Fase B · transições automáticas ─────────────────────────────────────
//
// As duas regras abaixo são de RENDERIZAÇÃO: nada aqui reescreve
// data/trips.json. O arquivo continua sendo a fonte da verdade editada por
// humanos (e pelo fluxo de docs/rotinas/sync-gmail.md); a app apenas
// interpreta o estado declarado. Ver docs/rotinas/sync-gmail.md §Transições
// automáticas.
//
// REGRA 1 — confirmada-parcial → confirmada.
//   Uma viagem em `em_planejamento` com `pendencias` vazio já é, na prática,
//   uma viagem confirmada: a ordem foi executada ao atingir o preço e não
//   sobrou buraco. Exibimos como "confirmada" sem mexer no status do JSON.
//
// REGRA 2 — viagem vencida vira histórico.
//   Viagem cuja data final já passou sai do radar de planejamento e aparece
//   no acervo de memórias com o selo "aguardando registro de memórias" —
//   fechamento de posição vira histórico. O status no JSON segue `planned`
//   até alguém escrever a memória e promover para `done`.

// effectiveStatus(trip) → status exibido na UI (nunca gravado). Sem `today`
// de propósito: a regra 1 não tem componente temporal, só olha as pendências.
export function effectiveStatus(trip) {
  const status = trip?.status;
  if (status === 'em_planejamento' && getPendencias(trip).length === 0) return 'planned';
  return status;
}

// True quando a viagem já terminou mas ainda não virou memória (`done`).
// Sem endDate a viagem nunca vence sozinha — é preciso decisão humana.
export function isPastPlan(trip, today) {
  if (!RADAR_STATUSES.has(trip?.status)) return false;
  const d = daysBetween(today, trip?.endDate);
  return d != null && d < 0;
}

// Viagens que o acervo de memórias deve exibir com o selo de pendência.
export function awaitsMemoryRecord(trip, today) {
  return isPastPlan(trip, today) && !String(trip?.memory || '').trim();
}
