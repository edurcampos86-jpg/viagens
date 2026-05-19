// Wizard temporal — F4.1.
// Dado um trip, mostra o próximo passo de planejamento contextual com
// base em quantos dias faltam para a partida. Cada janela conecta com
// o agente adequado.
//
// Janelas:
//   D > 90: comprar voo (Otimizador)
//   D 60–90: reservar hotel (Concierge histórico)
//   D 30–60: comprar ingressos/experiências
//   D 14–30: due diligence (Despachante)
//   D 7–14: bagagem (agente Bagagem do legado)
//   D 0–7: last mile + contagem regressiva
//   D < 0: viagem em andamento ou pos-trip (chama Cronista quando done)
//
// API pública:
//   nextStep(trip, today=new Date()) → { phase, label, ctas: [{label, action}] }
//   renderWizardCard(container, trip, callbacks)

import { getDates } from '../core/schema.js';

const PHASES = [
  {
    id: 'wishlist',
    when: (d) => d == null,
    title: 'Sem datas ainda',
    description: 'Defina o período antes de avançar.',
    ctas: ['edit-dates'],
  },
  {
    id: 'flight',
    when: (d) => d > 90,
    title: `Compre o voo`,
    description: 'Janela longa: melhor preço normalmente entre 60–90 dias. Ative o Otimizador para alertas.',
    ctas: ['price-hunter', 'edit-flight'],
  },
  {
    id: 'stay',
    when: (d) => d > 60 && d <= 90,
    title: 'Reserve hospedagem',
    description: 'Próximas 4 semanas é o ponto certo. Use o histórico para comparar.',
    ctas: ['benchmark', 'edit-stay'],
  },
  {
    id: 'experiences',
    when: (d) => d > 30 && d <= 60,
    title: 'Compre ingressos / experiências',
    description: 'Eventos populares esgotam. Concierge pode sugerir um roteiro.',
    ctas: ['concierge', 'edit-experiences'],
  },
  {
    id: 'compliance',
    when: (d) => d > 14 && d <= 30,
    title: 'Due diligence final',
    description: 'Visto, vacinas, seguro, passaporte. Despachante roda agora.',
    ctas: ['customs', 'checklist'],
  },
  {
    id: 'baggage',
    when: (d) => d > 7 && d <= 14,
    title: 'Bagagem e checklist',
    description: 'Bagagem (agente existente) sugere itens; passe pelo checklist.',
    ctas: ['baggage-agent', 'checklist'],
  },
  {
    id: 'last-mile',
    when: (d) => d >= 0 && d <= 7,
    title: 'Conta regressiva',
    description: 'Check-in online, documentos no celular, dinheiro local, contato de emergência.',
    ctas: ['customs', 'checklist'],
  },
  {
    id: 'in-progress',
    when: (d) => d < 0 && d > -30,
    title: 'Viagem em andamento',
    description: 'Aproveite. Quando voltar, marque como done para o Cronista entrar.',
    ctas: ['mark-done'],
  },
  {
    id: 'done',
    when: (d) => d <= -30,
    title: 'Pós-viagem',
    description: 'Cronista da Memória pode gerar o card completo a partir de uma entrevista curta.',
    ctas: ['chronicler'],
  },
];

export function nextStep(trip, today = new Date()) {
  const { start } = getDates(trip);
  if (!start) return PHASES[0];
  const daysToStart = Math.floor((new Date(start) - today) / 86400000);
  for (const phase of PHASES) {
    if (phase.when(daysToStart)) {
      return { ...phase, daysToStart };
    }
  }
  return { ...PHASES[0], daysToStart };
}

