"""
matcher.py — pure logic: match parsed email fragments to existing planned trips.

Kept separate from sync.py (which imports heavy Google libs) so the matching
logic can be unit-tested without OAuth/Google deps installed.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from parsers import TripFragment


# Maps email fragment.kind → checklist item id.
# Keys align with the user-visible checklist in assets/sketchy.js (CHECKLIST array):
# passagem, hotel, shows, transporte, doc, seguro, roteiro, cambio, mala.
KIND_TO_CHECKLIST: dict[str, str] = {
    "flight": "passagem",
    "hotel": "hotel",
    "stay": "hotel",
    "ticket": "shows",
}

# Maps email fragment.kind → budget category (.budget.committed keys).
KIND_TO_BUDGET: dict[str, str] = {
    "flight": "voos",
    "hotel": "hospedagem",
    "stay": "hospedagem",
    "ticket": "passeios",
}


# IATA → city/country lookup. Mirror of sync.IATA (small subset relevant to user data).
# Duplicated here so this module stays standalone-testable; sync.py is the source of truth.
IATA: dict[str, dict] = {
    "GRU": {"city": "São Paulo", "country": "Brasil"},
    "GIG": {"city": "Rio de Janeiro", "country": "Brasil"},
    "BSB": {"city": "Brasília", "country": "Brasil"},
    "CGH": {"city": "São Paulo", "country": "Brasil"},
    "IGU": {"city": "Foz do Iguaçu", "country": "Brasil"},
    "CTS": {"city": "Sapporo", "country": "Japan"},
    "NRT": {"city": "Tóquio", "country": "Japan"},
    "BKK": {"city": "Bangkok", "country": "Tailândia"},
    "RAK": {"city": "Marrakech", "country": "Marrocos"},
    "BRU": {"city": "Bruxelas", "country": "Bélgica"},
    "BGO": {"city": "Bergen", "country": "Norway"},
    "MLE": {"city": "Malé", "country": "Maldivas"},
}


def _trip_start(t: dict) -> Optional[date]:
    """Best estimate of when a trip starts."""
    s = t.get("startDate")
    if s:
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
    if t.get("year") and t.get("month"):
        try:
            return date(int(t["year"]), int(t["month"]), 15)
        except (ValueError, TypeError):
            pass
    return None


def match_fragment_to_trip(frag: TripFragment, trips: list[dict]) -> Optional[dict]:
    """
    Score each non-done trip against the fragment.
    Returns the best match (score ≥ 50), or None.

    Scoring: date proximity (±7d → +50, ±30d → +20) + country (+30) + city in name (+20).
    """
    if not frag.checkin:
        return None
    try:
        frag_date = date.fromisoformat(frag.checkin)
    except ValueError:
        return None

    # Resolve fragment destination(s). For flights, consider BOTH origin and
    # destination as candidate target cities — a return leg (CTS→GRU) is
    # still about the Japan trip even though "destination" reads as GRU.
    target_country = frag.country
    target_city = frag.city or frag.event_city
    candidates: list[tuple[str, str]] = []  # (city, country)
    for code in (frag.destination, frag.origin):
        if code and code in IATA:
            info = IATA[code]
            candidates.append((info["city"], info["country"]))
    # Prefer the non-Brasil candidate (assumes user lives in Brasil — see HOME_BASE in sync.py)
    candidates.sort(key=lambda c: 1 if c[1] == "Brasil" else 0)
    if candidates:
        target_city = target_city or candidates[0][0]
        target_country = target_country or candidates[0][1]

    best = None
    best_score = 0
    for t in trips:
        if t.get("status") == "done":
            continue
        trip_start = _trip_start(t)
        if not trip_start:
            continue
        delta_days = abs((frag_date - trip_start).days)
        if delta_days > 60:
            continue

        score = 0
        if delta_days <= 7:
            score += 50
        elif delta_days <= 30:
            score += 20
        else:
            score += 5

        if target_country and t.get("country"):
            tc = t["country"].lower()
            tgc = target_country.lower()
            if tgc == tc:
                score += 30
            elif tgc in tc or tc in tgc:
                score += 15

        if target_city:
            text = (t.get("name", "") + " " + t.get("sub", "")).lower()
            if target_city.lower() in text:
                score += 20

        if score > best_score:
            best_score = score
            best = t

    return best if best_score >= 50 else None


def apply_matched_fragments(
    fragments: list[TripFragment],
    existing: list[dict],
    now: Optional[datetime] = None,
) -> tuple[int, list[TripFragment], list[dict]]:
    """
    For each fragment, try to match to an existing planned trip. If matched,
    update the trip's `checklistAuto` and `budget.committed` in-place.

    Returns (matched_count, unmatched_fragments, updated_trips).
    """
    now = now or datetime.now(timezone.utc)
    matched_count = 0
    unmatched: list[TripFragment] = []
    updated_set: dict[str, dict] = {}

    for frag in fragments:
        trip = match_fragment_to_trip(frag, existing)
        if not trip:
            unmatched.append(frag)
            continue

        check_key = KIND_TO_CHECKLIST.get(frag.kind)
        if check_key:
            auto = trip.setdefault("checklistAuto", {})
            auto[check_key] = {
                "provider": frag.provider,
                "ref": frag.ref or "",
                "at": now.strftime("%Y-%m-%d"),
                "amount": frag.amount,
                "currency": frag.currency,
            }

        budget_key = KIND_TO_BUDGET.get(frag.kind)
        if budget_key and frag.amount:
            budget = trip.setdefault("budget", {})
            budget.setdefault("currency", frag.currency or "BRL")
            committed = budget.setdefault("committed", {})
            committed[budget_key] = round(
                float(committed.get(budget_key, 0)) + float(frag.amount), 2
            )
            sources = budget.setdefault("committedSources", {})
            sources.setdefault(budget_key, []).append({
                "provider": frag.provider,
                "ref": frag.ref or "",
                "amount": frag.amount,
            })

        matched_count += 1
        updated_set[trip["id"]] = trip

    return matched_count, unmatched, list(updated_set.values())
