// Backlog / Ideias — captura rápida + view de roadmap (semente da área Admin).
//
// Dois pontos de entrada:
//   • Botão fixo "💡 Ideias" na borda DIREITA (meio da tela), visualmente
//     distinto do #v2-fab-stack (canto inferior-direito). Abre a captura.
//   • View de roadmap: histórico "feito" (só leitura) + itens ativos
//     priorizáveis (reordena por prioridade).
//
// Escrita via PAT, espelhando o caminho do trips-api porém com gate próprio:
// usa src/core/backlog-api.js (parse-gate dedicado de data/backlog.json).
// Sem PAT desbloqueado → pede configurar (onRequireAuth); nunca trava. Fila
// offline é trabalho FUTURO (não aqui). Leitura pública via fetch do JSON.

import * as settings from '../core/settings.js';
import {
  getBacklogFile,
  putBacklogFile,
  upsertBacklogItem,
  BACKLOG_TYPES,
} from '../core/backlog-api.js';
import { enqueueLocal, listLocal, removeLocal } from '../core/backlog-local.js';

const AREAS = ['infra', 'design', 'media', 'memoria', 'admin', 'integracao', 'processo'];
const TYPE_LABEL = { ideia: '💡 ideia', correcao: '🐞 correção', implementacao: '🛠 implementação' };
const STATUS_LABEL = { nova: 'nova', priorizada: 'priorizada', fazendo: 'fazendo', feito: 'feito' };

