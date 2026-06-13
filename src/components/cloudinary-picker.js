// Ingestão iPhone→Cloudinary — sobe fotos/vídeos do Camera Roll para o CDN e
// EXPORTA os itens memory_video/memory_photo prontos para commit no desktop.
//
// SEM PAT (decisão 2026-06-13): o navegador NÃO escreve mais no GitHub. O PAT
// por aparelho era redundante para quem trabalha com o Claude no desktop (e
// frágil no iOS, que evicta o storage). Novo fluxo:
//   <input type=file multiple> (Camera Roll) → upload UNSIGNED pro Cloudinary
//   (transcodifica HEIC/HEVC) → monta os itens da gallery → MOSTRA um JSON
//   copiável. O Claude no desktop regenera o poster .webp do public_id e
//   commita o metadado no trips.json (putTripsFile + parse-gate). Nada de PAT,
//   nada de poster commitado pelo telefone.
//
// Bytes de VÍDEO nunca entram no repo: o vídeo cheio vive no Cloudinary; o repo
// guarda só o poster .webp (≤640px, regenerável do public_id). Vídeo > 100MB é
// avisado e pulado.

import { getTripsFile } from '../core/trips-api.js';
import * as settings from '../core/settings.js';
import {
  CLOUDINARY,
  MAX_VIDEO_BYTES,
  MAX_GALLERY_ITEMS,
  resourceTypeForFile,
  cloudinaryUploadUrl,
  cloudinaryDeliveryUrl,
  cloudinaryPosterUrl,
  galleryItemFromCdn,
  posterFilePath,
} from '../core/cloudinary-import.js';
import { isoToDate } from '../core/photos-import.js';

