#!/usr/bin/env python3
"""migrate_v2_data_to_bookings.py — popula bookings.{flights,stays} retroativamente.

Implementa a Fase 3 do plano em docs/ADR-001-schema-canonico.md.

Aditivo e idempotente: deriva bookings.flights de trip.air e bookings.stays
de trip.hospedagem[] (ou trip.logistics.hotels[] como fallback). Não toca
campos legacy — preserva air/hospedagem/logistics para compat com
assets/app.js. Não toca bookings.experiences (preservado se já populado).

Regras (ADR-001 §Decisão 2):
- Skip status in {wishlist, draft}
- Skip se bookings.flights OU bookings.stays já tem itens
- done   → status=confirmado, confirmada=true,  nota: contexto histórico
- planned→ status=pendente,   confirmada=false, nota: revisão manual
- flights: criticidade=alta · stays: criticidade=media · experiences: vazio
- Branch protection: --apply aborta se branch atual = main

Uso:
    py scripts/migrate_v2_data_to_bookings.py --dry-run   # gera preview
    py scripts/migrate_v2_data_to_bookings.py --apply     # aplica + backup
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path


DEFAULT_PATH = Path("data/trips.json")
PREVIEW_PATH = Path("data/trips.v3.preview.json")
BACKUP_DIR = Path("data/backups")
SCHEMAS_DIR = Path("data/schemas")
TRIPS_FILE_SCHEMA_PATH = SCHEMAS_DIR / "trips-file.schema.json"

SKIP_STATUSES = {"wishlist", "draft"}

NOTE_DONE_FLIGHT = (
    "Migrado retroativamente de trip.air via ADR-001 Fase 3. "
    "Viagem already done — confirmada=true assumida por contexto histórico."
)
NOTE_DONE_STAY = (
    "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. "
    "Viagem already done — confirmada=true assumida por contexto histórico."
)
NOTE_DONE_STAY_FROM_LOGISTICS = (
    "Migrado retroativamente de trip.logistics.hotels via ADR-001 Fase 3. "
    "Viagem already done — confirmada=true assumida por contexto histórico."
)
NOTE_PLANNED_FLIGHT = (
    "Migrado retroativamente de trip.air via ADR-001 Fase 3. "
    "Status=pendente até revisão manual de reservas reais."
)
NOTE_PLANNED_STAY = (
    "Migrado retroativamente de trip.hospedagem via ADR-001 Fase 3. "
    "Status=pendente até revisão manual de reservas reais."
)
NOTE_PLANNED_STAY_FROM_LOGISTICS = (
    "Migrado retroativamente de trip.logistics.hotels via ADR-001 Fase 3. "
    "Status=pendente até revisão manual de reservas reais."
)


def now_iso() -> str:
    return dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def current_branch() -> str | None:
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, check=True,
        )
        return r.stdout.strip()
    except Exception:
        return None


def extract_stay_titulo(h) -> str | None:
    """Extrai título de um item de hospedagem (aceita string ou objeto)."""
    if isinstance(h, str):
        s = h.strip()
        return s or None
    if isinstance(h, dict):
        for key in ("nome", "titulo", "name"):
            v = h.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    return None


def derive_bookings(trip: dict) -> tuple[dict | None, str]:
    """Retorna (new_bookings, summary). new_bookings=None significa skip."""
    status = trip.get("status")
    trip_id = trip.get("id", "<sem-id>")

    if status in SKIP_STATUSES:
        return None, f"skip status={status}"

    existing = trip.get("bookings") if isinstance(trip.get("bookings"), dict) else {}
    flights_existing = existing.get("flights") if isinstance(existing.get("flights"), list) else []
    stays_existing = existing.get("stays") if isinstance(existing.get("stays"), list) else []
    experiences_existing = existing.get("experiences") if isinstance(existing.get("experiences"), list) else []

    if len(flights_existing) > 0 or len(stays_existing) > 0:
        return None, "skip: bookings.flights ou .stays já populado"

    is_done = (status == "done")
    booking_status = "confirmado" if is_done else "pendente"
    confirmada = bool(is_done)

    note_flight = NOTE_DONE_FLIGHT if is_done else NOTE_PLANNED_FLIGHT
    note_stay_hospedagem = NOTE_DONE_STAY if is_done else NOTE_PLANNED_STAY
    note_stay_logistics = NOTE_DONE_STAY_FROM_LOGISTICS if is_done else NOTE_PLANNED_STAY_FROM_LOGISTICS

    flights: list[dict] = []
    stays: list[dict] = []

    air = trip.get("air")
    if isinstance(air, str) and air.strip():
        flights.append({
            "id": f"{trip_id}-fl-001",
            "titulo": air.strip(),
            "status": booking_status,
            "criticidade": "alta",
            "confirmada": confirmada,
            "notas": note_flight,
        })

    hospedagem = trip.get("hospedagem")
    if isinstance(hospedagem, list) and len(hospedagem) > 0:
        sources, source_field = hospedagem, "hospedagem"
        stay_note = note_stay_hospedagem
    else:
        logistics = trip.get("logistics") if isinstance(trip.get("logistics"), dict) else {}
        lh = logistics.get("hotels")
        if isinstance(lh, list) and len(lh) > 0:
            sources, source_field = lh, "logistics.hotels"
            stay_note = note_stay_logistics
        else:
            sources, source_field = [], None
            stay_note = note_stay_hospedagem

    seq = 1
    for h in sources:
        titulo = extract_stay_titulo(h)
        if not titulo:
            continue
        stays.append({
            "id": f"{trip_id}-st-{seq:03d}",
            "titulo": titulo,
            "status": booking_status,
            "criticidade": "media",
            "confirmada": confirmada,
            "notas": stay_note,
        })
        seq += 1

    new_bookings = {
        "flights": flights,
        "stays": stays,
        "experiences": experiences_existing,
    }
    if source_field:
        summary = f"flights:{len(flights)} stays:{len(stays)} (stays from {source_field})"
    else:
        summary = f"flights:{len(flights)} stays:0 (sem fonte)"
    return new_bookings, summary


def process_trips(content: dict) -> tuple[dict, dict]:
    """Aplica derive_bookings em cada trip. Retorna (new_content, report)."""
    trips = list(content.get("trips") or [])
    new_trips: list[dict] = []
    report = {
        "total": len(trips),
        "skipped_wishlist": 0,
        "skipped_draft": 0,
        "skipped_already_populated": 0,
        "upgraded": 0,
        "container_added": 0,
        "total_flights": 0,
        "total_stays": 0,
        "by_trip": [],
        "run_at": now_iso(),
    }

    for trip in trips:
        new_trip = dict(trip)
        tid = trip.get("id", "<sem-id>")
        status = trip.get("status")
        had_container = isinstance(trip.get("bookings"), dict)
        new_bookings, summary = derive_bookings(trip)

        if new_bookings is None:
            if status == "wishlist":
                report["skipped_wishlist"] += 1
            elif status == "draft":
                report["skipped_draft"] += 1
            else:
                report["skipped_already_populated"] += 1
            report["by_trip"].append({
                "id": tid, "status": status, "summary": summary, "action": "skip",
                "flights_n": 0, "stays_n": 0,
            })
        else:
            new_trip["bookings"] = new_bookings
            if not had_container:
                report["container_added"] += 1
            report["upgraded"] += 1
            report["total_flights"] += len(new_bookings["flights"])
            report["total_stays"] += len(new_bookings["stays"])
            report["by_trip"].append({
                "id": tid, "status": status, "summary": summary, "action": "upgrade",
                "flights_n": len(new_bookings["flights"]),
                "stays_n": len(new_bookings["stays"]),
            })
        new_trips.append(new_trip)

    new_content = dict(content)
    new_content["trips"] = new_trips
    return new_content, report


def print_report(report: dict, *, dry_run: bool) -> None:
    label = "DRY-RUN" if dry_run else "APPLY"
    print(f"\n=== Migration v2 data → bookings (mode: {label}) ===\n")
    print(f"Total trips processadas:                 {report['total']}")
    print(f"Viagens com bookings populados:          {report['upgraded']}")
    print(f"  (das quais ganharam container novo:    {report['container_added']})")
    print(f"Viagens puladas (wishlist):              {report['skipped_wishlist']}")
    print(f"Viagens puladas (draft):                 {report['skipped_draft']}")
    print(f"Viagens puladas (já tinham bookings):    {report['skipped_already_populated']}")
    print(f"Total de flights criados:                {report['total_flights']}")
    print(f"Total de stays criados:                  {report['total_stays']}")
    print()
    print("Detalhe por viagem:")
    for entry in report["by_trip"]:
        sym = "+" if entry["action"] == "upgrade" else "."
        line = f"  {sym} [{entry['id']:<32}] status={entry['status']:<10} | {entry['summary']}"
        print(line)


def validate_preview(preview_path: Path) -> bool:
    """Roda validação do preview file contra trips-file schema."""
    print(f"\n=== Validando {preview_path} contra trips-file.schema.json ===")
    try:
        from jsonschema import Draft202012Validator
        from referencing import Registry, Resource
        from referencing.jsonschema import DRAFT202012
    except ImportError as e:
        print(f"  ERRO: jsonschema não disponível: {e}", file=sys.stderr)
        return False

    registry = Registry()
    for schema_path in SCHEMAS_DIR.glob("*.schema.json"):
        with schema_path.open(encoding="utf-8") as f:
            schema = json.load(f)
        schema_id = schema.get("$id") or schema_path.name
        resource = Resource(contents=schema, specification=DRAFT202012)
        registry = registry.with_resource(uri=schema_id, resource=resource)
        registry = registry.with_resource(uri=schema_path.name, resource=resource)
        registry = registry.with_resource(uri=f"./{schema_path.name}", resource=resource)

    with TRIPS_FILE_SCHEMA_PATH.open(encoding="utf-8") as f:
        schema = json.load(f)
    with preview_path.open(encoding="utf-8") as f:
        data = json.load(f)

    validator = Draft202012Validator(schema, registry=registry)
    errors = list(validator.iter_errors(data))
    if errors:
        print(f"  FAIL: {len(errors)} erro(s) de validação", file=sys.stderr)
        for err in errors[:10]:
            path_str = "/".join(str(p) for p in err.absolute_path) or "(raiz)"
            print(f"    {path_str}: {err.message}", file=sys.stderr)
        if len(errors) > 10:
            print(f"    … e mais {len(errors) - 10} erro(s)", file=sys.stderr)
        return False
    print(f"  OK: {preview_path} valida contra o schema")
    return True


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", default=str(DEFAULT_PATH), type=Path)
    p.add_argument("--dry-run", action="store_true", help="Gera preview sem alterar trips.json")
    p.add_argument("--apply", action="store_true", help="Aplica + backup + valida")
    args = p.parse_args(argv)

    if not (args.dry_run or args.apply):
        print("ERRO: passe --dry-run OU --apply", file=sys.stderr)
        return 2
    if args.dry_run and args.apply:
        print("ERRO: --dry-run e --apply são mutuamente exclusivos", file=sys.stderr)
        return 2

    if args.apply:
        branch = current_branch()
        if branch == "main":
            print("ERRO: --apply não pode rodar em main. Crie uma branch dedicada.", file=sys.stderr)
            return 2
        print(f"Branch atual: {branch} (não é main — OK)")

    inp = args.input
    if not inp.exists():
        print(f"ERRO: {inp} não encontrado", file=sys.stderr)
        return 1

    with inp.open(encoding="utf-8") as f:
        content = json.load(f)

    new_content, report = process_trips(content)

    if args.dry_run:
        text = json.dumps(new_content, ensure_ascii=False, indent=2) + "\n"
        PREVIEW_PATH.write_text(text, encoding="utf-8")
        print_report(report, dry_run=True)
        print(f"\nPreview gravado em: {PREVIEW_PATH}")
        ok = validate_preview(PREVIEW_PATH)
        return 0 if ok else 1

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.utcnow().strftime("%Y%m%dT%H%M%S")
    backup = BACKUP_DIR / f"trips-pre-bookings-data-{stamp}.json"
    shutil.copy2(inp, backup)
    print(f"Backup criado: {backup}")

    text = json.dumps(new_content, ensure_ascii=False, indent=2) + "\n"
    inp.write_text(text, encoding="utf-8")
    print_report(report, dry_run=False)
    print(f"\nAplicado em: {inp}")

    print("\n=== Validação pós-apply (scripts/validate_schemas.py) ===")
    r = subprocess.run([sys.executable, "scripts/validate_schemas.py"])
    if r.returncode != 0:
        print("\n!!! VALIDAÇÃO FALHOU APÓS APPLY — restaurando do backup !!!", file=sys.stderr)
        shutil.copy2(backup, inp)
        print(f"Restaurado: {inp} ← {backup}", file=sys.stderr)
        return 1

    print("\n✓ Migração aplicada e validada com sucesso.")
    print(f"  Backup preservado em: {backup}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
