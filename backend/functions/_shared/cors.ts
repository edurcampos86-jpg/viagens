// Headers CORS para Edge Functions chamadas pelo frontend GitHub Pages.

export const ALLOWED_ORIGINS = [
  'https://edurcampos86-jpg.github.io',
  'http://localhost:5173',
  'http://localhost:8000',
];

export function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}
