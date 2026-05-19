// 🛂 Despachante Digital — F1.5.
//
// Roda due diligence documental e logística da viagem. Reporta status
// verde/amarelo/vermelho por item, com link para fonte oficial.
//
// Interface:
//   import { meta, run } from '../agents/customs.js';
//   const result = await run({ trip, profile, rulesDoc });
//   // result.items = [{ id, label, status, message, source }]
//
// O agente NÃO escreve no trips.json — só devolve sugestões + status.

import { loadRules, resolveRulesForTripFull } from '../components/checklist.js';
import { getDates } from '../core/schema.js';

export const meta = {
  id: 'customs',
  name: 'Despachante Digital',
  icon: '🛂',
  description: 'Due diligence documental: passaporte, visto, vacinas, voltagem, direção.',
};

const PROFILE_KEY = 'viagens.v2.profile';

export function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// ── Helpers de avaliação ────────────────────────────────────────────────

function monthsBetween(isoStartDate, isoEndDate) {
  const a = new Date(isoStartDate);
  const b = new Date(isoEndDate);
  if (isNaN(a) || isNaN(b)) return null;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

function isInternational(trip) {
  const cc = (trip.country_code || '').toUpperCase();
  const name = (trip.country || '').toLowerCase();
  return cc !== 'BR' && name !== 'brasil';
}

// ── Checks individuais ──────────────────────────────────────────────────

function checkPassport(trip, profile) {
  if (!isInternational(trip)) {
    return null; // não aplicável a domésticas
  }
  if (!profile?.passport?.expires_on) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'yellow',
      message: 'Configure validade do passaporte no perfil para checagem automática.',
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  const { end } = getDates(trip);
  const referenceEnd = end || trip.dates?.end || trip.dates?.start;
  if (!referenceEnd) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'yellow',
      message: 'Defina datas da viagem para conferir validade do passaporte.',
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  const months = monthsBetween(referenceEnd, profile.passport.expires_on);
  if (months == null) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'yellow',
      message: 'Data de validade inválida no perfil.',
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  if (months < 0) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'red',
      message: `Passaporte vencido em ${profile.passport.expires_on}. Renove com urgência.`,
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  if (months < 6) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'red',
      message: `Validade insuficiente: ${months} mês(es) após o fim da viagem. A maioria dos países exige 6 meses.`,
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  if (months < 12) {
    return {
      id: 'passport',
      label: 'Passaporte',
      status: 'yellow',
      message: `Validade OK (${months} meses), mas considere renovar — fila de emissão pode estar longa.`,
      source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
    };
  }
  return {
    id: 'passport',
    label: 'Passaporte',
    status: 'green',
    message: `Validade OK (${months} meses após o fim da viagem).`,
    source: 'https://www.gov.br/pf/pt-br/assuntos/passaporte',
  };
}

function checkVisa(trip, rules) {
  if (!isInternational(trip)) return null;
  const rule = rules.find((r) => r.match?.country_code || r.match?.region === 'schengen');
  if (!rule) {
    return {
      id: 'visa',
      label: 'Visto',
      status: 'yellow',
      message: 'Sem regra cadastrada para este destino — verifique manualmente.',
      source: 'https://www.gov.br/mre/pt-br',
    };
  }
  const required = rules.some((r) => r.visa_required_for_brazilians);
  return {
    id: 'visa',
    label: 'Visto',
    status: required ? 'red' : 'green',
    message: required
      ? `Visto/autorização obrigatório(a) para ${rule.country_name}.`
      : `Brasileiros isentos de visto em ${rule.country_name} (verifique tempo de permanência).`,
    source: rule.sources?.visa || rule.sources?.eta || rule.sources?.etias || 'https://www.gov.br/mre/pt-br',
  };
}

function checkVaccines(trip, rules) {
  if (!isInternational(trip)) return null;
  const required = rules.flatMap((r) => r.vaccines_required || []);
  if (!required.length) {
    return {
      id: 'vaccines',
      label: 'Vacinas',
      status: 'green',
      message: 'Nenhuma vacina obrigatória cadastrada.',
      source: 'https://www.gov.br/anvisa/pt-br/assuntos/viajante/cive',
    };
  }
  return {
    id: 'vaccines',
    label: 'Vacinas',
    status: 'yellow',
    message: `Verificar: ${required.join(', ')}. Emitir CIVP via Anvisa se aplicável.`,
    source: 'https://www.gov.br/anvisa/pt-br/assuntos/viajante/cive',
  };
}

function checkInsurance(trip, profile) {
  if (!isInternational(trip)) return null;
  if (profile?.insurance?.policy_number && profile?.insurance?.expires_on) {
    const { end } = getDates(trip);
    if (end && profile.insurance.expires_on >= end) {
      return {
        id: 'insurance',
        label: 'Seguro saúde',
        status: 'green',
        message: `Apólice ${profile.insurance.policy_number} válida até ${profile.insurance.expires_on}.`,
        source: 'https://www.gov.br/anac/pt-br',
      };
    }
    return {
      id: 'insurance',
      label: 'Seguro saúde',
      status: 'red',
      message: 'Apólice vence antes do fim da viagem — renovar.',
      source: 'https://www.gov.br/anac/pt-br',
    };
  }
  return {
    id: 'insurance',
    label: 'Seguro saúde',
    status: 'yellow',
    message: 'Cadastre apólice no perfil (Schengen exige cobertura ≥ EUR 30.000).',
    source: 'https://travel-europe.europa.eu/etias_en',
  };
}

function checkVoltage(trip, rules) {
  const rule = rules.find((r) => r.voltage);
  if (!rule) return null;
  return {
    id: 'voltage',
    label: 'Voltagem & tomadas',
    status: 'green',
    message: `${rule.voltage} em ${rule.country_name}. Levar adaptador adequado.`,
    source: 'https://www.iec.ch/world-plugs',
  };
}

function checkDrive(trip, rules) {
  const rule = rules.find((r) => r.drives_on);
  if (!rule) return null;
  return {
    id: 'drive',
    label: 'Lado da direção',
    status: rule.drives_on === 'left' ? 'yellow' : 'green',
    message:
      rule.drives_on === 'left'
        ? `${rule.country_name} dirige pela esquerda — atenção redobrada se alugar carro.`
        : `${rule.country_name} dirige pela direita.`,
    source: 'https://www.itamaraty.gov.br/pt-BR/',
  };
}

// ── Runner principal ───────────────────────────────────────────────────

export async function run({ trip, profile, rulesDoc } = {}) {
  if (!trip) throw new Error('customs.run: trip obrigatório');
  const rules = rulesDoc || (await loadRules());
  const applicable = resolveRulesForTripFull(trip, rules);
  const ctx = { trip, profile: profile || loadProfile(), applicable };
  const items = [
    checkPassport(ctx.trip, ctx.profile),
    checkVisa(ctx.trip, ctx.applicable),
    checkVaccines(ctx.trip, ctx.applicable),
    checkInsurance(ctx.trip, ctx.profile),
    checkVoltage(ctx.trip, ctx.applicable),
    checkDrive(ctx.trip, ctx.applicable),
  ].filter(Boolean);

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] = (acc[it.status] || 0) + 1;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 }
  );

  return {
    items,
    counts,
    overall: counts.red ? 'red' : counts.yellow ? 'yellow' : 'green',
    international: isInternational(trip),
  };
}

