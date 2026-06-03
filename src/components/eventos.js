// Timeline de eventos de uma viagem — módulo ISOLADO (Sprint 3A · Etapa 2).
//
// Renderiza a linha do tempo de eventos no formato de data/schemas/evento.schema.json.
// Sprint 3B Slice 1: aplica a identidade "Vida & Carreira" (Fraunces/pilares/tokens
// --vc-*) SOMENTE nesta timeline; marcação e renderItem inalterados. Classes com
// prefixo próprio `.ev-*`.
//
// Uso (browser):
//   import { renderEventos } from '../components/eventos.js';
//   renderEventos(eventos, { container: document.getElementById('eventos') });
//
// Uso (teste/Node, sem DOM):
//   const html = renderEventos(eventos);   // retorna a string HTML da timeline
//
// Assinatura:
//   renderEventos(eventos, opts?) -> string (HTML)
//     opts.container  : elemento DOM onde injetar (opcional; só no browser)
//     opts.emptyText  : texto do estado vazio (default "Sem eventos para esta viagem.")
//     opts.injectCss  : injeta <style> no browser (default true; ignorado em Node)

// ── Helpers defensivos ───────────────────────────────────────────────────

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidTime(s) {
  return typeof s === 'string' && /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(s);
}

// YYYY-MM-DD -> DD/MM/YYYY (parsing manual: sem new Date(), evita timezone).
function formatDate(s) {
  if (!isValidDate(s)) return 'Data a definir';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// ── Taxonomias (rótulos legíveis) ────────────────────────────────────────

const TIPO_LABEL = {
  festival: 'Festival',
  festa: 'Festa',
  show: 'Show',
  passeio: 'Passeio',
  restaurante: 'Restaurante',
  ritual: 'Ritual',
  evento_corporativo: 'Corporativo',
  outro: 'Outro',
};

// ingresso.status (evento.schema.json). Rótulo + se é "repassado/indisponível"
// (vendido/trocado) para indicação visual neutra.
const INGRESSO_STATUS = {
  nao_aplicavel: { label: 'Sem ingresso', repassado: false },
  pendente: { label: 'Ingresso pendente', repassado: false },
  comprado: { label: 'Ingresso comprado', repassado: false },
  compartilhado_recebido: { label: 'Ingresso recebido', repassado: false },
  compartilhado_enviado: { label: 'Ingresso repassado', repassado: true },
  vendido: { label: 'Vendido', repassado: true },
  cancelado_reembolsado: { label: 'Reembolsado', repassado: true },
};

function tipoLabel(tipo) {
  if (typeof tipo === 'string' && TIPO_LABEL[tipo]) return TIPO_LABEL[tipo];
  return 'Outro';
}

function ingressoInfo(ev) {
  const ing = ev && typeof ev.ingresso === 'object' && ev.ingresso ? ev.ingresso : null;
  const status = ing && typeof ing.status === 'string' ? ing.status : null;
  if (status && INGRESSO_STATUS[status]) return INGRESSO_STATUS[status];
  // Sem status explícito: deriva de necessita_ingresso quando possível.
  if (ing && ing.necessita_ingresso === false) {
    return { label: 'Sem ingresso', repassado: false };
  }
  return { label: '—', repassado: false };
}

// ── Ordenação por data (ascendente; sem data vai para o fim) ─────────────

function compareEventos(a, b) {
  const da = isValidDate(a && a.data) ? a.data : null;
  const db = isValidDate(b && b.data) ? b.data : null;
  if (da && db) {
    if (da !== db) return da < db ? -1 : 1;
    const ta = isValidTime(a && a.horario_inicio) ? a.horario_inicio : '99:99';
    const tb = isValidTime(b && b.horario_inicio) ? b.horario_inicio : '99:99';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  }
  if (da && !db) return -1;
  if (!da && db) return 1;
  return 0;
}

// Exposto para teste: ordena sem mutar o array de entrada.
export function sortEventos(eventos) {
  if (!Array.isArray(eventos)) return [];
  return eventos.slice().sort(compareEventos);
}

// ── Render de um item ────────────────────────────────────────────────────

function renderItem(ev) {
  const titulo =
    ev && typeof ev.titulo === 'string' && ev.titulo.trim()
      ? ev.titulo
      : '(sem título)';
  const tipo = tipoLabel(ev && ev.tipo);
  const dataAttr = isValidDate(ev && ev.data) ? ev.data : '';
  const dataTxt = formatDate(ev && ev.data);
  const hora = isValidTime(ev && ev.horario_inicio) ? ev.horario_inicio : '';
  const ing = ingressoInfo(ev);
  const cancelado = ev && ev.status === 'cancelado';

  const horaHtml = hora ? ` <span class="ev-hora">${escapeHtml(hora)}</span>` : '';
  const timeAttr = dataAttr ? ` datetime="${escapeHtml(dataAttr)}"` : '';
  const ingClass = ing.repassado ? ' ev-ingresso--repassado' : '';
  const itemClass = `ev-item${cancelado ? ' ev-item--cancelado' : ''}`;

  return (
    `<li class="${itemClass}" data-tipo="${escapeHtml((ev && ev.tipo) || 'outro')}">` +
    `<div class="ev-quando"><time${timeAttr}>${escapeHtml(dataTxt)}</time>${horaHtml}</div>` +
    `<div class="ev-corpo">` +
    `<span class="ev-tipo">${escapeHtml(tipo)}</span>` +
    `<h3 class="ev-titulo">${escapeHtml(titulo)}</h3>` +
    `<span class="ev-ingresso${ingClass}">${escapeHtml(ing.label)}</span>` +
    `</div>` +
    `</li>`
  );
}

// ── Pele "Vida & Carreira" (tokens --vc-*) · Sprint 3B Slice 1 ────────────
// Identidade aplicada SOMENTE à timeline (.ev-*). Marcação e renderItem
// inalterados. Cores via tokens --vc-* (tokens.css); nada hardcodado.

const CSS = `
.ev-timeline{font:inherit}
.ev-list{list-style:none;margin:0;padding:0;position:relative;display:flex;flex-direction:column;gap:4px}
.ev-list::before{content:"";position:absolute;top:10px;bottom:10px;left:78px;width:2px;background:linear-gradient(180deg,var(--vc-paper-3),var(--vc-ink-faint) 22%,var(--vc-ink-faint) 78%,var(--vc-paper-3));opacity:.55}
.ev-item{--acc:var(--vc-ink-faint);position:relative;display:grid;grid-template-columns:64px 1fr;gap:24px;padding:8px 0;align-items:start;animation:evIn .5s cubic-bezier(.2,.7,.2,1) both}
.ev-item::before{content:"";position:absolute;left:72px;top:16px;width:14px;height:14px;border-radius:50%;background:var(--acc);border:3px solid var(--vc-paper-2);box-shadow:0 0 0 1px var(--acc);z-index:1}
.ev-quando{text-align:right;padding-top:9px;line-height:1.15}
.ev-quando time{display:block;font-family:var(--vc-font-display);font-weight:600;font-size:15px;color:var(--vc-ink);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.ev-hora{display:block;margin-top:3px;font-size:11.5px;font-weight:600;color:var(--vc-ink-soft);letter-spacing:.02em}
.ev-corpo{position:relative;min-width:0;background:var(--vc-paper);border:1px solid var(--vc-paper-3);border-left:4px solid var(--acc);border-radius:12px;padding:13px 16px 14px;box-shadow:0 1px 0 #fff inset,0 14px 26px -22px rgba(43,38,32,.5);display:flex;flex-direction:column;gap:5px}
.ev-tipo{align-self:flex-start;font-size:10.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--acc)}
.ev-corpo .ev-titulo{margin:0;font-family:var(--vc-font-display);font-weight:600;font-size:19px;line-height:1.18;letter-spacing:-.015em;color:var(--vc-ink)}
.ev-ingresso{align-self:flex-start;margin-top:3px;font-size:11.5px;font-weight:600;color:var(--vc-ink-soft);background:var(--vc-paper-2);border:1px solid var(--vc-paper-3);border-radius:999px;padding:4px 10px;display:inline-flex;align-items:center;gap:6px;letter-spacing:.01em}
.ev-ingresso::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--vc-material)}
.ev-ingresso--repassado{color:var(--vc-ink-faint);text-decoration:line-through;text-decoration-thickness:1px}
.ev-ingresso--repassado::before{background:var(--vc-ink-faint)}
.ev-item--cancelado{opacity:.62}
.ev-item--cancelado .ev-corpo{background:repeating-linear-gradient(135deg,var(--vc-paper-2),var(--vc-paper-2) 7px,var(--vc-paper) 7px,var(--vc-paper) 14px);box-shadow:none}
.ev-item--cancelado::before{background:var(--vc-paper-2);box-shadow:0 0 0 1px var(--vc-ink-faint)}
.ev-item--cancelado .ev-corpo .ev-titulo{text-decoration:line-through;text-decoration-color:var(--vc-ink-faint)}
.ev-item[data-tipo="festival"]{--acc:var(--vc-brand-1)}
.ev-item[data-tipo="festa"]{--acc:var(--vc-relacoes)}
.ev-item[data-tipo="show"]{--acc:var(--vc-espiritual)}
.ev-item[data-tipo="passeio"]{--acc:var(--vc-material)}
.ev-item[data-tipo="restaurante"]{--acc:var(--vc-familia)}
.ev-item[data-tipo="ritual"]{--acc:var(--vc-saude)}
.ev-item[data-tipo="evento_corporativo"]{--acc:var(--vc-trabalho)}
.ev-empty{margin:0;padding:22px;text-align:center;color:var(--vc-ink-soft);font-size:14px;background:var(--vc-paper);border:1px dashed var(--vc-paper-3);border-radius:12px}
@keyframes evIn{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.ev-item:nth-child(1){animation-delay:.04s}.ev-item:nth-child(2){animation-delay:.11s}.ev-item:nth-child(3){animation-delay:.18s}.ev-item:nth-child(4){animation-delay:.25s}
@media (prefers-reduced-motion:reduce){.ev-item{animation:none}}
@media (max-width:560px){.ev-list::before{left:62px}.ev-item{grid-template-columns:52px 1fr;gap:18px}.ev-item::before{left:56px}}
`;

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ev-timeline-css')) return;
  const s = document.createElement('style');
  s.id = 'ev-timeline-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ── API pública ──────────────────────────────────────────────────────────

export function renderEventos(eventos, opts = {}) {
  const { container = null, emptyText = 'Sem eventos para esta viagem.', injectCss = true } =
    opts || {};

  if (injectCss) ensureCss();

  const lista = Array.isArray(eventos) ? eventos.filter((e) => e && typeof e === 'object') : [];

  let html;
  if (lista.length === 0) {
    html = `<div class="ev-timeline ev-timeline--empty"><p class="ev-empty">${escapeHtml(
      emptyText
    )}</p></div>`;
  } else {
    const items = sortEventos(lista).map(renderItem).join('');
    html = `<div class="ev-timeline"><ol class="ev-list">${items}</ol></div>`;
  }

  if (container && typeof container === 'object' && 'innerHTML' in container) {
    container.innerHTML = html;
  }
  return html;
}
