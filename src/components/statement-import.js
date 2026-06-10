// Importador de extrato bancário (OFX/CSV) — UI da Etapa 3 do port do extrato.
//
// Fluxo: upload → parser (statement-parser) → persistência LOCAL no
// IndexedDB (statement-store; o extrato bruto e as txns JAMAIS vão ao
// trips.json) → seleção de viagem por janela de datas (statement-match) →
// revisão humana (incluir/excluir, ajuste manual que vira origin:'ajustado',
// match sugerido a booking, criação EXPLÍCITA de lançamento — nunca
// automática) → "Aplicar à viagem": clone da viagem, valor/moeda +
// source:'extrato' + fitid nos bookings casados, budget.actual recalculado
// via mergeActual (budget.js) e persistência via onSave — main.js injeta o
// saveTrip dele, herdando offline/sync-queue/download de rascunho.
//
// Reimport do mesmo arquivo (hash igual): saveStatement preserva as txns
// existentes — inclusões e ajustes manuais (origin:'ajustado') sobrevivem.

import { parseOFX, parseCSV } from '../core/statement-parser.js';
import { matchTxnsToTrip, matchTxnToBooking } from '../core/statement-match.js';
import { saveStatement, listTxns, updateTxn } from '../core/statement-store.js';
import { mergeActual } from './budget.js';
import { getTripsFile } from '../core/trips-api.js';
import * as settings from '../core/settings.js';

let cssInjected = false;
const CSS = `
.si-overlay { position: fixed; inset: 0; z-index: 9999; padding: 16px;
  background: color-mix(in srgb, var(--vc-ink) 55%, transparent);
  display: flex; align-items: center; justify-content: center; }
.si-modal { background: var(--vc-paper); color: var(--vc-ink);
  width: min(960px, 100%); max-height: 92vh; overflow: auto;
  border-radius: 12px; font: 14px var(--vc-font-ui);
  box-shadow: 0 25px 50px -12px color-mix(in srgb, var(--vc-ink) 40%, transparent); }
.si-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--vc-paper-3);
  position: sticky; top: 0; background: var(--vc-paper); z-index: 1; }
.si-close { background: transparent; border: 0; font-size: 22px; cursor: pointer;
  color: var(--vc-ink-soft); }
.si-body { padding: 16px 20px; display: grid; gap: 14px; }
.si-drop { border: 2px dashed var(--vc-ink-faint); border-radius: 10px;
  padding: 24px; text-align: center; color: var(--vc-ink-soft); cursor: pointer;
  background: var(--vc-paper-2); }
.si-drop.si-over { border-color: var(--vc-brand-1); background: var(--vc-paper-3); }
.si-status { border-radius: 8px; padding: 8px 12px; font-size: 13px;
  background: var(--vc-paper-2); border: 1px solid var(--vc-paper-3); }
.si-status.si-ok { color: var(--vc-material); }
.si-status.si-err { color: var(--vc-saude); }
.si-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
.si-field { display: grid; gap: 4px; font-size: 12px; color: var(--vc-ink-soft); }
.si-field select, .si-field input { font: inherit; color: var(--vc-ink);
  background: var(--vc-paper); border: 1px solid var(--vc-ink-faint);
  border-radius: 6px; padding: 6px 8px; }
.si-window { font-size: 12px; color: var(--vc-ink-soft); }
.si-panel { background: var(--vc-paper-2); border: 1px solid var(--vc-paper-3);
  border-radius: 10px; padding: 10px 14px; display: flex; gap: 24px;
  flex-wrap: wrap; align-items: baseline; }
.si-panel strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.si-panel .si-over-budget { color: var(--vc-saude); }
.si-panel .si-under-budget { color: var(--vc-material); }
.si-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.si-table th { text-align: left; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; color: var(--vc-ink-soft); padding: 6px 8px;
  border-bottom: 1px solid var(--vc-ink-faint); }
.si-table td { padding: 6px 8px; border-bottom: 1px solid var(--vc-paper-3);
  vertical-align: middle; }
.si-table tr.si-excluded td { opacity: .45; }
.si-table input[type="text"], .si-table input[type="number"] { font: inherit;
  font-size: 13px; color: var(--vc-ink); background: var(--vc-paper);
  border: 1px solid var(--vc-paper-3); border-radius: 6px; padding: 4px 6px; }
.si-table input[type="text"] { width: 100%; min-width: 160px; }
.si-table input[type="number"] { width: 110px; text-align: right;
  font-variant-numeric: tabular-nums; }
.si-badge { display: inline-block; font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.si-badge-match { background: var(--vc-material); color: var(--vc-paper); }
.si-badge-applied { background: var(--vc-espiritual); color: var(--vc-paper); }
.si-badge-adjusted { background: var(--vc-trabalho); color: var(--vc-paper); }
.si-create { font: inherit; font-size: 12px; color: var(--vc-ink);
  background: var(--vc-paper); border: 1px solid var(--vc-ink-faint);
  border-radius: 6px; padding: 3px 6px; }
.si-actions { display: flex; justify-content: flex-end; gap: 8px; }
.si-apply { font: inherit; font-weight: 700; padding: 10px 18px; border: 0;
  border-radius: 8px; cursor: pointer; background: var(--vc-brand-1);
  color: var(--vc-paper); }
.si-apply[disabled] { opacity: .5; cursor: not-allowed; }
.si-note { font-size: 12px; color: var(--vc-ink-soft); }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'si-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

const CATEGORY_LABELS = { flights: '✈ Voos', stays: '🏨 Hospedagem', experiences: '🎟 Experiências' };

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function fmtMoney(n, cur = 'BRL') {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${cur} ${Number(n).toFixed(2)}`;
  }
}

