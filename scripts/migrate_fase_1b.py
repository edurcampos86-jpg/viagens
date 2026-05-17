"""
migrate_fase_1b.py — migração determinística da Fase 1b.

Escopo: apenas conversões que NÃO precisam de input humano:
  1. `logistics.hotels[]` (lista de strings) → `hospedagem[]` (lista de
     objetos {nome}). Mantém `logistics.hotels` intacto para não
     quebrar o `app.js` atual.
  2. Atualiza metadados (`atualizado_em`).

Tudo que depende de informação que só o Eduardo tem
(companhia, decisões pendentes, tags, documentos, orçamento estimado,
inspiração, passaporte válido_ate, etc.) é deixado para coleta
posterior — este script NÃO inventa esses dados.

Uso:
    python scripts/migrate_fase_1b.py              # aplica e salva
    python scripts/migrate_fase_1b.py --dry-run    # mostra o que faria
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"


def migrate(trips_data: dict) -> tuple[dict, dict]:
    """Aplica as conversões determinísticas. Retorna (novo_json, relatório)."""
    report = {
        "trips_total": len(trips_data.get("trips", [])),
        "hospedagem_criada": 0,
        "hospedagem_ja_existia": 0,
        "sem_hoteis": 0,
        "detalhes": [],
    }

    for trip in trips_data.get("trips", []):
        tid = trip.get("id", "?")
        legacy_hotels = (trip.get("logistics") or {}).get("hotels") or []

        if "hospedagem" in trip:
            report["hospedagem_ja_existia"] += 1
            continue

        if not legacy_hotels:
            report["sem_hoteis"] += 1
            continue

        trip["hospedagem"] = [{"nome": h} for h in legacy_hotels if h]
        report["hospedagem_criada"] += 1
        report["detalhes"].append({"id": tid, "hoteis": len(legacy_hotels)})

    trips_data["atualizado_em"] = date.today().isoformat()
    trips_data["fonte"] = (
        trips_data.get("fonte", "")
        + " · Fase 1b: hospedagem[] derivada de logistics.hotels[]"
    ).strip(" ·")

    return trips_data, report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Não escreve, só mostra o relatório.")
    args = parser.parse_args()

    with TRIPS_PATH.open("r", encoding="utf-8") as f:
        original = json.load(f)

    new_data, report = migrate(original)

    print(f"Migração Fase 1b — {report['trips_total']} viagens analisadas")
    print(f"  hospedagem[] criada:        {report['hospedagem_criada']}")
    print(f"  hospedagem[] já existia:    {report['hospedagem_ja_existia']}")
    print(f"  sem hotéis no logistics:    {report['sem_hoteis']}")

    if args.dry_run:
        print("\n(dry-run) Nenhuma escrita.")
        return 0

    with TRIPS_PATH.open("w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"\nEscrito em {TRIPS_PATH.relative_to(REPO_ROOT)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
