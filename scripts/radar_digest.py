#!/usr/bin/env python3
"""Radar de Viagens — digest semanal de prontidão no Slack (read-only).

Lê data/trips.json (+ data/eventos/<id>.json) e, para cada viagem FUTURA,
calcula o "score de prontidão" e o que falta — porte FIEL das regras de
src/core/readiness.js (Etapa A). Ordena por daysUntil e inclui só viagens que
ainda pedem atenção (score < 100% OU dentro de ~90 dias).

NÃO escreve nada nos dados — apenas lê e (opcionalmente) posta no Slack.

Uso:
  python scripts/radar_digest.py --dry-run     # imprime a mensagem, NÃO posta
  python scripts/radar_digest.py               # posta via SLACK_WEBHOOK_URL
  RADAR_TODAY=2026-06-03 python scripts/radar_digest.py --dry-run

Variáveis de ambiente:
  SLACK_WEBHOOK_URL   webhook do Slack (secret existente; sem ele, só imprime)
  RADAR_TODAY         opcional — sobrescreve a data de hoje (YYYY-MM-DD)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
TRIPS_PATH = DATA_DIR / "trips.json"
EVENTOS_DIR = DATA_DIR / "eventos"

# Janela de proximidade: viagem dentro disto entra no digest mesmo se "pronta".
PROXIMO_DIAS = 90

# ── Porte fiel de src/core/readiness.js ─────────────────────────────────────
FUTURE_STATUSES = {"planned", "wishlist", "draft", "em_planejamento"}

# Marcadores de texto-placeholder num "roteiro" (highlights) ainda não real.
PLACEHOLDER_RE = re.compile(
    r"placeholder|lorem|\btbd\b|\btodo\b|a definir|^\s*\?+\s*$|xxx+", re.IGNORECASE
)

SLOT_DEFS = [
    ("voo", "Voo"),
    ("hospedagem", "Hospedagem"),
    ("eventos", "Eventos/ingressos"),
    ("locomocao", "Locomoção"),
    ("roteiro", "Roteiro"),
    ("orcamento", "Orçamento"),
]


def _arr(x):
    return x if isinstance(x, list) else []


def _bookings(trip, key):
    b = trip.get("bookings") if isinstance(trip, dict) else None
    return _arr(b.get(key)) if isinstance(b, dict) else []


def compute_days_until(trip, today: date) -> Optional[int]:
    s = trip.get("startDate") if isinstance(trip, dict) else None
    if not (isinstance(s, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s)):
        return None
    try:
        start = date.fromisoformat(s)
    except ValueError:
        return None
    return (start - today).days


def is_future_trip(trip, today: date) -> bool:
    if not isinstance(trip, dict):
        return False
    if trip.get("status") in FUTURE_STATUSES:
        return True
    d = compute_days_until(trip, today)
    return d is not None and d >= 0


def slot_voo(trip) -> str:
    flights = _bookings(trip, "flights")
    if not flights:
        return "faltando"
    ok = any(
        isinstance(f, dict) and (f.get("confirmada") is True or f.get("status") == "confirmado")
        for f in flights
    )
    return "ok" if ok else "faltando"


def slot_hospedagem(trip) -> str:
    # Lar canônico (ADR-001): bookings.stays[]. NÃO usa hospedagem[] legado.
    return "ok" if _bookings(trip, "stays") else "faltando"


def slot_eventos(eventos) -> str:
    if eventos is None:
        return "na"  # sem loader/dados => indeterminável
    ok = any(isinstance(e, dict) and e.get("status") == "confirmado" for e in _arr(eventos))
    return "ok" if ok else "faltando"


def slot_locomocao(trip) -> str:
    exp = _bookings(trip, "experiences")
    transp = _arr(trip.get("transporte")) if isinstance(trip, dict) else []
    return "ok" if (exp or transp) else "na"


def slot_roteiro(trip) -> str:
    hs = [h for h in _arr(trip.get("highlights")) if isinstance(h, str) and h.strip()]
    if not hs:
        return "faltando"
    if any(PLACEHOLDER_RE.search(h) for h in hs):
        return "faltando"
    return "ok"


def slot_orcamento(trip) -> str:
    b = trip.get("budget") if isinstance(trip, dict) else None
    if b is None:
        return "na"  # campo inexistente
    buckets = [bk for bk in (b.get("planned"), b.get("actual")) if isinstance(bk, dict)]
    has_value = any(
        any(isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in bk.values())
        for bk in buckets
    )
    return "ok" if has_value else "faltando"


def load_eventos(trip_id: str):
    """Espelha src/core/eventos-data.js: data/eventos/<id>.json -> lista (ou []).
    Arquivo ausente/ inválido => [] (nunca None, como o loader do app)."""
    if not isinstance(trip_id, str) or not trip_id:
        return []
    path = EVENTOS_DIR / f"{trip_id}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else []


def compute_readiness(trip, today: date) -> dict:
    eventos = load_eventos(trip.get("id"))
    status_by_id = {
        "voo": slot_voo(trip),
        "hospedagem": slot_hospedagem(trip),
        "eventos": slot_eventos(eventos),
        "locomocao": slot_locomocao(trip),
        "roteiro": slot_roteiro(trip),
        "orcamento": slot_orcamento(trip),
    }
    slots = [{"id": sid, "label": label, "status": status_by_id[sid]} for sid, label in SLOT_DEFS]
    applicable = [s for s in slots if s["status"] != "na"]
    ok_count = sum(1 for s in applicable if s["status"] == "ok")
    score = (ok_count / len(applicable)) if applicable else 1.0
    faltando = [{"id": s["id"], "label": s["label"]} for s in slots if s["status"] == "faltando"]
    return {
        "id": trip.get("id"),
        "name": trip.get("name") or trip.get("id"),
        "score": score,
        "daysUntil": compute_days_until(trip, today),
        "future": is_future_trip(trip, today),
        "faltando": faltando,
    }


# ── Digest ──────────────────────────────────────────────────────────────────
def fmt_prazo(d: Optional[int]) -> str:
    if d is None:
        return "sem data"
    if d < 0:
        return "em andamento"
    if d == 0:
        return "hoje"
    if d == 1:
        return "amanhã"
    if d < 45:
        return f"em {d} dias"
    if d < 365:
        return f"em {round(d / 30)} meses"
    return f"em {d / 365:.1f} anos"


def select_for_digest(trips: list, today: date) -> list:
    items = []
    for t in trips:
        r = compute_readiness(t, today)
        if not r["future"]:
            continue
        d = r["daysUntil"]
        # Só o que ainda pede atenção: incompleto OU dentro da janela próxima.
        if r["score"] < 1.0 or (d is not None and 0 <= d <= PROXIMO_DIAS):
            items.append(r)
    items.sort(key=lambda r: (r["daysUntil"] is None, r["daysUntil"] if r["daysUntil"] is not None else 0))
    return items


def render_message(items: list, today: date) -> str:
    if not items:
        return f"*🧭 Radar de Viagens — {today.isoformat()}*\nTudo no lugar — nenhuma viagem futura pendente. ✅"
    lines = [
        f"*🧭 Radar de Viagens — {today.isoformat()}*",
        f"{len(items)} viagem(ns) pedindo atenção:",
        "",
    ]
    for r in items:
        pct = round(r["score"] * 100)
        lines.append(f"• *{r['name']}* — {fmt_prazo(r['daysUntil'])} · {pct}% pronto")
        if r["faltando"]:
            falta = ", ".join(f["label"] for f in r["faltando"])
            lines.append(f"   falta: {falta}")
    return "\n".join(lines)


def send_slack(text: str) -> Optional[bool]:
    """Posta no Slack via SLACK_WEBHOOK_URL. Retorna True/False/None (None=pulou)."""
    webhook = "".join(os.environ.get("SLACK_WEBHOOK_URL", "").split())  # CLEAN_URL
    if not webhook:
        return None
    import requests  # import tardio: --dry-run não precisa da dependência

    try:
        resp = requests.post(webhook, json={"text": text}, timeout=10)
        return 200 <= resp.status_code < 300
    except requests.RequestException as e:  # pragma: no cover
        print(f"⚠ Slack notify failed: {e}", file=sys.stderr)
        return False


def resolve_today() -> date:
    override = os.environ.get("RADAR_TODAY", "").strip()
    if override:
        try:
            return date.fromisoformat(override)
        except ValueError:
            print(f"⚠ RADAR_TODAY mal formatado: {override!r} — usando data real", file=sys.stderr)
    return date.today()


def main() -> int:
    parser = argparse.ArgumentParser(description="Digest semanal de prontidão das viagens (read-only).")
    parser.add_argument("--dry-run", action="store_true", help="imprime a mensagem em vez de postar no Slack")
    parser.add_argument("--today", default=None, help="sobrescreve a data de hoje (YYYY-MM-DD)")
    args = parser.parse_args()

    if args.today:
        os.environ["RADAR_TODAY"] = args.today
    today = resolve_today()

    trips_file = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    trips = trips_file.get("trips") if isinstance(trips_file, dict) else trips_file
    trips = trips if isinstance(trips, list) else []

    items = select_for_digest(trips, today)
    message = render_message(items, today)

    if args.dry_run:
        print(message)
        print(f"\n(— dry-run: {len(items)} viagem(ns); nada postado —)", file=sys.stderr)
        return 0

    status = send_slack(message)
    if status is True:
        print(f"Slack: digest enviado ({len(items)} viagem(ns)).")
    elif status is False:
        print("Slack: falha no envio.", file=sys.stderr)
        return 1
    else:
        print("SLACK_WEBHOOK_URL não configurado — nada postado. Use --dry-run para inspecionar.")
        print(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
