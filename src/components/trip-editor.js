// Modal de CRUD de viagem (Fase 1 — F1.1).
//
// Uso:
//   import { openTripEditor } from '../components/trip-editor.js';
//   openTripEditor({
//     mode: 'create' | 'edit' | 'duplicate',
//     trip,                       // obrigatório para edit/duplicate
//     onSave: async (trip) => {}, // chamado após validação OK
//     onDelete: async (id) => {}, // opcional, exibe botão excluir
//   });
//
// O modal é completamente autocontido: cria/destrói seu próprio DOM e CSS.
// Validação mínima local; F1.3 substitui por schema.js completo.

import {
  flagFromCountryCode,
  nominatimSearch,
  tripIdFrom,
  isValidLat,
  isValidLon,
  assessGeoTrust,
  PREFERRED_CC,
} from '../core/geo.js';
import { loadRules, injectChecklistItems, renderChecklist } from './checklist.js';
import { deriveDatesFromBookings, deriveLegacyDateFields } from '../core/dates.js';
import { getDates } from '../core/schema.js';
import { renderBudget, mergeActual } from './budget.js';
import { renderBenchmarkBanner } from './benchmark.js';
import { renderWizardCard } from './wizard.js';

let stylesInjected = false;

const STYLES = `
.tev-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.tev-modal { background: #fff; color: #0f172a; width: min(640px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px; box-shadow:
  0 25px 50px -12px rgba(0,0,0,0.35); font-family: Inter, system-ui, sans-serif; }
.tev-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
.tev-header h2 { margin: 0; font-size: 18px; font-weight: 700; }
.tev-close { background: transparent; border: 0; font-size: 22px; cursor: pointer;
  color: #64748b; line-height: 1; padding: 4px 8px; }
.tev-body { padding: 16px 20px; display: grid; gap: 12px; }
.tev-row { display: grid; gap: 4px; }
.tev-row.row-2 { grid-template-columns: 1fr 1fr; gap: 12px; }
.tev-row label { font-size: 12px; font-weight: 600; color: #475569;
  text-transform: uppercase; letter-spacing: 0.04em; }
.tev-row input, .tev-row select, .tev-row textarea { font: inherit;
  padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: #fff; color: #0f172a; }
.tev-row textarea { min-height: 72px; resize: vertical; }
.tev-row.disabled input { background: #f1f5f9; color: #475569; }
.tev-suggest { position: relative; }
.tev-suggest-list { position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  background: #fff; border: 1px solid #cbd5e1; border-top: 0; max-height: 220px;
  overflow: auto; border-radius: 0 0 6px 6px; }
.tev-suggest-item { padding: 8px 10px; cursor: pointer; font-size: 14px;
  border-top: 1px solid #f1f5f9; }
.tev-suggest-item:hover, .tev-suggest-item.active { background: #f1f5f9; }
.tev-suggest-empty { padding: 8px 10px; font-size: 13px; color: #94a3b8; }
.tev-status-line { display: flex; align-items: center; gap: 8px; font-size: 12px;
  color: #64748b; }
.tev-errors { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
  padding: 8px 12px; border-radius: 6px; font-size: 13px; }
.tev-errors ul { margin: 4px 0 0; padding-left: 18px; }
.tev-footer { display: flex; gap: 8px; justify-content: space-between;
  padding: 12px 20px 16px; border-top: 1px solid #e2e8f0; }
.tev-btn { font: inherit; padding: 8px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; }
.tev-btn-primary { background: #0f172a; color: #fff; }
.tev-btn-primary:hover { background: #1e293b; }
.tev-btn-secondary { background: #fff; color: #0f172a; border-color: #cbd5e1; }
.tev-btn-danger { background: #fff; color: #b91c1c; border-color: #fecaca; }
.tev-btn-danger:hover { background: #fef2f2; }
.tev-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.tev-meta { font-size: 12px; color: #64748b; padding: 0 20px 12px; }
`;

