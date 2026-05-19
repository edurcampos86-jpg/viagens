#!/usr/bin/env python3
"""Computa data/benchmarks.json a partir de data/trips.json.

Para cada viagem com `budget.actual` populado, agrega por continente
e por país. Produz:
- diária média (total realizado / nts)
- custo médio de voo
- ranking de hotéis por custo-benefício (preço/noite, viagens onde
  funcionou bem — medido por presença em logistics.hotels)

Idempotente. Roda como parte do pipeline `make benchmarks` ou
manualmente; resultado fica versionado para benefício de quem só lê.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import statistics
from collections import defaultdict
from pathlib import Path

DEFAULT_INPUT = Path("data/trips.json")
DEFAULT_OUTPUT = Path("data/benchmarks.json")


def trip_actual_total(trip: dict) -> float:
    actual = trip.get("budget", {}).get("actual") or {}
    return sum(v for v in actual.values() if isinstance(v, (int, float)))


def trip_flight_total(trip: dict) -> float:
    actual = trip.get("budget", {}).get("actual") or {}
    return float(actual.get("flights") or 0)


def trip_stay_total(trip: dict) -> float:
    actual = trip.get("budget", {}).get("actual") or {}
    return float(actual.get("stays") or 0)


def trip_nts(trip: dict) -> int | None:
    """Pega nts já calculado ou deriva de dates.start/end."""
    if isinstance(trip.get("nts"), int) and trip["nts"] > 0:
        return trip["nts"]
    dates = trip.get("dates") or {}
    s, e = dates.get("start"), dates.get("end")
    if not s or not e:
        return None
    try:
        return (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days
    except ValueError:
        return None


def aggregate(trips: list[dict]) -> dict:
    """Constrói o documento de benchmarks."""
    by_continent: dict[str, dict] = defaultdict(
        lambda: {
            "trips_count": 0,
            "daily_costs": [],
            "flight_costs": [],
            "stay_costs": [],
        }
    )
    by_country: dict[str, dict] = defaultdict(
        lambda: {"trips_count": 0, "daily_costs": [], "flight_costs": []}
    )
    hotels: dict[str, dict] = {}

    for trip in trips:
        actual_total = trip_actual_total(trip)
        if actual_total <= 0:
            continue
        nts = trip_nts(trip)
        continent = trip.get("continent") or "—"
        country = trip.get("country") or "—"

        c = by_continent[continent]
        c["trips_count"] += 1
        if nts and nts > 0:
            c["daily_costs"].append(actual_total / nts)
        c["flight_costs"].append(trip_flight_total(trip))
        c["stay_costs"].append(trip_stay_total(trip))

        ct = by_country[country]
        ct["trips_count"] += 1
        if nts and nts > 0:
            ct["daily_costs"].append(actual_total / nts)
        ct["flight_costs"].append(trip_flight_total(trip))

        # Hotéis: nome textual em logistics.hotels[] + preço/noite estimado
        # (stay_total dividido por nts, atribuído a cada hotel uniformemente)
        for hotel in trip.get("logistics", {}).get("hotels", []) or []:
            key = f"{country}::{hotel}"
            rec = hotels.setdefault(
                key,
                {
                    "name": hotel,
                    "country": country,
                    "appearances": 0,
                    "trips_count": 0,
                    "estimated_price_per_night": [],
                },
            )
            rec["appearances"] += 1
            rec["trips_count"] += 1
            if nts and nts > 0 and trip_stay_total(trip) > 0:
                rec["estimated_price_per_night"].append(trip_stay_total(trip) / nts)

    def summarize(rec: dict) -> dict:
        out = {"trips_count": rec["trips_count"]}
        for k in ("daily_costs", "flight_costs", "stay_costs"):
            arr = rec.get(k) or []
            if not arr:
                continue
            out[k.replace("_costs", "")] = {
                "avg": round(statistics.mean(arr), 2),
                "median": round(statistics.median(arr), 2),
                "min": round(min(arr), 2),
                "max": round(max(arr), 2),
                "n": len(arr),
            }
        return out

    return {
        "version": "1.0",
        "computed_at": dt.datetime.utcnow().isoformat() + "Z",
        "source_file": "data/trips.json",
        "by_continent": {k: summarize(v) for k, v in by_continent.items()},
        "by_country": {k: summarize(v) for k, v in by_country.items()},
        "hotels": sorted(
            (
                {
                    "name": h["name"],
                    "country": h["country"],
                    "appearances": h["appearances"],
                    "avg_price_per_night": (
                        round(statistics.mean(h["estimated_price_per_night"]), 2)
                        if h["estimated_price_per_night"]
                        else None
                    ),
                }
                for h in hotels.values()
            ),
            key=lambda x: x["appearances"],
            reverse=True,
        ),
    }


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    p.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args(argv)

    data = json.loads(args.input.read_text(encoding="utf-8"))
    bench = aggregate(data.get("trips") or [])

    if args.dry_run:
        print(json.dumps(bench, ensure_ascii=False, indent=2)[:2000])
        print(f"… (truncado).  by_continent: {len(bench['by_continent'])}, "
              f"by_country: {len(bench['by_country'])}, hotels: {len(bench['hotels'])}")
        return 0

    text = json.dumps(bench, ensure_ascii=False, indent=2) + "\n"
    args.output.write_text(text, encoding="utf-8")
    print(f"Gravado: {args.output}  ({len(bench['by_continent'])} continentes, "
          f"{len(bench['by_country'])} países, {len(bench['hotels'])} hotéis)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
