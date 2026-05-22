#!/usr/bin/env python3
"""
build_pr_preview.py — gera previews + corpo de comentário Markdown para o PR
de proposals.json.

Para cada cluster não-órfão em proposals.json, escolhe até 4 itens
representativos (mesma lógica de priorização — GPS + espaçamento temporal),
gera thumbs 160×160 WebP em previews/ingest/<cluster-id>/N.webp e monta um
corpo de PR em Markdown com:

  - Nome da viagem detectada (suggested_trip_id ou merge_with)
  - Contagem ("Detectadas N fotos + M vídeos")
  - Grid 2×2 inline com 4 thumbnails
  - Lista de legendas geradas (place · data) — pré-revisão

O markdown referencia os thumbs por URL `raw.githubusercontent.com` do branch
configurado em --branch (default: chore/ingest-proposals). Esse script é
executado no workflow `ingest.yml` no estágio `detect`.

Uso:
  python scripts/build_pr_preview.py \\
      --proposals proposals.json \\
      --previews-dir previews/ingest \\
      --branch chore/ingest-proposals \\
      --repo edurcampos86-jpg/viagens \\
      --out pr-body.md
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

MONTHS_PT = ["", "jan", "fev", "mar", "abr", "mai", "jun",
             "jul", "ago", "set", "out", "nov", "dez"]


def _fmt_date(ts: float | None) -> str | None:
    if not ts:
        return None
    dt = datetime.utcfromtimestamp(float(ts))
    return f"{dt.day:02d} {MONTHS_PT[dt.month]} {dt.year}"


def _caption_for(item: dict, place: str | None) -> str:
    date = _fmt_date(item.get("timestamp"))
    if place and date:
        return f"{place} · {date}"
    return place or date or "(sem data nem local)"


def _pick_preview_items(items: list[dict], n: int = 4) -> list[dict]:
    """Escolhe n itens representativos: com GPS, espaçados temporalmente."""
    from optimize_media import _pick_temporally_spaced
    with_gps = [it for it in items
                if it.get("lat") is not None and it.get("lon") is not None]
    pool = with_gps if len(with_gps) >= n else items
    images = [it for it in pool if it.get("type") == "image"]
    return _pick_temporally_spaced(images or pool, n)


def _make_thumb(src: Path, dst: Path, *, side: int = 160) -> bool:
    """Gera thumb WebP quadrado (crop centralizado). EXIF stripado."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return False
    try:
        with Image.open(src) as im:
            im = ImageOps.exif_transpose(im)
            im = im.convert("RGB")
            # Crop quadrado central + resize
            w, h = im.size
            s = min(w, h)
            left = (w - s) // 2
            top = (h - s) // 2
            im = im.crop((left, top, left + s, top + s))
            im = im.resize((side, side), Image.LANCZOS)
            dst.parent.mkdir(parents=True, exist_ok=True)
            im.save(dst, "WEBP", quality=60, method=6)
        return True
    except Exception as e:
        print(f"  ⚠ thumb {src.name}: {e}", file=sys.stderr)
        return False


