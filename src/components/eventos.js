// Timeline de eventos de uma viagem — módulo ISOLADO (Sprint 3A · Etapa 2).
//
// Renderiza a linha do tempo de eventos no formato de data/schemas/evento.schema.json.
// NÃO está integrado ao detalhe da viagem ainda (isso é a Etapa 3) e NÃO aplica a
// identidade visual nova (Fraunces/pilares/tokens --vc-*). Estilo funcional neutro,
// classes com prefixo próprio `.ev-*`.
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

// ── CSS funcional neutro (sem tokens --vc-) ──────────────────────────────

const CSS = `
.ev-timeline { font: inherit; }
.ev-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ev-item { display: flex; gap: 12px; padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; background: #fff; }
.ev-quando { flex: 0 0 96px; font-size: 13px; color: #555; }
.ev-quando time { font-weight: 600; color: #222; display: block; }
.ev-hora { color: #777; }
.ev-corpo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ev-tipo { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #888; }
.ev-titulo { margin: 0; font-size: 15px; font-weight: 600; color: #1a1a1a; }
.ev-ingresso { font-size: 12px; color: #555; }
.ev-ingresso--repassado { color: #999; text-decoration: line-through; }
.ev-item--cancelado { opacity: .6; }
.ev-item--cancelado .ev-titulo { text-decoration: line-through; }
.ev-empty { margin: 0; padding: 16px; text-align: center; color: #888; font-size: 14px; border: 1px dashed #ccc; border-radius: 8px; }
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
