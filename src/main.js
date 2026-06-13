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
import * as anthropicKey from './core/anthropic-key.js';
import { upsertTrip, deleteTripById, commitMessageFor } from './core/trips-api.js';
import * as customs from './agents/customs.js';
import * as priceHunter from './agents/price-hunter.js';
import * as concierge from './agents/concierge.js';
import * as chronicler from './agents/chronicler.js';
import * as syncQueue from './pwa/sync-queue.js';
import * as push from './pwa/push.js';
import * as backend from './core/backend.js';
import { openInbox } from './components/inbox.js';
import { openStatementImport } from './components/statement-import.js';
import { openPhotosPicker } from './components/photos-picker.js';
import { openMemoryMode } from './components/memory-mode.js';
import { mountIdeasButton, openBacklogCapture, openBacklogView } from './components/backlog.js';
import { openCloudinaryPicker } from './components/cloudinary-picker.js';
import * as dates from './core/dates.js';
import { renderHeatmap, computeYearData } from './components/heatmap.js';
import {
  openDecisionMatrix,
  computeScores,
  attachDecisionToTrip,
} from './components/decision-matrix.js';
import { initReadinessBadges } from './components/readiness-badge.js';

const v2 = (window.viagensV2 = window.viagensV2 || {});
v2.openTripEditor = openTripEditor;
v2.settings = settings;
v2.customs = customs;
v2.priceHunter = priceHunter;
v2.concierge = concierge;
v2.chronicler = chronicler;
v2.syncQueue = syncQueue;
v2.push = push;
v2['concierge'] = (trip) => concierge.openConciergeModal(trip, {
  onSave: async (next) => {
    if (settings.isUnlocked()) {
      await upsertTrip({ token: settings.getToken(), trip: next });
      alert('Itinerário salvo e commitado em trips.json!');
    } else {
      const blob = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trip-${next.id}-itinerario.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      alert('PAT não desbloqueado — rascunho baixado. Aplique manualmente.');
    }
  },
});
v2['price-hunter'] = (_trip) => priceHunter.openPriceHunterModal();
v2['customs'] = (trip) => customs.run({ trip }).then(() => openCustomsForTrip(trip));
v2['chronicler'] = (trip) => chronicler.openChroniclerModal(trip, {
  onSave: async (next) => {
    if (settings.isUnlocked()) {
      await upsertTrip({ token: settings.getToken(), trip: next });
      alert('Memória salva e commitada!');
    } else {
      const blob = new Blob([JSON.stringify(next, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trip-${next.id}-cronista.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      alert('PAT não desbloqueado — rascunho baixado. Aplique manualmente.');
    }
  },
});
v2.backend = backend;
v2.openInbox = openInbox;
v2.openStatementImport = (opts) => openStatementImport({ onSave: saveTrip, ...opts });
v2.openPhotosPicker = (opts) => openPhotosPicker({ onSave: saveTrip, ...opts });
v2.openCloudinaryPicker = (opts) => openCloudinaryPicker({ onSave: saveTrip, onRequireAuth: openPATModal, ...opts });
v2.openMemoryMode = (opts) => openMemoryMode(opts);
v2.openBacklog = (opts) => openBacklogView({ onRequireAuth: openPATModal, ...opts });
v2.openBacklogCapture = (opts) => openBacklogCapture({ onRequireAuth: openPATModal, ...opts });
v2.dates = dates;
v2.renderHeatmap = renderHeatmap;
v2.computeYearData = computeYearData;
v2.openDecisionMatrix = openDecisionMatrix;
v2.computeScores = computeScores;
v2.attachDecisionToTrip = attachDecisionToTrip;

// Captura tokens do magic link assim que carrega.
try {
  backend.captureSessionFromUrl();
} catch (e) {
  console.warn('[v2] captureSessionFromUrl falhou:', e);
}

// Registra o Service Worker v2 (Workbox) — substitui o sw.js antigo.
// PR #1.5B: script movido para a raiz para que o scope /viagens/ seja permitido
// (path do GitHub Pages; serve como / no domínio próprio vidacarreira.com.br).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw-workbox.js', { scope: './' })
      .then((reg) => {
        console.info('[v2] SW Workbox registrado:', reg.scope);
      })
      .catch((e) => console.warn('[v2] SW Workbox registration failed:', e));
  });

  // Listener PR #1.5B: detecta nova versão do SW ativada e oferece reload.
  // Ignora a PRIMEIRA mensagem 'sw-activated' (instalação inicial — sem versão
  // antiga, não há nada a "atualizar"). A segunda em diante indica deploy novo.
  let _swActivatedSeen = false;

  navigator.serviceWorker.addEventListener('message', async (e) => {
    // Sync offline: SW dispara 'flush-edit-queue' quando o app volta online.
    if (e.data?.type === 'flush-edit-queue' && settings.isUnlocked()) {
      const result = await syncQueue.flush(async (op) => {
        if (op.kind === 'upsert') {
          await upsertTrip({ token: settings.getToken(), trip: op.trip, message: op.message });
        } else if (op.kind === 'delete') {
          await deleteTripById({ token: settings.getToken(), id: op.id, message: op.message });
        }
      });
      if (result.processed) {
        console.info(`[v2] sync queue: ${result.processed} drenadas, ${result.remaining} restantes.`);
      }
      return;
    }
    // Update available: SW novo entrou em activate e expulsou o anterior.
    if (e.data?.type === 'sw-activated') {
      if (!_swActivatedSeen) {
        _swActivatedSeen = true;
        return;
      }
      console.info('[v2] Nova versão do SW disponível:', e.data.version);
      showUpdateAvailableToast();
    }
  });
}

