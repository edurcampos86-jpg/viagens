// Cliente da GitHub Contents API para persistir `data/backlog.json` como commits.
//
// ESPELHA o padrão de `trips-api.js` (GET sha → PUT b64 + sha anti-409), mas é
// um MÓDULO SEPARADO de propósito: o parse-gate aqui é DEDICADO ao backlog
// ({version, items[]}) e nunca toca o gate de trips ({config, trips[]}) nem o
// arquivo trips.json. Os helpers de b64/headers são duplicados de propósito
// (isolamento > DRY) para não precisar exportar internals do trips-api.
//
// Schema do item:
//   { id, title, description, type:'ideia|correcao|implementacao',
//     area, status:'nova|priorizada|fazendo|feito', priority, created, origin }

const DEFAULT_REPO = { owner: 'edurcampos86-jpg', name: 'viagens' };
const DEFAULT_PATH = 'data/backlog.json';
const DEFAULT_BRANCH = 'main';

const API = 'https://api.github.com';

export const BACKLOG_TYPES = ['ideia', 'correcao', 'implementacao'];
export const BACKLOG_STATUS = ['nova', 'priorizada', 'fazendo', 'feito'];

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64decodeUtf8(str) {
  const bin = atob(str.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── Parse-gate DEDICADO do backlog ───────────────────────────────────────
// Rejeita qualquer payload que não seja um backlog válido ANTES de commitar.
// Espelha a blindagem do putTripsFile (incidente 2026-06 do preview de UI
// prefixado ao JSON), mas para a estrutura {version, items[]}.
export function validateBacklog(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('backlog inválido: raiz precisa ser objeto {version, items[]}');
  }
  if (!Array.isArray(parsed.items)) {
    throw new Error('backlog inválido: falta items[]');
  }
  const types = new Set(BACKLOG_TYPES);
  const status = new Set(BACKLOG_STATUS);
  const ids = new Set();
  for (const it of parsed.items) {
    if (!it || typeof it !== 'object') {
      throw new Error('backlog inválido: item não é objeto');
    }
    if (typeof it.id !== 'string' || !it.id.trim()) {
      throw new Error('backlog inválido: item sem id');
    }
    if (ids.has(it.id)) {
      throw new Error(`backlog inválido: id duplicado "${it.id}"`);
    }
    ids.add(it.id);
    if (typeof it.title !== 'string' || !it.title.trim()) {
      throw new Error(`backlog inválido: item "${it.id}" sem title`);
    }
    if (!types.has(it.type)) {
      throw new Error(`backlog inválido: item "${it.id}" com type fora de {${BACKLOG_TYPES.join('|')}}`);
    }
    if (!status.has(it.status)) {
      throw new Error(`backlog inválido: item "${it.id}" com status fora de {${BACKLOG_STATUS.join('|')}}`);
    }
  }
  return parsed;
}

// GET do arquivo. Retorna { content, sha, raw }; sha:null se o arquivo ainda
// não existe no remoto (404) — o PUT então cria.
export async function getBacklogFile({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path = DEFAULT_PATH,
  branch = DEFAULT_BRANCH,
} = {}) {
  if (!token) throw new Error('getBacklogFile: token obrigatório');
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return { content: { version: 1, items: [] }, sha: null, raw: null };
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  const meta = await res.json();
  const text = b64decodeUtf8(meta.content);
  return { content: JSON.parse(text), sha: meta.sha, raw: text };
}

export async function putBacklogFile({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path = DEFAULT_PATH,
  branch = DEFAULT_BRANCH,
  content,
  sha,
  message,
} = {}) {
  if (!token) throw new Error('putBacklogFile: token obrigatório');
  if (!message) throw new Error('putBacklogFile: commit message obrigatória');
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
  // Parse-gate: nunca commitar payload que não seja JSON válido com {items[]}.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`putBacklogFile: conteúdo não é JSON válido, commit abortado — ${e.message}`);
  }
  validateBacklog(parsed);

  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const attempt = async (currentSha) => {
    const body = { message, content: b64encodeUtf8(text), branch };
    if (currentSha) body.sha = currentSha;
    return fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };
  let res = await attempt(sha);
  if (res.status === 409 || res.status === 422) {
    // corrida: alguém comitou o mesmo path — re-pega o SHA e tenta 1x.
    const fresh = await getBacklogFile({ token, owner, repo, path, branch });
    res = await attempt(fresh.sha);
  }
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// Adiciona/atualiza um item: GET fresco → merge por id → PUT (gate no PUT).
export async function upsertBacklogItem({ token, item, message, ...rest } = {}) {
  if (!item || !item.id) throw new Error('upsertBacklogItem: item.id obrigatório');
  const { content, sha } = await getBacklogFile({ token, ...rest });
  const items = Array.isArray(content.items) ? content.items : [];
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx === -1) items.push(item);
  else items[idx] = { ...items[idx], ...item };
  const next = { ...content, version: content.version || 1, items };
  return putBacklogFile({
    token,
    content: next,
    sha,
    message: message || `feat(backlog): ${idx === -1 ? 'add' : 'update'} ${item.id}`,
    ...rest,
  });
}