def build(proposals_path: Path, previews_dir: Path,
          branch: str, repo: str, out_path: Path,
          repo_root: Path | None = None) -> None:
    """
    Gera previews em previews_dir e escreve out_path com o corpo Markdown.
    repo_root é usado para calcular paths relativos dos thumbs.
    """
    root = repo_root or REPO_ROOT
    payload = json.loads(proposals_path.read_text(encoding="utf-8"))
    clusters = [c for c in payload.get("clusters", [])
                if c.get("action") != "orphan"]

    raw_base = f"https://raw.githubusercontent.com/{repo}/{branch}"

    lines: list[str] = []
    lines.append("## Preview da ingestão")
    lines.append("")
    lines.append(f"**Modo:** `{payload.get('mode', 'cluster')}`  ")
    lines.append(f"**Clusters não-órfãos:** {len(clusters)}")
    lines.append("")

    if not clusters:
        lines.append("_Nenhum cluster ativo. Veja `proposals.json` para detalhes._")
        out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return

    for cl in clusters:
        cid = cl["id"]
        tid = cl.get("suggested_trip_id") or cl.get("merge_with") or cid
        stats = cl.get("stats", {})
        photos = stats.get("photos", 0)
        videos = stats.get("videos", 0)
        action = cl.get("action", "create")
        action_label = {
            "create": "criar nova viagem",
            "merge": f"merge com `{cl.get('merge_with')}`",
        }.get(action, action)

        lines.append(f"### `{tid}` — {action_label}")
        lines.append("")
        bullets = [
            f"- **Período:** {cl.get('start_date', '?')} → {cl.get('end_date', '?')}",
            f"- **Local:** {cl.get('place') or '(sem geocoding)'} "
            f"{('· ' + cl.get('country')) if cl.get('country') else ''}",
            f"- **Mídia:** Detectadas **{photos} fotos** + **{videos} vídeos**",
        ]
        lines += bullets
        lines.append("")

        # Gera previews para esse cluster
        preview_items = _pick_preview_items(cl.get("items", []), n=4)
        thumb_dir = previews_dir / cid
        thumb_urls: list[tuple[str, str]] = []
        for i, item in enumerate(preview_items):
            if item.get("type") != "image":
                continue
            src = Path(item.get("path", ""))
            if not src.exists():
                continue
            dst = thumb_dir / f"{i}.webp"
            if not _make_thumb(src, dst):
                continue
            rel = dst.relative_to(root).as_posix()
            url = f"{raw_base}/{rel}"
            cap = _caption_for(item, cl.get("place"))
            thumb_urls.append((url, cap))

        # Grid 2×2 inline (tabela markdown — única forma de grid em comment)
        if thumb_urls:
            lines.append("| | |")
            lines.append("|---|---|")
            pairs = [thumb_urls[i:i + 2] for i in range(0, len(thumb_urls), 2)]
            for row in pairs:
                cells = []
                for url, _ in row:
                    cells.append(f"![preview]({url})")
                while len(cells) < 2:
                    cells.append("")
                lines.append(f"| {cells[0]} | {cells[1]} |")
            lines.append("")

        # Lista de legendas geradas (todas as fotos do cluster — máx 25 pra não explodir)
        if cl.get("items"):
            lines.append("**Legendas geradas (`caption_auto: true` — edite no JSON se quiser):**")
            lines.append("")
            for item in cl["items"][:25]:
                if item.get("type") != "image":
                    continue
                cap = _caption_for(item, cl.get("place"))
                lines.append(f"- {cap}")
            if len(cl["items"]) > 25:
                lines.append(f"- … e mais {len(cl['items']) - 25} item(ns) (ver `proposals.json`).")
            lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("⚠ Edite o `proposals.json` neste PR para corrigir captions, "
                 "trip-ids ou marcar clusters como `orphan`. **Não há merge automático.** "
                 "Quando aprovar, rode o workflow `ingest` com `stage=apply`.")

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"✓ PR body em {out_path}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Gera previews + body de PR para proposals.json.")
    ap.add_argument("--proposals", type=Path, default=REPO_ROOT / "proposals.json")
    ap.add_argument("--previews-dir", type=Path,
                    default=REPO_ROOT / "previews" / "ingest")
    ap.add_argument("--branch", default="chore/ingest-proposals")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY",
                                                     "edurcampos86-jpg/viagens"))
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "pr-body.md")
    ap.add_argument("--repo-root", type=Path, default=REPO_ROOT,
                    help="Raiz do repo (usada p/ paths relativos nas URLs raw).")
    args = ap.parse_args(argv)

    if not args.proposals.exists():
        print(f"✗ proposals.json não encontrado: {args.proposals}", file=sys.stderr)
        return 2

    build(args.proposals, args.previews_dir, args.branch, args.repo, args.out,
          repo_root=args.repo_root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
