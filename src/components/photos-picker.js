// Importador Google Photos Picker — álbum da viagem (media.gallery).
//
// Fluxo: OAuth (GIS token client, escopo SÓ photospicker readonly) → cria
// session no Picker API → usuário escolhe as fotos NO Google Photos (a
// seleção é dele, nunca automática) → poll até mediaItemsSet → lista os
// itens escolhidos → revisão aqui (incluir/excluir, legenda) → "Aplicar":
// baixa cada item (baseUrl expira — por isso persistimos), comprime
// client-side (webp, lado maior 1600px; thumb 320px), commita em
// media/<tripId>/ via putBinaryFile (Contents API, anti-409) e referencia
// em media.gallery com origin:'ajustado' + source_id (dedup em re-imports).
//
// Vídeos: NUNCA entram no repo (bytes via =dv falhavam com "Load failed" e
// estouram a Contents API). Baixamos só o THUMBNAIL do vídeo (baseUrl
// =w800-h800 funciona para VIDEO), commitamos como poster .webp e gravamos
// type:'video_link' com href para o item no Google Photos — o álbum mostra
// o poster com badge ▶ e o clique abre o vídeo lá, em nova aba.
//
// O Client ID é público por design (OAuth implicit p/ SPA — a segurança vem
// do consent + origens autorizadas no Google Cloud, projeto monitor-viagens).

import {
  MAX_GALLERY_ITEMS,
  IMAGE_MAX_DIM,
  THUMB_MAX_DIM,
  durationToMs,
  mediaFilePath,
  thumbFilePath,
  posterFilePath,
  imageDownloadUrl,
  videoPosterDownloadUrl,
  normalizePickerItem,
  galleryItemFromPicker,
  mergeGallery,
  galleryStats,
} from '../core/photos-import.js';
import { getTripsFile, putBinaryFile } from '../core/trips-api.js';
import * as settings from '../core/settings.js';

const GOOGLE_CLIENT_ID =
  '88563707611-q7rni5aj01tj12njdjuk8998ktt6922f.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const PICKER_API = 'https://photospicker.googleapis.com/v1';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let cssInjected = false;