// Ordena por data (e id para desempate estável) — mesma ordem na revisão e
// na aplicação, para o exclude incremental produzir os MESMOS matches.
function sortByDate(txns) {
  return [...txns].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1,
  );
}

// Mesmo padrão do inbox: com PAT desbloqueado lê via API (estado mais
// recente); sem PAT, o trips.json público (read-only).
async function loadAllTrips() {
  if (settings.isUnlocked()) {
    const { content } = await getTripsFile({ token: settings.getToken() });
    return content.trips || [];
  }
  const res = await fetch('data/trips.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha lendo trips.json');
  const data = await res.json();
  return data.trips || [];
}

function detectFormat(name, text) {
  if (/\.ofx$/i.test(name || '')) return 'ofx';
  if (/\.csv$/i.test(name || '')) return 'csv';
  return /<OFX>|OFXHEADER/i.test(text) ? 'ofx' : 'csv';
}

// Sugestões de match por booking para a lista em revisão. O exclude
// incremental impede duas txns no mesmo booking — espelha exatamente o que
// a aplicação fará.
function computeSuggestions(rows, trip) {
  const suggestions = new Map();
  if (!trip) return suggestions;
  const exclude = new Set();
  for (const t of rows) {
    if (!t.included || t.appliedTo) continue;
    const { bookingPath } = matchTxnToBooking(t, trip, { exclude });
    if (bookingPath) {
      suggestions.set(t.id, bookingPath);
      exclude.add(`${bookingPath.category}:${bookingPath.index}`);
    }
  }
  return suggestions;
}

