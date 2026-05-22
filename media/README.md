# /media — álbuns das viagens

Cada subpasta corresponde a um `trip.id` em `data/trips.json` e armazena
as mídias daquela viagem (fotos otimizadas + vídeos opcionais).

## Estrutura

```
media/
└── <trip-id>/
    ├── cover.webp           # foto de capa (1600x900 ideal, ~120KB)
    ├── 01.webp              # foto 1 (1920x lado maior, ~200KB)
    ├── 01-thumb.webp        # thumb da foto 1 (320x lado maior, ~50KB)
    ├── 02.webp
    ├── 02-thumb.webp
    ├── ...                  # até 20 fotos
    ├── highlights.mp4       # vídeo opcional (até 2 por trip)
    └── highlights-poster.webp
```

## Como adicionar fotos manualmente

1. Coloque os arquivos otimizados (WebP recomendado) na pasta `media/<trip-id>/`.
2. Edite `data/trips.json` e adicione o bloco `media` na viagem:
   ```json
   "media": {
     "cover": "media/iguacu-2021/cover.webp",
     "gallery": [
       { "type": "image", "src": "media/iguacu-2021/01.webp", "thumb": "media/iguacu-2021/01-thumb.webp", "caption": "Cataratas ao amanhecer" }
     ],
     "stats": { "photos": 1, "videos": 0 }
   }
   ```
3. Rode `python scripts/validate_schemas.py` para conferir.
4. Commit + push.

## Git LFS

Todos os arquivos `*.webp`, `*.jpg`, `*.png`, `*.mp4`, `*.mov`, `*.heic`,
`*.avif`, `*.m4v`, `*.webm` estão configurados para ir via Git LFS
(ver `.gitattributes` no root). Antes do primeiro `git add` neste repo:

```bash
git lfs install
```

Sem isso, fotos vão para o repositório normal e estouram o limite.

## Pipeline automatizado (Fase 3 — em construção)

Quando a Fase 3 for entregue, scripts em `scripts/ingest_takeout.py` e
`scripts/optimize_media.py` vão automaticamente:

- detectar viagens via clusterização espaço-temporal das fotos do Takeout,
- otimizar imagens (WebP qualidade 80, max 1920px) e gerar thumbs,
- gerar posters dos vídeos via ffmpeg,
- propor entradas em `trips.json` para sua revisão.

Por enquanto a adição é manual.