let cssInjected = false;
const CSS = `
.cdn-overlay { position: fixed; inset: 0; z-index: 9999; padding: 16px;
  background: color-mix(in srgb, var(--vc-ink) 55%, transparent);
  display: flex; align-items: center; justify-content: center; }
.cdn-modal { background: var(--vc-paper); color: var(--vc-ink);
  width: min(840px, 100%); max-height: 92vh; overflow: auto;
  border-radius: 12px; font: 14px var(--vc-font-ui);
  box-shadow: 0 25px 50px -12px color-mix(in srgb, var(--vc-ink) 40%, transparent); }
.cdn-header { display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid var(--vc-paper-3);
  position: sticky; top: 0; background: var(--vc-paper); z-index: 1; }
.cdn-close { background: transparent; border: 0; font-size: 22px; cursor: pointer;
  color: var(--vc-ink-soft); }
.cdn-body { padding: 16px 20px; display: grid; gap: 14px; }
.cdn-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
.cdn-field { display: grid; gap: 4px; font-size: 12px; color: var(--vc-ink-soft); }
.cdn-field select, .cdn-field input[type="file"] { font: inherit; color: var(--vc-ink);
  background: var(--vc-paper); border: 1px solid var(--vc-ink-faint);
  border-radius: 6px; padding: 6px 8px; }
.cdn-status { border-radius: 8px; padding: 8px 12px; font-size: 13px;
  background: var(--vc-paper-2); border: 1px solid var(--vc-paper-3); }
.cdn-status.cdn-ok { color: var(--vc-material); }
.cdn-status.cdn-err { color: var(--vc-saude); }
.cdn-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.cdn-card { border: 1px solid var(--vc-paper-3); border-radius: 10px; overflow: hidden;
  background: var(--vc-paper-2); display: grid; gap: 6px; padding-bottom: 8px; }
.cdn-card.cdn-excluded { opacity: .45; }
.cdn-card.cdn-toobig { outline: 2px solid var(--vc-saude); }
.cdn-thumb { width: 100%; aspect-ratio: 1; object-fit: cover; display: block;
  background: var(--vc-paper-3); }
.cdn-vid-tile { width: 100%; aspect-ratio: 1; display: flex; align-items: center;
  justify-content: center; font-size: 34px; background: var(--vc-paper-3); }
.cdn-card-meta { display: flex; align-items: center; gap: 6px; padding: 0 8px;
  font-size: 11px; color: var(--vc-ink-soft); }
.cdn-card input[type="text"] { font: inherit; font-size: 12px; margin: 0 8px;
  color: var(--vc-ink); background: var(--vc-paper);
  border: 1px solid var(--vc-paper-3); border-radius: 6px; padding: 4px 6px; }
.cdn-badge { display: inline-block; font-size: 10px; font-weight: 700;
  padding: 1px 7px; border-radius: 999px; background: var(--vc-relacoes); color: var(--vc-paper); }
.cdn-badge.cdn-warn { background: var(--vc-saude); }
.cdn-actions { display: flex; justify-content: flex-end; gap: 8px; align-items: center; flex-wrap: wrap; }
.cdn-cta { font: inherit; font-weight: 700; padding: 10px 18px; border: 0;
  border-radius: 8px; cursor: pointer; background: var(--vc-brand-1); color: var(--vc-paper); }
.cdn-cta[disabled] { opacity: .5; cursor: not-allowed; }
.cdn-secondary { font: inherit; padding: 8px 14px; border: 1px solid var(--vc-ink-faint);
  border-radius: 8px; cursor: pointer; background: var(--vc-paper); color: var(--vc-ink); }
.cdn-note { font-size: 12px; color: var(--vc-ink-soft); }
.cdn-progress { font-variant-numeric: tabular-nums; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'cdn-css';
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

function fmtBytes(n) {
  if (!n) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

// Cor dominante (média amostrada) do poster → '#rrggbb'. Cosmético: falha → null.
async function dominantColor(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const W = 24, H = 24;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, W, H);
    bmp.close();
    const { data } = ctx.getImageData(0, 0, W, H);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 16) continue; // ignora transparente
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    if (!n) return null;
    const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return null;
  }
}

async function uploadToCloudinary(file, resourceType) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY.uploadPreset);
  const res = await fetch(cloudinaryUploadUrl(resourceType), { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

// Com PAT: lê via API (estado fresco). Sem PAT: trips.json público.
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

export function openCloudinaryPicker({ defaultTripId = 'sp-junho-2026' } = {}) {
  ensureCss();

  const state = { trips: [], tripId: null, items: [], applying: false, closed: false };

  const overlay = document.createElement('div');
  overlay.className = 'cdn-overlay';
  const modal = document.createElement('div');
  modal.className = 'cdn-modal';
  modal.innerHTML = `
    <div class="cdn-header">
      <strong>📱 iPhone → CDN — mídia da viagem (Cloudinary)</strong>
      <button type="button" class="cdn-close" aria-label="Fechar">×</button>
    </div>
    <div class="cdn-body">
      <div class="cdn-status" hidden></div>
      <div class="cdn-main"></div>
    </div>
  `;
  overlay.appendChild(modal);
  const close = () => {
    state.closed = true;
    for (const it of state.items) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    overlay.remove();
  };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  modal.querySelector('.cdn-close').addEventListener('click', close);
  document.body.appendChild(overlay);

  const statusBox = modal.querySelector('.cdn-status');
  const main = modal.querySelector('.cdn-main');

  function setStatus(message, kind) {
    statusBox.hidden = false;
    statusBox.innerHTML = message;
    statusBox.className = `cdn-status${kind === 'ok' ? ' cdn-ok' : kind === 'err' ? ' cdn-err' : ''}`;
  }

  const currentTrip = () => state.trips.find((t) => t.id === state.tripId) || null;

  function onFilesPicked(fileList) {
    for (const file of Array.from(fileList || [])) {
      const type = resourceTypeForFile(file);
      const tooBig = type === 'video' && file.size > MAX_VIDEO_BYTES;
      const previewUrl = type === 'image' ? URL.createObjectURL(file) : null;
      const dateIso = Number.isFinite(file.lastModified)
        ? new Date(file.lastModified).toISOString()
        : null;
      state.items.push({
        file, type, tooBig, previewUrl,
        included: !tooBig,
        caption: '',
        date: isoToDate(dateIso),
        size: file.size,
      });
    }
    render();
  }

  function cardHtml(it, i) {
    const media = it.type === 'image' && it.previewUrl
      ? `<img class="cdn-thumb" src="${esc(it.previewUrl)}" alt="" loading="lazy"/>`
      : `<div class="cdn-vid-tile">🎬</div>`;
    return `<div class="cdn-card ${it.included ? '' : 'cdn-excluded'} ${it.tooBig ? 'cdn-toobig' : ''}">
      ${media}
      <div class="cdn-card-meta">
        <input type="checkbox" data-inc="${i}" ${it.included ? 'checked' : ''} ${it.tooBig ? 'disabled' : ''} title="Incluir"/>
        <span class="cdn-badge ${it.type === 'video' ? '' : ''}">${it.type === 'video' ? '🎬 vídeo' : '🖼 foto'}</span>
        <span>${esc(fmtBytes(it.size))}</span>
        ${it.tooBig ? `<span class="cdn-badge cdn-warn">&gt;100MB — pulado</span>` : ''}
      </div>
      <input type="text" data-cap="${i}" placeholder="legenda (opcional)" value="${esc(it.caption)}" maxlength="280"/>
    </div>`;
  }

  function render() {
    const trip = currentTrip();
    const existing = trip?.media?.gallery?.length || 0;
    const room = Math.max(0, MAX_GALLERY_ITEMS - existing);
    const included = state.items.filter((i) => i.included && !i.tooBig);

    main.innerHTML = `
      <div class="cdn-row">
        <label class="cdn-field">
          <span>Viagem destino</span>
          <select id="cdn-trip">
            ${state.trips.map((t) =>
              `<option value="${esc(t.id)}" ${t.id === state.tripId ? 'selected' : ''}>${esc(t.name || t.id)}</option>`).join('')}
          </select>
        </label>
        <label class="cdn-field">
          <span>Fotos/vídeos do iPhone</span>
          <input id="cdn-files" type="file" accept="image/*,video/*" multiple />
        </label>
        <span class="cdn-note">álbum atual: ${existing}/${MAX_GALLERY_ITEMS}
          ${existing >= MAX_GALLERY_ITEMS ? '— <strong>cheio</strong>' : `— cabem mais ${room}`}</span>
      </div>
      <div class="cdn-note">A mídia cheia vai pro <strong>Cloudinary</strong> (cloud <code>${esc(CLOUDINARY.cloudName)}</code>);
        o repo recebe só um poster leve. Vídeo &gt; 100MB é pulado. Cloudinary transcodifica HEIC/HEVC.</div>
      ${state.items.length ? `<div class="cdn-grid">${state.items.map((it, i) => cardHtml(it, i)).join('')}</div>` : ''}
      <div class="cdn-actions">
        <span class="cdn-note">
          ${included.length} para subir → Cloudinary. O poster + metadado o Claude commita no desktop — <strong>sem PAT</strong>.
        </span>
        <button type="button" id="cdn-apply" class="cdn-cta"
          ${state.applying || !included.length || !trip ? 'disabled' : ''}>
          ${state.applying ? 'Enviando…' : 'Subir ao Cloudinary'}
        </button>
      </div>
    `;

    main.querySelector('#cdn-trip')?.addEventListener('change', (e) => {
      state.tripId = e.target.value; render();
    });
    main.querySelector('#cdn-files')?.addEventListener('change', (e) => onFilesPicked(e.target.files));
    main.querySelector('#cdn-apply')?.addEventListener('click', applyToTrip);
    main.querySelectorAll('[data-inc]').forEach((el) =>
      el.addEventListener('change', () => {
        state.items[Number(el.getAttribute('data-inc'))].included = el.checked; render();
      }));
    main.querySelectorAll('[data-cap]').forEach((el) =>
      el.addEventListener('change', () => {
        state.items[Number(el.getAttribute('data-cap'))].caption = el.value.trim();
      }));
  }

  async function applyToTrip() {
    const trip = currentTrip();
    if (!trip || state.applying) return;
    state.applying = true;
    render();
    const chosen = state.items.filter((i) => i.included && !i.tooBig);
    const galleryItems = [];
    const skipped = [];
    let done = 0;
    const progress = (msg) =>
      setStatus(`<span class="cdn-progress">[${done}/${chosen.length}]</span> ${esc(msg)}`);

    try {
      for (const it of chosen) {
        const label = it.file.name || `item ${done + 1}`;
        progress(`subindo ${label}…`);
        try {
          const resourceType = it.type;
          // 1) upload UNSIGNED ao CDN (sem PAT)
          const up = await uploadToCloudinary(it.file, resourceType);
          if (!up?.public_id) throw new Error('resposta do Cloudinary sem public_id');
          // 2) busca o poster do CDN SÓ para extrair a cor de acento (cosmético).
          //    O poster NÃO é commitado aqui: o Claude o regenera do public_id
          //    no desktop e grava no repo. Falha aqui não impede o item.
          let accent = null;
          try {
            const pr = await fetch(cloudinaryPosterUrl(up.public_id, resourceType));
            if (pr.ok) accent = await dominantColor(await pr.blob());
          } catch { /* acento é opcional */ }
          // 3) monta o item da gallery (poster = caminho LOCAL determinístico,
          //    regenerável do public_id; o desktop baixa e commita).
          galleryItems.push(galleryItemFromCdn({
            resourceType,
            publicId: up.public_id,
            src: cloudinaryDeliveryUrl(up.public_id, resourceType),
            poster: posterFilePath(state.tripId, up.public_id),
            width: Number(up.width) || undefined,
            height: Number(up.height) || undefined,
            caption: it.caption,
            date: it.date,
            accent,
          }));
        } catch (e) {
          skipped.push(`${label} (${e.message})`);
        }
        done++;
      }
    } catch (e) {
      state.applying = false;
      setStatus(`Falha no envio: ${esc(e.message)}`, 'err');
      render();
      return;
    }

    state.applying = false;
    if (!galleryItems.length) {
      setStatus(`Nada subiu ao CDN. Pulados: ${esc(skipped.join('; ') || '—')}`, 'err');
      render();
      return;
    }
    // sucesso: tira os enviados da fila e mostra o JSON para copiar pro desktop
    state.items = state.items.filter((i) => !i.included || i.tooBig);
    renderResult({ tripId: state.tripId, tripName: trip.name || state.tripId, items: galleryItems }, skipped);
  }

  // Painel de resultado: o telefone já subiu ao CDN; aqui exporta o JSON para
  // o Claude commitar no desktop (sem PAT). Substitui o corpo do picker.
  function renderResult(payload, skipped) {
    const json = JSON.stringify(payload, null, 2);
    setStatus(
      `✅ ${payload.items.length} mídia(s) no Cloudinary.${skipped.length ? ` Pulados: ${esc(skipped.join('; '))}` : ''}`,
      'ok',
    );
    main.innerHTML = `
      <div class="cdn-note">Pronto — as mídias estão no Cloudinary. <strong>Copie o bloco abaixo e cole para o Claude no desktop</strong>: ele baixa os posters e grava no <code>trips.json</code>. Nenhum PAT necessário.</div>
      <textarea id="cdn-result" readonly rows="12"
        style="width:100%;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--vc-ink);background:var(--vc-paper-2);border:1px solid var(--vc-paper-3);border-radius:8px;padding:10px;">${esc(json)}</textarea>
      <div class="cdn-actions">
        <button type="button" id="cdn-more" class="cdn-secondary">Enviar mais</button>
        <button type="button" id="cdn-copy" class="cdn-cta">📋 Copiar para o Claude</button>
      </div>
    `;
    const ta = main.querySelector('#cdn-result');
    main.querySelector('#cdn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(json);
        setStatus('Copiado! Cole na conversa com o Claude no desktop.', 'ok');
      } catch {
        ta.focus(); ta.select();
        setStatus('Selecionei o texto — use Copiar do teclado e cole pro Claude.', 'ok');
      }
    });
    main.querySelector('#cdn-more').addEventListener('click', render);
  }

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