export function openStatementImport({ onSave } = {}) {
  ensureCss();

  const state = {
    hash: null,
    fileName: '',
    txns: [],
    trips: [],
    tripsLoaded: false,
    tripId: null,
    bufferDays: 30,
    createChoice: new Map(), // txn.id → categoria escolhida explicitamente
    applying: false,
  };

  const overlay = document.createElement('div');
  overlay.className = 'si-overlay';
  const modal = document.createElement('div');
  modal.className = 'si-modal';
  modal.innerHTML = `
    <div class="si-header">
      <strong>🧾 Importar extrato — reconciliação de custos</strong>
      <button type="button" class="si-close" aria-label="Fechar">×</button>
    </div>
    <div class="si-body">
      <div class="si-drop" tabindex="0">
        <strong>Arraste um extrato OFX ou CSV aqui</strong><br/>
        ou clique para escolher o arquivo. Tudo fica só neste navegador
        (IndexedDB) — nada do extrato bruto vai ao trips.json.
        <input type="file" accept=".ofx,.csv,.txt" hidden />
      </div>
      <div class="si-status" hidden></div>
      <div class="si-main" hidden></div>
    </div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  modal.querySelector('.si-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const statusBox = modal.querySelector('.si-status');
  const main = modal.querySelector('.si-main');

  function setStatus(message, kind) {
    statusBox.hidden = false;
    statusBox.textContent = message;
    statusBox.className = `si-status${kind === 'ok' ? ' si-ok' : kind === 'err' ? ' si-err' : ''}`;
  }

  // ── Upload ──────────────────────────────────────────────────────────
  const drop = modal.querySelector('.si-drop');
  const fileInput = drop.querySelector('input[type="file"]');
  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('si-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('si-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('si-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
    fileInput.value = '';
  });

  async function handleFile(file) {
    try {
      const raw = await file.text();
      const format = detectFormat(file.name, raw);
      const parsed = format === 'ofx' ? parseOFX(raw) : parseCSV(raw);
      if (!parsed.length) {
        throw new Error('nenhuma transação reconhecida no arquivo (formato não suportado?).');
      }
      const { hash, added, skipped } = await saveStatement(
        { name: file.name, format, raw },
        parsed,
      );
      state.hash = hash;
      state.fileName = file.name;
      state.createChoice = new Map();
      state.txns = await listTxns(hash);
      if (!state.tripsLoaded) {
        state.trips = await loadAllTrips();
        state.tripsLoaded = true;
      }
      state.tripId = null; // re-elege a viagem de maior overlap p/ este arquivo
      setStatus(
        `${state.fileName}: ${state.txns.length} transações — ${added} novas, ` +
          `${skipped} já conhecidas (inclusões e ajustes manuais preservados).`,
        'ok',
      );
      render();
    } catch (e) {
      setStatus(`Falha ao importar: ${e.message}`, 'err');
    }
  }

  // ── Estado derivado ─────────────────────────────────────────────────
  function rankedTrips() {
    return state.trips
      .map((trip) => ({
        trip,
        count: matchTxnsToTrip(state.txns, trip, { bufferDays: state.bufferDays }).matches.length,
      }))
      .sort((a, b) => b.count - a.count || String(a.trip.name).localeCompare(String(b.trip.name)));
  }

  function currentTrip() {
    return state.trips.find((t) => t.id === state.tripId) || null;
  }

  // ── Render ──────────────────────────────────────────────────────────
  function render() {
    const ranked = rankedTrips();
    if (!state.tripId && ranked.length) state.tripId = ranked[0].trip.id;
    const trip = currentTrip();
    const { window: win, matches } = trip
      ? matchTxnsToTrip(state.txns, trip, { bufferDays: state.bufferDays })
      : { window: null, matches: [] };
    const rows = sortByDate(matches);
    const suggestions = computeSuggestions(rows, trip);

    // Painel vivo: custo realizado (só incluídas; débito soma, estorno
    // abate) por moeda, e desvio vs budget.planned quando existir.
    const totals = {};
    rows
      .filter((t) => t.included)
      .forEach((t) => {
        const cur = t.currency || 'BRL';
        totals[cur] = (totals[cur] || 0) - t.amount;
      });
    const planned = trip?.budget?.planned || {};
    const plannedTotal = Object.values(planned).reduce(
      (s, v) => s + (typeof v === 'number' ? v : 0),
      0,
    );
    const realizedBRL = totals.BRL || 0;
    const deviation = realizedBRL - plannedTotal;
    const totalsHtml = Object.entries(totals)
      .map(([cur, v]) => `<strong>${esc(fmtMoney(v, cur))}</strong>`)
      .join(' + ');

    main.hidden = false;
    main.innerHTML = `
      <div class="si-row">
        <label class="si-field">
          <span>Viagem (ordenada por overlap de datas)</span>
          <select id="si-trip">
            ${ranked
              .map(
                ({ trip: t, count }) =>
                  `<option value="${esc(t.id)}" ${t.id === state.tripId ? 'selected' : ''}>` +
                  `${esc(t.name || t.id)} — ${count} txn${count === 1 ? '' : 's'}</option>`,
              )
              .join('')}
          </select>
        </label>
        <label class="si-field">
          <span>Buffer pré-viagem (dias)</span>
          <input id="si-buffer" type="number" min="0" step="1" value="${state.bufferDays}" />
        </label>
        ${
          win
            ? `<span class="si-window">janela: ${esc(win.start)} → ${esc(win.end)} ` +
              `(datas: ${esc(win.source)}) · ${rows.length} de ${state.txns.length} txns do extrato</span>`
            : '<span class="si-window">viagem sem datas — nenhuma transação casável.</span>'
        }
      </div>
      <div class="si-panel">
        <span>Custo realizado (incluídas): ${totalsHtml || '<strong>—</strong>'}</span>
        ${
          plannedTotal > 0
            ? `<span>Planejado: <strong>${esc(fmtMoney(plannedTotal, 'BRL'))}</strong></span>` +
              `<span class="${deviation > 0 ? 'si-over-budget' : 'si-under-budget'}">` +
              `Desvio: <strong>${deviation > 0 ? '+' : ''}${esc(fmtMoney(deviation, 'BRL'))}</strong></span>`
            : '<span class="si-note">sem budget.planned nesta viagem.</span>'
        }
      </div>
      ${
        rows.length
          ? `<table class="si-table">
        <thead><tr>
          <th></th><th>Data</th><th>Descrição</th><th>Valor</th><th>Moeda</th><th>Reconciliação</th>
        </tr></thead>
        <tbody>
          ${rows.map((t) => rowHtml(t, suggestions.get(t.id), trip)).join('')}
        </tbody>
      </table>`
          : '<p class="si-note">Nenhuma transação na janela desta viagem — ajuste o buffer ou escolha outra viagem.</p>'
      }
      <div class="si-actions">
        <span class="si-note">Aplicar preenche valor/moeda + source:'extrato' + fitid nos bookings
          casados e cria SÓ os lançamentos pedidos acima. O extrato bruto continua local.</span>
        <button type="button" id="si-apply" class="si-apply" ${state.applying || !trip ? 'disabled' : ''}>
          ${state.applying ? 'Aplicando…' : `Aplicar à viagem`}
        </button>
      </div>
    `;

    main.querySelector('#si-trip')?.addEventListener('change', (e) => {
      state.tripId = e.target.value;
      render();
    });
    main.querySelector('#si-buffer')?.addEventListener('change', (e) => {
      const v = Number(e.target.value);
      state.bufferDays = Number.isFinite(v) && v >= 0 ? Math.floor(v) : 30;
      render();
    });
    main.querySelector('#si-apply')?.addEventListener('click', applyToTrip);

    main.querySelectorAll('[data-include]').forEach((el) =>
      el.addEventListener('change', async () => {
        await patchTxn(el.getAttribute('data-include'), { included: el.checked });
      }),
    );
    main.querySelectorAll('[data-desc]').forEach((el) =>
      el.addEventListener('change', async () => {
        const value = el.value.trim();
        if (value) await patchTxn(el.getAttribute('data-desc'), { description: value });
        else render();
      }),
    );
    main.querySelectorAll('[data-amount]').forEach((el) =>
      el.addEventListener('change', async () => {
        const v = Number(el.value);
        if (Number.isFinite(v) && v !== 0) await patchTxn(el.getAttribute('data-amount'), { amount: v });
        else render();
      }),
    );
    main.querySelectorAll('[data-create]').forEach((el) =>
      el.addEventListener('change', () => {
        const id = el.getAttribute('data-create');
        if (el.value) state.createChoice.set(id, el.value);
        else state.createChoice.delete(id);
        render();
      }),
    );
  }

  function rowHtml(t, suggestion, trip) {
    const frozen = Boolean(t.appliedTo);
    return `<tr class="${t.included ? '' : 'si-excluded'}">
      <td><input type="checkbox" data-include="${esc(t.id)}" ${t.included ? 'checked' : ''}
        ${frozen ? 'disabled' : ''} title="Incluir/excluir do custo realizado" /></td>
      <td class="si-note">${esc(t.date)}</td>
      <td>
        <input type="text" data-desc="${esc(t.id)}" value="${esc(t.description)}" ${frozen ? 'disabled' : ''} />
        ${t.origin === 'ajustado' ? '<span class="si-badge si-badge-adjusted" title="Ajuste manual — preservado em reimports do mesmo arquivo">ajustado</span>' : ''}
      </td>
      <td><input type="number" step="0.01" data-amount="${esc(t.id)}" value="${esc(t.amount)}" ${frozen ? 'disabled' : ''} /></td>
      <td class="si-note">${esc(t.currency || 'BRL')}</td>
      <td>${reconcileCell(t, suggestion, trip)}</td>
    </tr>`;
  }

  function reconcileCell(t, suggestion, trip) {
    if (t.appliedTo) {
      return `<span class="si-badge si-badge-applied" title="Já aplicada em ${esc(t.appliedTo.tripId)}">✓ aplicada</span>`;
    }
    if (!t.included) return '<span class="si-note">excluída</span>';
    if (suggestion) {
      const bk = trip?.bookings?.[suggestion.category]?.[suggestion.index] || {};
      return (
        `<span class="si-badge si-badge-match" title="Ao aplicar, preenche valor/moeda deste booking">` +
        `≈ ${esc(CATEGORY_LABELS[suggestion.category])} · ${esc(bk.titulo || '(sem título)')}</span>`
      );
    }
    const chosen = state.createChoice.get(t.id) || '';
    return `<select class="si-create" data-create="${esc(t.id)}"
      title="Sem match com booking existente. Criar lançamento novo é decisão sua — nunca automático.">
      <option value="">sem match — criar lançamento…</option>
      ${Object.entries(CATEGORY_LABELS)
        .map(([k, l]) => `<option value="${k}" ${chosen === k ? 'selected' : ''}>criar em ${l}</option>`)
        .join('')}
    </select>`;
  }

  async function patchTxn(id, patch) {
    try {
      const next = await updateTxn(id, patch);
      state.txns = state.txns.map((t) => (t.id === next.id ? next : t));
    } catch (e) {
      setStatus(`Falha ao atualizar transação: ${e.message}`, 'err');
    }
    render();
  }

  // ── Aplicação à viagem ──────────────────────────────────────────────
  async function applyToTrip() {
    const trip = currentTrip();
    if (!trip || state.applying) return;
    if (typeof onSave !== 'function') {
      setStatus('Sem handler de persistência (onSave) — abra pelo badge 🧾 do site.', 'err');
      return;
    }
    state.applying = true;
    render();
    try {
      const { matches } = matchTxnsToTrip(state.txns, trip, { bufferDays: state.bufferDays });
      const pending = sortByDate(matches).filter((t) => t.included && !t.appliedTo);

      // Clone da viagem (padrão mergeEventIntoTrip do inbox) — nada muta o
      // objeto original até o onSave concluir.
      const next = JSON.parse(JSON.stringify(trip));
      next.bookings ||= { flights: [], stays: [], experiences: [] };
      next.bookings.flights ||= [];
      next.bookings.stays ||= [];
      next.bookings.experiences ||= [];

      const exclude = new Set();
      const applied = [];
      for (const t of pending) {
        const { bookingPath } = matchTxnToBooking(t, next, { exclude });
        if (bookingPath) {
          const bk = next.bookings[bookingPath.category][bookingPath.index];
          bk.valor = Math.abs(t.amount);
          bk.moeda = t.currency || 'BRL';
          bk.source = 'extrato';
          bk.fitid = t.fitid;
          exclude.add(`${bookingPath.category}:${bookingPath.index}`);
          applied.push({ txn: t, category: bookingPath.category, index: bookingPath.index });
          continue;
        }
        const category = state.createChoice.get(t.id);
        if (!category || !CATEGORY_LABELS[category]) continue; // criação só explícita
        const arr = next.bookings[category];
        arr.push({
          titulo: t.description,
          data: t.date,
          valor: Math.abs(t.amount),
          moeda: t.currency || 'BRL',
          source: 'extrato',
          fitid: t.fitid,
        });
        applied.push({ txn: t, category, index: arr.length - 1 });
      }

      if (!applied.length) {
        setStatus('Nada a aplicar: nenhuma txn incluída casa com booking nem tem criação pedida.', 'err');
        return;
      }

      // budget.actual com a mesma lógica do editor (mergeActual importa
      // computeActualFromBookings de budget.js — não duplicamos a soma).
      next.budget = {
        planned: {},
        currency: 'BRL',
        ...(next.budget || {}),
        actual: mergeActual(next),
      };
      next.updated_at = new Date().toISOString();

      const result = await onSave(next);

      for (const a of applied) {
        const updated = await updateTxn(a.txn.id, {
          appliedTo: { tripId: next.id, category: a.category, index: a.index },
        });
        state.txns = state.txns.map((t) => (t.id === updated.id ? updated : t));
      }
      for (const a of applied) state.createChoice.delete(a.txn.id);

      const where = result?.committed
        ? 'commit criado no trips.json.'
        : result?.queued
          ? 'offline — enfileirado na sync-queue.'
          : 'PAT bloqueado — rascunho .json baixado para aplicar manualmente.';
      setStatus(`${applied.length} lançamento(s) aplicado(s) em "${trip.name || trip.id}" — ${where}`, 'ok');
    } catch (e) {
      setStatus(`Falha ao aplicar: ${e.message}`, 'err');
    } finally {
      state.applying = false;
      render();
    }
  }
}
