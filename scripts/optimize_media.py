#!/usr/bin/env python3
"""
optimize_media.py — converte fotos/vídeos para formato web-friendly e strips EXIF.

Para cada cluster aprovado (em proposals.json):
  - imagens: WebP qualidade 80, max 1920px lado maior, EXIF stripado.
  - thumbnails: WebP qualidade 70, 320px lado maior.
  - vídeos: poster via ffmpeg (frame em 1s), re-encoda h264 720p CRF 26 se >10MB.
  - cap: até 20 fotos + 2 vídeos por trip (priorizando GPS > qualidade > ordem).
  - move para /media/<trip-id>/NN.webp + NN-thumb.webp + posters.

Uso:
  python scripts/optimize_media.py --proposals proposals.json
  python scripts/optimize_media.py --proposals proposals.json --cluster cluster-0
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROPOSALS = REPO_ROOT / "proposals.json"
DEFAULT_MEDIA_DIR = REPO_ROOT / "media"

LIMITS = {
    "max_photos": 20,
    "max_videos": 2,
    "image_max_side": 1920,
    "image_quality": 80,
    "thumb_max_side": 320,
    "thumb_quality": 70,
    "video_max_mb": 10,
    "video_max_height": 720,
    "video_crf": 26,
}


@dataclass
class OptimizedItem:
    """Resultado da otimização de um item para usar no apply_proposals."""
    type: str  # "image" | "video"
    src: str   # path relativo ao repo root, ex.: "media/iguacu-2021/01.webp"
    thumb: str | None = None
    poster: str | None = None
    caption: str | None = None
    date: str | None = None
    lat: float | None = None
    lon: float | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None


def prioritize(items: list[dict], max_photos: int, max_videos: int) -> list[dict]:
    """
    Ordena itens para escolha:
      1) com GPS antes de sem GPS
      2) ordem cronológica
    Depois trunca por tipo.
    """
    def key(it: dict):
        has_gps = it.get("lat") is not None and it.get("lon") is not None
        ts = it.get("timestamp") or 0
        return (0 if has_gps else 1, ts)

    sorted_items = sorted(items, key=key)
    images = [it for it in sorted_items if it.get("type") == "image"][:max_photos]
    videos = [it for it in sorted_items if it.get("type") == "video"][:max_videos]
    return images + videos


def optimize_image(src: Path, dst: Path, *, max_side: int, quality: int) -> tuple[int, int]:
    """
    Converte src → dst (WebP). Redimensiona se necessário. Strips EXIF.
    Retorna (width, height) do arquivo final.
    """
    from PIL import Image, ImageOps
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        # ImageOps.exif_transpose aplica orientação EXIF antes do strip
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB") if im.mode != "RGB" else im
        w, h = im.size
        if max(w, h) > max_side:
            im.thumbnail((max_side, max_side), Image.LANCZOS)
        # Salva SEM exif (parâmetro vazio omite o bloco). Privacidade.
        im.save(dst, "WEBP", quality=quality, method=6)
        return im.size


def make_video_poster(src: Path, dst: Path, *, at_seconds: float = 1.0) -> bool:
    """Extrai poster do vídeo via ffmpeg. Retorna True se OK."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(at_seconds), "-i", str(src),
        "-frames:v", "1",
        "-vf", f"scale=-2:'min(720,ih)'",
        "-q:v", "3", str(dst),
    ]
    r = subprocess.run(cmd, capture_output=True, timeout=30)
    return r.returncode == 0


