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


MONTHS_PT = ["", "jan", "fev", "mar", "abr", "mai", "jun",
             "jul", "ago", "set", "out", "nov", "dez"]


@dataclass
class OptimizedItem:
    """Resultado da otimização de um item para usar no apply_proposals."""
    type: str  # "image" | "video"
    src: str   # path relativo ao repo root, ex.: "media/iguacu-2021/01.webp"
    thumb: str | None = None
    poster: str | None = None
    caption: str | None = None
    caption_auto: bool | None = None
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
    Depois trunca por tipo. Mantida por compat com testes existentes;
    novo código deve usar prioritize_with_discards.
    """
    def key(it: dict):
        has_gps = it.get("lat") is not None and it.get("lon") is not None
        ts = it.get("timestamp") or 0
        return (0 if has_gps else 1, ts)

    sorted_items = sorted(items, key=key)
    images = [it for it in sorted_items if it.get("type") == "image"][:max_photos]
    videos = [it for it in sorted_items if it.get("type") == "video"][:max_videos]
    return images + videos


def _pick_temporally_spaced(items: list[dict], n: int) -> list[dict]:
    """
    Escolhe n itens distribuídos uniformemente na linha do tempo.
    Itens sem timestamp ficam no fim. Determinístico.
    """
    if n <= 0 or not items:
        return []
    with_ts = sorted(
        [it for it in items if it.get("timestamp") is not None],
        key=lambda it: it["timestamp"],
    )
    without_ts = [it for it in items if it.get("timestamp") is None]
    if len(with_ts) <= n:
        return with_ts + without_ts[: n - len(with_ts)]
    # Pega n índices uniformemente espaçados (sempre inclui o primeiro e o último).
    step = (len(with_ts) - 1) / (n - 1) if n > 1 else 0
    picked_idx = sorted({int(round(i * step)) for i in range(n)})
    # Em caso de colisão (idx repetido após arredondar), completa com vizinhos.
    while len(picked_idx) < n:
        for i in range(len(with_ts)):
            if i not in picked_idx:
                picked_idx.append(i)
                if len(picked_idx) == n:
                    break
        picked_idx = sorted(picked_idx)
    return [with_ts[i] for i in picked_idx[:n]]


def prioritize_with_discards(
    items: list[dict], max_photos: int, max_videos: int,
) -> tuple[list[dict], list[dict]]:
    """
    Versão estendida: separa em (escolhidos, descartados) com critério:
      1) GPS presente vence sem-GPS,
      2) entre os com-GPS, espaça temporalmente (variedade na linha do tempo),
      3) preenche resto com cronológico simples.
    Aplica limite por tipo. Retorna ambas listas para logar descartes.
    """
    def split_by_type(xs):
        return ([it for it in xs if it.get("type") == "image"],
                [it for it in xs if it.get("type") == "video"])

    images, videos = split_by_type(items)

    def pick(group: list[dict], n: int) -> list[dict]:
        if len(group) <= n:
            return sorted(group, key=lambda it: it.get("timestamp") or 0)
        with_gps = [it for it in group if it.get("lat") is not None and it.get("lon") is not None]
        without_gps = [it for it in group if not (it.get("lat") is not None and it.get("lon") is not None)]
        chosen = _pick_temporally_spaced(with_gps, min(n, len(with_gps)))
        if len(chosen) < n:
            extra = sorted(without_gps, key=lambda it: it.get("timestamp") or 0)
            chosen += extra[: n - len(chosen)]
        return chosen

    chosen_images = pick(images, max_photos)
    chosen_videos = pick(videos, max_videos)
    chosen = chosen_images + chosen_videos

    chosen_paths = {it.get("path") for it in chosen}
    discards = [it for it in items if it.get("path") not in chosen_paths]
    return chosen, discards


def make_auto_caption(place: str | None, ts: float | None) -> str | None:
    """
    Gera caption no formato "<place> · DD MMM YYYY" (pt-BR), ou só a data
    se place ausente, ou None se nem data houver.
    """
    if not ts:
        return place or None
    from datetime import datetime
    dt = datetime.utcfromtimestamp(float(ts))
    date_str = f"{dt.day:02d} {MONTHS_PT[dt.month]} {dt.year}"
    if place:
        return f"{place} · {date_str}"
    return date_str


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
                     repo_root: Path | None = None,
                     return_discards: bool = False):
    """
    Otimiza todos os itens (priorizados) de um cluster, escrevendo em
    media_root/<trip-id>/NN.webp etc. Retorna a lista de OptimizedItem
    pronta para virar trip.media.gallery.

    repo_root é usado só para computar paths relativos no resultado.
    Default: pai do media_root (ex.: media/iguacu-2021/01.webp).

    Se return_discards=True, retorna (results, discards) — discards é a
    lista de items que foram cortados pelo cap de 20 fotos + 2 vídeos.
    """
    lim = {**LIMITS, **(limits or {})}
    root = repo_root or media_root.parent
    tid = trip_id or cluster.get("suggested_trip_id") or cluster.get("merge_with") or cluster["id"]
    out_dir = media_root / tid
    out_dir.mkdir(parents=True, exist_ok=True)

    chosen, discards = prioritize_with_discards(
        cluster["items"], lim["max_photos"], lim["max_videos"],
    )
    results: list[OptimizedItem] = []

    # Place vem do cluster (reverse-geocodado em ingest_takeout); usado p/ captions.
    place = cluster.get("place")

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
                _tw, _th = optimize_image(src, out_dir / thumb_fname,
                                          max_side=lim["thumb_max_side"], quality=lim["thumb_quality"])
                date = _iso_date_from_ts(it.get("timestamp"))
                caption = make_auto_caption(place, it.get("timestamp"))
                results.append(OptimizedItem(
                    type="image",
                    src=str((out_dir / fname).relative_to(root)),
                    thumb=str((out_dir / thumb_fname).relative_to(root)),
                    date=date, lat=it.get("lat"), lon=it.get("lon"),
                    width=w, height=h,
                    caption=caption,
                    caption_auto=True if caption else None,
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
                caption = make_auto_caption(place, it.get("timestamp"))
                results.append(OptimizedItem(
                    type="video",
                    src=str((out_dir / fname).relative_to(root)),
                    poster=str((out_dir / poster_fname).relative_to(root)),
                    date=_iso_date_from_ts(it.get("timestamp")),
                    lat=it.get("lat"), lon=it.get("lon"),
                    caption=caption,
                    caption_auto=True if caption else None,
                ))
        except Exception as e:
            print(f"  ⚠ erro em {src.name}: {e}", file=sys.stderr)
            continue

    if return_discards:
        return results, discards
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
    discards_index: dict[str, list[dict]] = {}
    for cl in clusters:
        tid = cl.get("suggested_trip_id") or cl.get("merge_with") or cl["id"]
        print(f"→ Otimizando {cl['id']} → {tid} "
              f"({cl['stats']['total']} item(s))…", file=sys.stderr)
        opt, discards = optimize_cluster(cl, args.media_dir, trip_id=tid,
                                         return_discards=True)
        out_index[cl["id"]] = [_to_dict(o) for o in opt]
        if discards:
            discards_index[cl["id"]] = [
                {"path": d.get("path"), "type": d.get("type"),
                 "timestamp": d.get("timestamp"),
                 "has_gps": d.get("lat") is not None}
                for d in discards
            ]
            print(f"  ✓ {len(opt)} item(s) otimizado(s); "
                  f"{len(discards)} descartado(s) pelo cap", file=sys.stderr)
        else:
            print(f"  ✓ {len(opt)} item(s) otimizado(s)", file=sys.stderr)

    # Salva resultado em proposals.json para apply_proposals consumir
    payload["_optimized"] = out_index
    if discards_index:
        payload["_discards"] = discards_index
    args.proposals.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Resultado em {args.proposals} (chave _optimized)", file=sys.stderr)
    return 0


def _to_dict(o: OptimizedItem) -> dict:
    d = {k: v for k, v in o.__dict__.items() if v is not None}
    return d


if __name__ == "__main__":
    sys.exit(main())