// ── Renderização opcional ──────────────────────────────────────────────

let cssInjected = false;
const CSS = `
.cust-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px;
  font: 14px Inter, system-ui, sans-serif; }
.cust-card h3 { margin: 0 0 8px; font-size: 14px; display: flex;
  align-items: center; gap: 6px; }
.cust-item { display: flex; align-items: flex-start; gap: 8px; padding: 6px 0;
  border-top: 1px solid #f1f5f9; }
.cust-item:first-of-type { border-top: 0; }
.cust-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 5px;
  flex-shrink: 0; }
.cust-dot.green { background: #22c55e; }
.cust-dot.yellow { background: #eab308; }
.cust-dot.red { background: #ef4444; }
.cust-label { font-weight: 600; }
.cust-msg { color: #475569; font-size: 13px; }
.cust-src { font-size: 12px; }
.cust-src a { color: #0f172a; }
`;

function ensureCss() {
  if (cssInjected) return;
  const s = document.createElement('style');
  s.id = 'cust-css';
  s.textContent = CSS;
  document.head.appendChild(s);
  cssInjected = true;
}

export function renderCustomsCard(container, result) {
  ensureCss();
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'cust-card';
  const title = document.createElement('h3');
  const dot = document.createElement('span');
  dot.className = `cust-dot ${result.overall}`;
  title.append(dot, document.createTextNode(`${meta.icon} ${meta.name}`));
  card.appendChild(title);

  if (!result.items.length) {
    card.appendChild(
      Object.assign(document.createElement('p'), {
        textContent: 'Viagem doméstica — sem checagens documentais.',
        className: 'cust-msg',
      })
    );
  } else {
    for (const it of result.items) {
      const row = document.createElement('div');
      row.className = 'cust-item';
      const d = document.createElement('span');
      d.className = `cust-dot ${it.status}`;
      const body = document.createElement('div');
      body.style.flex = '1';
      body.innerHTML =
        `<div class="cust-label">${it.label}</div>` +
        `<div class="cust-msg">${it.message}</div>` +
        (it.source
          ? `<div class="cust-src"><a href="${it.source}" target="_blank" rel="noopener">fonte oficial ↗</a></div>`
          : '');
      row.append(d, body);
      card.appendChild(row);
    }
  }
  container.appendChild(card);
  return card;
}
