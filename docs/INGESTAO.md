# Ingestão de fotos via Google Takeout

Pipeline para transformar exports do Google Takeout em viagens
automaticamente populadas no `data/trips.json` + mídia otimizada em
`/media/<trip-id>/`.

**Por que Takeout (e não Google Photos API):** em 31/mar/2025 o Google
desativou os escopos `photoslibrary.readonly`, `photoslibrary.sharing` e
`photoslibrary` da Google Photos Library API. Apps que usavam essas
permissões passaram a receber `403`. O Takeout (download manual de um
ZIP) é hoje a única forma estável e gratuita de acessar todo o histórico
de fotos com metadados (EXIF + GPS + timestamp).

## Passo 1 — solicitar o Takeout

1. Acesse [takeout.google.com](https://takeout.google.com).
2. Clique em **Desmarcar tudo** e marque apenas **Google Fotos**.
3. Clique em **Todos os álbuns de fotos incluídos**.
   - Para uma viagem específica: marque só o(s) álbum(ns) da viagem.
   - Para o histórico inteiro: deixe tudo marcado.
4. **Próxima etapa** → tipo `.zip`, tamanho `2 GB` (Drive parte arquivos
   maiores em vários ZIPs — é só descompactar todos no mesmo lugar depois).
5. Solicite o export. Pode demorar de minutos a horas/dias dependendo do
   volume; o Google envia e-mail quando ficar pronto.
6. Baixe o(s) ZIP(s) e descompacte.

A estrutura sai mais ou menos assim:

```
Takeout/
└── Google Fotos/
    ├── 2024-06-12 - Foz do Iguaçu/
    │   ├── IMG_0001.jpg
    │   ├── IMG_0001.jpg.json   ← metadata sidecar (lat/lon/timestamp)
    │   ├── IMG_0002.jpg
    │   ├── IMG_0002.jpg.json
    │   └── ...
    └── 2024-11-15 - Atacama/
        └── ...
```

## Passo 2 — colocar em `media-import/`

```bash
cd seu-clone-do-viagens/
mkdir -p media-import
cp -r ~/Downloads/Takeout/Google\ Fotos/* media-import/
```

> 💡 A pasta `media-import/` está no `.gitignore` — fotos brutas
> **nunca** vão para o repositório. Só vai pro repo o WebP otimizado em
> `/media/<trip-id>/`, com EXIF stripado.

## Passo 3 — rodar localmente (recomendado para o primeiro Takeout)

```bash
# 1. Instale dependências
pip install -r scripts/requirements-ingest.txt
# (no Mac: brew install ffmpeg | no Linux: sudo apt-get install ffmpeg)

# 2. Detecte viagens
python scripts/ingest_takeout.py
# Saída: ./proposals.json com 1 cluster por viagem detectada.

# 3. Abra proposals.json e revise
#    Para cada cluster:
#      - action="create"  → cria viagem nova
#      - action="merge"   → anexa fotos a uma viagem que já existe
#      - action="orphan"  → pulado (poucas fotos ou sem GPS)
#    Ajuste suggested_trip_id, place, country se quiser.

# 4. Otimize as mídias aprovadas
python scripts/optimize_media.py
# Gera /media/<trip-id>/cover.webp + NN.webp + NN-thumb.webp + posters.

# 5. Aplique em trips.json
python scripts/apply_proposals.py
# Valida o schema e gera INGEST-LOG.md com o sumário.

# 6. Commit + push
git add media/ data/trips.json INGEST-LOG.md
git commit -m "feat(ingest): adiciona viagens via Takeout"
git push
```

## Passo 4 — rodar via GitHub Actions (alternativa)

Se preferir não rodar local:

1. Crie uma branch dedicada (ex.: `feat/takeout-2024`).
2. Commite `media-import/` ali (precisará `git add -f` pois é gitignored).
   Atenção: o ZIP pode passar do limite GitHub de 100MB/arquivo; nesse
   caso, divida em PRs menores ou use Git LFS já configurado.
3. **Actions → ingest → Run workflow** com `stage=detect`.
4. Aprove o PR `chore/ingest-proposals` (e edite o JSON se quiser).
5. **Actions → ingest → Run workflow** com `stage=apply`.

## Parâmetros do clustering

Defaults razoáveis para a maioria dos casos:

| Param | Default | O que controla |
|---|---|---|
| `--eps-days` | 2.0 | Fotos a até 2 dias podem ser do mesmo cluster |
| `--eps-km` | 500 | Fotos a até 500 km podem ser do mesmo cluster |
| `--min-samples` | 5 | Cluster precisa de ao menos 5 fotos |

Para uma viagem **muito longa** (ex.: 3 semanas pela Europa visitando 5
cidades), pode ser melhor diminuir `eps-km` para 200 — isso vai gerar 1
cluster por cidade ao invés de 1 só pela viagem inteira. Cada cluster
pode virar uma viagem `multi-destino` posteriormente.

Para um **passeio curto** sem muitas fotos: `--min-samples 3`.

## O que vai (e não vai) pro repositório

| Vai para o repo | Fica fora |
|---|---|
| `/media/<trip-id>/cover.webp` | `/media-import/` (Takeout bruto) |
| `/media/<trip-id>/NN.webp` (≤1920px, qualidade 80) | `proposals.json` (intermediário) |
| `/media/<trip-id>/NN-thumb.webp` (≤320px, qualidade 70) | EXIF original (stripado) |
| `/media/<trip-id>/video-NN.mp4` (h264 720p ≤10MB) | GPS no nível da foto |
| `/media/<trip-id>/video-NN-poster.webp` | |
| `data/trips.json` atualizado | |
| `INGEST-LOG.md` (histórico) | |

## Privacidade — EXIF strip

Todas as fotos otimizadas que vão para o repositório público têm o bloco
EXIF removido. Isso significa:

- ❌ Coordenadas GPS não ficam embutidas em cada `.webp`.
- ❌ Modelo da câmera/celular não fica embutido.
- ❌ Timestamp original removido.

As coordenadas GPS úteis (para o mapa) ficam no `trips.json` no nível da
**viagem**, não da foto individual — granularidade suficiente para o
mapa interativo, mas insuficiente para revelar o local exato de cada
clique.

A orientação EXIF é aplicada **antes** do strip (via
`ImageOps.exif_transpose`), garantindo que fotos do celular não saiam
rotacionadas.

## Limitações conhecidas

1. **Takeout é incremental por solicitação:** se você pediu um Takeout
   hoje, ele pega tudo até hoje. Para fotos novas, peça um novo Takeout
   no mês seguinte. A pipeline detecta duplicatas (merge não-duplicado
   por `src` path) — pode rodar o pipeline de novo sem medo.
2. **Reverse geocoding via Nominatim:** gratuito mas com rate-limit de
   1 req/s. O script já respeita; em CI usamos `--no-geocode` e
   deixamos o geocoding manual no review do PR.
3. **HEIC do iPhone:** Pillow + `pillow-heif` lidam, mas `pillow-heif`
   não está em `requirements-ingest.txt` por padrão (peso de install).
   Se precisar, adicione manualmente e rode local.
4. **Vídeos longos podem demorar:** re-encodar 4K → 720p h264 leva
   ~1 min por minuto de vídeo na máquina padrão do GitHub Actions
   (2 vCPUs). Para Takeouts grandes com muitos vídeos, prefira rodar
   local com mais CPU.

## Próximos passos (não implementados)

- [ ] Detecção automática de fotos parecidas (perceptual hash) para
      deduplicação cross-Takeout.
- [ ] Geração de `memory` (texto narrativo) via LLM a partir dos clusters.
- [ ] Multi-cidade: dividir cluster grande em sub-clusters geográficos
      automaticamente quando span > 500 km.
