#!/usr/bin/env python3
"""
apply_proposals.py — aplica proposals.json (já otimizado) em data/trips.json.

Para cada cluster com action=create: adiciona uma nova trip básica.
Para cada cluster com action=merge: anexa media[] em trip já existente.
Para action=orphan: pula (deixar para revisão manual).

Sempre roda validate_schemas.py antes de salvar — falha se invalidar.
Gera INGEST-LOG.md com sumário do que foi aplicado.

Uso:
  python scripts/apply_proposals.py
  python scripts/apply_proposals.py --proposals proposals.json --dry-run
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROPOSALS = REPO_ROOT / "proposals.json"
TRIPS_JSON = REPO_ROOT / "data" / "trips.json"
INGEST_LOG = REPO_ROOT / "INGEST-LOG.md"


def load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def save_json(p: Path, data: dict):
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def gallery_from_optimized(opt_items: list[dict]) -> list[dict]:
    """Filtra campos None e mapeia para o schema do media.gallery."""
    out = []
    for it in opt_items:
        d = {"type": it["type"], "src": it["src"]}
        for k in ("thumb", "poster", "caption", "date", "lat", "lon",
                  "width", "height", "duration"):
            if it.get(k) is not None:
                d[k] = it[k]
        out.append(d)
    return out


def apply_to_existing_trip(trip: dict, cluster: dict, opt_items: list[dict]) -> dict:
    """Anexa media[] a uma trip que já existe. Não duplica."""
    gallery = gallery_from_optimized(opt_items)
    cover = gallery[0]["src"] if gallery else None
    existing = trip.get("media") or {}
    existing_srcs = {g.get("src") for g in (existing.get("gallery") or [])}
    new_gallery = (existing.get("gallery") or []) + [
        g for g in gallery if g["src"] not in existing_srcs
    ]
    photos = sum(1 for g in new_gallery if g["type"] == "image")
    videos = sum(1 for g in new_gallery if g["type"] == "video")
    trip["media"] = {
        "cover": existing.get("cover") or cover,
        "gallery": new_gallery,
        "stats": {"photos": photos, "videos": videos},
    }
    trip["updated_at"] = datetime.now(timezone.utc).isoformat()
    return trip


def new_trip_from_cluster(cluster: dict, opt_items: list[dict]) -> dict:
    """Cria nova trip básica a partir de cluster + mídia otimizada."""
    gallery = gallery_from_optimized(opt_items)
    cover = gallery[0]["src"] if gallery else None
    photos = sum(1 for g in gallery if g["type"] == "image")
    videos = sum(1 for g in gallery if g["type"] == "video")
    start = cluster.get("start_date")
    end = cluster.get("end_date")
    year = int(start[:4]) if start else None
    month = int(start[5:7]) if start else None
    nts = None
    if start and end:
        try:
            sd = datetime.strptime(start, "%Y-%m-%d")
            ed = datetime.strptime(end, "%Y-%m-%d")
            nts = max(0, (ed - sd).days)
        except ValueError:
            pass
    return {
        "id": cluster.get("suggested_trip_id") or cluster["id"],
        "name": (cluster.get("place") or "Viagem").title(),
        "status": "done",
        "country": cluster.get("country"),
        "country_code": cluster.get("country_code"),
        "year": year,
        "month": month,
        "label": f"{_month_pt(month)} {year}" if year and month else None,
        "startDate": start,
        "endDate": end,
        "nts": nts,
        "lat": cluster.get("center_lat"),
        "lon": cluster.get("center_lon"),
        "media": {
            "cover": cover,
            "gallery": gallery,
            "stats": {"photos": photos, "videos": videos},
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "_schema": 2,
        "_source": "ingest_takeout",
    }


def _month_pt(m: int | None) -> str:
    return ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez"][m or 0]


def validate_or_die(trips_path: Path) -> None:
    """Roda validate_schemas.py. Se falhar, lança SystemExit(2)."""
    script = REPO_ROOT / "scripts" / "validate_schemas.py"
    r = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
    if r.returncode != 0:
        print("✗ validate_schemas.py falhou — abortando apply.", file=sys.stderr)
        print(r.stdout, file=sys.stderr)
        print(r.stderr, file=sys.stderr)
        raise SystemExit(2)


def write_log(log_path: Path, summary: dict, details: list[dict]) -> None:
    """Gera INGEST-LOG.md em Markdown."""
    lines = [
        "# INGEST-LOG — última ingestão de mídia",
        "",
        f"**Data:** {datetime.now(timezone.utc).isoformat()}  ",
        f"**Fonte:** `{summary.get('source', 'proposals.json')}`",
        "",
        "## Sumário",
        "",
        f"- Clusters processados: **{summary['processed']}**",
        f"- Novas viagens criadas: **{summary['created']}**",
        f"- Viagens enriquecidas (merge): **{summary['merged']}**",
        f"- Órfãos ignorados: **{summary['skipped_orphan']}**",
        f"- Fotos totais agregadas: **{summary['photos']}**",
        f"- Vídeos totais agregados: **{summary['videos']}**",
        "",
        "## Detalhe por cluster",
        "",
    ]
    for d in details:
        lines.append(
            f"- **{d['cluster_id']}** → `{d['action']}` em `{d['trip_id']}` "
            f"({d['photos']} fotos, {d['videos']} vídeos)"
        )
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply(proposals_path: Path, trips_path: Path, *,
          dry_run: bool = False, log_path: Path | None = None) -> dict:
    """API programática (usada também pelos testes).

    log_path: se omitido, usa INGEST_LOG global. Testes devem passar
    um tmp_path para nao poluir o repo root.
    """
    proposals = load_json(proposals_path)
    trips_doc = load_json(trips_path)
    trips_list = trips_doc.get("trips", [])
    by_id = {t["id"]: t for t in trips_list}
    optimized = proposals.get("_optimized") or {}
    log_target = log_path or INGEST_LOG

    summary = {"processed": 0, "created": 0, "merged": 0,
               "skipped_orphan": 0, "photos": 0, "videos": 0,
               "source": str(proposals_path)}
    details: list[dict] = []

    for cluster in proposals.get("clusters", []):
        cid = cluster["id"]
        action = cluster.get("action", "create")
        opt = optimized.get(cid, [])
        photos = sum(1 for o in opt if o["type"] == "image")
        videos = sum(1 for o in opt if o["type"] == "video")

        if action == "orphan":
            summary["skipped_orphan"] += 1
            details.append({"cluster_id": cid, "action": "orphan",
                            "trip_id": "—", "photos": photos, "videos": videos})
            continue

        if not opt:
            print(f"  ⚠ cluster {cid} sem '_optimized' — pulando", file=sys.stderr)
            continue

        if action == "merge" and cluster.get("merge_with") in by_id:
            tid = cluster["merge_with"]
            apply_to_existing_trip(by_id[tid], cluster, opt)
            summary["merged"] += 1
        else:
            new_trip = new_trip_from_cluster(cluster, opt)
            tid = new_trip["id"]
            if tid in by_id:
                # Colisão de ID — sufixa com -dup-N
                k = 2
                while f"{tid}-dup-{k}" in by_id:
                    k += 1
                new_trip["id"] = f"{tid}-dup-{k}"
                tid = new_trip["id"]
            trips_list.append(new_trip)
            by_id[tid] = new_trip
            summary["created"] += 1

        summary["processed"] += 1
        summary["photos"] += photos
        summary["videos"] += videos
        details.append({"cluster_id": cid, "action": action,
                        "trip_id": tid, "photos": photos, "videos": videos})

    trips_doc["trips"] = trips_list

    if not dry_run:
        save_json(trips_path, trips_doc)
        validate_or_die(trips_path)
        write_log(log_target, summary, details)
        print(f"✓ {trips_path.name} atualizado; log em {log_target.name}",
              file=sys.stderr)
    return {"summary": summary, "details": details}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Aplica proposals.json em data/trips.json")
    ap.add_argument("--proposals", type=Path, default=DEFAULT_PROPOSALS)
    ap.add_argument("--trips", type=Path, default=TRIPS_JSON)
    ap.add_argument("--dry-run", action="store_true",
                    help="Não escreve trips.json nem INGEST-LOG.md")
    args = ap.parse_args(argv)

    if not args.proposals.exists():
        print(f"✗ proposals.json não encontrado: {args.proposals}", file=sys.stderr)
        return 2

    res = apply(args.proposals, args.trips, dry_run=args.dry_run)
    s = res["summary"]
    print(f"\nResumo: {s['processed']} cluster(s) → "
          f"{s['created']} criados + {s['merged']} merge "
          f"({s['photos']} fotos, {s['videos']} vídeos). "
          f"{s['skipped_orphan']} órfãos pulados.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
