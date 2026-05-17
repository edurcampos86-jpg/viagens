"""
test_matching.py — tests for fragment ↔ existing-trip matching in sync.py.

Run directly: `python scripts/test_matching.py`
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from parsers import TripFragment  # noqa: E402
from matcher import match_fragment_to_trip, apply_matched_fragments  # noqa: E402


# Synthetic existing trips
TRIPS = [
    {
        "id": "sp-junho-2026",
        "name": "São Paulo — Só Track Boa + Pride",
        "sub": "São Paulo · SP",
        "country": "Brasil",
        "status": "planned",
        "year": 2026, "month": 6,
        "startDate": "2026-06-13",
    },
    {
        "id": "tomorrowland-2026",
        "name": "Europa — Tomorrowland Bélgica",
        "sub": "Boom · Bruxelas · Bélgica",
        "country": "Bélgica",
        "status": "planned",
        "year": 2026, "month": 7,
        "startDate": "2026-07-17",
    },
    {
        "id": "japao-2027",
        "name": "Japão — Hokkaido",
        "sub": "Sapporo · Hokkaido · Japão",
        "country": "Japan",
        "status": "planned",
        "year": 2027, "month": 2,
        "startDate": "2027-02-08",
    },
    {
        "id": "iguacu-2021",
        "name": "Foz do Iguaçu",
        "sub": "Paraná · Brasil",
        "country": "Brasil",
        "status": "done",
        "year": 2021, "month": 6,
    },
]


def test_matches_sympla_to_sp_trip():
    frag = TripFragment(
        kind="ticket", provider="Sympla", raw_subject="Só Track Boa",
        checkin="2026-06-13", event_city="São Paulo",
        amount=280.0, currency="BRL", ref="SYM-A1B2",
    )
    m = match_fragment_to_trip(frag, TRIPS)
    assert m is not None
    assert m["id"] == "sp-junho-2026"


def test_matches_tomorrowland_to_europe_trip():
    frag = TripFragment(
        kind="ticket", provider="Tomorrowland", raw_subject="TML",
        checkin="2026-07-17", city="Boom", country="Bélgica",
        amount=1890.0, currency="EUR",
    )
    m = match_fragment_to_trip(frag, TRIPS)
    assert m is not None
    assert m["id"] == "tomorrowland-2026"


def test_matches_latam_japan_via_iata():
    frag = TripFragment(
        kind="flight", provider="LATAM", raw_subject="GRU CTS",
        origin="GRU", destination="CTS",
        checkin="2027-02-08",
        amount=7890.0, currency="BRL", ref="LA8X9",
    )
    m = match_fragment_to_trip(frag, TRIPS)
    assert m is not None
    assert m["id"] == "japao-2027"


def test_no_match_when_date_too_far():
    frag = TripFragment(
        kind="flight", provider="LATAM", raw_subject="GRU GIG",
        origin="GRU", destination="GIG",
        checkin="2030-01-01",  # 4 years from any planned trip
    )
    m = match_fragment_to_trip(frag, TRIPS)
    assert m is None


def test_no_match_to_done_trip():
    # Even with perfect date+country match, status=done should be skipped
    frag = TripFragment(
        kind="hotel", provider="Booking.com", raw_subject="X",
        checkin="2021-06-10", city="Foz do Iguaçu", country="Brasil",
    )
    m = match_fragment_to_trip(frag, TRIPS)
    assert m is None


def test_apply_updates_checklist_and_budget():
    trips = [dict(t) for t in TRIPS]  # deep-ish copy
    frags = [
        TripFragment(kind="ticket", provider="Sympla", raw_subject="Só Track Boa",
                     checkin="2026-06-13", event_city="São Paulo",
                     amount=280.0, currency="BRL", ref="SYM-A1"),
        TripFragment(kind="flight", provider="LATAM", raw_subject="GRU CTS",
                     origin="GRU", destination="CTS",
                     checkin="2027-02-08", amount=7890.0, currency="BRL"),
    ]
    matched, unmatched, updated = apply_matched_fragments(frags, trips)
    assert matched == 2
    assert len(unmatched) == 0
    assert len(updated) == 2

    sp = next(t for t in trips if t["id"] == "sp-junho-2026")
    assert sp["checklistAuto"]["shows"]["provider"] == "Sympla"
    assert sp["checklistAuto"]["shows"]["ref"] == "SYM-A1"
    assert sp["budget"]["committed"]["passeios"] == 280.0
    assert sp["budget"]["currency"] == "BRL"

    jp = next(t for t in trips if t["id"] == "japao-2027")
    assert jp["checklistAuto"]["passagem"]["provider"] == "LATAM"
    assert jp["budget"]["committed"]["voos"] == 7890.0


def test_apply_aggregates_multiple_to_same_budget_key():
    """Two flights → same trip should sum into budget.committed.voos."""
    trips = [dict(t) for t in TRIPS]
    frags = [
        TripFragment(kind="flight", provider="LATAM", raw_subject="A",
                     origin="GRU", destination="CTS", checkin="2027-02-08",
                     amount=4000.0, currency="BRL"),
        TripFragment(kind="flight", provider="LATAM", raw_subject="B",
                     origin="CTS", destination="GRU", checkin="2027-02-18",
                     amount=3500.0, currency="BRL"),
    ]
    matched, _, _ = apply_matched_fragments(frags, trips)
    assert matched == 2
    jp = next(t for t in trips if t["id"] == "japao-2027")
    assert jp["budget"]["committed"]["voos"] == 7500.0


def test_apply_populates_hospedagem_from_hotel_fragment():
    """Fragment kind=hotel should add an entry to hospedagem[] with
    nome=provider, check_in, check_out e preco_real estruturado."""
    trips = [dict(t) for t in TRIPS]
    frags = [
        TripFragment(
            kind="hotel", provider="Park Hyatt Tokyo", raw_subject="reserva",
            city="Tóquio", country="Japan",
            checkin="2027-02-10", checkout="2027-02-15",
            amount=4500.0, currency="BRL", ref="HYATT-1",
        ),
    ]
    matched, _, _ = apply_matched_fragments(frags, trips)
    assert matched == 1
    jp = next(t for t in trips if t["id"] == "japao-2027")
    hosp = jp.get("hospedagem", [])
    assert len(hosp) == 1
    entry = hosp[0]
    assert entry["nome"] == "Park Hyatt Tokyo"
    assert entry["check_in"] == "2027-02-10"
    assert entry["check_out"] == "2027-02-15"
    assert entry["confirmada"] is True
    assert entry["preco_real"] == {"valor": 4500.0, "moeda": "BRL"}


def test_apply_hospedagem_deduplicates_same_nome_checkin():
    """Mesma reserva enviada duas vezes (ex: confirmação + lembrete) não
    deve criar entrada duplicada em hospedagem[]."""
    trips = [dict(t) for t in TRIPS]
    frag = TripFragment(
        kind="hotel", provider="Park Hyatt Tokyo", raw_subject="conf",
        city="Tóquio", country="Japan",
        checkin="2027-02-10", checkout="2027-02-15",
        amount=4500.0, currency="BRL",
    )
    apply_matched_fragments([frag], trips)
    apply_matched_fragments([frag], trips)
    jp = next(t for t in trips if t["id"] == "japao-2027")
    assert len(jp.get("hospedagem", [])) == 1


def test_unmatched_falls_through():
    """Fragment with no plausible target should end up in unmatched."""
    trips = [dict(t) for t in TRIPS]
    frags = [
        TripFragment(kind="flight", provider="LATAM", raw_subject="GRU NAT",
                     origin="GRU", destination="NAT", checkin="2028-12-15",
                     amount=2000.0, currency="BRL"),
    ]
    matched, unmatched, _ = apply_matched_fragments(frags, trips)
    assert matched == 0
    assert len(unmatched) == 1


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ! {t.__name__} CRASHED: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
