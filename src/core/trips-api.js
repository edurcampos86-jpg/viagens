// Cliente da GitHub Contents API para persistir `data/trips.json` como commits.
//
// Fluxo de escrita:
//   1. GET /repos/:owner/:repo/contents/:path   → recebe { content, sha }
//   2. mescla mudanças sobre o JSON parseado
//   3. PUT /repos/:owner/:repo/contents/:path   → envia { content (b64), sha, message }
//
// O SHA garante que estamos comitando sobre a versão correta — se mudou no
// remoto enquanto o usuário editava, o PUT falha com 409 e re-pegamos.

const DEFAULT_REPO = { owner: 'edurcampos86-jpg', name: 'viagens' };
const DEFAULT_PATH = 'data/trips.json';
const DEFAULT_BRANCH = 'main';

const API = 'https://api.github.com';

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function b64encodeUtf8(str) {
  // btoa não aceita unicode direto; serializamos via TextEncoder
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

export async function getTripsFile({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path = DEFAULT_PATH,
  branch = DEFAULT_BRANCH,
} = {}) {
  if (!token) throw new Error('getTripsFile: token obrigatório');
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  const meta = await res.json();
  const text = b64decodeUtf8(meta.content);
  return { content: JSON.parse(text), sha: meta.sha, raw: text };
}

export async function putTripsFile({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path = DEFAULT_PATH,
  branch = DEFAULT_BRANCH,
  content,
  sha,
  message,
} = {}) {
  if (!token) throw new Error('putTripsFile: token obrigatório');
  if (!sha) throw new Error('putTripsFile: SHA obrigatório (faça GET antes)');
  if (!message) throw new Error('putTripsFile: commit message obrigatória');
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n';
  // Blindagem anti-corrupção (incidente 2026-06: preview de UI prefixado ao JSON
  // travou o boot). Nunca commitar payload que não seja JSON válido com {config, trips[]}.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`putTripsFile: conteúdo não é JSON válido, commit abortado — ${e.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.config || !Array.isArray(parsed.trips)) {
    throw new Error('putTripsFile: estrutura inválida (faltam config/trips[]), commit abortado');
  }
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: b64encodeUtf8(text),
      sha,
      branch,
    }),
  });
  if (res.status === 409) {
    throw new Error('PUT conflito de SHA — alguém editou o arquivo. Recarregue.');
  }
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Mídia binária (fotos/vídeos do álbum) ───────────────────────────────
// Mesmo padrão de SHA anti-409 do trips.json, SEM o parse-gate acima: o
// gate protege exclusivamente data/trips.json; aqui o payload é binário
// opaco (base64) em media/**. Nunca usar para data/*.json.

export async function getFileSha({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path,
  branch = DEFAULT_BRANCH,
} = {}) {
  if (!token) throw new Error('getFileSha: token obrigatório');
  if (!path) throw new Error('getFileSha: path obrigatório');
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return null; // arquivo novo
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  const meta = await res.json();
  return meta.sha || null;
}

export async function putBinaryFile({
  token,
  owner = DEFAULT_REPO.owner,
  repo = DEFAULT_REPO.name,
  path,
  branch = DEFAULT_BRANCH,
  base64,
  message,
} = {}) {
  if (!token) throw new Error('putBinaryFile: token obrigatório');
  if (!path) throw new Error('putBinaryFile: path obrigatório');
  if (path.startsWith('data/')) {
    throw new Error('putBinaryFile: use putTripsFile para data/* (parse-gate obrigatório)');
  }
  if (!base64) throw new Error('putBinaryFile: base64 obrigatório');
  if (!message) throw new Error('putBinaryFile: commit message obrigatória');
  const url = `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const attempt = async (sha) => {
    const body = { message, content: base64, branch };
    if (sha) body.sha = sha;
    return fetch(url, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };
  let sha = await getFileSha({ token, owner, repo, path, branch });
  let res = await attempt(sha);
  if (res.status === 409 || res.status === 422) {
    // corrida: alguém comitou o mesmo path — re-pega o SHA e tenta 1x
    sha = await getFileSha({ token, owner, repo, path, branch });
    res = await attempt(sha);
  }
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export function commitMessageFor(trip, action = 'add') {
  const verb = { add: 'add', update: 'update', archive: 'archive', delete: 'delete' }[action] || action;
  return `feat(trip): ${verb} ${trip.id || trip.name || 'unknown'}`;
}

export async function upsertTrip({
  token,
  trip,
  message,
  ...rest
} = {}) {
  if (!trip || !trip.id) throw new Error('upsertTrip: trip.id obrigatório');
  const { content, sha } = await getTripsFile({ token, ...rest });
  const trips = Array.isArray(content.trips) ? content.trips : [];
  const idx = trips.findIndex((t) => t.id === trip.id);
  const action = idx === -1 ? 'add' : 'update';
  if (idx === -1) trips.push(trip);
  else trips[idx] = { ...trips[idx], ...trip };
  const next = { ...content, trips };
  return putTripsFile({
    token,
    content: next,
    sha,
    message: message || commitMessageFor(trip, action),
    ...rest,
  });
}

export async function deleteTripById({ token, id, message, ...rest } = {}) {
  if (!id) throw new Error('deleteTripById: id obrigatório');
  const { content, sha } = await getTripsFile({ token, ...rest });
  const trips = Array.isArray(content.trips) ? content.trips : [];
  const next = { ...content, trips: trips.filter((t) => t.id !== id) };
  return putTripsFile({
    token,
    content: next,
    sha,
    message: message || `feat(trip): delete ${id}`,
    ...rest,
  });
}