// Toast "Nova versão disponível" — exibido após receber 'sw-activated' do SW.
function showUpdateAvailableToast() {
  if (document.querySelector('#sw-update-toast')) return;
  const el = document.createElement('div');
  el.id = 'sw-update-toast';
  el.style.cssText = [
    'position:fixed', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
    'background:#0f172a', 'color:#fff', 'padding:12px 18px', 'border-radius:8px',
    'font:14px Inter,system-ui,sans-serif', 'z-index:10000',
    'box-shadow:0 10px 25px rgba(0,0,0,.3)',
    'display:flex', 'gap:12px', 'align-items:center',
  ].join(';');
  el.innerHTML = `
    <span>🔄 Nova versão disponível</span>
    <button id="sw-reload-btn" style="background:#f1f5f9;color:#0f172a;border:none;padding:6px 12px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer">Recarregar</button>
    <button id="sw-dismiss-btn" style="background:transparent;color:#94a3b8;border:none;padding:6px;cursor:pointer;font-size:18px" aria-label="Fechar">×</button>
  `;
  document.body.appendChild(el);
  el.querySelector('#sw-reload-btn').addEventListener('click', () => location.reload());
  el.querySelector('#sw-dismiss-btn').addEventListener('click', () => el.remove());
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
    if (!navigator.onLine) {
      // Offline: enfileira para retentar quando voltar
      await syncQueue.enqueue({
        kind: 'upsert',
        trip,
        message: commitMessageFor(trip),
      });
      await syncQueue.requestSync();
      console.info('[v2] offline — viagem enfileirada para sync:', trip.id);
      return { committed: false, queued: true };
    }
    try {
      await upsertTrip({
        token: settings.getToken(),
        trip,
        message: commitMessageFor(trip),
      });
      console.info('[v2] commit criado:', trip.id);
      return { committed: true };
    } catch (e) {
      // Falha de rede transitória: enfileira
      if (e.message?.includes('NetworkError') || e.message?.includes('fetch')) {
        await syncQueue.enqueue({
          kind: 'upsert',
          trip,
          message: commitMessageFor(trip),
        });
        await syncQueue.requestSync();
        return { committed: false, queued: true };
      }
      throw e;
    }
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

function openAnthropicKeyModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:20px;border-radius:12px;
    width:min(440px,100%);font:14px Inter,system-ui,sans-serif;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);`;
  const configured = anthropicKey.isConfigured();
  modal.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:16px;font-weight:700;">
      ${configured ? '🔓 Desbloquear chave Anthropic' : '🔐 Configurar chave Anthropic'}
    </h2>
    <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
      ${configured
        ? 'Digite sua senha mestra para desbloquear a chave Anthropic configurada.'
        : 'Cole sua chave Anthropic (sk-ant-…). Cifrada em AES-256 (PBKDF2 200k iter), fica só neste navegador. Usada pelo Concierge (Opus ~$0.30/itinerário).'}
    </p>
    ${configured ? '' : `
    <label style="display:block;margin-bottom:8px;">
      <span style="display:block;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Chave Anthropic</span>
      <input id="ak-input" type="password" autocomplete="off" placeholder="sk-ant-…" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
    </label>
    `}
    <label style="display:block;margin-bottom:12px;">
      <span style="display:block;font-size:12px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Senha mestra</span>
      <input id="ak-pwd" type="password" autocomplete="off" placeholder="8+ caracteres" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font:inherit;"/>
    </label>
    <div id="ak-err" style="color:#991b1b;background:#fef2f2;border:1px solid #fecaca;padding:6px 10px;border-radius:6px;font-size:13px;margin-bottom:8px;display:none;"></div>
    <div style="display:flex;gap:8px;justify-content:space-between;">
      <button id="ak-cancel" type="button" style="font:inherit;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">Cancelar</button>
      <div style="display:flex;gap:8px;">
        ${configured ? '<button id="ak-clear" type="button" style="font:inherit;padding:8px 12px;border:1px solid #fecaca;color:#b91c1c;background:#fff;border-radius:6px;cursor:pointer;">Limpar</button>' : ''}
        <button id="ak-submit" type="button" style="font:inherit;padding:8px 14px;border:0;border-radius:6px;background:#0f172a;color:#fff;cursor:pointer;">
          ${configured ? 'Desbloquear' : 'Salvar'}
        </button>
      </div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('#ak-cancel').addEventListener('click', close);
  const errBox = modal.querySelector('#ak-err');
  const showErr = (m) => { errBox.textContent = m; errBox.style.display = 'block'; };

  modal.querySelector('#ak-clear')?.addEventListener('click', () => {
    if (!confirm('Apagar chave Anthropic cifrada deste navegador?')) return;
    anthropicKey.clear();
    close();
    updateAnthropicBadge();
  });

  modal.querySelector('#ak-submit').addEventListener('click', async () => {
    const password = modal.querySelector('#ak-pwd').value;
    try {
      if (configured) {
        await anthropicKey.unlock(password);
      } else {
        const key = modal.querySelector('#ak-input').value.trim();
        await anthropicKey.setupKey(key, password);
      }
      close();
      updateAnthropicBadge();
    } catch (e) {
      showErr(e.message);
    }
  });
}

function updateAnthropicBadge() {
  const badge = document.getElementById('v2-anthropic-badge');
  if (!badge) return;
  if (anthropicKey.isUnlocked()) {
    badge.textContent = '🔓 Anthropic ativa';
    badge.title = 'Chave Anthropic desbloqueada. Concierge pode gerar itinerários.';
    badge.style.background = '#1e40af';
  } else if (anthropicKey.isConfigured()) {
    badge.textContent = '🔒 Anthropic';
    badge.title = 'Chave cifrada no localStorage. Clique p/ desbloquear com a senha mestra.';
    badge.style.background = '#ca8a04';
  } else {
    badge.textContent = '🔐 Anthropic';
    badge.title = 'Configurar chave Anthropic para ativar o Concierge (Claude Opus 4.7).';
    badge.style.background = '#475569';
  }
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

// Cada badge: { id, emoji, label, tooltip, color, onClick }
const FAB_BADGES = [
  {
    id: 'v2-help-badge',
    emoji: '❓',
    label: 'Como usar v2',
    tooltip: 'Guia rápido: o que cada botão faz, os 7 agentes, modos de operação.',
    color: '#0f172a',
    onClick: () => openHelpModal(),
  },
  {
    id: 'v2-pat-badge', // texto/cor mudam dinamicamente via updateBadge()
    emoji: '⚙',
    label: 'Configurar PAT',
    tooltip: 'Configurar GitHub PAT para commitar viagens automaticamente. Cifrado AES-256.',
    color: '#475569',
    onClick: () => openPATModal(),
  },
  {
    id: 'v2-anthropic-badge', // texto/cor mudam via updateAnthropicBadge()
    emoji: '🔐',
    label: 'Anthropic',
    tooltip: 'Configurar chave Anthropic para ativar o Concierge (Claude Opus 4.7). Cifrada AES-256.',
    color: '#475569',
    onClick: () => openAnthropicKeyModal(),
  },
  {
    id: 'v2-be-badge',
    emoji: '🛠',
    label: 'Backend & Gmail',
    tooltip: 'Conectar Supabase + Gmail OAuth (readonly) para extrair reservas de e-mails automaticamente.',
    color: '#0891b2',
    onClick: () => openBackendModal(),
  },
  {
    id: 'v2-inbox-badge',
    emoji: '📥',
    label: 'Sugestões do Gmail',
    tooltip: 'Bandeja de reservas extraídas (Curador). Aprove para aplicar à viagem.',
    color: '#7c3aed',
    onClick: () => openInbox(),
  },
  {
    id: 'v2-statement-badge',
    emoji: '🧾',
    label: 'Importar extrato',
    tooltip: 'Importar extrato bancário (OFX/CSV), reconciliar com bookings e registrar custos reais.',
    color: '#0e7490',
    onClick: () => openStatementImport({ onSave: saveTrip }),
  },
  {
    id: 'v2-photos-badge',
    emoji: '📸',
    label: 'Fotos do Google',
    tooltip: 'Importar fotos/vídeos do Google Photos (Picker) para o álbum da viagem. Você escolhe lá; aqui só entra a sua seleção.',
    color: '#b45309',
    onClick: () => openPhotosPicker({ onSave: saveTrip }),
  },
  {
    id: 'v2-cloudinary-badge',
    emoji: '📱',
    label: 'iPhone → CDN',
    tooltip: 'Subir fotos/vídeos do iPhone (Camera Roll) para o Cloudinary (CDN) e gravar como memórias. O vídeo fica no CDN; só um poster leve entra no repo.',
    color: '#0284c7',
    onClick: () => openCloudinaryPicker({ onSave: saveTrip, onRequireAuth: openPATModal }),
  },
  {
    id: 'v2-memory-badge',
    emoji: '🎞',
    label: 'Modo Memória',
    tooltip: 'Palco cinematográfico: reviva as memórias da viagem (álbum media.gallery) com Ambilight, crossfade e anel de tempo. Só visualização.',
    color: '#4338ca',
    onClick: () => openMemoryMode(),
  },
  {
    id: 'v2-heatmap-badge',
    emoji: '📅',
    label: 'Heatmap anual',
    tooltip: 'Calendário tipo GitHub: dias em casa vs nacionais vs internacionais por ano.',
    color: '#15803d',
    onClick: () => openHeatmapModal(),
  },
  {
    id: 'v2-decision-badge',
    emoji: '🧭',
    label: 'Matriz de decisão',
    tooltip: 'Compare opções (ex: Dolomitas vs Ibiza) com critérios ponderados.',
    color: '#ea580c',
    onClick: () =>
      openDecisionMatrix({
        onSave: (decision) => {
          console.info('[v2] decisão salva:', decision);
          alert('Decisão registrada localmente. Para anexar a uma viagem, use viagensV2.attachDecisionToTrip(trip, decision).');
        },
      }),
  },
  {
    id: 'v2-price-badge',
    emoji: '💸',
    label: 'Otimizador de Bolso',
    tooltip: 'Histórico de alertas de queda de preço dos voos planejados (precisa backend).',
    color: '#be185d',
    onClick: () => priceHunter.openPriceHunterModal(),
  },
];

function injectFloatingButton() {
  if (document.getElementById('v2-fab-stack')) return;
  const stack = document.createElement('div');
  stack.id = 'v2-fab-stack';
  stack.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:9000;
    display:flex;flex-direction:column;gap:6px;align-items:flex-end;
    max-width:280px;`;

  for (const b of FAB_BADGES) {
    const node = document.createElement('button');
    node.type = 'button';
    node.id = b.id;
    node.title = b.tooltip;
    node.setAttribute('aria-label', b.tooltip);
    node.style.cssText = `font:600 11px Inter,system-ui,sans-serif;color:#fff;
      background:${b.color};padding:5px 11px;border:0;border-radius:999px;
      cursor:pointer;box-shadow:0 4px 10px -2px rgba(15,23,42,.3);
      display:flex;align-items:center;gap:5px;`;
    node.textContent = `${b.emoji} ${b.label}`;
    node.addEventListener('click', b.onClick);
    stack.appendChild(node);
  }

  // CTA principal — fica embaixo, maior e destacado
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.id = 'v2-new-trip-fab';
  newBtn.textContent = '+ Nova viagem';
  newBtn.title = 'Adicionar nova viagem com auto-complete de cidade e checklist contextual.';
  newBtn.style.cssText = `background:#0f172a;color:#fff;border:0;border-radius:999px;
    padding:12px 18px;font:600 14px Inter,system-ui,sans-serif;
    box-shadow:0 10px 20px -5px rgba(15,23,42,.4);cursor:pointer;
    margin-top:4px;`;
  newBtn.addEventListener('click', () => {
    openTripEditor({ mode: 'create', onSave: saveTrip });
  });
  stack.appendChild(newBtn);

  document.body.appendChild(stack);
  updateBadge();
  updateAnthropicBadge();
}

