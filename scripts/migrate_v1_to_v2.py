#!/usr/bin/env python3
"""Migration v1 → v2 do data/trips.json.

Aditiva e idempotente: campos legados (year, month, nts, lat, lon, highlights,
logistics, etc.) são preservados intactos. A v2 introduz containers vazios
para `bookings`, `budget`, `checklist` e metadados (`created_at`, `updated_at`)
quando ausentes. NÃO inventa datas precisas (`dates.start/end`) — para legacy
o reader continua usando year/month via schema.js.

Uso:
    python3 scripts/migrate_v1_to_v2.py [--dry-run] [--input data/trips.json] [--output data/trips.json]

Cria backup antes de sobrescrever (data/backups/trips-pre-v2-<timestamp>.json).
"""

import argparse
import datetime as dt
import json
import shutil
import sys
from pathlib import Path

MIGRATION_VERSION = 2
DEFAULT_PATH = Path("data/trips.json")
BACKUP_DIR = Path("data/backups")
NORMALIZE_STATUS = {
    "em_planejamento": "planned",
    "in_progress": "in_progress",
    "planned": "planned",
    "done": "done",
    "wishlist": "wishlist",
}


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def synth_created_at(trip: dict) -> str:
    """Deriva um `created_at` a partir do year/month se houver — só p/ legacy."""
    y = trip.get("year")
    m = trip.get("month") or 1
    if isinstance(y, int) and isinstance(m, int):
        try:
            return dt.datetime(y, m, 1).isoformat() + "Z"
        except ValueError:
            pass
    return "2021-01-01T00:00:00Z"


def upgrade_trip(trip: dict, *, run_at: str) -> tuple[dict, list[str]]:
    """Retorna (trip_v2, lista_de_mudanças)."""
    changes: list[str] = []
    out = dict(trip)  # copia rasa preserva tudo que já existe

    # 1. Status canônico (em_planejamento → planned)
    raw_status = out.get("status")
    if raw_status in NORMALIZE_STATUS and NORMALIZE_STATUS[raw_status] != raw_status:
        out["status"] = NORMALIZE_STATUS[raw_status]
        changes.append(f"status: {raw_status} → {out['status']}")

    # 2. Containers v2 (apenas se ausentes — sem clobber)
    if "bookings" not in out:
        out["bookings"] = {"flights": [], "stays": [], "experiences": []}
        changes.append("bookings: container vazio adicionado")

    if "budget" not in out:
        out["budget"] = {"planned": {}, "actual": {}, "currency": "BRL"}
        changes.append("budget: container vazio adicionado")

    if "checklist" not in out:
        out["checklist"] = []
        changes.append("checklist: lista vazia adicionada")

    # 3. Normaliza `notes`: se já existe como string, embrulha em { general }.
    notes = out.get("notes")
    if isinstance(notes, str):
        out["notes"] = {"general": notes}
        changes.append("notes: string → objeto {general}")
    elif notes is None:
        # Não criamos notes vazio — fica omitido.
        pass

    # 4. Metadados
    if "created_at" not in out:
        out["created_at"] = synth_created_at(out)
        changes.append(f"created_at sintetizado: {out['created_at']}")
    if "updated_at" not in out:
        out["updated_at"] = run_at
        changes.append("updated_at adicionado")

    # 5. Marcador de schema (idempotente)
    out["_schema"] = MIGRATION_VERSION

    return out, changes


def upgrade_file(content: dict) -> tuple[dict, dict]:
    """Retorna (content_v2, relatório)."""
    run_at = now_iso()
    trips = list(content.get("trips") or [])
    upgraded = []
    report: dict = {
        "total": len(trips),
        "already_v2": 0,
        "upgraded": 0,
        "by_trip": {},
        "schema_version": MIGRATION_VERSION,
        "run_at": run_at,
    }
    for t in trips:
        if t.get("_schema") == MIGRATION_VERSION:
            report["already_v2"] += 1
            upgraded.append(t)
            continue
        new_t, changes = upgrade_trip(t, run_at=run_at)
        upgraded.append(new_t)
        if changes:
            report["upgraded"] += 1
            report["by_trip"][t.get("id", "<sem id>")] = changes

    out = dict(content)
    out["trips"] = upgraded
    out["atualizado_em"] = run_at
    out["_schema"] = MIGRATION_VERSION
    return out, report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", default=str(DEFAULT_PATH), type=Path)
    p.add_argument("--output", default=None, type=Path)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-backup", action="store_true")
    args = p.parse_args(argv)

    inp: Path = args.input
    out: Path = args.output or inp

    with inp.open("r", encoding="utf-8") as f:
        content = json.load(f)

    new_content, report = upgrade_file(content)

    print(
        f"Migration v1→v2: {report['upgraded']} viagens atualizadas, "
        f"{report['already_v2']} já em v{MIGRATION_VERSION} (total {report['total']})."
    )
    if report["by_trip"]:
        for tid, changes in list(report["by_trip"].items())[:5]:
            print(f"  • {tid}: {', '.join(changes[:3])}")
        if len(report["by_trip"]) > 5:
            print(f"  … e mais {len(report['by_trip']) - 5} viagens.")

    if args.dry_run:
        print("--dry-run ativo; nada foi gravado.")
        return 0

    if not args.no_backup and out.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
        backup = BACKUP_DIR / f"trips-pre-v{MIGRATION_VERSION}-{stamp}.json"
        shutil.copy2(inp, backup)
        print(f"Backup: {backup}")

    text = json.dumps(new_content, ensure_ascii=False, indent=2) + "\n"
    out.write_text(text, encoding="utf-8")
    print(f"Gravado: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
