"""
test_parsers.py — sanity tests for email parsers.

Run with:
    python -m pytest scripts/test_parsers.py -v
or directly:
    python scripts/test_parsers.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make scripts/ importable when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent))

from parsers import (  # noqa: E402
    parse_email,
    parse_sympla,
    parse_ingresse,
    parse_eventim,
    parse_tomorrowland,
    parse_latam,
    parse_booking,
    extract_amount,
    _parse_amount_str,
)


# ── amount parsing ──────────────────────────────────────────────────

def test_parse_amount_brl():
    assert _parse_amount_str("1.234,56") == 1234.56
    assert _parse_amount_str("1234,56") == 1234.56
    assert _parse_amount_str("1234") == 1234.0


def test_parse_amount_en():
    assert _parse_amount_str("1,234.56") == 1234.56
    assert _parse_amount_str("1234.56") == 1234.56


def test_extract_amount_picks_largest():
    text = "Taxa: R$ 15,00 — Total: R$ 1.234,56 — IOF R$ 5,00"
    amt, cur = extract_amount(text)
    assert amt == 1234.56
    assert cur == "BRL"


def test_extract_amount_eur():
    text = "Order total: EUR 89.50"
    amt, cur = extract_amount(text)
    assert amt == 89.5
    assert cur == "EUR"


def test_extract_amount_none():
    assert extract_amount("Sem valor algum aqui") == (None, None)


# ── Sympla ──────────────────────────────────────────────────────────

SYMPLA_EMAIL = """
Olá Eduardo,
Seu pedido foi confirmado!

Evento: Só Track Boa — São Paulo Edition
Data: sex, 13 de jun de 2026 22:00
Local: Espaço das Américas, São Paulo - SP

Pedido #SYM-A1B2C3
Total: R$ 280,00

— Equipe Sympla
"""


def test_sympla_parses():
    frag = parse_sympla("Sua compra confirmada: Só Track Boa SP", SYMPLA_EMAIL, "noreply@sympla.com.br")
    assert frag is not None
    assert frag.kind == "ticket"
    assert frag.provider == "Sympla"
    assert frag.amount == 280.0
    assert frag.currency == "BRL"
    assert frag.checkin == "2026-06-13"
    assert frag.city == "São Paulo"


def test_sympla_ignores_other_sender():
    assert parse_sympla("Random", "Random content", "foo@bar.com") is None


# ── Ingresse ────────────────────────────────────────────────────────

INGRESSE_EMAIL = """
Sua compra foi aprovada.
Evento: Festa da Lili 2026
Data: 07/08/2026
Local: Brasília, DF
Total a pagar: R$ 350,00
"""


def test_ingresse_parses():
    frag = parse_ingresse("Confirmação de compra", INGRESSE_EMAIL, "no-reply@ingresse.com")
    assert frag is not None
    assert frag.provider == "Ingresse"
    assert frag.amount == 350.0
    assert frag.checkin == "2026-08-07"


# ── Tomorrowland ────────────────────────────────────────────────────

TML_EMAIL = """
Dear Eduardo,
Your Tomorrowland registration is confirmed.
Package: Magnificent Greens — 2 persons
Total: EUR 1,890.00
See you in Boom!
"""


def test_tomorrowland_parses():
    frag = parse_tomorrowland("Tomorrowland 2026: registration confirmed",
                              TML_EMAIL, "no-reply@tomorrowland.com")
    assert frag is not None
    assert frag.provider == "Tomorrowland"
    assert frag.city == "Boom"
    assert frag.country == "Bélgica"
    assert frag.amount == 1890.0
    assert frag.currency == "EUR"


# ── LATAM ───────────────────────────────────────────────────────────

LATAM_EMAIL = """
Sua viagem está confirmada!

Voo: GRU → CTS
Data: 8 de fevereiro de 2027
Reserva: LA8X9Z2

Valor total: R$ 7.890,00
"""


def test_latam_parses_with_amount():
    frag = parse_latam("LATAM — sua viagem", LATAM_EMAIL, "noreply@latam.com")
    assert frag is not None
    assert frag.origin == "GRU"
    assert frag.destination == "CTS"
    assert frag.amount == 7890.0
    assert frag.ref == "LA8X9Z2"


# ── Generic dispatcher ──────────────────────────────────────────────

def test_parse_email_dispatches_correctly():
    frag = parse_email("Tomorrowland 2026 confirmed", TML_EMAIL, "no-reply@tomorrowland.com")
    assert frag is not None and frag.provider == "Tomorrowland"

    frag = parse_email("Compra Sympla", SYMPLA_EMAIL, "info@sympla.com.br")
    assert frag is not None and frag.provider == "Sympla"


# ── Self-runner ─────────────────────────────────────────────────────

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
