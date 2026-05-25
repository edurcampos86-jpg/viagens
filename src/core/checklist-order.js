// F5 — helpers puros de ordenação e prazos do checklist da plan-page.
// Sem DOM/localStorage; o legado (assets/app.js) lê/grava o estado e só
// usa estas funções para a lógica. Testáveis isoladamente.

// Reordena `items` segundo `orderIds` (array de ids salvos pelo usuário).
// Itens cujo id está em orderIds vêm primeiro, na ordem salva; os demais
// mantêm a ordem original (estável). Não muta os argumentos.
export function applyChecklistOrder(items, orderIds) {
  if (!Array.isArray(items)) return [];
  if (!Array.isArray(orderIds) || !orderIds.length) return items.slice();
  const pos = new Map(orderIds.map((id, i) => [id, i]));
  const known = [];
  const rest = [];
  for (const it of items) {
    if (pos.has(it.id)) known.push(it);
    else rest.push(it);
  }
  known.sort((a, b) => pos.get(a.id) - pos.get(b.id));
  return [...known, ...rest];
}

// Move `fromId` para a posição de `toId` (insere ANTES de toId) numa lista
// de ids. `toId === null` move para o fim. Retorna novo array (não muta).
export function moveItem(ids, fromId, toId) {
  const arr = Array.isArray(ids) ? ids.slice() : [];
  const from = arr.indexOf(fromId);
  if (from === -1 || fromId === toId) return arr;
  arr.splice(from, 1);
  if (toId == null) {
    arr.push(fromId);
    return arr;
  }
  const to = arr.indexOf(toId);
  if (to === -1) arr.push(fromId);
  else arr.splice(to, 0, fromId);
  return arr;
}

// Item vencido: tem prazo, não está marcado, e o prazo (YYYY-MM-DD) é
// anterior a hoje. Vencer "hoje" não conta como overdue (ainda dá tempo).
export function isItemOverdue(due, checked, today = new Date()) {
  if (!due || checked) return false;
  const d = String(due).slice(0, 10);
  const t = today instanceof Date ? today.toISOString().slice(0, 10) : String(today).slice(0, 10);
  return d < t;
}
