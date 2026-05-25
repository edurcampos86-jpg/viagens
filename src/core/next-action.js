// B3 — "Próxima ação" da plan-page (Sprint SP-Junho).
//
// Árvore de decisão PURA: recebe os sinais já computados pelo legado
// (assets/app.js calcula `d`, voos confirmados, stays, etc.) e devolve
// { label, severity, cta }. Sem DOM, sem `Date.now()`, sem localStorage —
// determinística e testável (recebe `d` em vez de calcular a partir de hoje).
//
// Ordem das janelas (T-D dias até embarcar):
//   wishlist/sem data → >90 → >60 sem voo → >30 sem stay → >14 → >3 →
//   >=0 (embarque) → pós-viagem sem memória → memória registrada.

export function decideNextAction({
  status,
  d,
  confirmedFlights = 0,
  hasStays = false,
  hasMemory = false,
  pendingChecks = 0,
} = {}) {
  let label;
  let severity = 'info';
  let cta = null;

  if (status === 'wishlist' || d == null) {
    label = '📌 Definir datas e destino';
    severity = 'warn';
    cta = { anchor: 'planHero', kind: 'edit-dates' };
  } else if (d > 90) {
    label = '📅 Pesquisar voos e hospedagem';
    cta = { anchor: 'planReservations' };
  } else if (d > 60 && confirmedFlights === 0) {
    label = '✈ Comprar voos (preços tendem a subir)';
    severity = 'warn';
    cta = { anchor: 'planReservations' };
  } else if (d > 30 && !hasStays) {
    label = '🏨 Reservar hospedagem';
    severity = 'warn';
    cta = { anchor: 'planReservations' };
  } else if (d > 14) {
    label = '📋 Rodar Despachante Digital + revisar checklist';
    cta = { anchor: 'planChecklist' };
  } else if (d > 3) {
    label = '🧳 Preparar bagagem';
    cta = { anchor: 'planPacking', tab: 'packing' };
  } else if (d >= 0) {
    label = '✈ Check-in online + impressão de docs';
    severity = 'urgent';
    cta = { anchor: 'planChecklist' };
  } else if (!hasMemory) {
    label = '📝 Registrar lembranças da viagem';
    cta = { anchor: 'planPlanning' };
  } else {
    label = '✓ Memória registrada';
    severity = 'done';
  }

  if (pendingChecks > 0 && severity !== 'done') {
    label += ` (${pendingChecks} ${pendingChecks === 1 ? 'item pendente' : 'itens pendentes'})`;
  }

  return { label, severity, cta };
}
