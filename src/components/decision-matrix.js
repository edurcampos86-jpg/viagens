// Matriz de decisão multicritério — F3.3.
//
// Resolve dilemas tipo "Dolomitas vs Ibiza vs Amsterdã": usuário define
// opções e critérios pesados, pontua cada opção em cada critério (0–5),
// e recebe um ranking ponderado.
//
// Persiste em `notes.decisions_pending` no trip (lista, identificada
// por uuid + question). Não dispara commit sozinho — o caller decide.
//
// API:
//   openDecisionMatrix({ trip, decision?, onSave });
//   computeScores(decision) → { results: [{option, score}], best }

let cssInjected = false;
const CSS = `
.dm-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.dm-modal { background: #fff; color: #0f172a; width: min(820px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35);
  font: 14px Inter, system-ui, sans-serif; }
.dm-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
.dm-body { padding: 16px 20px; display: grid; gap: 12px; }
.dm-question { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1;
  border-radius: 6px; font: inherit; }
.dm-table { border-collapse: collapse; width: 100%; }
.dm-table th, .dm-table td { border: 1px solid #e2e8f0; padding: 6px 8px;
  text-align: center; font-size: 13px; }
.dm-table th.option { background: #f8fafc; min-width: 120px; }
.dm-table td.criterion { text-align: left; font-weight: 600; background: #f8fafc; }
.dm-table input[type=range] { width: 100%; }
.dm-weight { width: 50px; padding: 2px 4px; border: 1px solid #cbd5e1;
  border-radius: 4px; font: inherit; text-align: center; }
.dm-add-row { display: flex; gap: 8px; }
.dm-add-row input { flex: 1; padding: 6px 8px; border: 1px solid #cbd5e1;
  border-radius: 6px; font: inherit; }
.dm-btn { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px;
  cursor: pointer; }
.dm-btn-primary { background: #0f172a; color: #fff; }
.dm-btn-secondary { background: #fff; color: #0f172a; border: 1px solid #cbd5e1; }
.dm-btn-danger { background: #fff; color: #b91c1c; border: 1px solid #fecaca; }
.dm-results { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
  padding: 12px; }
.dm-results h4 { margin: 0 0 6px; }
.dm-results .winner { font-size: 16px; font-weight: 700; color: #15803d; }
.dm-bar { height: 8px; background: #dcfce7; border-radius: 4px; overflow: hidden;
  margin-top: 4px; }
.dm-bar-fill { height: 100%; background: #16a34a; }
.dm-row-actions { display: flex; gap: 4px; justify-content: center; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'dm-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

const DEFAULT_CRITERIA = [
  { id: 'climate', label: 'Clima na data', weight: 3 },
  { id: 'cost', label: 'Custo médio', weight: 4 },
  { id: 'travel', label: 'Deslocamento', weight: 2 },
  { id: 'couple', label: 'Preferência casal', weight: 5 },
  { id: 'novelty', label: 'Novidade vs revisita', weight: 3 },
  { id: 'logistics', label: 'Dificuldade logística', weight: 2 },
];

function uuid() {
  return (crypto.randomUUID?.() ||
    'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
}

function newDecision() {
  return {
    id: uuid(),
    question: '',
    options: [
      { id: uuid(), name: 'Opção A' },
      { id: uuid(), name: 'Opção B' },
    ],
    criteria: DEFAULT_CRITERIA.map((c) => ({ ...c })),
    scores: {},          // { [optionId]: { [criterionId]: 0..5 } }
    notes: '',
    created_at: new Date().toISOString(),
  };
}

// ── Cálculo ─────────────────────────────────────────────────────────────

export function computeScores(decision) {
  const results = decision.options.map((opt) => {
    let total = 0;
    let denom = 0;
    for (const c of decision.criteria) {
      const s = Number(decision.scores?.[opt.id]?.[c.id] || 0);
      total += s * c.weight;
      denom += 5 * c.weight;
    }
    const score = denom ? total / denom : 0;
    return { option: opt, score, raw: total, max: denom };
  });
  results.sort((a, b) => b.score - a.score);
  return {
    results,
    best: results[0] || null,
  };
}

// ── UI ──────────────────────────────────────────────────────────────────

export function openDecisionMatrix({ trip, decision, onSave } = {}) {
  ensureCss();
  const draft = decision ? JSON.parse(JSON.stringify(decision)) : newDecision();

  const overlay = document.createElement('div');
  overlay.className = 'dm-overlay';
  const modal = document.createElement('div');
  modal.className = 'dm-modal';

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  function rerender() {
    const { results, best } = computeScores(draft);
    modal.innerHTML = `
      <div class="dm-header">
        <strong>🧭 Matriz de decisão${trip ? ` — ${trip.name || ''}` : ''}</strong>
        <button class="dm-btn dm-btn-secondary" id="dm-close" type="button" style="border:0;background:transparent;font-size:22px;cursor:pointer;color:#64748b;">×</button>
      </div>
      <div class="dm-body">
        <div>
          <label style="display:block;font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Pergunta / dilema</label>
          <input id="dm-q" class="dm-question" type="text" value="${escapeHtml(draft.question)}" placeholder="Ex: Dolomitas vs Ibiza vs Amsterdã?"/>
        </div>
        <div>
          ${renderTable(draft)}
        </div>
        <div class="dm-add-row">
          <input id="dm-add-opt" type="text" placeholder="Nova opção (ex: Marrocos)"/>
          <button class="dm-btn dm-btn-secondary" id="dm-add-opt-btn" type="button">+ Adicionar opção</button>
          <input id="dm-add-crit" type="text" placeholder="Novo critério"/>
          <button class="dm-btn dm-btn-secondary" id="dm-add-crit-btn" type="button">+ Adicionar critério</button>
        </div>
        ${best ? `
          <div class="dm-results">
            <h4>Resultado ponderado</h4>
            <div class="winner">🏆 ${escapeHtml(best.option.name)} — ${(best.score * 100).toFixed(0)}%</div>
            ${results.map((r) => `
              <div style="margin-top:6px;">
                <div style="display:flex;justify-content:space-between;font-size:12px;">
                  <span>${escapeHtml(r.option.name)}</span>
                  <span>${(r.score * 100).toFixed(0)}% (${r.raw}/${r.max})</span>
                </div>
                <div class="dm-bar"><div class="dm-bar-fill" style="width:${(r.score * 100).toFixed(0)}%"></div></div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="dm-btn dm-btn-secondary" id="dm-cancel" type="button">Cancelar</button>
          <button class="dm-btn dm-btn-primary" id="dm-save" type="button">Salvar no trip</button>
        </div>
      </div>
    `;
    bind();
  }

  function bind() {
    modal.querySelector('#dm-close').addEventListener('click', close);
    modal.querySelector('#dm-cancel').addEventListener('click', close);
    modal.querySelector('#dm-q').addEventListener('input', (e) => {
      draft.question = e.target.value;
    });
    modal.querySelector('#dm-save').addEventListener('click', () => {
      if (!draft.question.trim()) {
        alert('Defina a pergunta antes de salvar.');
        return;
      }
      onSave?.(draft);
      close();
    });
    modal.querySelector('#dm-add-opt-btn').addEventListener('click', () => {
      const name = modal.querySelector('#dm-add-opt').value.trim();
      if (!name) return;
      draft.options.push({ id: uuid(), name });
      rerender();
    });
    modal.querySelector('#dm-add-crit-btn').addEventListener('click', () => {
      const label = modal.querySelector('#dm-add-crit').value.trim();
      if (!label) return;
      draft.criteria.push({ id: uuid(), label, weight: 3 });
      rerender();
    });
    modal.querySelectorAll('[data-score]').forEach((input) => {
      input.addEventListener('input', () => {
        const optId = input.getAttribute('data-opt');
        const critId = input.getAttribute('data-crit');
        if (!draft.scores[optId]) draft.scores[optId] = {};
        draft.scores[optId][critId] = Number(input.value);
        rerender();
      });
    });
    modal.querySelectorAll('[data-weight]').forEach((input) => {
      input.addEventListener('input', () => {
        const critId = input.getAttribute('data-weight');
        const c = draft.criteria.find((x) => x.id === critId);
        if (c) c.weight = Number(input.value) || 1;
        rerender();
      });
    });
    modal.querySelectorAll('[data-remove-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-opt');
        if (draft.options.length <= 2) {
          alert('Mantenha ao menos 2 opções.');
          return;
        }
        draft.options = draft.options.filter((o) => o.id !== id);
        delete draft.scores[id];
        rerender();
      });
    });
    modal.querySelectorAll('[data-remove-crit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-remove-crit');
        if (draft.criteria.length <= 1) {
          alert('Mantenha ao menos 1 critério.');
          return;
        }
        draft.criteria = draft.criteria.filter((c) => c.id !== id);
        rerender();
      });
    });
  }

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  rerender();
  return { close };
}

function renderTable(draft) {
  return `
    <table class="dm-table">
      <thead>
        <tr>
          <th style="background:#f8fafc;">Critério</th>
          <th style="background:#f8fafc;">Peso</th>
          ${draft.options.map((o) => `
            <th class="option">${escapeHtml(o.name)}
              <div class="dm-row-actions">
                <button class="dm-btn dm-btn-danger" type="button" data-remove-opt="${o.id}" style="padding:2px 6px;font-size:11px;">×</button>
              </div>
            </th>
          `).join('')}
        </tr>
      </thead>
      <tbody>
        ${draft.criteria.map((c) => `
          <tr>
            <td class="criterion">
              ${escapeHtml(c.label)}
              <button class="dm-btn dm-btn-danger" type="button" data-remove-crit="${c.id}" style="padding:1px 4px;font-size:10px;margin-left:4px;">×</button>
            </td>
            <td>
              <input class="dm-weight" type="number" min="1" max="10" value="${c.weight}" data-weight="${c.id}"/>
            </td>
            ${draft.options.map((o) => {
              const v = draft.scores?.[o.id]?.[c.id] ?? 0;
              return `<td>
                <input type="range" min="0" max="5" step="1" value="${v}"
                  data-score data-opt="${o.id}" data-crit="${c.id}"/>
                <div style="font-size:11px;color:#64748b;">${v}/5</div>
              </td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ── Helper para persistir num trip ──────────────────────────────────────

export function attachDecisionToTrip(trip, decision) {
  const out = { ...trip };
  out.notes = { ...(out.notes || {}) };
  const list = Array.isArray(out.notes.decisions_pending)
    ? [...out.notes.decisions_pending]
    : [];
  const idx = list.findIndex((d) => d.id === decision.id);
  if (idx === -1) list.push(decision);
  else list[idx] = decision;
  out.notes.decisions_pending = list;
  out.updated_at = new Date().toISOString();
  return out;
}
