#!/usr/bin/env node
// Auditoria de fotos: lê data/trips.json, faz HEAD em cada URL e reporta.
// Não modifica nada — apenas leitura e impressão.
// Uso: npm run audit

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Timeout por requisição HEAD (em ms). Cloudinary costuma responder em <300ms.
const TIMEOUT_MS = 3000;

// Concorrência para checagem em paralelo (mais alto que upload porque é só HEAD).
const CONCURRENCY = 10;

// Faz HEAD em uma URL com timeout. Devolve {ok, status, error?}.
async function head(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'follow',
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const message = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

// Pool simples com limite de concorrência, preservando a ordem dos resultados.
async function runPool(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

// Extrai todas as URLs de fotos de uma viagem, considerando os dois formatos
// possíveis (gallery: string[] do legado e fotos: {url}[] canônico do schema).
function extractUrls(trip) {
  const urls = [];
  if (Array.isArray(trip.gallery)) {
    for (const item of trip.gallery) {
      if (typeof item === 'string') urls.push(item);
      else if (item && typeof item.url === 'string') urls.push(item.url);
    }
  }
  if (Array.isArray(trip.fotos)) {
    for (const item of trip.fotos) {
      if (item && typeof item.url === 'string' && !urls.includes(item.url)) {
        urls.push(item.url);
      }
    }
  }
  if (typeof trip.photo === 'string' && trip.photo && !urls.includes(trip.photo)) {
    urls.push(trip.photo);
  }
  return urls;
}

async function main() {
  const tripsPath = path.join(ROOT, 'data', 'trips.json');
  const data = JSON.parse(await fs.readFile(tripsPath, 'utf8'));
  const trips = data.trips || [];

  // Monta lista plana de checagens (slug + url) e mantém o índice por slug.
  const bySlug = new Map();
  for (const trip of trips) {
    bySlug.set(trip.id, {
      slug: trip.id,
      total: extractUrls(trip).length,
      broken: 0,
      errors: [],
    });
  }

  const probes = [];
  for (const trip of trips) {
    for (const url of extractUrls(trip)) probes.push({ slug: trip.id, url });
  }

  console.log(`→ Auditando ${trips.length} viagens, ${probes.length} URL(s) (timeout ${TIMEOUT_MS}ms, concorrência ${CONCURRENCY})...`);

  const results = await runPool(probes, CONCURRENCY, async ({ slug, url }) => {
    const probe = await head(url);
    return { slug, url, probe };
  });

  for (const r of results) {
    const row = bySlug.get(r.slug);
    if (!r.probe.ok) {
      row.broken++;
      const tag = r.probe.error || `HTTP ${r.probe.status}`;
      row.errors.push(`${tag} — ${r.url}`);
    }
  }

  // Tabela principal.
  console.log('\n─── Auditoria de fotos ───');
  const colSlug = Math.max(4, ...trips.map(t => t.id.length));
  console.log(`${'slug'.padEnd(colSlug)}  fotos  status`);
  console.log('─'.repeat(colSlug + 20));

  let withProblems = 0;
  for (const trip of trips) {
    const row = bySlug.get(trip.id);
    let status;
    if (row.total === 0) {
      status = '— (sem fotos)';
    } else if (row.broken > 0) {
      status = `⚠ ${row.broken} quebrada(s) de ${row.total}`;
      withProblems++;
    } else {
      status = `✓ todas ${row.total} ok`;
    }
    console.log(`${trip.id.padEnd(colSlug)}  ${String(row.total).padStart(5)}  ${status}`);
  }

  // Detalhes das viagens com problema.
  const problemRows = [...bySlug.values()].filter(r => r.broken > 0);
  if (problemRows.length > 0) {
    console.log('\n─── Detalhes das URLs com problema ───');
    for (const r of problemRows) {
      console.log(`\n${r.slug}:`);
      r.errors.forEach(e => console.log(`  ✖ ${e}`));
    }
  }

  // Resumo final.
  const totalUrls = probes.length;
  const okUrls = results.filter(r => r.probe.ok).length;
  console.log('\n─── Resumo ───');
  console.log(`Viagens totais:        ${trips.length}`);
  console.log(`Viagens com fotos:     ${[...bySlug.values()].filter(r => r.total > 0).length}`);
  console.log(`Viagens sem fotos:     ${[...bySlug.values()].filter(r => r.total === 0).length}`);
  console.log(`URLs testadas:         ${totalUrls}`);
  console.log(`URLs ok:               ${okUrls}`);
  console.log(`URLs quebradas:        ${totalUrls - okUrls}`);
  console.log(`Viagens com problema:  ${withProblems}`);

  // Exit code != 0 quando algo está quebrado, útil pra CI no futuro.
  process.exit(withProblems > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
