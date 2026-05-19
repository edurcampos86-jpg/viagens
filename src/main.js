// Bootstrap da v2.0 — Fase 1.
//
// Carregado por <script type="module" src="src/main.js"></script> no index.html.
// Não substitui o app legado (`assets/app.js`); apenas adiciona a camada nova
// (editor inline, persistência via GitHub API, agentes novos) sem reformatar
// o que já existe.
//
// Expõe `window.viagensV2` para inspeção via console.

import { openTripEditor } from './components/trip-editor.js';
import * as settings from './core/settings.js';
import { upsertTrip, deleteTripById, commitMessageFor } from './core/trips-api.js';
import * as customs from './agents/customs.js';
import * as backend from './core/backend.js';
import { openInbox } from './components/inbox.js';
import * as dates from './core/dates.js';

const v2 = (window.viagensV2 = window.viagensV2 || {});
v2.openTripEditor = openTripEditor;
v2.settings = settings;
v2.customs = customs;
v2.backend = backend;
v2.openInbox = openInbox;
v2.dates = dates;

// Captura tokens do magic link assim que carrega.
try {
  backend.captureSessionFromUrl();
} catch (e) {
  console.warn('[v2] captureSessionFromUrl falhou:', e);
}

// ── Fallback: baixa rascunho .json para aplicar manualmente. ────────────
function downloadDraft(trip) {
  const blob = new Blob([JSON.stringify(trip, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `trip-${trip.id || 'novo'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  console.info('[v2] Rascunho exportado:', trip.id);
}

// ── Save handler: usa GitHub API se PAT desbloqueado; senão, baixa rascunho. ──
async function saveTrip(trip) {
  if (settings.isUnlocked()) {
    await upsertTrip({
      token: settings.getToken(),
      trip,
      message: commitMessageFor(trip),
    });
    console.info('[v2] commit criado:', trip.id);
    return { committed: true };
  }
  downloadDraft(trip);
  return { committed: false };
}

async function deleteTrip(id) {
  if (!settings.isUnlocked()) throw new Error('Conecte e desbloqueie o PAT para excluir via API.');
  await deleteTripById({ token: settings.getToken(), id });
  console.info('[v2] commit de exclusão criado:', id);
}

v2.saveTrip = saveTrip;
v2.deleteTrip = deleteTrip;

// ── UI: modal mínimo para configurar/desbloquear PAT. ───────────────────
function openPATModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:20px;border-radius:12px;
    width:min(440px,100%);font:14px Inter,system-ui,sans-serif;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);`;
  const configured = settings.isConfigured();
  modal.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:700;">
      ${configured ? 'Desbloquear PAT' : 'Configurar GitHub PAT'}
    </h2>
    <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
      ${configured
        ? 'Digite sua senha mestra para desbloquear o PAT já configurado.'
        : 'Cole um PAT com escopo <code>contents:write</code> no repo viagens. O token é cifrado com AES-256 (PBKDF2 200k iter) e fica só no seu navegador.'}
    </p>
    ${configured ? '' : `
    <label style="display:block;margin-bottom:8px;">
      <span style="display:block;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">PAT</span>
      <input id="pat-input" type="password" autocomplete="off" placeholder="ghp_… ou github_pat_…" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
    </label>
    `}
    <label style="display:block;margin-bottom:12px;">
      <span style="display:block;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Senha mestra</span>
      <input id="pwd-input" type="password" autocomplete="off" placeholder="8+ caracteres" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
    </label>
    <div id="pat-err" style="color:#991b1b;background:#fef2f2;border:1px solid #fecaca;padding:6px 10px;border-radius:6px;font-size:13px;margin-bottom:8px;display:none;"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;">
      <button id="pat-cancel" type="button" style="font:inherit;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Cancelar</button>
      <div style="display:flex;gap:8px;">
        ${configured ? '<button id="pat-clear" type="button" style="font:inherit;padding:8px 12px;border:1px solid #fecaca;color:#b91c1c;background:#fff;border-radius:6px;cursor:pointer;">Limpar configuração</button>' : ''}
        <button id="pat-submit" type="button" style="font:inherit;padding:8px 14px;border:0;border-radius:6px;background:#0f172a;color:#fff;cursor:pointer;">
          ${configured ? 'Desbloquear' : 'Salvar'}
        </button>
      </div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector('#pat-cancel').addEventListener('click', close);
  const errBox = modal.querySelector('#pat-err');
  const showErr = (m) => {
    errBox.textContent = m;
    errBox.style.display = 'block';
  };

  modal.querySelector('#pat-clear')?.addEventListener('click', () => {
    if (!confirm('Apagar PAT cifrado deste navegador? Você precisará configurar novamente.')) return;
    settings.clear();
    close();
    updateBadge();
  });

  modal.querySelector('#pat-submit').addEventListener('click', async () => {
    const password = modal.querySelector('#pwd-input').value;
    try {
      if (configured) {
        await settings.unlock(password);
      } else {
        const token = modal.querySelector('#pat-input').value.trim();
        await settings.setupPAT(token, password);
      }
      close();
      updateBadge();
    } catch (e) {
      showErr(e.message);
    }
  });
}

async function openCustomsForTrip(trip) {
  const result = await customs.run({ trip });
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;width:min(560px,100%);
    max-height:90vh;overflow:auto;border-radius:12px;padding:16px 20px;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);
    font:14px Inter,system-ui,sans-serif;`;
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  header.innerHTML = `<strong>🛂 Despachante — ${trip.name || trip.id || 'viagem'}</strong>`;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.style.cssText = 'background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;';
  close.addEventListener('click', () => overlay.remove());
  header.appendChild(close);
  const cardBox = document.createElement('div');
  modal.append(header, cardBox);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  customs.renderCustomsCard(cardBox, result);
}

v2.openCustoms = openCustomsForTrip;

function injectFloatingButton() {
  if (document.getElementById('v2-fab-stack')) return;
  const stack = document.createElement('div');
  stack.id = 'v2-fab-stack';
  stack.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9000;
    display:flex;flex-direction:column;gap:8px;align-items:flex-end;`;

  const badge = document.createElement('div');
  badge.id = 'v2-pat-badge';
  badge.style.cssText = `font:600 11px Inter,system-ui,sans-serif;color:#fff;
    background:#475569;padding:4px 10px;border-radius:999px;cursor:pointer;
    box-shadow:0 4px 10px -2px rgba(15,23,42,.3);`;
  badge.addEventListener('click', openPATModal);

  const beBadge = document.createElement('div');
  beBadge.id = 'v2-be-badge';
  beBadge.style.cssText = `font:600 11px Inter,system-ui,sans-serif;color:#fff;
    background:#0891b2;padding:4px 10px;border-radius:999px;cursor:pointer;
    box-shadow:0 4px 10px -2px rgba(15,23,42,.3);`;
  beBadge.textContent = '🛠 Backend & Gmail';
  beBadge.addEventListener('click', openBackendModal);

  const inboxBadge = document.createElement('div');
  inboxBadge.id = 'v2-inbox-badge';
  inboxBadge.style.cssText = `font:600 11px Inter,system-ui,sans-serif;color:#fff;
    background:#7c3aed;padding:4px 10px;border-radius:999px;cursor:pointer;
    box-shadow:0 4px 10px -2px rgba(15,23,42,.3);`;
  inboxBadge.textContent = '📥 Sugestões do Gmail';
  inboxBadge.addEventListener('click', openInbox);

  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.textContent = '+ Nova viagem';
  newBtn.title = 'Adicionar nova viagem (v2 alpha)';
  newBtn.style.cssText = `background:#0f172a;color:#fff;border:0;border-radius:999px;
    padding:12px 18px;font:600 14px Inter,system-ui,sans-serif;
    box-shadow:0 10px 20px -5px rgba(15,23,42,.4);cursor:pointer;`;
  newBtn.addEventListener('click', () => {
    openTripEditor({ mode: 'create', onSave: saveTrip });
  });

  const hint = document.createElement('div');
  hint.style.cssText = `font:500 11px Inter,system-ui,sans-serif;color:#64748b;
    background:#fff;padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;
    box-shadow:0 4px 10px -2px rgba(15,23,42,.1);max-width:240px;text-align:right;`;
  hint.innerHTML = 'Console: <code>viagensV2.openCustoms(trip)</code>';

  stack.appendChild(badge);
  stack.appendChild(beBadge);
  stack.appendChild(inboxBadge);
  stack.appendChild(hint);
  stack.appendChild(newBtn);
  document.body.appendChild(stack);
  updateBadge();
}

function updateBadge() {
  const badge = document.getElementById('v2-pat-badge');
  if (!badge) return;
  if (settings.isUnlocked()) {
    badge.textContent = '🔓 PAT ativo — clique para gerenciar';
    badge.style.background = '#16a34a';
  } else if (settings.isConfigured()) {
    badge.textContent = '🔒 PAT configurado — clique p/ desbloquear';
    badge.style.background = '#ca8a04';
  } else {
    badge.textContent = '⚙ Configurar PAT (commit automático)';
    badge.style.background = '#475569';
  }
}

v2.openPATModal = openPATModal;

// ── Modal de backend (Supabase + Gmail) ────────────────────────────────
function openBackendModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:20px;border-radius:12px;
    width:min(480px,100%);font:14px Inter,system-ui,sans-serif;max-height:90vh;overflow:auto;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);`;
  const cfg = backend.getConfig();
  const authed = backend.isAuthenticated();
  modal.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:700;">Backend de integrações</h2>
    <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
      Opcional. Conecte um projeto Supabase para habilitar Gmail/preços/etc.
      Sem isso, o site funciona em modo só-memória + commits via PAT.
    </p>
    <fieldset style="border:1px solid #e2e8f0;padding:12px;border-radius:8px;margin-bottom:12px;">
      <legend style="font-size:12px;color:#475569;padding:0 6px;">1. Conexão Supabase</legend>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;font-size:11px;color:#475569;margin-bottom:2px;">URL do projeto</span>
        <input id="be-url" type="url" placeholder="https://xxxxx.supabase.co"
          value="${cfg?.url || ''}"
          style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
      </label>
      <label style="display:block;margin-bottom:8px;">
        <span style="display:block;font-size:11px;color:#475569;margin-bottom:2px;">Anon key (pública)</span>
        <input id="be-anon" type="text" placeholder="eyJhbGciOi..."
          value="${cfg?.anonKey || ''}"
          style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;font-family:monospace;font-size:11px;"/>
      </label>
      <button id="be-save" type="button" style="font:inherit;padding:6px 12px;border:0;border-radius:6px;background:#0f172a;color:#fff;cursor:pointer;">Salvar conexão</button>
      ${cfg ? '<button id="be-clear" type="button" style="font:inherit;padding:6px 12px;border:1px solid #fecaca;color:#b91c1c;border-radius:6px;background:#fff;margin-left:6px;cursor:pointer;">Desconectar</button>' : ''}
    </fieldset>
    ${cfg ? `
    <fieldset style="border:1px solid #e2e8f0;padding:12px;border-radius:8px;margin-bottom:12px;">
      <legend style="font-size:12px;color:#475569;padding:0 6px;">2. Login (magic link)</legend>
      ${authed ? `
        <div style="font-size:13px;color:#16a34a;">Sessão ativa.</div>
        <button id="be-signout" type="button" style="margin-top:6px;font:inherit;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Sair</button>
      ` : `
        <label style="display:block;margin-bottom:6px;">
          <span style="display:block;font-size:11px;color:#475569;">Seu e-mail</span>
          <input id="be-email" type="email" placeholder="voce@exemplo.com" style="width:100%;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
        </label>
        <button id="be-magic" type="button" style="font:inherit;padding:6px 12px;border:0;border-radius:6px;background:#0f172a;color:#fff;cursor:pointer;">Enviar magic link</button>
      `}
    </fieldset>
    ${authed ? `
    <fieldset style="border:1px solid #e2e8f0;padding:12px;border-radius:8px;">
      <legend style="font-size:12px;color:#475569;padding:0 6px;">3. Conectar Gmail</legend>
      <p style="margin:0 0 6px;font-size:13px;color:#475569;">Scope <code>gmail.readonly</code>. Tokens ficam cifrados no Supabase.</p>
      <button id="be-gmail" type="button" style="font:inherit;padding:6px 12px;border:0;border-radius:6px;background:#dc2626;color:#fff;cursor:pointer;">Conectar Gmail →</button>
    </fieldset>
    ` : ''}
    ` : ''}
    <div id="be-err" style="color:#991b1b;background:#fef2f2;border:1px solid #fecaca;padding:6px 10px;border-radius:6px;font-size:13px;margin-top:8px;display:none;"></div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px;">
      <button id="be-close" type="button" style="font:inherit;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Fechar</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#be-close').addEventListener('click', close);

  const err = modal.querySelector('#be-err');
  const showErr = (m) => { err.textContent = m; err.style.display = 'block'; };

  modal.querySelector('#be-save').addEventListener('click', () => {
    try {
      backend.setConfig({
        url: modal.querySelector('#be-url').value.trim(),
        anonKey: modal.querySelector('#be-anon').value.trim(),
      });
      close();
      openBackendModal();
    } catch (e) { showErr(e.message); }
  });
  modal.querySelector('#be-clear')?.addEventListener('click', () => {
    if (!confirm('Remover configuração do backend?')) return;
    backend.clearConfig();
    close();
    updateBadge();
  });
  modal.querySelector('#be-magic')?.addEventListener('click', async () => {
    const email = modal.querySelector('#be-email').value.trim();
    if (!email) return showErr('E-mail obrigatório');
    try {
      await backend.signInWithEmail(email);
      showErr('Magic link enviado — verifique seu e-mail. Após o clique você volta para cá autenticado.');
    } catch (e) { showErr(e.message); }
  });
  modal.querySelector('#be-signout')?.addEventListener('click', () => {
    backend.signOut();
    close();
    openBackendModal();
  });
  modal.querySelector('#be-gmail')?.addEventListener('click', () => {
    try {
      window.location.href = backend.buildGmailOAuthStartUrl();
    } catch (e) { showErr(e.message); }
  });
}

v2.openBackendModal = openBackendModal;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectFloatingButton);
} else {
  injectFloatingButton();
}
