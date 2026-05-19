// Edge Function: concierge (F4.2)
// Dado um trip (destino + datas) e historico anonimo do usuario,
// gera itinerario diario via Claude Sonnet.
//
// Payload de entrada (POST):
//   {
//     trip: { country, city, lat, lon, dates: {start, end} },
//     history: [
//       { country, hotels: [string], restaurants: [string], tips }
//     ]
//   }
//
// Resposta:
//   { itinerary: [{ day, date, morning, afternoon, evening, notes }] }

import { corsHeaders } from '../_shared/cors.ts';
import { callClaude, extractJson } from '../_shared/claude.ts';
import { getUserFromJwt } from '../_shared/supabase.ts';

const SYSTEM = `Você é o Concierge Local — um agente do portal de viagens do Eduardo Campos.

Sua missão: dado o destino e as datas de uma viagem, gerar um itinerário
diário considerando:
- Histórico do Eduardo: hotéis (geralmente Aman, Four Seasons, Belmond) e
  restaurantes premium + locais que ele já gostou. Use isso para inferir
  preferências de estilo.
- Dias da semana: museus geralmente fecham segunda; mercados em sábado
  funcionam melhor; rooftops para sexta/sábado.
- Distâncias: agrupe atividades próximas no mesmo dia.

Retorne APENAS um JSON puro (sem fences \`\`\`) no formato:
{
  "itinerary": [
    {
      "day": 1,
      "date": "2026-07-14",
      "morning": "<atividade + breve justificativa>",
      "afternoon": "<atividade + breve justificativa>",
      "evening": "<restaurante/atividade + breve justificativa>",
      "notes": "<dica logística opcional>"
    },
    ...
  ]
}

Sugira no máximo 7 dias. Em PT-BR. Cite no máximo 1 estabelecimento por
slot. Se sugerir hotel/restaurante do histórico, mencione o motivo
("alinhado com o estilo Aman/Belmond que você já gostou").`;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: corsHeaders(origin) });
  }

  // Auth: aceita JWT do usuário (RLS aplica)
  const jwt = req.headers.get('authorization')?.replace('Bearer ', '');
  const user = jwt ? await getUserFromJwt(jwt) : null;
  if (!user) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders(origin) });
  }

  const body = (await req.json().catch(() => null)) as {
    trip?: {
      country?: string;
      city?: string;
      dates?: { start?: string; end?: string };
    };
    history?: { country: string; hotels?: string[]; restaurants?: string[]; tips?: string }[];
  } | null;
  if (!body?.trip?.country || !body.trip?.dates?.start) {
    return new Response('payload incompleto: trip.country e dates.start obrigatórios.', {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  // Monta o prompt do usuário (sem PII)
  const dates = body.trip.dates;
  const days = dates.end
    ? Math.max(1, Math.round((new Date(dates.end).getTime() - new Date(dates.start).getTime()) / 86400000))
    : 5;
  const history = (body.history || [])
    .slice(0, 10) // limite de payload
    .map(
      (h) =>
        `- ${h.country}: hotéis [${(h.hotels || []).slice(0, 3).join(', ')}], ` +
        `restaurantes [${(h.restaurants || []).slice(0, 5).join(', ')}]` +
        (h.tips ? ` — dica: ${h.tips.slice(0, 120)}` : '')
    )
    .join('\n');

  const userMsg = `Destino: ${body.trip.country}${body.trip.city ? ` (${body.trip.city})` : ''}
Datas: ${dates.start} até ${dates.end || '(end desconhecido — assuma ' + days + ' dias)'}
Total de dias: ${days}

Histórico anonimo de viagens passadas (para inferir estilo):
${history || '(sem histórico relevante)'}

Gere o itinerário em JSON conforme instruído.`;

  try {
    const resp = await callClaude({
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 2048,
      temperature: 0.5,
    });
    const json = extractJson(resp);
    return new Response(JSON.stringify(json), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  } catch (e) {
    return new Response(`erro: ${(e as Error).message}`, {
      status: 502,
      headers: corsHeaders(origin),
    });
  }
});
