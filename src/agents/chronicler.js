// 📝 Cronista da Memória — F4.3.
// Frontend: entrevista chat-style após uma viagem mudar para `done`,
// chama backend /functions/v1/chronicler, mostra preview editável e
// devolve o trip atualizado ao caller (que commita via trips-api).

import * as backend from '../core/backend.js';

export const meta = {
  id: 'chronicler',
  name: 'Cronista da Memória',
  icon: '📝',
  description: 'Entrevista pós-viagem que gera memória, highlights e legendas.',
};

const QUESTIONS = [
  { id: 'value', q: 'O que valeu mais que o preço?' },
  { id: 'shortfall', q: 'O que ficou aquém da expectativa?' },
  { id: 'return', q: 'Voltaria? Pra quem recomendaria?' },
  { id: 'highlight', q: 'Algum momento que precisa ficar eternizado?' },
];

let cssInjected = false;
const CSS = `
.cr-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
  display: flex; align-items: center; justify-content: center; z-index: 9999;
  padding: 16px; }
.cr-modal { background: #fff; color: #0f172a; width: min(640px, 100%);
  max-height: 90vh; overflow: auto; border-radius: 12px;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.35);
  font: 14px Inter, system-ui, sans-serif; }
.cr-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
.cr-body { padding: 16px 20px; }
.cr-q { background: #f1f5f9; padding: 8px 12px; border-radius: 8px;
  font-weight: 600; margin-bottom: 6px; }
.cr-a { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1;
  border-radius: 6px; font: inherit; min-height: 70px; resize: vertical;
  margin-bottom: 12px; }
.cr-actions { display: flex; gap: 8px; justify-content: flex-end; }
.cr-btn { font: inherit; padding: 8px 14px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; }
.cr-btn-primary { background: #0f172a; color: #fff; }
.cr-btn-secondary { background: #fff; color: #0f172a; border-color: #cbd5e1; }
.cr-preview { display: grid; gap: 12px; }
.cr-section { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
.cr-section h4 { margin: 0 0 6px; font-size: 13px; font-weight: 700; color: #475569; }
.cr-section textarea { width: 100%; padding: 6px 8px; border: 1px solid #cbd5e1;
  border-radius: 6px; font: inherit; min-height: 80px; resize: vertical; }
.cr-caption-row { display: flex; gap: 6px; align-items: flex-start;
  padding: 6px 0; border-top: 1px solid #f1f5f9; }
.cr-caption-row:first-of-type { border-top: 0; }
.cr-caption-row textarea { flex: 1; min-height: 50px; }
.cr-loading { padding: 30px; text-align: center; color: #64748b; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'cr-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

async function callChronicler(trip, answers) {
  if (!backend.isConfigured() || !backend.isAuthenticated()) {
    throw new Error('Conecte o backend Supabase + faça login antes de usar o Cronista.');
  }
  const cfg = backend.getConfig();
  const session = backend.getSession();
  const res = await fetch(`${cfg.url}/functions/v1/chronicler`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: cfg.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      trip: { name: trip.name, country: trip.country, dates: trip.dates },
      answers,
    }),
  });
  if (!res.ok) throw new Error(`Cronista: ${res.status} ${await res.text()}`);
  return res.json();
}

// Aplica o output ao trip e devolve o objeto atualizado (sem commitar).
export function applyChronicleToTrip(trip, chronicle) {
  const out = JSON.parse(JSON.stringify(trip));
  if (chronicle.memory) out.memory = chronicle.memory;
  if (Array.isArray(chronicle.highlights)) out.highlights = chronicle.highlights;
  if (chronicle.logistics_tips) {
    out.logistics = out.logistics || {};
    out.logistics.tips = chronicle.logistics_tips;
  }
  if (Array.isArray(chronicle.instagram_captions)) {
    out.notes = out.notes || {};
    out.notes.instagram_captions = chronicle.instagram_captions;
  }
  out.status = 'done';
  out.updated_at = new Date().toISOString();
  return out;
}

export async function openChroniclerModal(trip, { onSave } = {}) {
  ensureCss();
  const overlay = document.createElement('div');
  overlay.className = 'cr-overlay';
  const modal = document.createElement('div');
  modal.className = 'cr-modal';
  modal.innerHTML = `
    <div class="cr-header">
      <strong>📝 Cronista — ${trip.name || trip.id}</strong>
      <button id="cr-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div id="cr-body" class="cr-body"></div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#cr-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  const body = modal.querySelector('#cr-body');
  renderInterview();

  function renderInterview() {
    body.innerHTML = `
      <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
        Responda 4 perguntas curtas. Pode pular qualquer uma (deixe em branco).
      </p>
      ${QUESTIONS.map(
        (q) => `
        <div class="cr-q">${q.q}</div>
        <textarea class="cr-a" data-q="${q.id}" placeholder="..."></textarea>
      `
      ).join('')}
      <div class="cr-actions">
        <button id="cr-cancel" class="cr-btn cr-btn-secondary" type="button">Cancelar</button>
        <button id="cr-gen" class="cr-btn cr-btn-primary" type="button">Gerar memória</button>
      </div>
    `;
    body.querySelector('#cr-cancel').addEventListener('click', () => overlay.remove());
    body.querySelector('#cr-gen').addEventListener('click', async () => {
      const answers = QUESTIONS.map((q) => ({
        question: q.q,
        answer: body.querySelector(`[data-q="${q.id}"]`).value.trim(),
      })).filter((a) => a.answer);
      if (!answers.length) {
        alert('Responda ao menos uma pergunta.');
        return;
      }
      body.innerHTML = '<div class="cr-loading">Gerando memória, highlights e legendas via Claude Sonnet…</div>';
      try {
        const chronicle = await callChronicler(trip, answers);
        renderPreview(chronicle);
      } catch (e) {
        body.innerHTML = `<p style="color:#b91c1c;">Erro: ${e.message}</p>`;
      }
    });
  }

  function renderPreview(chronicle) {
    body.innerHTML = `
      <div class="cr-preview">
        <div class="cr-section">
          <h4>📓 Memória</h4>
          <textarea id="cr-memory">${escapeHtml(chronicle.memory || '')}</textarea>
        </div>
        <div class="cr-section">
          <h4>⭐ Highlights</h4>
          <textarea id="cr-highlights">${(chronicle.highlights || []).join('\n')}</textarea>
          <small style="color:#94a3b8;">Uma linha por highlight.</small>
        </div>
        <div class="cr-section">
          <h4>🛟 Dica logística</h4>
          <textarea id="cr-tips">${escapeHtml(chronicle.logistics_tips || '')}</textarea>
        </div>
        <div class="cr-section">
          <h4>📱 Legendas para Instagram (3 opções)</h4>
          ${(chronicle.instagram_captions || []).map(
            (cap, i) => `
            <div class="cr-caption-row">
              <strong style="min-width:18px;">${i + 1}.</strong>
              <textarea data-cap="${i}">${escapeHtml(cap)}</textarea>
            </div>
          `
          ).join('')}
        </div>
      </div>
      <div class="cr-actions" style="margin-top:12px;">
        <button id="cr-back" class="cr-btn cr-btn-secondary" type="button">Voltar</button>
        <button id="cr-save" class="cr-btn cr-btn-primary" type="button">Aplicar à viagem</button>
      </div>
    `;
    body.querySelector('#cr-back').addEventListener('click', renderInterview);
    body.querySelector('#cr-save').addEventListener('click', async () => {
      const edited = {
        memory: body.querySelector('#cr-memory').value.trim(),
        highlights: body.querySelector('#cr-highlights').value
          .split('\n').map((l) => l.trim()).filter(Boolean),
        logistics_tips: body.querySelector('#cr-tips').value.trim(),
        instagram_captions: [...body.querySelectorAll('[data-cap]')]
          .map((t) => t.value.trim()).filter(Boolean),
      };
      const next = applyChronicleToTrip(trip, edited);
      try {
        await onSave?.(next);
        overlay.remove();
      } catch (e) {
        alert(`Falha ao salvar: ${e.message}`);
      }
    });
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

export async function run({ trip, onSave } = {}) {
  if (!trip) throw new Error('chronicler.run: trip obrigatório');
  return openChroniclerModal(trip, { onSave });
}
