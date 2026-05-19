// Helper compartilhado para chamar a Anthropic API a partir de Edge
// Functions. Centraliza header `anthropic-no-training: true`,
// modelo padrão e tratamento de erro.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface ClaudeRequest {
  model?: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  max_tokens?: number;
  temperature?: number;
}

export interface ClaudeResponse {
  content: { type: string; text: string }[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export async function callClaude(req: ClaudeRequest): Promise<ClaudeResponse> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ausente — configure via supabase secrets.');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-no-training': 'true',
    },
    body: JSON.stringify({
      model: req.model || DEFAULT_MODEL,
      max_tokens: req.max_tokens ?? 1024,
      temperature: req.temperature ?? 0.4,
      system: req.system,
      messages: req.messages,
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export function extractText(resp: ClaudeResponse): string {
  return resp.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

export function extractJson(resp: ClaudeResponse): unknown {
  const text = extractText(resp);
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error('JSON não encontrado na resposta');
  return JSON.parse(match[0]);
}