def reencode_video_if_needed(src: Path, dst: Path, *, max_mb: int,
                             max_height: int, crf: int) -> bool:
    """
    Se o vídeo > max_mb, re-encoda em h264 com CRF e altura máxima.
    Caso contrário, apenas copia. Sempre tira EXIF/metadata.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    size_mb = src.stat().st_size / 1_000_000
    if size_mb <= max_mb:
        # Copia binária; também limpa metadados via ffmpeg para privacidade.
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(src),
            "-map_metadata", "-1",
            "-c", "copy", str(dst),
        ]
    else:
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(src),
            "-map_metadata", "-1",
            "-vf", f"scale=-2:'min({max_height},ih)'",
            "-c:v", "libx264", "-crf", str(crf), "-preset", "medium",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(dst),
        ]
    r = subprocess.run(cmd, capture_output=True, timeout=300)
    return r.returncode == 0


def optimize_cluster(cluster: dict, media_root: Path, trip_id: str | None = None,
                     limits: dict | None = None,
                     repo_root: Path | None = None) -> list[OptimizedItem]:
    """
    Otimiza todos os itens (priorizados) de um cluster, escrevendo em
    media_root/<trip-id>/NN.webp etc. Retorna a lista de OptimizedItem
    pronta para virar trip.media.gallery.

    repo_root é usado só para computar paths relativos no resultado.
    Default: pai do media_root (ex.: media/iguacu-2021/01.webp).
    """
    lim = {**LIMITS, **(limits or {})}
    root = repo_root or media_root.parent
    tid = trip_id or cluster.get("suggested_trip_id") or cluster.get("merge_with") or cluster["id"]
    out_dir = media_root / tid
    out_dir.mkdir(parents=True, exist_ok=True)

    chosen = prioritize(cluster["items"], lim["max_photos"], lim["max_videos"])
    results: list[OptimizedItem] = []

    # Cover = primeiro item de imagem (se houver)
    cover_src = next((it for it in chosen if it["type"] == "image"), None)
    if cover_src:
        cover_dst = out_dir / "cover.webp"
        try:
            optimize_image(Path(cover_src["path"]), cover_dst,
                           max_side=lim["image_max_side"] // 2,  # cover menor
                           quality=lim["image_quality"])
        except Exception as e:
            print(f"  ⚠ cover falhou para {tid}: {e}", file=sys.stderr)

    photo_i = 0
    video_i = 0
    for it in chosen:
        src = Path(it["path"])
        if not src.exists():
            continue
        try:
            if it["type"] == "image":
                photo_i += 1
                fname = f"{photo_i:02d}.webp"
                thumb_fname = f"{photo_i:02d}-thumb.webp"
                w, h = optimize_image(src, out_dir / fname,
                                      max_side=lim["image_max_side"], quality=lim["image_quality"])
                tw, th = optimize_image(src, out_dir / thumb_fname,
                                        max_side=lim["thumb_max_side"], quality=lim["thumb_quality"])
                date = _iso_date_from_ts(it.get("timestamp"))
                results.append(OptimizedItem(
                    type="image",
                    src=str((out_dir / fname).relative_to(root)),
                    thumb=str((out_dir / thumb_fname).relative_to(root)),
                    date=date, lat=it.get("lat"), lon=it.get("lon"),
                    width=w, height=h,
                ))
            else:
                video_i += 1
                fname = f"video-{video_i:02d}.mp4"
                poster_fname = f"video-{video_i:02d}-poster.webp"
                if not reencode_video_if_needed(src, out_dir / fname,
                                                max_mb=lim["video_max_mb"],
                                                max_height=lim["video_max_height"],
                                                crf=lim["video_crf"]):
                    print(f"  ⚠ falha ao re-encodar {src.name}", file=sys.stderr)
                    continue
                make_video_poster(src, out_dir / poster_fname)
                results.append(OptimizedItem(
                    type="video",
                    src=str((out_dir / fname).relative_to(root)),
                    poster=str((out_dir / poster_fname).relative_to(root)),
                    date=_iso_date_from_ts(it.get("timestamp")),
                    lat=it.get("lat"), lon=it.get("lon"),
                ))
        except Exception as e:
            print(f"  ⚠ erro em {src.name}: {e}", file=sys.stderr)
            continue

    return results


def _iso_date_from_ts(ts):
    if not ts:
        return None
    from datetime import datetime, timezone
    return datetime.utcfromtimestamp(float(ts)).strftime("%Y-%m-%d")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Otimiza mídias de proposals.json em /media/<trip-id>/")
    ap.add_argument("--proposals", type=Path, default=DEFAULT_PROPOSALS)
    ap.add_argument("--media-dir", type=Path, default=DEFAULT_MEDIA_DIR)
    ap.add_argument("--cluster", default=None,
                    help="Filtra para 1 cluster específico (ex.: cluster-0).")
    ap.add_argument("--include-orphans", action="store_true",
                    help="Otimiza também clusters action=orphan.")
    args = ap.parse_args(argv)

    if not args.proposals.exists():
        print(f"✗ proposals.json não encontrado: {args.proposals}", file=sys.stderr)
        return 2
    payload = json.loads(args.proposals.read_text(encoding="utf-8"))

    clusters = payload.get("clusters", [])
    if args.cluster:
        clusters = [c for c in clusters if c["id"] == args.cluster]
        if not clusters:
            print(f"✗ cluster {args.cluster} não encontrado", file=sys.stderr)
            return 2
    if not args.include_orphans:
        clusters = [c for c in clusters if c.get("action") != "orphan"]

    out_index: dict[str, list[dict]] = {}
    for cl in clusters:
        tid = cl.get("suggested_trip_id") or cl.get("merge_with") or cl["id"]
        print(f"→ Otimizando {cl['id']} → {tid} "
              f"({cl['stats']['total']} item(s))…", file=sys.stderr)
        opt = optimize_cluster(cl, args.media_dir, trip_id=tid)
        out_index[cl["id"]] = [_to_dict(o) for o in opt]
        print(f"  ✓ {len(opt)} item(s) otimizado(s)", file=sys.stderr)

    # Salva resultado em proposals.json para apply_proposals consumir
    payload["_optimized"] = out_index
    args.proposals.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Resultado em {args.proposals} (chave _optimized)", file=sys.stderr)
    return 0


def _to_dict(o: OptimizedItem) -> dict:
    d = {k: v for k, v in o.__dict__.items() if v is not None}
    return d


if __name__ == "__main__":
    sys.exit(main())