function updateBadge() {
  const badge = document.getElementById('v2-pat-badge');
  if (!badge) return;
  if (settings.isUnlocked()) {
    badge.textContent = '🔓 PAT ativo';
    badge.title = 'Token desbloqueado. Cada salvar gera commit automático no GitHub.';
    badge.style.background = '#16a34a';
  } else if (settings.isConfigured()) {
    badge.textContent = '🔒 PAT configurado';
    badge.title = 'PAT cifrado no localStorage. Clique p/ desbloquear com a senha mestra.';
    badge.style.background = '#ca8a04';
  } else {
    badge.textContent = '⚙ Configurar PAT';
    badge.title = 'Configurar GitHub PAT para commitar viagens automaticamente. Cifrado AES-256.';
    badge.style.background = '#475569';
  }
}

v2.openPATModal = openPATModal;
v2.openAnthropicKeyModal = openAnthropicKeyModal;
v2.anthropicKey = anthropicKey;

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

// ── Heatmap modal (F3.1) ───────────────────────────────────────────────
async function openHeatmapModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:20px;border-radius:12px;
    width:min(820px,100%);max-height:90vh;overflow:auto;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);font:14px Inter,system-ui,sans-serif;`;
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <strong>📅 Heatmap anual de viagens</strong>
      <button id="hm-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div id="hm-content">Carregando…</div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#hm-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);

  try {
    const res = await fetch('data/trips.json', { cache: 'no-cache' });
    const data = await res.json();
    renderHeatmap(modal.querySelector('#hm-content'), { trips: data.trips });
  } catch (e) {
    modal.querySelector('#hm-content').textContent = `Erro: ${e.message}`;
  }
}
v2.openHeatmap = openHeatmapModal;

// ── Modal de ajuda — autoexplicabilidade da v2 ────────────────────────
function openHelpModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(15,23,42,.55);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;
  const modal = document.createElement('div');
  modal.style.cssText = `background:#fff;color:#0f172a;padding:0;border-radius:12px;
    width:min(720px,100%);max-height:90vh;overflow:auto;
    box-shadow:0 25px 50px -12px rgba(0,0,0,.35);font:14px Inter,system-ui,sans-serif;`;

  const modeBadge = (() => {
    if (settings.isUnlocked() && backend.isAuthenticated()) {
      return { label: '🎯 Modo completo', desc: 'PAT desbloqueado + backend conectado. Tudo ativo.', color: '#16a34a' };
    }
    if (settings.isUnlocked()) {
      return { label: '✏ Modo autenticado local', desc: 'CRUD inline e commit automático ativos. Backend desligado.', color: '#0891b2' };
    }
    if (backend.isAuthenticated()) {
      return { label: '🛠 Backend só', desc: 'Magic link OK, mas PAT não desbloqueado — escritas vão pro download.', color: '#ca8a04' };
    }
    return { label: '👀 Modo público (somente leitura)', desc: 'Você está como qualquer visitante. Configure PAT/Backend abaixo para ativar edição.', color: '#475569' };
  })();

  modal.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;
      display:flex;justify-content:space-between;align-items:center;">
      <div>
        <strong style="font-size:16px;">❓ Como usar — Portal de Viagens v2.0</strong>
        <div style="margin-top:4px;">
          <span style="display:inline-block;padding:2px 10px;border-radius:999px;
            background:${modeBadge.color};color:#fff;font-size:11px;font-weight:600;">${modeBadge.label}</span>
          <span style="font-size:12px;color:#64748b;margin-left:8px;">${modeBadge.desc}</span>
        </div>
      </div>
      <button id="help-close" type="button" style="background:transparent;border:0;font-size:22px;cursor:pointer;color:#64748b;">×</button>
    </div>
    <div style="padding:16px 20px;display:grid;gap:14px;">
      <section>
        <h3 style="margin:0 0 6px;font-size:14px;">🚀 Por onde começar</h3>
        <ol style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;">
          <li><strong>Quer só ver as viagens?</strong> Você já está aí — mapa, timeline e cards funcionam sem login.</li>
          <li><strong>Quer adicionar/editar viagem?</strong> Clique <code>⚙ Configurar PAT</code> → cole um GitHub PAT com escopo <code>contents:write</code> + senha mestra. Depois clique <code>+ Nova viagem</code>.</li>
          <li><strong>Quer Gmail + agentes Claude?</strong> Configure também o <code>🛠 Backend & Gmail</code> (precisa do projeto Supabase deployado — ver <code>docs/DEPLOY.md</code>).</li>
        </ol>
      </section>

      <section>
        <h3 style="margin:0 0 6px;font-size:14px;">🤖 Os 7 agentes</h3>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:13px;">
          <div>🧳</div><div><strong>Bagagem</strong> — Sugere itens com base em clima e duração. Dentro do app legacy.</div>
          <div>💡</div><div><strong>Inspiração</strong> — Recomenda próximos destinos. Dentro do app legacy.</div>
          <div>🛂</div><div><strong>Despachante Digital</strong> — Due diligence: passaporte 6 meses, visto, vacinas, voltagem, direção. Roda no editor de qualquer viagem internacional. Console: <code>viagensV2.customs(trip)</code>.</div>
          <div>📥</div><div><strong>Curador de E-mail</strong> — Lê Gmail (readonly), extrai reservas. Bandeja em <code>📥 Sugestões do Gmail</code>.</div>
          <div>💸</div><div><strong>Otimizador de Bolso</strong> — Monitora preços de voos planejados (Kiwi Tequila). Alerta queda &gt; 10% ou data ±2 dias &gt; 15% mais barata. Em <code>💸 Otimizador</code>.</div>
          <div>🍽️</div><div><strong>Concierge Local</strong> — Gera itinerário 7 dias com base no estilo histórico. Botão no wizard temporal do editor. Usa Claude Sonnet.</div>
          <div>📝</div><div><strong>Cronista da Memória</strong> — Entrevista pós-viagem (4 perguntas), gera memória + 3 legendas Instagram. Disparado pelo wizard quando trip está <code>done</code>.</div>
        </div>
      </section>

      <section>
        <h3 style="margin:0 0 6px;font-size:14px;">🗺 O que cada botão do canto faz</h3>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:13px;">
          <div>❓</div><div>Este painel de ajuda.</div>
          <div>⚙/🔒/🔓</div><div>Gerenciar PAT do GitHub (verde = ativo).</div>
          <div>🛠</div><div>Configurar Supabase + magic link + Conectar Gmail.</div>
          <div>📥</div><div>Bandeja de reservas extraídas do Gmail aguardando aprovação.</div>
          <div>📅</div><div>Heatmap anual: 365 dias coloridos por status (em casa/nacional/intl).</div>
          <div>🧭</div><div>Matriz de decisão multicritério. Standalone (não exige trip).</div>
          <div>💸</div><div>Histórico de alertas de queda de preço.</div>
          <div>+ Nova viagem</div><div>Editor inline com auto-complete + checklist contextual + wizard temporal + benchmark + orçamento.</div>
        </div>
      </section>

      <section>
        <h3 style="margin:0 0 6px;font-size:14px;">🛡 Princípios de privacidade</h3>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;">
          <li><strong>PAT do GitHub:</strong> cifrado AES-256-GCM com chave derivada da senha mestra via PBKDF2 200k iterações. Senha mestra NUNCA é guardada.</li>
          <li><strong>Gmail OAuth:</strong> escopo exclusivamente <code>gmail.readonly</code> (validado em 3 camadas). Token nunca trafega para o frontend; só o evento estruturado.</li>
          <li><strong>Anthropic API:</strong> header <code>anthropic-no-training: true</code> em 100% das chamadas. Dados não entram em corpus de treino.</li>
          <li><strong>trips.json é a única fonte da verdade:</strong> backend só propõe — toda escrita vira commit auditável no GitHub.</li>
        </ul>
      </section>

      <section>
        <h3 style="margin:0 0 6px;font-size:14px;">💻 Console (para power users)</h3>
        <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;font-size:11px;line-height:1.5;overflow:auto;margin:0;">
viagensV2.openTripEditor({ mode: 'create' })
viagensV2.customs(trip)              // Despachante
viagensV2.concierge(trip)            // Itinerário (precisa backend)
viagensV2.chronicler(trip)           // Memória pós-viagem
viagensV2.openInbox()                // Bandeja Gmail
viagensV2.openHeatmap()              // Visualização anual
viagensV2.attachDecisionToTrip(t, d) // Anexar decisão a uma viagem
viagensV2.settings.isUnlocked()      // PAT status
viagensV2.backend.isAuthenticated()  // Backend status
viagensV2.syncQueue.list()           // Fila offline pendente</pre>
      </section>

      <section style="font-size:12px;color:#64748b;">
        Mais detalhes: <code>README.md</code> · <code>docs/PRD-viagens-v2.md</code> ·
        <code>docs/ARCHITECTURE.md</code> · <code>docs/AGENTS.md</code> ·
        <code>docs/DEPLOY.md</code>
      </section>
    </div>
  `;
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  modal.querySelector('#help-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}
v2.openHelpModal = openHelpModal;

function bootstrapV2() {
  injectFloatingButton();
  // Frente D — botão fixo "💡 Ideias" (borda direita, distinto do FAB stack).
  mountIdeasButton({ onRequireAuth: openPATModal });
  // Radar · Etapa B — selos de prontidão nos cards futuros (aditivo, só leitura).
  try {
    initReadinessBadges();
  } catch (e) {
    console.warn('[v2] initReadinessBadges falhou:', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapV2);
} else {
  bootstrapV2();
}