const CSS = `
.pp-overlay { position: fixed; inset: 0; z-index: 9999; padding: 16px;
  background: color-mix(in srgb, var(--vc-ink) 55%, transparent);
  display: flex; align-items: center; justify-content: center; }
.pp-modal { background: var(--vc-paper); color: var(--vc-ink);
  width: min(960px, 100%); max-height: 92vh; overflow: auto;
  border-radius: 12px; font: 14px var(--vc-font-ui);
  box-shadow: 0 25px 50px -12px color-mix(in srgb, var(--vc-ink) 40%, transparent); }
.pp-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--vc-paper-3);
  position: sticky; top: 0; background: var(--vc-paper); z-index: 1; }
.pp-close { background: transparent; border: 0; font-size: 22px; cursor: pointer;
  color: var(--vc-ink-soft); }
.pp-body { padding: 16px 20px; display: grid; gap: 14px; }
.pp-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
.pp-field { display: grid; gap: 4px; font-size: 12px; color: var(--vc-ink-soft); }
.pp-field select { font: inherit; color: var(--vc-ink); background: var(--vc-paper);
  border: 1px solid var(--vc-ink-faint); border-radius: 6px; padding: 6px 8px; }
.pp-status { border-radius: 8px; padding: 8px 12px; font-size: 13px;
  background: var(--vc-paper-2); border: 1px solid var(--vc-paper-3); }
.pp-status.pp-ok { color: var(--vc-material); }
.pp-status.pp-err { color: var(--vc-saude); }
.pp-cta { font: inherit; font-weight: 700; padding: 10px 18px; border: 0;
  border-radius: 8px; cursor: pointer; background: var(--vc-brand-1);
  color: var(--vc-paper); }
.pp-cta[disabled] { opacity: .5; cursor: not-allowed; }
.pp-secondary { font: inherit; padding: 8px 14px; border: 1px solid var(--vc-ink-faint);
  border-radius: 8px; cursor: pointer; background: var(--vc-paper); color: var(--vc-ink); }
.pp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px; }
.pp-card { border: 1px solid var(--vc-paper-3); border-radius: 10px; overflow: hidden;
  background: var(--vc-paper-2); display: grid; gap: 6px; padding-bottom: 8px; }
.pp-card.pp-excluded { opacity: .45; }
.pp-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block;
  background: var(--vc-paper-3); }
.pp-card-meta { display: flex; align-items: center; gap: 6px; padding: 0 8px;
  font-size: 11px; color: var(--vc-ink-soft); }
.pp-card input[type="text"] { font: inherit; font-size: 12px; margin: 0 8px;
  color: var(--vc-ink); background: var(--vc-paper);
  border: 1px solid var(--vc-paper-3); border-radius: 6px; padding: 4px 6px; }
.pp-badge { display: inline-block; font-size: 10px; font-weight: 700;
  padding: 1px 7px; border-radius: 999px; background: var(--vc-trabalho);
  color: var(--vc-paper); }
.pp-actions { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
.pp-note { font-size: 12px; color: var(--vc-ink-soft); }
.pp-progress { font-variant-numeric: tabular-nums; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'pp-css';
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

// ── OAuth (Google Identity Services) ─────────────────────────────────────
let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Falha carregando Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisPromise;
}

// Token só em memória (módulo) — nunca em storage. Expira ~1h; renovamos
// sob demanda com margem de 60s.
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(`OAuth: ${resp.error}${resp.error_description ? ` — ${resp.error_description}` : ''}`));
          return;
        }
        tokenCache = {
          token: resp.access_token,
          expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000,
        };
        resolve(resp.access_token);
      },
      error_callback: (e) => reject(new Error(`OAuth: ${e?.type || 'popup falhou'}`)),
    });
    client.requestAccessToken();
  });
}

// ── Picker API ───────────────────────────────────────────────────────────
async function pickerFetch(token, path, init = {}) {
  const res = await fetch(`${PICKER_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Picker ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const createSession = (token) =>
  pickerFetch(token, '/sessions', { method: 'POST', body: '{}' });
const getSession = (token, id) => pickerFetch(token, `/sessions/${id}`);
const deleteSession = (token, id) =>
  pickerFetch(token, `/sessions/${id}`, { method: 'DELETE' }).catch(() => null);

async function listSelectedItems(token, sessionId) {
  const items = [];
  let pageToken = '';
  do {
    const qs = new URLSearchParams({ sessionId, pageSize: '100' });
    if (pageToken) qs.set('pageToken', pageToken);
    const page = await pickerFetch(token, `/mediaItems?${qs}`);
    for (const raw of page.mediaItems || []) {
      const norm = normalizePickerItem(raw);
      if (norm) items.push(norm);
    }
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return items;
}

// baseUrls exigem o Bearer — <img src> direto não autentica; baixamos blob.
async function fetchMediaBlob(token, url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`download mídia: ${res.status}`);
  return res.blob();
}

// ── Canvas: compressão/poster ────────────────────────────────────────────
async function compressImage(blob, maxDim, quality = 0.82) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    const out = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob retornou null'))),
        'image/webp',
        quality,
      );
    });
    return { blob: out, width: w, height: h };
  } finally {
    bmp.close();
  }
}

// FileReader (chunk-safe) — evita estourar a pilha com String.fromCharCode.
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('falha lendo blob'));
    r.onload = () => resolve(String(r.result).split(',', 2)[1]);
    r.readAsDataURL(blob);
  });
}

// Mesmo padrão do statement-import: com PAT lê via API (estado fresco);
// sem PAT, o trips.json público.
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

