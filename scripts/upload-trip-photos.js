#!/usr/bin/env node
// Script de upload de fotos de uma viagem para o Cloudinary.
// Uso: npm run upload -- <slug>     (exemplo: npm run upload -- brussels-2026)
// Lê de ./photos-to-upload/<slug>/ e popula data/trips.json (gallery + fotos + photo).

import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Extensões de imagem aceitas (Cloudinary suporta todas estas como resource_type=image).
const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp',
  '.heic', '.heif', '.gif', '.avif', '.tiff', '.tif',
]);

// Concorrência máxima de uploads simultâneos para evitar rate-limit do Cloudinary.
const CONCURRENCY = 5;

// Largura máxima para a URL otimizada de exibição (mantém aspect ratio via crop=limit).
const DISPLAY_WIDTH = 1600;

// Tier gratuito Cloudinary (referência): 25 GB de storage e 25 GB de bandwidth/mês.
const FREE_TIER_STORAGE_BYTES = 25 * 1024 * 1024 * 1024;

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

// Configura o SDK do Cloudinary a partir das variáveis de ambiente do .env.
function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    die('Credenciais ausentes. Copie .env.example para .env e preencha CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.');
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Constrói a URL otimizada de exibição: até 1600px de largura preservando aspect ratio,
// formato e qualidade automáticos (servidos como WebP/AVIF quando o navegador suporta).
function buildDisplayUrl(publicId) {
  return cloudinary.url(publicId, {
    secure: true,
    transformation: [
      { width: DISPLAY_WIDTH, crop: 'limit' },
      { quality: 'auto', fetch_format: 'auto' },
    ],
  });
}

// Faz upload de uma foto. Idempotente: se o public_id já existe no Cloudinary,
// reaproveita o asset existente em vez de duplicar (overwrite: false).
async function uploadPhoto(filepath, slug) {
  const basename = path.basename(filepath, path.extname(filepath));
  // public_id determinístico baseado no nome do arquivo — permite idempotência.
  const publicId = `viagens/${slug}/${basename}`;
  const stat = await fs.stat(filepath);

  try {
    const result = await cloudinary.uploader.upload(filepath, {
      public_id: publicId,
      overwrite: false,
      unique_filename: false,
      use_filename: false,
      resource_type: 'image',
    });
    return {
      ok: true,
      reused: false,
      filename: path.basename(filepath),
      publicId: result.public_id,
      url: buildDisplayUrl(result.public_id),
      bytes: result.bytes ?? stat.size,
    };
  } catch (err) {
    const message = err?.message || String(err);
    // Quando overwrite=false e o asset já existe, o Cloudinary retorna erro;
    // nesse caso buscamos o recurso existente e reaproveitamos a URL.
    if (/exist|already|duplicate/i.test(message)) {
      try {
        const info = await cloudinary.api.resource(publicId);
        return {
          ok: true,
          reused: true,
          filename: path.basename(filepath),
          publicId: info.public_id,
          url: buildDisplayUrl(info.public_id),
          bytes: info.bytes ?? 0,
        };
      } catch (fetchErr) {
        return {
          ok: false,
          filename: path.basename(filepath),
          error: `asset existente porém não recuperável: ${fetchErr.message || fetchErr}`,
        };
      }
    }
    return { ok: false, filename: path.basename(filepath), error: message };
  }
}

// Executa um pool de tarefas com limite de concorrência, preservando a ordem de saída.
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) die('Uso: npm run upload -- <slug>   (ex: brussels-2026)');

  configureCloudinary();

  // Confere se a pasta de origem existe.
  const photosDir = path.join(ROOT, 'photos-to-upload', slug);
  try {
    await fs.access(photosDir);
  } catch {
    die(`Pasta não encontrada: ${photosDir}. Crie-a e coloque as fotos lá antes de rodar.`);
  }

  // Lista arquivos de imagem em ordem alfabética — essa será a ordem das fotos no site.
  const allFiles = await fs.readdir(photosDir);
  const files = allFiles
    .filter(f => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => path.join(photosDir, f));

  if (files.length === 0) die(`Nenhuma imagem encontrada em ${photosDir} (extensões aceitas: ${[...IMAGE_EXTS].join(', ')}).`);

  // Confirma que a viagem existe no trips.json antes de gastar quota no Cloudinary.
  const tripsPath = path.join(ROOT, 'data', 'trips.json');
  const tripsRaw = await fs.readFile(tripsPath, 'utf8');
  const tripsData = JSON.parse(tripsRaw);
  const trip = tripsData.trips.find(t => t.id === slug);
  if (!trip) die(`Viagem com id "${slug}" não encontrada em data/trips.json. Slugs disponíveis: ${tripsData.trips.map(t => t.id).join(', ')}`);

  console.log(`→ Subindo ${files.length} foto(s) de "${slug}" para Cloudinary (concorrência ${CONCURRENCY})...`);
  const start = Date.now();

  const results = await runWithConcurrency(files, CONCURRENCY, async (filepath) => {
    const r = await uploadPhoto(filepath, slug);
    if (r.ok) {
      const tag = r.reused ? 'reutilizada' : 'enviada';
      console.log(`  ✓ ${r.filename} (${tag}, ${formatBytes(r.bytes)})`);
    } else {
      console.log(`  ✖ ${r.filename} — ${r.error}`);
    }
    return r;
  });

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  const successes = results.filter(r => r && r.ok);
  const failures = results.filter(r => r && !r.ok);
  const totalBytes = successes.reduce((sum, r) => sum + (r.bytes || 0), 0);

  // Atualiza data/trips.json com as URLs em três campos (decisão "opção C" combinada):
  //   - gallery: array de strings (consumido por app.js sem alteração)
  //   - fotos: array de objetos {url, destaque?} (canônico do schema)
  //   - photo: primeira URL (capa do hero)
  if (successes.length > 0) {
    const urls = successes.map(r => r.url);
    trip.gallery = urls;
    trip.photo = urls[0];
    trip.fotos = urls.map((url, i) => i === 0 ? { url, destaque: true } : { url });
    await fs.writeFile(tripsPath, JSON.stringify(tripsData, null, 2) + '\n', 'utf8');
    console.log(`\n→ data/trips.json atualizado: ${urls.length} URL(s) gravada(s) em gallery/fotos/photo para "${slug}".`);
  }

  // Resumo final no terminal.
  console.log('\n─── Resumo ───');
  console.log(`Sucesso:     ${successes.length}`);
  console.log(`Falhas:      ${failures.length}`);
  console.log(`Tempo:       ${elapsedSec}s`);
  console.log(`Volume:      ${formatBytes(totalBytes)} (somatório dos arquivos enviados/reaproveitados)`);
  console.log(`Quota free:  ~${(totalBytes / FREE_TIER_STORAGE_BYTES * 100).toFixed(4)}% dos 25 GB de storage gratuito do Cloudinary`);

  if (failures.length > 0) {
    console.log('\nFalhas detalhadas:');
    failures.forEach(f => console.log(`  ✖ ${f.filename}: ${f.error}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Erro inesperado:', err);
  process.exit(1);
});
