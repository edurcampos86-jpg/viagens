// "Testar PAT" — valida o token READ-ONLY no momento do save, distinguindo os
// dois modos de falha mais comuns: valor inválido (401) vs token válido mas
// SEM permissão de escrita (Contents: Read and write) neste repo.
//
// NÃO escreve nada: faz só GET /repos/:owner/:repo e lê `permissions.push`.
//
// interpretPatTest é PURA (testável em Node com respostas mockadas); testPat
// faz a rede com fetchImpl injetável (mesmo padrão de eventos-data.js).

const REPO_URL = 'https://api.github.com/repos/edurcampos86-jpg/viagens';

// status + body do GET → { level: 'ok'|'warn'|'error'|'neterror', message }.
// As frases são exatas (UI prefixa o ícone conforme o level).
export function interpretPatTest({ status, body } = {}) {
  if (status === 401) {
    return { level: 'error', message: 'Token inválido (valor errado/incompleto)' };
  }
  if (status === 200) {
    if (body && body.permissions && body.permissions.push === true) {
      return { level: 'ok', message: 'Token OK — pronto pra commitar' };
    }
    return {
      level: 'warn',
      message: 'Token válido, mas sem permissão de escrita (Contents: Read and write) neste repo',
    };
  }
  if (status === 403) {
    return { level: 'error', message: 'Acesso negado (403) — rate limit ou token sem acesso ao repo.' };
  }
  if (status === 404) {
    return { level: 'error', message: 'Repo não encontrado para este token (404) — fine-grained sem acesso a viagens?' };
  }
  return { level: 'error', message: `Resposta inesperada do GitHub (HTTP ${status}).` };
}

// GET read-only ao repo com o token. Erro de rede → neterror com frase clara.
export async function testPat(token, { fetchImpl = fetch, repoUrl = REPO_URL } = {}) {
  if (!token) return { level: 'error', message: 'Sem token para testar — cole ou configure primeiro.' };
  let res;
  try {
    res = await fetchImpl(repoUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (e) {
    return {
      level: 'neterror',
      message: `Não deu para testar agora — sem rede ou GitHub indisponível${e && e.message ? ` (${e.message})` : ''}.`,
    };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* corpo pode faltar em alguns status — interpretPatTest tolera body null */
  }
  return interpretPatTest({ status: res.status, body });
}
