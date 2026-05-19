// Edge Function: chronicler (F4.3)
// Recebe entrevista pos-viagem (perguntas + respostas) e gera:
//   - memory: texto markdown 2-3 paragrafos
//   - highlights: 3-5 bullets curtos
//   - logistics_tips: dica pratica adicional
//   - instagram_captions: 3 opcoes de legenda em PT-BR estilo Eduardo

import { corsHeaders } from '../_shared/cors.ts';
import { callClaude, extractJson } from '../_shared/claude.ts';
import { getUserFromJwt } from '../_shared/supabase.ts';

const SYSTEM = `Voce e o Cronista da Memoria — agente do portal de viagens do
Eduardo Campos. Sua missao: a partir de uma entrevista curta apos a
viagem, gerar o card de memoria.

Estilo do Eduardo (para legendas e tom):
- PT-BR, primeira pessoa, sem hashtags excessivas
- Imagens concretas (cores, sabores, sons) > adjetivos vagos
- Inclui aprendizado pessoal quando relevante
- 1 emoji por legenda, no maximo

Retorne APENAS um JSON puro:
{
  "memory": "texto 2-3 paragrafos em markdown",
  "highlights": ["bullet 1 curto", "bullet 2", "..."],
  "logistics_tips": "dica pratica adicional (opcional)",
  "instagram_captions": [
    "opcao 1 (~150 caracteres)",
    "opcao 2 (mais reflexiva)",
    "opcao 3 (mais leve)"
  ]
}`;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const jwt = req.headers.get('authorization')?.replace('Bearer ', '');
  const user = jwt ? await getUserFromJwt(jwt) : null;
  if (!user) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders(origin) });
  }

  const body = (await req.json().catch(() => null)) as {
    trip?: { name?: string; country?: string; dates?: { start?: string; end?: string } };
    answers?: { question: string; answer: string }[];
  } | null;
  if (!body?.trip?.name || !Array.isArray(body.answers) || !body.answers.length) {
    return new Response('payload incompleto: trip.name e answers[] obrigatorios.', {
      status: 400,
      headers: corsHeaders(origin),
    });
  }

  const userMsg = `Viagem: ${body.trip.name} (${body.trip.country || ''}, ${body.trip.dates?.start || ''}—${body.trip.dates?.end || ''}).

Entrevista:
${body.answers.map((a, i) => `${i + 1}. ${a.question}\n   ${a.answer}`).join('\n\n')}

Gere o card de memoria em JSON conforme instruido.`;

  try {
    const resp = await callClaude({
      system: SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
      max_tokens: 1200,
      temperature: 0.7,
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