function injectStyles() {
  if (stylesInjected) return;
  const style = document.createElement('style');
  style.id = 'tev-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
  stylesInjected = true;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function validate(trip) {
  const errors = [];
  if (!trip.name?.trim()) errors.push('Nome da viagem é obrigatório.');
  if (!trip.status) errors.push('Status é obrigatório.');
  if (typeof trip.lat !== 'number' || typeof trip.lon !== 'number') {
    errors.push('Selecione um destino na busca ou informe país/coordenadas manualmente.');
  }
  if (typeof trip.lat === 'number' && (trip.lat < -90 || trip.lat > 90)) {
    errors.push('Latitude deve estar entre -90 e 90.');
  }
  if (typeof trip.lon === 'number' && (trip.lon < -180 || trip.lon > 180)) {
    errors.push('Longitude deve estar entre -180 e 180.');
  }
  if (trip._geoNeedsConfirm) {
    errors.push('Confirme o destino sinalizado (⚠) ou ajuste país/coordenadas manualmente.');
  }
  if (trip.startDate && trip.endDate && trip.startDate > trip.endDate) {
    errors.push('Data de início deve ser anterior à data de fim.');
  }
  return errors;
}

function buildSeed(mode, source) {
  const now = new Date().toISOString();
  if (mode === 'create') {
    return {
      id: '',
      name: '',
      status: 'planned',
      lat: null,
      lon: null,
      flag: '',
      country: '',
      dates: { start: '', end: '', computed_from: 'manual' },
      bookings: { flights: [], stays: [], experiences: [] },
      budget: { planned: {}, actual: {}, currency: 'BRL' },
      checklist: [],
      notes: { general: '' },
      created_at: now,
      updated_at: now,
    };
  }
  // edit / duplicate
  const copy = JSON.parse(JSON.stringify(source));
  if (mode === 'duplicate') {
    copy.id = '';
    copy.name = `${copy.name} (cópia)`;
    copy.status = 'planned';
    copy.created_at = now;
  }
  copy.updated_at = now;
  // ADR-003: semeia o estado de trabalho de datas via leitor tolerante, para
  // editar registros legacy (startDate/endDate ou year/month) SEM perder datas
  // ao gravar o canônico. dates.* aqui é só estado de UI, não é persistido.
  const seeded = getDates(source);
  copy.dates = {
    start: seeded.start || '',
    end: seeded.end || '',
    computed_from: copy.dates?.computed_from || 'manual',
  };
  copy.bookings = copy.bookings || { flights: [], stays: [], experiences: [] };
  copy.budget = copy.budget || { planned: {}, actual: {}, currency: 'BRL' };
  copy.checklist = copy.checklist || [];
  copy.notes = copy.notes || { general: '' };
  return copy;
}

export function openTripEditor({ mode = 'create', trip, onSave, onDelete } = {}) {
  if ((mode === 'edit' || mode === 'duplicate') && !trip) {
    throw new Error(`trip-editor: 'trip' obrigatório no modo ${mode}`);
  }
  injectStyles();
  const draft = buildSeed(mode, trip);

  let suggestionsAbort = null;
  let suggestionTimer = null;
  let activeSuggestionIndex = -1;
  let suggestions = [];

  const titleMap = { create: 'Nova viagem', edit: 'Editar viagem', duplicate: 'Duplicar viagem' };

  const errorsBox = el('div', { class: 'tev-errors', hidden: 'true' });

  const nameInput = el('input', {
    type: 'text',
    placeholder: 'Ex: Bruxelas + Tomorrowland',
    value: draft.name || '',
  });
  const statusSelect = el('select');
  for (const v of ['planned', 'in_progress', 'done', 'wishlist']) {
    const opt = el('option', { value: v }, v);
    if (draft.status === v) opt.setAttribute('selected', 'true');
    statusSelect.appendChild(opt);
  }

  const destInput = el('input', {
    type: 'text',
    placeholder: 'Digite cidade ou país (auto-complete Nominatim/OSM)',
    value: draft.country ? `${draft.country}` : '',
    autocomplete: 'off',
  });
  const destList = el('div', { class: 'tev-suggest-list', hidden: 'true' });
  const destWrap = el('div', { class: 'tev-suggest' }, [destInput, destList]);
  const destMeta = el('div', { class: 'tev-status-line' });

  // ── B1: entrada MANUAL de país/coords + proveniência ────────────────────
  // Espelha a UX do Período: inputs em row-2, botão secundário pequeno e uma
  // linha de proveniência (✍ manual / 🗺 Nominatim). Edição manual marca
  // geo_source='manual' e NÃO é sobrescrita por geocoding depois.
  const countryInput = el('input', { type: 'text', placeholder: 'País (ex: Brasil)', value: draft.country || '' });
  const ccInput = el('input', {
    type: 'text', placeholder: 'ISO 2 (ex: BR)', maxlength: '2',
    value: draft.country_code || '', style: 'text-transform: uppercase;',
  });
  const latInput = el('input', { type: 'number', step: 'any', placeholder: 'lat (-90..90)', value: draft.lat != null ? String(draft.lat) : '' });
  const lonInput = el('input', { type: 'number', step: 'any', placeholder: 'lon (-180..180)', value: draft.lon != null ? String(draft.lon) : '' });

  const geoProvenance = el('div', { class: 'tev-status-line' });
  const inferGeoBtn = el('button', { type: 'button', class: 'tev-btn tev-btn-secondary', style: 'padding: 4px 10px; font-size: 12px;' }, '🗺 Inferir do mapa');
  const revertGeoBtn = el('button', { type: 'button', class: 'tev-btn tev-btn-secondary', style: 'padding: 4px 10px; font-size: 12px;' }, '↩ Voltar ao valor inferido');
  const confirmGeoBtn = el('button', { type: 'button', class: 'tev-btn tev-btn-secondary', style: 'padding: 4px 10px; font-size: 12px;', hidden: 'true' }, '✓ Confirmar destino');

  let lastInferredGeo = null; // snapshot do último pick Nominatim (para "voltar")

  function refreshGeoProvenance() {
    const map = { manual: '✍ manual', nominatim: '🗺 Nominatim/OSM' };
    if (draft._geoNeedsConfirm) {
      geoProvenance.textContent = draft._geoConfirmLabel || '⚠ confirmar destino';
      confirmGeoBtn.hidden = false;
    } else {
      geoProvenance.textContent = map[draft.geo_source] || '';
      confirmGeoBtn.hidden = true;
    }
    revertGeoBtn.disabled = !lastInferredGeo;
  }

  function setManualGeo() {
    draft.geo_source = 'manual';
    draft._geoNeedsConfirm = false;
    refreshGeoProvenance();
  }

  function syncGeoInputs() {
    countryInput.value = draft.country || '';
    ccInput.value = draft.country_code || '';
    latInput.value = draft.lat != null ? String(draft.lat) : '';
    lonInput.value = draft.lon != null ? String(draft.lon) : '';
  }

  function onCoordInput() {
    const lat = parseFloat(latInput.value);
    const lon = parseFloat(lonInput.value);
    const errs = [];
    if (latInput.value !== '' && !isValidLat(lat)) errs.push('lat -90..90');
    if (lonInput.value !== '' && !isValidLon(lon)) errs.push('lon -180..180');
    if (errs.length) {
      geoProvenance.textContent = `⚠ coordenada inválida: ${errs.join(' · ')}`;
      return;
    }
    if (latInput.value !== '') draft.lat = lat;
    if (lonInput.value !== '') draft.lon = lon;
    setManualGeo();
    renderIdMeta();
  }

  countryInput.addEventListener('input', () => {
    draft.country = countryInput.value.trim();
    setManualGeo();
    renderIdMeta();
  });
  ccInput.addEventListener('input', () => {
    const cc = ccInput.value.trim().toUpperCase();
    draft.country_code = cc;
    draft.flag = flagFromCountryCode(cc);
    setManualGeo();
    renderIdMeta();
  });
  latInput.addEventListener('input', onCoordInput);
  lonInput.addEventListener('input', onCoordInput);

  inferGeoBtn.addEventListener('click', () => {
    destInput.focus();
    if (destInput.value.trim().length >= 2) destInput.dispatchEvent(new Event('input'));
  });
  revertGeoBtn.addEventListener('click', () => {
    if (!lastInferredGeo) return;
    Object.assign(draft, {
      country: lastInferredGeo.country,
      country_code: lastInferredGeo.country_code,
      flag: lastInferredGeo.flag,
      lat: lastInferredGeo.lat,
      lon: lastInferredGeo.lon,
      geo_source: 'nominatim',
      _geoNeedsConfirm: lastInferredGeo.needsConfirm,
      _geoConfirmLabel: lastInferredGeo.confirmLabel,
    });
    destInput.value = lastInferredGeo.display || '';
    syncGeoInputs();
    refreshGeoProvenance();
    renderIdMeta();
  });
  confirmGeoBtn.addEventListener('click', () => {
    draft._geoNeedsConfirm = false;
    draft.geo_source = draft.geo_source || 'nominatim';
    refreshGeoProvenance();
  });

  const startInput = el('input', { type: 'date', value: draft.dates?.start || '' });
  const endInput = el('input', { type: 'date', value: draft.dates?.end || '' });

  // F2.5: botão para inferir datas a partir de bookings cadastrados.
  const inferBtn = el('button', {
    type: 'button',
    class: 'tev-btn tev-btn-secondary',
    style: 'padding: 4px 10px; font-size: 12px;',
  }, '✈ Inferir do aéreo');
  const datesProvenance = el('div', { class: 'tev-status-line' });

  function refreshProvenance() {
    const src = draft.dates?.computed_from;
    if (!src) {
      datesProvenance.textContent = '';
      return;
    }
    const map = { flight: '✈ inferido do voo', stay: '🏨 inferido da hospedagem', manual: '✍ manual' };
    datesProvenance.textContent = map[src] || src;
  }
  refreshProvenance();

  inferBtn.addEventListener('click', () => {
    const inferred = deriveDatesFromBookings(draft.bookings);
    if (!inferred) {
      datesProvenance.textContent = 'Sem bookings com datas — cadastre voos ou stays primeiro (via inbox de Gmail ou edição manual).';
      return;
    }
    if (inferred.start) {
      startInput.value = inferred.start;
      draft.dates = { ...(draft.dates || {}), start: inferred.start };
    }
    if (inferred.end) {
      endInput.value = inferred.end;
      draft.dates = { ...(draft.dates || {}), end: inferred.end };
    }
    draft.dates.computed_from = inferred.computed_from;
    if (inferred.nts != null) draft.nts = inferred.nts;
    refreshProvenance();
    renderIdMeta();
  });

  const notesInput = el('textarea', {
    placeholder: 'Notas gerais (markdown OK)',
  });
  notesInput.value = draft.notes?.general || '';

  // Wizard temporal — atualiza quando datas mudam.
  const wizardBox = el('div', { class: 'tev-wz-box' });
  function refreshWizard() {
    renderWizardCard(wizardBox, draft, {
      default: (cta) => {
        if (cta.startsWith('edit-')) {
          // Foca no campo apropriado (no-op visual; usuário já está editando)
          return;
        }
        // Outros CTAs disparam agentes externos via callback global
        if (window.viagensV2?.[cta]) window.viagensV2[cta](draft);
      },
    });
  }

  // Benchmark histórico — atualiza quando destino muda.
  const benchmarkBox = el('div', { class: 'tev-bm-box' });
  function refreshBenchmark() {
    renderBenchmarkBanner(benchmarkBox, draft).catch((e) => {
      benchmarkBox.textContent = `Benchmark indisponível: ${e.message}`;
    });
  }

  // Orçamento vivo — recalcula a partir de bookings.
  const budgetBox = el('div', { class: 'tev-bg-box' });
  function refreshBudget() {
    renderBudget(budgetBox, draft, {
      onChange: ({ planned, actual }) => {
        draft.budget = {
          ...(draft.budget || {}),
          planned,
          actual,
          currency: 'BRL',
        };
      },
    });
    // Atualiza draft.budget.actual já com o cálculo inicial
    draft.budget = {
      ...(draft.budget || {}),
      actual: mergeActual(draft),
      currency: 'BRL',
    };
  }

  // Checklist contextual — popula automaticamente quando destino muda.
  const checklistBox = el('div', { class: 'tev-cl-box' });
  const checklistMeta = el('div', { class: 'tev-status-line' }, 'Selecione um destino para gerar checklist contextual.');
  let rulesDoc = null;
  let checklistApi = null;
  async function refreshChecklist() {
    try {
      if (!rulesDoc) rulesDoc = await loadRules();
    } catch (e) {
      checklistMeta.textContent = `Falha ao carregar regras: ${e.message}`;
      return;
    }
    const next = injectChecklistItems(draft.checklist || [], draft, rulesDoc);
    draft.checklist = next;
    const autoCount = next.filter((it) => it.auto_added).length;
    const manualCount = next.length - autoCount;
    checklistMeta.textContent = `${autoCount} item(s) auto · ${manualCount} manual(is)`;
    checklistApi = renderChecklist(checklistBox, next, {
      onChange: (items) => {
        draft.checklist = items;
        const a = items.filter((it) => it.auto_added).length;
        checklistMeta.textContent = `${a} item(s) auto · ${items.length - a} manual(is)`;
      },
    });
  }

  const idMeta = el('div', { class: 'tev-meta' });
  const renderIdMeta = () => {
    const candidate = tripIdFrom(nameInput.value, startInput.value);
    const flag = draft.flag || flagFromCountryCode(draft.country_code || '');
    idMeta.textContent =
      `ID gerado: ${candidate || '—'}` +
      (flag ? `  ${flag}` : '') +
      (draft.lat != null && draft.lon != null
        ? `   ${draft.lat.toFixed(3)}, ${draft.lon.toFixed(3)}`
        : '   (sem coordenadas — selecione na busca)');
  };

  function pickSuggestion(idx) {
    const s = suggestions[idx];
    if (!s) return;
    // B2: avalia confiança ANTES de aceitar. Baixa relevância / ambiguidade /
    // fora da região preferida (viés BR) → não auto-atribui, exige confirmação.
    const trust = assessGeoTrust(suggestions, { pickedIndex: idx });
    draft.country = s.country || '';
    draft.country_code = s.country_code || '';
    draft.flag = flagFromCountryCode(s.country_code);
    draft.lat = s.lat;
    draft.lon = s.lon;
    draft.geo_source = 'nominatim';
    draft._geoNeedsConfirm = trust.confirm;
    draft._geoConfirmLabel = trust.label;
    lastInferredGeo = {
      country: draft.country, country_code: draft.country_code, flag: draft.flag,
      lat: draft.lat, lon: draft.lon, display: s.display,
      needsConfirm: trust.confirm, confirmLabel: trust.label,
    };
    destInput.value = s.display;
    destMeta.textContent = `País: ${draft.country || '—'}  ${draft.flag}   coords: ${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`;
    syncGeoInputs();
    refreshGeoProvenance();
    destList.hidden = true;
    suggestions = [];
    activeSuggestionIndex = -1;
    renderIdMeta();
    refreshChecklist();
    refreshBenchmark();
  }

  destInput.addEventListener('input', () => {
    clearTimeout(suggestionTimer);
    const query = destInput.value.trim();
    if (query.length < 2) {
      destList.hidden = true;
      return;
    }
    suggestionTimer = setTimeout(async () => {
      if (suggestionsAbort) suggestionsAbort.abort();
      suggestionsAbort = new AbortController();
      destList.innerHTML = '';
      destList.appendChild(
        el('div', { class: 'tev-suggest-empty' }, 'Buscando…')
      );
      destList.hidden = false;
      try {
        const results = await nominatimSearch(query, { signal: suggestionsAbort.signal });
        destList.innerHTML = '';
        suggestions = results;
        if (!results.length) {
          destList.appendChild(
            el('div', { class: 'tev-suggest-empty' }, 'Sem resultados')
          );
          return;
        }
        results.forEach((r, i) => {
          const node = el(
            'div',
            {
              class: 'tev-suggest-item',
              onclick: () => pickSuggestion(i),
              onmouseenter: () => {
                activeSuggestionIndex = i;
                Array.from(destList.children).forEach((c, j) =>
                  c.classList.toggle('active', i === j)
                );
              },
            },
            `${(r.country_code || '').toUpperCase() !== PREFERRED_CC ? '⚠ ' : ''}${flagFromCountryCode(r.country_code)} ${r.display}`
          );
          destList.appendChild(node);
        });
      } catch (e) {
        if (e.name === 'AbortError') return;
        destList.innerHTML = '';
        destList.appendChild(
          el('div', { class: 'tev-suggest-empty' }, `Erro: ${e.message}`)
        );
      }
    }, 450);
  });

  destInput.addEventListener('keydown', (e) => {
    if (destList.hidden || !suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex + 1) % suggestions.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeSuggestionIndex =
        (activeSuggestionIndex - 1 + suggestions.length) % suggestions.length;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSuggestion(activeSuggestionIndex >= 0 ? activeSuggestionIndex : 0);
      return;
    } else {
      return;
    }
    Array.from(destList.children).forEach((c, j) =>
      c.classList.toggle('active', j === activeSuggestionIndex)
    );
  });

  nameInput.addEventListener('input', renderIdMeta);
  startInput.addEventListener('input', () => {
    if (draft.dates) draft.dates.computed_from = 'manual';
    refreshProvenance();
    renderIdMeta();
  });
  endInput.addEventListener('input', () => {
    if (draft.dates) draft.dates.computed_from = 'manual';
    refreshProvenance();
  });

  // Se for edição, preencher metadados do destino sem fazer busca
  if (mode !== 'create' && draft.lat != null && draft.lon != null) {
    const flag = draft.flag || flagFromCountryCode(draft.country_code || '');
    destMeta.textContent = `País: ${draft.country || '—'}  ${flag}   coords: ${draft.lat?.toFixed?.(3)}, ${draft.lon?.toFixed?.(3)}`;
    // Semeia o "voltar ao valor inferido" quando o registro já veio do Nominatim.
    if (draft.geo_source === 'nominatim') {
      lastInferredGeo = {
        country: draft.country, country_code: draft.country_code, flag: draft.flag,
        lat: draft.lat, lon: draft.lon, display: destInput.value || draft.country || '',
        needsConfirm: false, confirmLabel: '',
      };
    }
  }
  refreshGeoProvenance();
  renderIdMeta();

  const overlay = el('div', { class: 'tev-overlay' });
  const closeBtn = el('button', { class: 'tev-close', 'aria-label': 'Fechar' }, '×');
  const header = el('div', { class: 'tev-header' }, [
    el('h2', {}, titleMap[mode] || 'Viagem'),
    closeBtn,
  ]);

  const saveBtn = el('button', { class: 'tev-btn tev-btn-primary' }, 'Salvar');
  const cancelBtn = el('button', { class: 'tev-btn tev-btn-secondary' }, 'Cancelar');
  const deleteBtn = onDelete
    ? el('button', { class: 'tev-btn tev-btn-danger' }, 'Excluir')
    : null;

  const footer = el('div', { class: 'tev-footer' }, [
    deleteBtn || el('span', {}),
    el('div', { style: 'display: flex; gap: 8px;' }, [cancelBtn, saveBtn]),
  ]);

  const body = el('div', { class: 'tev-body' }, [
    errorsBox,
    wizardBox,
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Nome'),
      nameInput,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Destino (cidade ou país)'),
      destWrap,
      destMeta,
    ]),
    el('div', { class: 'tev-row row-2' }, [
      el('div', { class: 'tev-row' }, [el('label', {}, 'País'), countryInput]),
      el('div', { class: 'tev-row' }, [el('label', {}, 'Código ISO'), ccInput]),
    ]),
    el('div', { class: 'tev-row row-2' }, [
      el('div', { class: 'tev-row' }, [el('label', {}, 'Latitude'), latInput]),
      el('div', { class: 'tev-row' }, [el('label', {}, 'Longitude'), lonInput]),
    ]),
    el('div', { class: 'tev-row', style: 'flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap;' }, [
      inferGeoBtn,
      revertGeoBtn,
      confirmGeoBtn,
      geoProvenance,
    ]),
    el('div', { class: 'tev-row row-2' }, [
      el('div', { class: 'tev-row' }, [el('label', {}, 'Início'), startInput]),
      el('div', { class: 'tev-row' }, [el('label', {}, 'Fim'), endInput]),
    ]),
    el('div', { class: 'tev-row', style: 'flex-direction: row; align-items: center; gap: 8px;' }, [
      inferBtn,
      datesProvenance,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Status'),
      statusSelect,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Notas'),
      notesInput,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Checklist contextual'),
      checklistMeta,
      checklistBox,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Benchmark próprio'),
      benchmarkBox,
    ]),
    el('div', { class: 'tev-row' }, [
      el('label', {}, 'Orçamento (realizado / planejado)'),
      budgetBox,
    ]),
  ]);

  const modal = el('div', { class: 'tev-modal', role: 'dialog', 'aria-modal': 'true' }, [
    header,
    body,
    idMeta,
    footer,
  ]);
  overlay.appendChild(modal);

  function close() {
    if (suggestionsAbort) suggestionsAbort.abort();
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  }

  function onEsc(e) {
    if (e.key === 'Escape') close();
  }

  function collect() {
    const out = { ...draft };
    out.name = nameInput.value.trim();
    out.status = statusSelect.value;
    // ADR-003 (opção B): grava a forma CANÔNICA startDate/endDate + espelhos
    // year/month/nts derivados. dates.* é DEPRECADO e não é mais emitido.
    const start = startInput.value || null;
    const end = endInput.value || null;
    const legacy = deriveLegacyDateFields(start, end);
    out.startDate = legacy.startDate;
    out.endDate = legacy.endDate;
    if (legacy.year != null) out.year = legacy.year;
    if (legacy.month != null) out.month = legacy.month;
    if (legacy.nts != null) out.nts = legacy.nts;
    delete out.dates;
    out.notes = { ...(out.notes || {}), general: notesInput.value.trim() };
    out.id = out.id || tripIdFrom(out.name, start);
    out.updated_at = new Date().toISOString();
    return out;
  }

  function showErrors(list) {
    if (!list.length) {
      errorsBox.hidden = true;
      return;
    }
    errorsBox.innerHTML = '';
    errorsBox.appendChild(el('strong', {}, 'Corrija os campos abaixo:'));
    const ul = el('ul', {});
    list.forEach((m) => ul.appendChild(el('li', {}, m)));
    errorsBox.appendChild(ul);
    errorsBox.hidden = false;
  }

  saveBtn.addEventListener('click', async () => {
    const final = collect();
    const errs = validate(final);
    if (errs.length) {
      showErrors(errs);
      return;
    }
    showErrors([]);
    // Campos de UI internos não vão para o trips.json.
    delete final._geoNeedsConfirm;
    delete final._geoConfirmLabel;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando…';
    try {
      await onSave?.(final);
      close();
    } catch (e) {
      showErrors([`Falha ao salvar: ${e.message}`]);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar';
    }
  });

  cancelBtn.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onEsc);

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Excluir esta viagem? Essa ação cria um commit.')) return;
      deleteBtn.disabled = true;
      try {
        await onDelete(draft.id);
        close();
      } catch (e) {
        showErrors([`Falha ao excluir: ${e.message}`]);
        deleteBtn.disabled = false;
      }
    });
  }

  document.body.appendChild(overlay);
  nameInput.focus();

  // Em modo edit/duplicate, dispara o refresh inicial da checklist.
  if (mode !== 'create') refreshChecklist();
  refreshBudget();
  refreshBenchmark();
  refreshWizard();

  // Re-renderiza wizard quando datas mudam
  startInput.addEventListener('change', refreshWizard);
  endInput.addEventListener('change', refreshWizard);

  return { close };
}