let cssInjected = false;
const CSS = `
.wz-card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px;
  font: 14px Inter, system-ui, sans-serif; color: #0f172a;
  background: linear-gradient(135deg, #f8fafc, #fff); }
.wz-timeline { display: flex; gap: 4px; margin-bottom: 12px; }
.wz-tl-segment { flex: 1; height: 6px; border-radius: 3px; background: #e2e8f0; }
.wz-tl-segment.passed { background: #cbd5e1; }
.wz-tl-segment.active { background: #0f172a; }
.wz-tl-segment.future { background: #e2e8f0; }
.wz-tl-labels { display: flex; justify-content: space-between; font-size: 10px;
  color: #94a3b8; margin-bottom: 12px; }
.wz-days { font-size: 28px; font-weight: 800; color: #0f172a;
  line-height: 1; margin-bottom: 4px; }
.wz-days small { font-size: 12px; font-weight: 500; color: #64748b;
  display: block; margin-top: 4px; }
.wz-title { font-size: 16px; font-weight: 700; margin: 8px 0 4px; }
.wz-desc { font-size: 13px; color: #475569; margin-bottom: 12px; }
.wz-ctas { display: flex; flex-wrap: wrap; gap: 6px; }
.wz-cta { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 6px;
  border: 1px solid #cbd5e1; background: #fff; cursor: pointer; color: #0f172a; }
.wz-cta-primary { background: #0f172a; color: #fff; border-color: #0f172a; }
.wz-cta:hover { background: #f1f5f9; }
.wz-cta-primary:hover { background: #1e293b; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'wz-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

const PHASE_ORDER = ['flight', 'stay', 'experiences', 'compliance', 'baggage', 'last-mile', 'in-progress', 'done'];

function renderTimeline(activeId) {
  const idx = PHASE_ORDER.indexOf(activeId);
  return `
    <div class="wz-timeline">
      ${PHASE_ORDER.map((id, i) => `
        <div class="wz-tl-segment ${i < idx ? 'passed' : i === idx ? 'active' : 'future'}"
          title="${id}"></div>
      `).join('')}
    </div>
    <div class="wz-tl-labels">
      <span>voo</span>
      <span>hotel</span>
      <span>ingressos</span>
      <span>visto</span>
      <span>bagagem</span>
      <span>último km</span>
      <span>viagem</span>
      <span>memória</span>
    </div>
  `;
}

const CTA_LABELS = {
  'price-hunter': '💸 Abrir Otimizador',
  'concierge': '🍽️ Itinerário com Concierge',
  'customs': '🛂 Rodar Despachante',
  'chronicler': '📝 Entrevista com Cronista',
  'baggage-agent': '🧳 Sugestões de Bagagem',
  'checklist': '✅ Ver checklist',
  'benchmark': '📊 Comparar histórico',
  'edit-dates': '✍ Editar datas',
  'edit-flight': '✈ Editar voos',
  'edit-stay': '🏨 Editar hospedagem',
  'edit-experiences': '🎟 Editar experiências',
  'mark-done': '✅ Marcar como concluída',
};

export function renderWizardCard(container, trip, callbacks = {}) {
  ensureCss();
  const phase = nextStep(trip);
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'wz-card';

  let daysText = '';
  if (phase.daysToStart == null) {
    daysText = '—';
  } else if (phase.daysToStart > 0) {
    daysText = `<div class="wz-days">${phase.daysToStart}<small>dia(s) até a partida</small></div>`;
  } else if (phase.daysToStart === 0) {
    daysText = `<div class="wz-days">Hoje!</div>`;
  } else if (phase.daysToStart > -30) {
    daysText = `<div class="wz-days">+${Math.abs(phase.daysToStart)}<small>dia(s) desde a partida</small></div>`;
  } else {
    daysText = `<div class="wz-days">—<small>pós-viagem</small></div>`;
  }

  card.innerHTML = `
    ${renderTimeline(phase.id)}
    ${daysText}
    <div class="wz-title">${phase.title}</div>
    <div class="wz-desc">${phase.description}</div>
    <div class="wz-ctas">
      ${(phase.ctas || []).map((c, i) =>
        `<button class="wz-cta ${i === 0 ? 'wz-cta-primary' : ''}" data-cta="${c}">
          ${CTA_LABELS[c] || c}
         </button>`
      ).join('')}
    </div>
  `;
  card.querySelectorAll('[data-cta]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cta = btn.getAttribute('data-cta');
      const handler = callbacks[cta] || callbacks.default;
      if (handler) handler(cta, trip);
      else console.warn('[wizard] sem handler para', cta);
    });
  });
  container.appendChild(card);
  return phase;
}
