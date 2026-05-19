// Fallback de parsing via Claude Haiku quando regex falha ou confiança é baixa.
//
// Header `anthropic-no-training: true` obrigatório — payload do e-mail
// nunca pode entrar em corpus de treino.

import type { ParseResult } from './types.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = `Você extrai dados estruturados de e-mails de viagem.
Retorne APENAS um JSON com o formato:
{
  "event_type": "flight" | "stay" | "experience" | "unknown",
  "payload": { ... campos relevantes ... },
  "confidence": 0..1
}
Campos esperados por tipo:
- flight: airline, pnr, from (IATA 3 letras), to (IATA), departure (ISO),
  arrival (ISO), price_brl
- stay: platform, name, check_in (YYYY-MM-DD), check_out (YYYY-MM-DD),
  price_brl
- experience: name, date (YYYY-MM-DD), price_brl

Se não souber um campo, use null. Não invente valores. Se o e-mail não for
sobre viagem, retorne event_type="unknown" e confidence < 0.3.`;

export async function llmExtract(body: string, subject: string): Promise<ParseResult | null> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[llm-fallback] ANTHROPIC_API_KEY ausente — pulando fallback.');
    return null;
  }
  // Trunca corpo gigante para reduzir custo
  const trimmed = body.length > 6000 ? body.slice(0, 6000) + '\n[TRUNCADO]' : body;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-no-training': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      temperature: 0,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Assunto: ${subject}\n\n${trimmed}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error('[llm-fallback] anthropic erro:', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { content: { type: string; text: string }[] };
  const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
  // Aceita JSON puro ou em bloco ```
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (
      typeof parsed.event_type === 'string' &&
      typeof parsed.confidence === 'number' &&
      typeof parsed.payload === 'object'
    ) {
      return parsed as ParseResult;
    }
  } catch (e) {
    console.error('[llm-fallback] JSON inválido:', e);
  }
  return null;
}
