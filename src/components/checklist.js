// Checklist contextual — injeta itens com base em data/destination_rules.json
// para cada trip e renderiza com badge "auto-adicionado" + botão remover.
//
// Uso:
//   import { resolveRulesForTrip, injectChecklistItems, renderChecklist } from
//     '../components/checklist.js';
//
//   const rules = await loadRules();
//   const items = injectChecklistItems(trip.checklist || [], trip, rules);
//   renderChecklist(container, items, { onChange: (items) => save(...) });

let cachedRules = null;
let cachedRulesPromise = null;

export async function loadRules({ url = 'data/destination_rules.json' } = {}) {
  if (cachedRules) return cachedRules;
  if (cachedRulesPromise) return cachedRulesPromise;
  cachedRulesPromise = fetch(url, { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`Falha ao carregar regras: ${r.status}`);
      return r.json();
    })
    .then((data) => {
      cachedRules = data;
      cachedRulesPromise = null;
      return data;
    });
  return cachedRulesPromise;
}

// ── Resolução de regras aplicáveis ──────────────────────────────────────

export function resolveRulesForTrip(trip, rulesDoc) {
  if (!trip || !rulesDoc?.rules) return [];
  const cc = (trip.country_code || inferCountryCode(trip) || '').toUpperCase();
  const matched = [];
  for (const rule of rulesDoc.rules) {
    if (matches(rule.match, cc, trip)) matched.push(rule);
  }
  return matched;
}

function matches(rule, cc, trip) {
  if (!rule) return false;
  if (rule.country_code && rule.country_code.toUpperCase() === cc) {
    if (rule.is_domestic != null) {
      // Heurística: se rule pede domestic, exige flag pt-br
      const isDomestic = (trip.country || '').toLowerCase() === 'brasil' && cc === 'BR';
      return rule.is_domestic === isDomestic;
    }
    return true;
  }
  if (rule.region === 'schengen') {
    // Resolvido no parent (regra tem `applies_to`)
    return false; // tratamos no laço externo
  }
  return false;
}

function inferCountryCode(trip) {
  // Tenta extrair de flag emoji (regional indicators)
  const flag = trip.flag;
  if (typeof flag === 'string' && flag.length >= 4) {
    const cp1 = flag.codePointAt(0);
    const cp2 = flag.codePointAt(2);
    if (cp1 && cp2 && cp1 >= 0x1f1e6 && cp1 <= 0x1f1ff && cp2 >= 0x1f1e6 && cp2 <= 0x1f1ff) {
      return (
        String.fromCharCode(0x41 + (cp1 - 0x1f1e6)) +
        String.fromCharCode(0x41 + (cp2 - 0x1f1e6))
      );
    }
  }
  return '';
}

// Reescreve `resolveRulesForTrip` para também tratar Schengen corretamente.
const _baseResolve = resolveRulesForTrip;
export function resolveRulesForTripFull(trip, rulesDoc) {
  const direct = _baseResolve(trip, rulesDoc);
  const cc = (trip.country_code || inferCountryCode(trip) || '').toUpperCase();
  const schengen = rulesDoc?.rules?.find(
    (r) => r.match?.region === 'schengen' && r.applies_to?.includes(cc)
  );
  return schengen ? [...direct, schengen] : direct;
}

// ── Injeção de itens auto ───────────────────────────────────────────────

export function injectChecklistItems(existing, trip, rulesDoc) {
  const items = Array.isArray(existing) ? [...existing] : [];
  const rules = resolveRulesForTripFull(trip, rulesDoc);
  for (const rule of rules) {
    for (const text of rule.checklist_items || []) {
      const reason = `${rule.country_name || rule.match?.country_code || rule.match?.region}`;
      const alreadyAuto = items.some(
        (it) => it.auto_added && it.item === text && it.reason === reason
      );
      const alreadyManual = items.some((it) => !it.auto_added && it.item === text);
      if (alreadyAuto || alreadyManual) continue;
      items.push({
        item: text,
        done: false,
        auto_added: true,
        reason,
      });
    }
  }
  return items;
}

// ── UI ─────────────────────────────────────────────────────────────────

let cssInjected = false;
const CSS = `
.tev-checklist { display: flex; flex-direction: column; gap: 6px; }
.tev-cl-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px;
  border: 1px solid #e2e8f0; border-radius: 6px; font-size: 14px; }
.tev-cl-item.done { background: #f0fdf4; border-color: #bbf7d0; }
.tev-cl-item.done .tev-cl-text { text-decoration: line-through; color: #475569; }
.tev-cl-check { margin-top: 3px; }
.tev-cl-text { flex: 1; }
.tev-cl-badge { font-size: 10px; font-weight: 600; color: #92400e;
  background: #fef3c7; border: 1px solid #fde68a; border-radius: 999px;
  padding: 2px 8px; margin-left: 6px; text-transform: uppercase;
  letter-spacing: 0.04em; }
.tev-cl-reason { font-size: 11px; color: #64748b; margin-left: 6px; }
.tev-cl-remove { background: transparent; border: 0; color: #94a3b8; cursor: pointer;
  font-size: 16px; padding: 0 4px; line-height: 1; }
.tev-cl-remove:hover { color: #b91c1c; }
.tev-cl-add { display: flex; gap: 6px; margin-top: 8px; }
.tev-cl-add input { flex: 1; padding: 6px 8px; border: 1px solid #cbd5e1;
  border-radius: 6px; font: inherit; }
.tev-cl-add button { padding: 6px 12px; border: 0; border-radius: 6px;
  background: #0f172a; color: #fff; cursor: pointer; font: inherit; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'tev-checklist-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

export function renderChecklist(container, items, { onChange } = {}) {
  ensureCss();
  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'tev-checklist';
  let working = items.map((it) => ({ ...it }));

  function commit() {
    onChange?.(working);
    rerender();
  }

  function rerender() {
    list.innerHTML = '';
    working.forEach((it, idx) => {
      const wrap = document.createElement('div');
      wrap.className = `tev-cl-item${it.done ? ' done' : ''}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'tev-cl-check';
      cb.checked = !!it.done;
      cb.addEventListener('change', () => {
        working[idx].done = cb.checked;
        commit();
      });
      const txt = document.createElement('span');
      txt.className = 'tev-cl-text';
      txt.textContent = it.item;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tev-cl-remove';
      remove.title = 'Remover item';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        working.splice(idx, 1);
        commit();
      });
      wrap.append(cb, txt);
      if (it.auto_added) {
        const badge = document.createElement('span');
        badge.className = 'tev-cl-badge';
        badge.textContent = 'auto';
        wrap.append(badge);
        if (it.reason) {
          const r = document.createElement('span');
          r.className = 'tev-cl-reason';
          r.textContent = `(${it.reason})`;
          wrap.append(r);
        }
      }
      wrap.append(remove);
      list.appendChild(wrap);
    });
  }

  rerender();

  const addRow = document.createElement('div');
  addRow.className = 'tev-cl-add';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Adicionar item manual…';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Adicionar';
  function add() {
    const v = input.value.trim();
    if (!v) return;
    working.push({ item: v, done: false, auto_added: false });
    input.value = '';
    commit();
  }
  btn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  addRow.append(input, btn);

  container.append(list, addRow);
  return {
    get items() {
      return working;
    },
  };
}