let cssInjected = false;
const CSS = `
.bk-fab { position: fixed; right: 10px; top: 50%; transform: translateY(-50%);
  z-index: 9100; font: 700 13px var(--vc-font-ui); color: var(--vc-paper);
  background: var(--vc-relacoes); border: 0; border-radius: 999px;
  padding: 11px 15px; cursor: pointer; display: flex; align-items: center; gap: 6px;
  box-shadow: 0 8px 20px -4px color-mix(in srgb, var(--vc-relacoes) 60%, transparent);
  outline: 2px solid color-mix(in srgb, var(--vc-paper) 70%, transparent); }
.bk-fab:hover { filter: brightness(1.05); }
.bk-overlay { position: fixed; inset: 0; z-index: 9999; padding: 16px;
  background: color-mix(in srgb, var(--vc-ink) 55%, transparent);
  display: flex; align-items: center; justify-content: center; }
.bk-modal { background: var(--vc-paper); color: var(--vc-ink);
  width: min(720px, 100%); max-height: 92vh; overflow: auto;
  border-radius: 12px; font: 14px var(--vc-font-ui);
  box-shadow: 0 25px 50px -12px color-mix(in srgb, var(--vc-ink) 40%, transparent); }
.bk-modal.bk-wide { width: min(880px, 100%); }
.bk-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--vc-paper-3);
  position: sticky; top: 0; background: var(--vc-paper); z-index: 1; }
.bk-header strong { font-size: 16px; }
.bk-close { background: transparent; border: 0; font-size: 22px; cursor: pointer;
  color: var(--vc-ink-soft); }
.bk-body { padding: 16px 20px; display: grid; gap: 14px; }
.bk-field { display: grid; gap: 4px; font-size: 12px; color: var(--vc-ink-soft); }
.bk-field > span { font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.bk-field input, .bk-field textarea, .bk-field select { font: inherit; color: var(--vc-ink);
  background: var(--vc-paper); border: 1px solid var(--vc-ink-faint);
  border-radius: 6px; padding: 8px 10px; }
.bk-field textarea { min-height: 64px; resize: vertical; }
.bk-row { display: flex; gap: 12px; flex-wrap: wrap; }
.bk-row > .bk-field { flex: 1 1 160px; }
.bk-status { border-radius: 8px; padding: 8px 12px; font-size: 13px;
  background: var(--vc-paper-2); border: 1px solid var(--vc-paper-3); }
.bk-status.bk-ok { color: var(--vc-material); }
.bk-status.bk-err { color: var(--vc-saude); }
.bk-actions { display: flex; justify-content: flex-end; gap: 8px; align-items: center;
  flex-wrap: wrap; }
.bk-cta { font: inherit; font-weight: 700; padding: 10px 18px; border: 0;
  border-radius: 8px; cursor: pointer; background: var(--vc-relacoes);
  color: var(--vc-paper); }
.bk-cta[disabled] { opacity: .5; cursor: not-allowed; }
.bk-secondary { font: inherit; padding: 9px 14px; border: 1px solid var(--vc-ink-faint);
  border-radius: 8px; cursor: pointer; background: var(--vc-paper); color: var(--vc-ink); }
.bk-section-title { font-size: 13px; font-weight: 700; color: var(--vc-ink-soft);
  text-transform: uppercase; letter-spacing: .04em; margin: 4px 0 0; }
.bk-list { display: grid; gap: 8px; }
.bk-item { border: 1px solid var(--vc-paper-3); border-radius: 10px;
  background: var(--vc-paper-2); padding: 10px 12px; display: grid; gap: 6px; }
.bk-item.bk-done { opacity: .72; }
.bk-item-top { display: flex; align-items: center; gap: 8px; }
.bk-item-title { font-weight: 700; flex: 1; }
.bk-item-desc { font-size: 13px; color: var(--vc-ink-soft); }
.bk-tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.bk-badge { display: inline-block; font-size: 10px; font-weight: 700;
  padding: 2px 8px; border-radius: 999px; background: var(--vc-paper-3);
  color: var(--vc-ink-soft); }
.bk-badge.bk-b-feito { background: var(--vc-material); color: var(--vc-paper); }
.bk-badge.bk-b-priorizada { background: var(--vc-relacoes); color: var(--vc-paper); }
.bk-badge.bk-b-fazendo { background: var(--vc-trabalho); color: var(--vc-paper); }
.bk-rank { display: flex; gap: 4px; }
.bk-rank button { font: 700 12px var(--vc-font-ui); width: 26px; height: 26px;
  border: 1px solid var(--vc-ink-faint); border-radius: 6px; cursor: pointer;
  background: var(--vc-paper); color: var(--vc-ink); }
.bk-rank button[disabled] { opacity: .35; cursor: not-allowed; }
.bk-item-statussel { font: inherit; font-size: 12px; color: var(--vc-ink);
  background: var(--vc-paper); border: 1px solid var(--vc-ink-faint);
  border-radius: 6px; padding: 4px 6px; }
.bk-note { font-size: 12px; color: var(--vc-ink-soft); }
.bk-empty { font-size: 13px; color: var(--vc-ink-soft); font-style: italic; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'bk-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'ideia';
}

function newId(title) {
  const rand = (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 4);
  return `bk-${slugify(title)}-${rand}`;
}

// Leitura: com PAT desbloqueado lê via API (estado fresco + sha p/ escrita);
// sem PAT, lê o backlog.json público. Mesmo padrão do statement-import/picker.
async function loadBacklog() {
  if (settings.isUnlocked()) {
    const { content, sha } = await getBacklogFile({ token: settings.getToken() });
    return { content, sha };
  }
  const res = await fetch('data/backlog.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('Falha lendo backlog.json');
  return { content: await res.json(), sha: null };
}

function buildOverlay({ wide = false, titleHtml = '' } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'bk-overlay';
  const modal = document.createElement('div');
  modal.className = `bk-modal${wide ? ' bk-wide' : ''}`;
  modal.innerHTML = `
    <div class="bk-header">
      <strong>${titleHtml}</strong>
      <button type="button" class="bk-close" aria-label="Fechar">×</button>
    </div>
    <div class="bk-body"></div>
  `;
  overlay.appendChild(modal);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('.bk-close').addEventListener('click', close);
  document.body.appendChild(overlay);
  return { overlay, modal, body: modal.querySelector('.bk-body'), close };
}

// ── Captura rápida ─────────────────────────────────────────────────────
export function openBacklogCapture({ onRequireAuth } = {}) {
  ensureCss();
  const { body, close } = buildOverlay({ titleHtml: '💡 Capturar implementação' });

  body.innerHTML = `
    <div class="bk-status" hidden></div>
    <label class="bk-field">
      <span>Por quê</span>
      <textarea id="bk-porque" maxlength="600" placeholder="que dor resolve, ou que objetivo atende? se não souber, talvez seja ruído." autofocus></textarea>
    </label>
    <label class="bk-field">
      <span>O quê</span>
      <input id="bk-title" type="text" maxlength="120" placeholder="o item concreto: ex. tela de histórico" />
    </label>
    <label class="bk-field">
      <span>Como</span>
      <input id="bk-como" type="text" maxlength="200" placeholder="a abordagem (opcional)" />
    </label>
    <div class="bk-row">
      <label class="bk-field">
        <span>Tipo</span>
        <select id="bk-type">
          ${BACKLOG_TYPES.map((t) => `<option value="${t}">${esc(TYPE_LABEL[t] || t)}</option>`).join('')}
        </select>
      </label>
      <label class="bk-field">
        <span>Impacto</span>
        <select id="bk-impacto">
          <option value="alto">alto</option>
          <option value="medio" selected>médio</option>
          <option value="baixo">baixo</option>
        </select>
      </label>
      <label class="bk-field">
        <span>Esforço</span>
        <select id="bk-esforco">
          <option value="alto">alto</option>
          <option value="medio" selected>médio</option>
          <option value="baixo">baixo</option>
        </select>
      </label>
    </div>
    <div class="bk-row">
      <label class="bk-field">
        <span>Área</span>
        <input id="bk-area" type="text" list="bk-areas" placeholder="ex: media" />
        <datalist id="bk-areas">${AREAS.map((a) => `<option value="${a}"></option>`).join('')}</datalist>
      </label>
      <label class="bk-field">
        <span>Prioridade</span>
        <input id="bk-priority" type="number" min="1" step="1" placeholder="(sem)" />
      </label>
    </div>
    <label class="bk-field">
      <span>Detalhes / links</span>
      <textarea id="bk-desc" maxlength="800" placeholder="contexto extra, links… (opcional)"></textarea>
    </label>
    <div class="bk-actions">
      <button type="button" id="bk-goto-view" class="bk-secondary">📋 Ver roadmap</button>
      <button type="button" id="bk-save" class="bk-cta">Salvar</button>
    </div>
  `;

  const statusBox = body.querySelector('.bk-status');
  const setStatus = (msg, kind) => {
    statusBox.hidden = false;
    statusBox.innerHTML = msg;
    statusBox.className = `bk-status${kind === 'ok' ? ' bk-ok' : kind === 'err' ? ' bk-err' : ''}`;
  };

  body.querySelector('#bk-goto-view').addEventListener('click', () => {
    close();
    openBacklogView({ onRequireAuth });
  });

  body.querySelector('#bk-save').addEventListener('click', async () => {
    const porque = body.querySelector('#bk-porque').value.trim();
    if (!porque) return setStatus('O "Por quê" é obrigatório. Se você não consegue escrevê-lo em uma linha, provavelmente é ruído.', 'err');
    const title = body.querySelector('#bk-title').value.trim();
    if (!title) return setStatus('O "O quê" é obrigatório.', 'err');

    const priRaw = body.querySelector('#bk-priority').value.trim();
    const priority = priRaw ? Number(priRaw) : null;
    const item = {
      id: newId(title),
      title,
      porque,
      como: body.querySelector('#bk-como').value.trim(),
      impacto: body.querySelector('#bk-impacto').value,
      esforco: body.querySelector('#bk-esforco').value,
      description: body.querySelector('#bk-desc').value.trim(),
      type: body.querySelector('#bk-type').value,
      area: body.querySelector('#bk-area').value.trim() || 'geral',
      status: priority != null ? 'priorizada' : 'nova',
      priority: priority != null && Number.isFinite(priority) ? priority : null,
      created: new Date().toISOString(),
      origin: 'ui',
    };

    if (!settings.isUnlocked()) {
      try {
        await enqueueLocal(item);
        setStatus(
          'Salvo localmente neste aparelho ✔ Será publicado quando você conectar o GitHub. ' +
          '<button type="button" id="bk-cfg" class="bk-secondary" style="margin-left:8px">⚙ Conectar GitHub</button>',
          'ok',
        );
        body.querySelector('#bk-cfg')?.addEventListener('click', () => {
          if (typeof onRequireAuth === 'function') onRequireAuth();
          else window.viagensV2?.openPATModal?.();
        });
        body.querySelector('#bk-porque').value = '';
        body.querySelector('#bk-como').value = '';
        body.querySelector('#bk-title').value = '';
        body.querySelector('#bk-desc').value = '';
        body.querySelector('#bk-priority').value = '';
      } catch (e) {
        setStatus(`Falha ao salvar localmente: ${esc(e.message)}`, 'err');
      }
      return;
    }

    const btn = body.querySelector('#bk-save');
    btn.disabled = true;
    setStatus('Gravando ideia…');
    try {
      await upsertBacklogItem({
        token: settings.getToken(),
        item,
        message: `feat(backlog): captura "${item.title}" (${item.type})`,
      });
      setStatus(`Ideia "${esc(item.title)}" gravada no backlog.json ✔`, 'ok');
      body.querySelector('#bk-porque').value = '';
      body.querySelector('#bk-como').value = '';
      body.querySelector('#bk-title').value = '';
      body.querySelector('#bk-desc').value = '';
      body.querySelector('#bk-priority').value = '';
    } catch (e) {
      setStatus(`Falha ao gravar: ${esc(e.message)}`, 'err');
    } finally {
      btn.disabled = false;
    }
  });
}

// ── View de roadmap ──────────────────────────────────────────────────────
function rankActive(items) {
  // ativos = tudo que não está "feito"; ordena por prioridade (nulls por
  // último) e, em empate, por data de criação.
  return items
    .filter((i) => i.status !== 'feito')
    .sort((a, b) => {
      const pa = a.priority == null ? Infinity : a.priority;
      const pb = b.priority == null ? Infinity : b.priority;
      if (pa !== pb) return pa - pb;
      return String(a.created || '').localeCompare(String(b.created || ''));
    });
}

export function openBacklogView({ onRequireAuth } = {}) {
  ensureCss();
  const { body, close } = buildOverlay({ wide: true, titleHtml: '🗺 Backlog / Roadmap' });

  const state = { content: { version: 1, items: [] }, sha: null, busy: false, sortMode: 'prioridade', localPending: [] };

  const statusBox = document.createElement('div');
  statusBox.className = 'bk-status';
  statusBox.hidden = true;
  const setStatus = (msg, kind) => {
    statusBox.hidden = false;
    statusBox.innerHTML = msg;
    statusBox.className = `bk-status${kind === 'ok' ? ' bk-ok' : kind === 'err' ? ' bk-err' : ''}`;
  };

  function itemHtml(it, opts) {
    const { rankable, idx, total } = opts;
    const statusBadge = it.status !== 'nova'
      ? `<span class="bk-badge bk-b-${esc(it.status)}">${esc(STATUS_LABEL[it.status] || it.status)}</span>`
      : '';
    return `<div class="bk-item ${it.status === 'feito' ? 'bk-done' : ''}" data-id="${esc(it.id)}">
      <div class="bk-item-top">
        ${rankable ? `<span class="bk-rank">
          <button type="button" data-up="${esc(it.id)}" ${idx === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
          <button type="button" data-down="${esc(it.id)}" ${idx === total - 1 ? 'disabled' : ''} aria-label="Descer">▼</button>
        </span>` : ''}
        <span class="bk-item-title">${it.status !== 'feito' && it.priority != null ? `${esc(String(it.priority))}. ` : ''}${esc(it.title)}</span>
        ${rankable
          ? `<select class="bk-item-statussel" data-status="${esc(it.id)}">
              ${['nova', 'priorizada', 'fazendo', 'feito'].map((s) =>
                `<option value="${s}" ${it.status === s ? 'selected' : ''}>${esc(STATUS_LABEL[s])}</option>`).join('')}
            </select>`
          : statusBadge}
      </div>
      ${it.porque ? `<div class="bk-item-desc"><strong>Por quê:</strong> ${esc(it.porque)}</div>` : ''}
      ${it.description ? `<div class="bk-item-desc">${esc(it.description)}</div>` : ''}
      <div class="bk-tags">
        <span class="bk-badge">${esc(TYPE_LABEL[it.type] || it.type)}</span>
        <span class="bk-badge">${esc(it.area || 'geral')}</span>
        ${it.impacto ? `<span class="bk-badge">impacto ${esc(it.impacto)}</span>` : ''}
        ${it.esforco ? `<span class="bk-badge">esforço ${esc(it.esforco)}</span>` : ''}
        ${isQuickWin(it) ? '<span class="bk-badge bk-b-quickwin">⚡ ganho rápido</span>' : ''}
        <button type="button" class="bk-secondary bk-gen" data-gen="${esc(it.id)}" style="margin-left:auto">✨ Gerar CREATE</button>
      </div>
    </div>`;
  }

  const IMP_W = { alto: 3, medio: 2, baixo: 1 };
  const ESF_W = { alto: 3, medio: 2, baixo: 1 };
  const ganhoScore = (it) => (IMP_W[it.impacto] || 0) - (ESF_W[it.esforco] || 0);
  const isQuickWin = (it) => it.impacto === 'alto' && it.esforco === 'baixo';
  const itemById = (id) => (state.content.items || []).find((x) => x.id === id);

  function rankByGanho(items) {
    return items
      .filter((i) => i.status !== 'feito')
      .sort((a, b) => {
        const ga = ganhoScore(a);
        const gb = ganhoScore(b);
        if (ga !== gb) return gb - ga;
        const pa = a.priority == null ? Infinity : a.priority;
        const pb = b.priority == null ? Infinity : b.priority;
        if (pa !== pb) return pa - pb;
        return String(a.created || '').localeCompare(String(b.created || ''));
      });
  }

  function gerarCreate(it) {
    if (!it) return;
    const prompt = [
      '[C] Context',
      'Projeto Vida & Carreira (PWA pessoal do Eduardo, repo github.com/edurcampos86-jpg/viagens).',
      '',
      '[R] Request',
      'Você atuará como engenheiro do projeto, me ajudando a implementar este item do backlog.',
      '',
      '[E] Examples',
      'Sem exemplo de referência.',
      '',
      '[A] Audience',
      'Eu (Eduardo), dono do projeto.',
      '',
      '[T] Task',
      `${it.title}.`,
      `Por quê: ${it.porque || '(não informado)'}.`,
      `Como: ${it.como || '(a definir)'}.`,
      `Tipo: ${TYPE_LABEL[it.type] || it.type}. Impacto: ${it.impacto || '?'}. Esforço: ${it.esforco || '?'}.`,
      '',
      '[E] Extra Details',
      'Caminho seguro e reversível: branch + PR, sem merge sem revisão. Bump de service worker se mexer em src/*. Sem travessão.',
    ].join('\n');

    const sub = buildOverlay({ titleHtml: '✨ Prompt CREATE' });
    sub.body.innerHTML = `
      <label class="bk-field">
        <span>Cole onde quiser executar (Claude Chat, Cowork, Code)</span>
        <textarea id="bk-create-out" rows="14" readonly style="font-family:var(--vc-font-mono,monospace);font-size:12px"></textarea>
      </label>
      <div class="bk-actions">
        <button type="button" id="bk-create-copy" class="bk-cta">📋 Copiar</button>
      </div>`;
    const ta = sub.body.querySelector('#bk-create-out');
    ta.value = prompt;
    sub.body.querySelector('#bk-create-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(prompt); }
      catch { ta.select(); document.execCommand('copy'); }
      sub.body.querySelector('#bk-create-copy').textContent = '✔ Copiado';
    });
  }

  function render() {
    const items = Array.isArray(state.content.items) ? state.content.items : [];
    const active = state.sortMode === 'ganho' ? rankByGanho(items) : rankActive(items);
    const done = items.filter((i) => i.status === 'feito');
    const unlocked = settings.isUnlocked();
    const pend = state.localPending || [];

    body.innerHTML = '';
    body.appendChild(statusBox);

    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '14px';
    wrap.innerHTML = `
      <div class="bk-actions" style="justify-content:space-between">
        <span class="bk-note">${active.length} ativo(s) · ${done.length} concluído(s)
          ${unlocked ? '' : '· <strong>somente leitura</strong> (GitHub não conectado)'}</span>
        <span>
          <button type="button" id="bk-sort" class="bk-secondary">↕ Ordem: ${state.sortMode === 'ganho' ? 'ganho rápido' : 'prioridade'}</button>
          <button type="button" id="bk-new" class="bk-cta">💡 Nova ideia</button>
        </span>
      </div>
      ${pend.length ? `<div class="bk-note" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span>⏳ ${pend.length} ideia(s) salva(s) só neste aparelho.</span>
        ${unlocked
          ? '<button type="button" id="bk-pub-local" class="bk-cta">Publicar agora</button>'
          : '<span>Conecte o GitHub para publicar.</span>'}
      </div>` : ''}
      <div>
        <p class="bk-section-title">🗺 Roadmap — ativos (priorizáveis)</p>
        <div class="bk-list" id="bk-active">
          ${active.length
            ? active.map((it, i) => itemHtml(it, { rankable: unlocked, idx: i, total: active.length })).join('')
            : '<div class="bk-empty">Nenhum item ativo. Capture uma ideia ✨</div>'}
        </div>
      </div>
      <div>
        <p class="bk-section-title">✅ Histórico — feito</p>
        <div class="bk-list" id="bk-done">
          ${done.length
            ? done.map((it) => itemHtml(it, { rankable: false })).join('')
            : '<div class="bk-empty">Sem itens concluídos.</div>'}
        </div>
      </div>
      ${unlocked ? '' : `<div class="bk-note">Conecte o GitHub (badge ⚙) para priorizar e mudar status.
        <button type="button" id="bk-cfg2" class="bk-secondary" style="margin-left:8px">⚙ Conectar GitHub</button></div>`}
    `;
    body.appendChild(wrap);

    wrap.querySelector('#bk-new').addEventListener('click', () => {
      close();
      openBacklogCapture({ onRequireAuth });
    });
    wrap.querySelector('#bk-cfg2')?.addEventListener('click', () => {
      if (typeof onRequireAuth === 'function') onRequireAuth();
      else window.viagensV2?.openPATModal?.();
    });
    wrap.querySelectorAll('[data-up]').forEach((el) =>
      el.addEventListener('click', () => move(el.getAttribute('data-up'), -1)));
    wrap.querySelectorAll('[data-down]').forEach((el) =>
      el.addEventListener('click', () => move(el.getAttribute('data-down'), +1)));
    wrap.querySelectorAll('[data-status]').forEach((el) =>
      el.addEventListener('change', () => changeStatus(el.getAttribute('data-status'), el.value)));
    wrap.querySelectorAll('[data-gen]').forEach((el) =>
      el.addEventListener('click', () => gerarCreate(itemById(el.getAttribute('data-gen')))));
    wrap.querySelector('#bk-sort')?.addEventListener('click', () => {
      state.sortMode = state.sortMode === 'ganho' ? 'prioridade' : 'ganho';
      render();
    });
    wrap.querySelector('#bk-pub-local')?.addEventListener('click', () => publishLocal());
  }

  // Reordena os ativos e reescreve prioridades sequenciais 1..n; depois persiste.
  async function move(id, delta) {
    if (state.busy) return;
    const items = state.content.items;
    const active = rankActive(items);
    const pos = active.findIndex((i) => i.id === id);
    const target = pos + delta;
    if (pos < 0 || target < 0 || target >= active.length) return;
    [active[pos], active[target]] = [active[target], active[pos]];
    // reatribui prioridade sequencial aos ativos; "feito" fica intocado.
    active.forEach((it, i) => {
      const ref = items.find((x) => x.id === it.id);
      ref.priority = i + 1;
      if (ref.status === 'nova') ref.status = 'priorizada';
    });
    await persist(`feat(backlog): reordena prioridades`);
  }

  async function changeStatus(id, status) {
    if (state.busy) return;
    const ref = state.content.items.find((x) => x.id === id);
    if (!ref || ref.status === status) return;
    ref.status = status;
    if (status === 'feito') ref.priority = 0;
    await persist(`feat(backlog): ${id} → ${status}`);
  }

  async function persist(message) {
    if (!settings.isUnlocked()) {
      setStatus('GitHub não conectado, conecte para priorizar.', 'err');
      return;
    }
    state.busy = true;
    setStatus('Salvando…');
    try {
      await putBacklogFile({
        token: settings.getToken(),
        content: { ...state.content, version: state.content.version || 1 },
        sha: state.sha,
        message,
      });
      // recarrega para pegar o novo sha (evita 409 no próximo write).
      const fresh = await getBacklogFile({ token: settings.getToken() });
      state.content = fresh.content;
      state.sha = fresh.sha;
      setStatus('Salvo ✔', 'ok');
      render();
    } catch (e) {
      setStatus(`Falha ao salvar: ${esc(e.message)}`, 'err');
    } finally {
      state.busy = false;
    }
  }

  async function publishLocal() {
    if (state.busy) return;
    if (!settings.isUnlocked()) {
      setStatus('Conecte o GitHub para publicar as ideias locais.', 'err');
      return;
    }
    const pend = state.localPending || [];
    if (!pend.length) return;
    state.busy = true;
    setStatus(`Publicando ${pend.length} ideia(s) local(is)…`);
    try {
      for (const rec of pend) {
        await upsertBacklogItem({
          token: settings.getToken(),
          item: rec.item,
          message: `feat(backlog): publica ideia local "${rec.item.title}"`,
        });
        await removeLocal(rec.lid);
      }
      const fresh = await loadBacklog();
      state.content = fresh.content && Array.isArray(fresh.content.items) ? fresh.content : { version: 1, items: [] };
      state.sha = fresh.sha;
      state.localPending = await listLocal().catch(() => []);
      setStatus('Ideias locais publicadas ✔', 'ok');
      render();
    } catch (e) {
      state.localPending = await listLocal().catch(() => state.localPending);
      setStatus(`Falha ao publicar: ${esc(e.message)}`, 'err');
      render();
    } finally {
      state.busy = false;
    }
  }

  (async () => {
    body.innerHTML = '<div class="bk-note">Carregando backlog…</div>';
    try {
      const { content, sha } = await loadBacklog();
      state.content = content && Array.isArray(content.items) ? content : { version: 1, items: [] };
      state.sha = sha;
      state.localPending = await listLocal().catch(() => []);
      render();
    } catch (e) {
      body.innerHTML = `<div class="bk-status bk-err">Erro: ${esc(e.message)}</div>`;
    }
  })();
}

// ── Botão fixo "💡 Ideias" (borda direita, distinto do FAB stack) ────────
export function mountIdeasButton({ onRequireAuth } = {}) {
  ensureCss();
  if (document.getElementById('bk-ideias-fab')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'bk-ideias-fab';
  btn.className = 'bk-fab';
  btn.title = 'Capturar uma ideia / correção / implementação e ver o roadmap.';
  btn.setAttribute('aria-label', 'Capturar ideia e ver roadmap');
  btn.innerHTML = '💡 Implementações';
  btn.addEventListener('click', () => openBacklogCapture({ onRequireAuth }));
  document.body.appendChild(btn);
}