// ── Componente ───────────────────────────────────────────────────────────
export function openPhotosPicker({ onSave, defaultTripId = 'sp-junho-2026' } = {}) {
  ensureCss();

  const state = {
    trips: [],
    tripId: null,
    session: null, // { id, pickerUri }
    polling: false,
    items: [], // normalizados + { included, caption, previewUrl }
    applying: false,
    closed: false,
  };

  const overlay = document.createElement('div');
  overlay.className = 'pp-overlay';
  const modal = document.createElement('div');
  modal.className = 'pp-modal';
  modal.innerHTML = `
    <div class="pp-header">
      <strong>📸 Fotos do Google Photos — álbum da viagem</strong>
      <button type="button" class="pp-close" aria-label="Fechar">×</button>
    </div>
    <div class="pp-body">
      <div class="pp-status" hidden></div>
      <div class="pp-main"></div>
    </div>
  `;
  overlay.appendChild(modal);
  const close = () => {
    state.closed = true; // para o polling
    for (const it of state.items) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  modal.querySelector('.pp-close').addEventListener('click', close);
  document.body.appendChild(overlay);

  const statusBox = modal.querySelector('.pp-status');
  const main = modal.querySelector('.pp-main');

  function setStatus(message, kind) {
    statusBox.hidden = false;
    statusBox.innerHTML = message;
    statusBox.className = `pp-status${kind === 'ok' ? ' pp-ok' : kind === 'err' ? ' pp-err' : ''}`;
  }

  function currentTrip() {
    return state.trips.find((t) => t.id === state.tripId) || null;
  }

  // ── Render ────────────────────────────────────────────────────────────
  function render() {
    const trip = currentTrip();
    const existing = trip?.media?.gallery?.length || 0;
    const included = state.items.filter((i) => i.included);
    const room = Math.max(0, MAX_GALLERY_ITEMS - existing);

    main.innerHTML = `
      <div class="pp-row">
        <label class="pp-field">
          <span>Viagem destino do álbum</span>
          <select id="pp-trip">
            ${state.trips
              .map(
                (t) =>
                  `<option value="${esc(t.id)}" ${t.id === state.tripId ? 'selected' : ''}>` +
                  `${esc(t.name || t.id)}</option>`,
              )
              .join('')}
          </select>
        </label>
        <span class="pp-note">álbum atual: ${existing}/${MAX_GALLERY_ITEMS} itens
          ${existing >= MAX_GALLERY_ITEMS ? '— <strong>cheio</strong> (teto do schema)' : `— cabem mais ${room}`}</span>
      </div>
      ${
        !state.session
          ? `<div class="pp-row">
              <button type="button" id="pp-connect" class="pp-cta">Conectar Google Photos</button>
              <span class="pp-note">Escopo mínimo (só itens que VOCÊ escolher no picker).
                Nada é lido além da sua seleção.</span>
            </div>`
          : !state.items.length
            ? `<div class="pp-row">
                <button type="button" id="pp-open" class="pp-cta">Abrir Google Photos para escolher</button>
                <button type="button" id="pp-check" class="pp-secondary">Já escolhi — verificar</button>
                <span class="pp-note">${state.polling ? 'aguardando sua seleção no Google Photos…' : ''}</span>
              </div>`
            : ''
      }
      ${
        state.items.length
          ? `<div class="pp-grid">
              ${state.items.map((it, i) => cardHtml(it, i)).join('')}
            </div>
            <div class="pp-actions">
              <span class="pp-note">
                ${included.length} selecionada(s) → media/${esc(state.tripId || '?')}/ +
                referência em media.gallery (origin:'ajustado').
                ${!settings.isUnlocked() ? '<br/><strong>PAT bloqueado</strong> — desbloqueie (badge ⚙) para commitar as mídias.' : ''}
              </span>
              <button type="button" id="pp-apply" class="pp-cta"
                ${state.applying || !included.length || !settings.isUnlocked() || !trip ? 'disabled' : ''}>
                ${state.applying ? 'Aplicando…' : 'Aplicar à viagem'}
              </button>
            </div>`
          : ''
      }
    `;

    main.querySelector('#pp-trip')?.addEventListener('change', (e) => {
      state.tripId = e.target.value;
      render();
    });
    main.querySelector('#pp-connect')?.addEventListener('click', connect);
    main.querySelector('#pp-open')?.addEventListener('click', () => {
      // window.open síncrono no clique — não cai no popup blocker
      window.open(state.session.pickerUri, '_blank', 'noopener');
      if (!state.polling) pollLoop();
    });
    main.querySelector('#pp-check')?.addEventListener('click', checkOnce);
    main.querySelector('#pp-apply')?.addEventListener('click', applyToTrip);
    main.querySelectorAll('[data-inc]').forEach((el) =>
      el.addEventListener('change', () => {
        state.items[Number(el.getAttribute('data-inc'))].included = el.checked;
        render();
      }),
    );
    main.querySelectorAll('[data-cap]').forEach((el) =>
      el.addEventListener('change', () => {
        state.items[Number(el.getAttribute('data-cap'))].caption = el.value.trim();
      }),
    );
  }

  function cardHtml(it, i) {
    return `<div class="pp-card ${it.included ? '' : 'pp-excluded'}">
      <img src="${esc(it.previewUrl || '')}" alt="${esc(it.filename)}" loading="lazy"/>
      <div class="pp-card-meta">
        <input type="checkbox" data-inc="${i}" ${it.included ? 'checked' : ''}
          title="Incluir no álbum"/>
        ${it.type === 'video' ? '<span class="pp-badge">🎬 vídeo</span>' : ''}
        <span>${esc(it.date || '')}</span>
      </div>
      <input type="text" data-cap="${i}" placeholder="legenda (opcional)"
        value="${esc(it.caption || '')}" maxlength="280"/>
    </div>`;
  }

  // ── Conexão e seleção ─────────────────────────────────────────────────
  async function connect() {
    try {
      setStatus('Autenticando no Google…');
      const token = await getAccessToken();
      setStatus('Criando sessão do picker…');
      state.session = await createSession(token);
      setStatus(
        'Sessão criada. Clique em <strong>Abrir Google Photos</strong>, escolha as fotos e volte aqui.',
        'ok',
      );
      render();
    } catch (e) {
      setStatus(`Falha na conexão: ${esc(e.message)}`, 'err');
    }
  }

  async function checkOnce() {
    try {
      const token = await getAccessToken();
      const s = await getSession(token, state.session.id);
      if (!s.mediaItemsSet) {
        setStatus('Seleção ainda não concluída no Google Photos.', 'err');
        return;
      }
      await loadSelection(token);
    } catch (e) {
      setStatus(`Falha verificando sessão: ${esc(e.message)}`, 'err');
    }
  }

  async function pollLoop() {
    state.polling = true;
    render();
    try {
      const token = await getAccessToken();
      const intervalMs = durationToMs(state.session.pollingConfig?.pollInterval, 5000);
      const deadline = Date.now() + durationToMs(state.session.pollingConfig?.timeoutIn, 1_800_000);
      while (!state.closed && Date.now() < deadline) {
        const s = await getSession(token, state.session.id);
        if (s.mediaItemsSet) {
          await loadSelection(token);
          return;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      if (!state.closed) setStatus('Sessão do picker expirou — conecte de novo.', 'err');
    } catch (e) {
      if (!state.closed) setStatus(`Polling falhou: ${esc(e.message)}`, 'err');
    } finally {
      state.polling = false;
    }
  }

  async function loadSelection(token) {
    setStatus('Carregando sua seleção…');
    const items = await listSelectedItems(token, state.session.id);
    // sessão é descartável — Google recomenda apagar após listar
    deleteSession(token, state.session.id);
    state.items = items.map((n) => ({ ...n, included: true, caption: '', date: (n.createTime || '').slice(0, 10) || null, previewUrl: null }));
    // previews exigem Bearer — baixa miniaturas p/ objectURL (lazy, melhor-esforço)
    for (const it of state.items) {
      try {
        const blob = await fetchMediaBlob(
          token,
          it.type === 'video'
            ? videoPosterDownloadUrl(it.baseUrl, THUMB_MAX_DIM)
            : imageDownloadUrl(it.baseUrl, THUMB_MAX_DIM),
        );
        it.previewUrl = URL.createObjectURL(blob);
      } catch {
        /* preview é cosmético — o import segue sem ele */
      }
      if (state.closed) return;
    }
    setStatus(`${state.items.length} item(ns) selecionado(s). Revise e aplique.`, 'ok');
    render();
  }

  // ── Aplicação ─────────────────────────────────────────────────────────
  async function applyToTrip() {
    const trip = currentTrip();
    if (!trip || state.applying) return;
    if (typeof onSave !== 'function') {
      setStatus('Sem handler de persistência (onSave) — abra pelo badge 📸 do site.', 'err');
      return;
    }
    if (!settings.isUnlocked()) {
      setStatus('PAT bloqueado — mídia binária não tem fallback de rascunho.', 'err');
      return;
    }
    state.applying = true;
    render();
    const ghToken = settings.getToken();
    const skipped = [];
    try {
      const token = await getAccessToken();
      const chosen = state.items.filter((i) => i.included);
      const galleryItems = [];
      let done = 0;
      const progress = (msg) =>
        setStatus(`<span class="pp-progress">[${done}/${chosen.length}]</span> ${esc(msg)}`);

      for (const it of chosen) {
        progress(`${it.filename || it.id}…`);
        try {
          if (it.type === 'image') {
            const raw = await fetchMediaBlob(token, imageDownloadUrl(it.baseUrl, IMAGE_MAX_DIM));
            const full = await compressImage(raw, IMAGE_MAX_DIM);
            const thumb = await compressImage(raw, THUMB_MAX_DIM, 0.7);
            const srcPath = mediaFilePath(state.tripId, it.id, 'webp');
            const thPath = thumbFilePath(state.tripId, it.id);
            await putBinaryFile({
              token: ghToken, path: srcPath, base64: await blobToBase64(full.blob),
              message: `feat(media): foto do Google Photos em ${state.tripId} (picker)`,
            });
            await putBinaryFile({
              token: ghToken, path: thPath, base64: await blobToBase64(thumb.blob),
              message: `feat(media): thumb do Google Photos em ${state.tripId} (picker)`,
            });
            galleryItems.push(
              galleryItemFromPicker(it, {
                src: srcPath, thumb: thPath,
                width: full.width, height: full.height, caption: it.caption,
              }),
            );
          } else {
            // Vídeo: só o poster entra no repo (thumbnail =w-h do baseUrl,
            // que funciona para VIDEO); o item vira video_link com href para
            // o vídeo no Google Photos. Bytes de vídeo nunca são baixados.
            const raw = await fetchMediaBlob(token, videoPosterDownloadUrl(it.baseUrl));
            const poster = await compressImage(raw, IMAGE_MAX_DIM); // já vem ≤800px; só converte p/ webp
            const poPath = posterFilePath(state.tripId, it.id);
            await putBinaryFile({
              token: ghToken, path: poPath, base64: await blobToBase64(poster.blob),
              message: `feat(media): poster de vídeo do Google Photos em ${state.tripId} (picker)`,
            });
            galleryItems.push(
              galleryItemFromPicker(it, {
                src: poPath, thumb: poPath, poster: poPath,
                width: poster.width || undefined, height: poster.height || undefined,
                caption: it.caption,
              }),
            );
          }
        } catch (e) {
          skipped.push(`${it.filename || it.id} (${e.message})`);
        }
        done++;
      }

      if (!galleryItems.length) {
        setStatus(`Nada aplicado. Pulados: ${esc(skipped.join('; ') || '—')}`, 'err');
        return;
      }

      // Clone (padrão statement-import) — nada muta o original até o onSave.
      const next = JSON.parse(JSON.stringify(trip));
      next.media ||= {};
      const merged = mergeGallery(next.media.gallery || [], galleryItems);
      next.media.gallery = merged.gallery;
      next.media.cover ||= merged.gallery.find((m) => m.type === 'image')?.src;
      next.media.stats = galleryStats(merged.gallery);
      next.updated_at = new Date().toISOString();

      const result = await onSave(next);
      const idx = state.trips.findIndex((t) => t.id === next.id);
      if (idx !== -1) state.trips[idx] = next;

      const where = result?.committed
        ? 'commit criado no trips.json.'
        : result?.queued
          ? 'offline — referências na sync-queue (mídias já commitadas).'
          : 'atenção: trips.json não foi commitado.';
      const warn = [
        merged.dupes.length ? `${merged.dupes.length} já estavam no álbum (dedup por source_id)` : '',
        merged.overflow.length ? `${merged.overflow.length} ficaram FORA — teto de ${MAX_GALLERY_ITEMS} itens` : '',
        skipped.length ? `pulados: ${skipped.join('; ')}` : '',
      ].filter(Boolean).join(' · ');
      setStatus(
        `${merged.added.length} mídia(s) no álbum de "${esc(next.name || next.id)}" — ${esc(where)}${warn ? `<br/>${esc(warn)}` : ''}`,
        'ok',
      );
      state.items = state.items.filter((i) => !i.included);
    } catch (e) {
      setStatus(`Falha ao aplicar: ${esc(e.message)}`, 'err');
    } finally {
      state.applying = false;
      render();
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  (async () => {
    try {
      setStatus('Carregando viagens…');
      state.trips = await loadAllTrips();
      state.tripId = state.trips.some((t) => t.id === defaultTripId)
        ? defaultTripId
        : state.trips[0]?.id || null;
      statusBox.hidden = true;
      render();
    } catch (e) {
      setStatus(`Falha carregando viagens: ${esc(e.message)}`, 'err');
    }
  })();
}
