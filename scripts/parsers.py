"""
parsers.py — extract trip metadata from booking confirmation emails.

Each parser returns a dict like:
    {
      "kind": "flight" | "hotel" | "stay",
      "provider": "Booking.com",
      "origin": "GRU",            # for flights, IATA code
      "destination": "MAD",       # for flights, IATA code
      "city": "Madrid",           # for hotels/stays
      "country": "Spain",
      "checkin": "2026-01-15",
      "checkout": "2026-01-22",
      "ref": "ABC123",            # booking reference
      "raw_subject": "...",
    }

To add a new provider, write a `parse_<name>` function returning the dict
(or None if it doesn't match), and add it to PARSERS at the bottom.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, asdict
from datetime import datetime, date
from typing import Optional

from dateutil import parser as dtparser


@dataclass
class TripFragment:
    kind: str
    provider: str
    raw_subject: str
    ref: Optional[str] = None
    origin: Optional[str] = None       # IATA for flights
    destination: Optional[str] = None  # IATA for flights
    city: Optional[str] = None
    country: Optional[str] = None
    checkin: Optional[str] = None      # ISO date
    checkout: Optional[str] = None     # ISO date
    amount: Optional[float] = None     # Price in BRL (or local currency, see currency)
    currency: Optional[str] = None     # ISO 4217 (e.g. "BRL", "EUR")
    event_name: Optional[str] = None   # For tickets: festival/event name
    event_city: Optional[str] = None   # For tickets: city where event happens

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ── helpers ──────────────────────────────────────────────────────────

MONTHS_PT = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}
MONTHS_EN = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def parse_date_flexible(s: str) -> Optional[date]:
    s = s.strip()
    if not s:
        return None
    # Try ISO/standard formats first
    try:
        return dtparser.parse(s, dayfirst=True, fuzzy=True).date()
    except (ValueError, OverflowError):
        pass
    # Try "15 de janeiro de 2026" or "15 Jan 2026"
    m = re.search(r"(\d{1,2})\s*(?:de\s+)?([a-zç]+)\s*(?:de\s+)?(\d{4})", s.lower())
    if m:
        d, mo, y = m.groups()
        mo_n = MONTHS_PT.get(mo[:3]) or MONTHS_EN.get(mo[:3])
        if mo_n:
            try:
                return date(int(y), mo_n, int(d))
            except ValueError:
                pass
    return None


def iata_extract(text: str) -> Optional[str]:
    """Find a 3-letter airport code, optionally in parens, like (GRU)."""
    m = re.search(r"\b([A-Z]{3})\b", text)
    return m.group(1) if m else None


def matches_any(subject: str, body: str, keywords: list[str]) -> bool:
    blob = f"{subject}\n{body}".lower()
    return any(k.lower() in blob for k in keywords)


def extract_amount(text: str) -> tuple[Optional[float], Optional[str]]:
    """
    Best-effort price extraction. Returns (amount, currency_code).
    Recognizes patterns like:
      R$ 1.234,56 · R$1234,56 · BRL 1234.56
      EUR 1,234.56 · € 1.234,56
      USD 99.99 · $ 99,99
    Picks the LARGEST monetary value found (usually the trip total, not a tax line).
    """
    candidates: list[tuple[float, str]] = []
    # Pattern A: prefix currency (R$, BRL, $, USD, EUR, €, £, GBP)
    pat = re.compile(
        r"(R\$|BRL|US\$|USD|\$|EUR|€|GBP|£)\s*([\d.,]+)",
        re.IGNORECASE,
    )
    cur_map = {"r$": "BRL", "brl": "BRL", "us$": "USD", "usd": "USD",
               "$": "USD", "eur": "EUR", "€": "EUR", "gbp": "GBP", "£": "GBP"}
    for m in pat.finditer(text):
        raw_cur = m.group(1).lower()
        raw_amt = m.group(2)
        cur = cur_map.get(raw_cur, "BRL")
        val = _parse_amount_str(raw_amt)
        if val is not None and val > 0:
            candidates.append((val, cur))
    # Pattern B: suffix currency ("99,99 BRL" / "1234.56 EUR")
    pat2 = re.compile(r"([\d][\d.,]{2,})\s*(BRL|EUR|USD|GBP)\b", re.IGNORECASE)
    for m in pat2.finditer(text):
        val = _parse_amount_str(m.group(1))
        if val is not None and val > 0:
            candidates.append((val, m.group(2).upper()))
    if not candidates:
        return None, None
    # Return the largest (trip total typically dominates line items / fees)
    candidates.sort(key=lambda x: -x[0])
    return candidates[0]


def _parse_amount_str(s: str) -> Optional[float]:
    """
    Parse '1.234,56' (pt-BR) or '1,234.56' (en) or '1234' / '1234.56' / '1234,56'.
    """
    s = s.strip()
    if not s:
        return None
    # If both . and , present: the LAST one is the decimal separator
    if "." in s and "," in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # Decimal comma (pt-BR) — unless it's a thousands separator with no decimals
        # Heuristic: if there are exactly 2 digits after the LAST comma, treat as decimal
        right = s.rsplit(",", 1)[1]
        if len(right) == 2:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    # Else: only dots, treat as standard
    try:
        return float(s)
    except ValueError:
        return None


# ── per-provider parsers ─────────────────────────────────────────────

def parse_booking(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if "booking.com" not in from_addr.lower():
        return None
    if not matches_any(subject, body, ["confirma", "reserva", "booking", "your booking"]):
        return None

    ref = None
    m = re.search(r"(?:Confirmation|Confirmação|Reserva)[^\d]{0,15}(\d{7,11})", body)
    if m:
        ref = m.group(1)

    # City: usually in subject like "Your booking is confirmed: Hotel X, Lisbon"
    city = None
    m = re.search(r",\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-Za-zÀ-ÿ\s\-]+?)(?:\s*-|\s*$)", subject)
    if m:
        city = m.group(1).strip()

    # Dates: "Check-in: ... — Check-out: ..."
    checkin = checkout = None
    ci = re.search(r"[Cc]heck[\- ]in[^\d]{0,30}(\d{1,2}[\s/\-\.][A-Za-z]{3,9}[\s/\-\.]\d{2,4}|\d{1,2}/\d{1,2}/\d{2,4})", body)
    co = re.search(r"[Cc]heck[\- ]out[^\d]{0,30}(\d{1,2}[\s/\-\.][A-Za-z]{3,9}[\s/\-\.]\d{2,4}|\d{1,2}/\d{1,2}/\d{2,4})", body)
    if ci:
        d = parse_date_flexible(ci.group(1))
        if d:
            checkin = d.isoformat()
    if co:
        d = parse_date_flexible(co.group(1))
        if d:
            checkout = d.isoformat()

    if not (city or ref):
        return None

    amount, currency = extract_amount(body)
    return TripFragment(
        kind="hotel",
        provider="Booking.com",
        raw_subject=subject,
        ref=ref,
        city=city,
        checkin=checkin,
        checkout=checkout,
        amount=amount,
        currency=currency,
    )


def parse_airbnb(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if "airbnb" not in from_addr.lower() and "airbnb" not in subject.lower():
        return None
    if not matches_any(subject, body, ["reservation", "reserva", "confirmed", "confirmada"]):
        return None

    ref = None
    m = re.search(r"\b([A-Z0-9]{10})\b", body)
    if m:
        ref = m.group(1)

    city = None
    m = re.search(r"(?:em|in)\s+([A-ZÁÉÍÓÚ][A-Za-zÀ-ÿ\s\-]+?)(?:\.|,|\!|$)", subject)
    if m:
        city = m.group(1).strip()

    return TripFragment(
        kind="stay",
        provider="Airbnb",
        raw_subject=subject,
        ref=ref,
        city=city,
    )


def parse_latam(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if not ("latam" in from_addr.lower() or "latam" in subject.lower()):
        return None
    if not matches_any(subject, body, [
        "confirma", "passagem", "boarding", "itinerar", "your trip", "sua viagem"
    ]):
        return None

    # Find origin/destination airports — often "GRU → MAD" or "GRU - MAD"
    m = re.search(r"\b([A-Z]{3})\s*(?:→|-|→|to|para)\s*([A-Z]{3})\b", body)
    origin = m.group(1) if m else None
    destination = m.group(2) if m else None

    ref = None
    m = re.search(r"(?:reserva|booking|locator|código)[\s\:]+([A-Z0-9]{5,8})", body, re.I)
    if m:
        ref = m.group(1)

    # Departure date
    checkin = None
    m = re.search(r"(\d{1,2}\s+(?:de\s+)?[a-zç]{3,9}(?:\s+de)?\s+\d{4})", body, re.I)
    if m:
        d = parse_date_flexible(m.group(1))
        if d:
            checkin = d.isoformat()

    if not (origin and destination):
        return None
    amount, currency = extract_amount(body)
    return TripFragment(
        kind="flight",
        provider="LATAM",
        raw_subject=subject,
        ref=ref,
        origin=origin,
        destination=destination,
        checkin=checkin,
        amount=amount,
        currency=currency,
    )


def parse_decolar(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if "decolar" not in from_addr.lower() and "despegar" not in from_addr.lower():
        return None
    if not matches_any(subject, body, ["confirmação", "confirmada", "pedido"]):
        return None

    origin = destination = None
    m = re.search(r"\b([A-Z]{3})\s*(?:→|-|→)\s*([A-Z]{3})\b", body)
    if m:
        origin, destination = m.group(1), m.group(2)

    city = None
    if not (origin or destination):
        m = re.search(r"(?:hotel|hospedagem|pacote)\s+(?:em|no|na)\s+([A-ZÁÉÍÓÚ][A-Za-zÀ-ÿ\s\-]+?)(?:\.|,|\!|$)", subject, re.I)
        if m:
            city = m.group(1).strip()

    return TripFragment(
        kind="flight" if origin else "stay",
        provider="Decolar",
        raw_subject=subject,
        origin=origin,
        destination=destination,
        city=city,
    )


def parse_smiles(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if "smiles" not in from_addr.lower() and "smiles" not in subject.lower():
        return None
    if not matches_any(subject, body, ["emiss", "voo", "passagem"]):
        return None

    m = re.search(r"\b([A-Z]{3})\s*(?:→|-|→|para)\s*([A-Z]{3})\b", body)
    if not m:
        return None
    return TripFragment(
        kind="flight",
        provider="Smiles",
        raw_subject=subject,
        origin=m.group(1),
        destination=m.group(2),
    )


def parse_gol(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    if "gol" not in from_addr.lower() and "voegol" not in from_addr.lower():
        return None
    if not matches_any(subject, body, ["confirma", "voo", "embarque"]):
        return None
    m = re.search(r"\b([A-Z]{3})\s*(?:→|-|→)\s*([A-Z]{3})\b", body)
    if not m:
        return None
    return TripFragment(
        kind="flight",
        provider="GOL",
        raw_subject=subject,
        origin=m.group(1),
        destination=m.group(2),
    )


# ── ticket / event parsers ───────────────────────────────────────────

def _event_city_from_text(text: str) -> Optional[str]:
    """Try to find a Brazilian city + UF or a major capital in the text."""
    # "em São Paulo - SP" / "São Paulo/SP" / "Brasília, DF"
    m = re.search(r"\b([A-ZÁÉÍÓÚÂÊÔÃÇ][A-Za-zÀ-ÿ\s'\-]+?)\s*[\-/,]\s*([A-Z]{2})\b", text)
    if m:
        return m.group(1).strip()
    # Bare capital list (cheap fallback)
    for city in ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Belo Horizonte",
                 "Curitiba", "Porto Alegre", "Florianópolis", "Recife", "Fortaleza",
                 "Boom", "Bruxelas", "Antwerp", "Amsterdã"]:
        if city.lower() in text.lower():
            return city
    return None


def parse_sympla(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    """Sympla — Brazilian event/ticket platform."""
    if "sympla" not in from_addr.lower() and "sympla" not in body.lower():
        return None
    if not matches_any(subject, body, [
        "ingresso", "confirmação", "confirmacao", "pedido", "compra confirmada",
        "ticket", "your order"
    ]):
        return None

    # Event name often appears in subject after a colon, or as a line in body
    event_name = None
    m = re.search(r"(?:ingresso|seu pedido|confirmação)[:\s\-]+(.{5,80}?)(?:\.|\n|$)", subject + "\n" + body[:500], re.I)
    if m:
        event_name = m.group(1).strip(" -—:")
    if not event_name:
        # First non-empty line of body that's not the standard footer
        for line in body.split("\n")[:15]:
            line = line.strip()
            if 5 < len(line) < 80 and "sympla" not in line.lower():
                event_name = line
                break

    # Event date — Sympla often shows "qua, 15 de jun de 2026 19:00"
    checkin = None
    m = re.search(r"(\d{1,2}\s+(?:de\s+)?[a-zç]{3,9}(?:\s+de)?\s+\d{4})", body, re.I)
    if m:
        d = parse_date_flexible(m.group(1))
        if d:
            checkin = d.isoformat()

    ref = None
    m = re.search(r"(?:pedido|order)[\s#:]*([A-Z0-9\-]{6,20})", body, re.I)
    if m:
        ref = m.group(1)

    amount, currency = extract_amount(body)
    city = _event_city_from_text(body)

    return TripFragment(
        kind="ticket",
        provider="Sympla",
        raw_subject=subject,
        ref=ref,
        city=city,
        event_city=city,
        event_name=event_name,
        checkin=checkin,
        amount=amount,
        currency=currency,
    )


def parse_ingresse(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    """Ingresse — Brazilian event ticket platform."""
    if "ingresse" not in from_addr.lower() and "ingresse" not in body.lower():
        return None
    if not matches_any(subject, body, ["ingresso", "confirma", "compra"]):
        return None

    event_name = None
    m = re.search(r"(?:evento|event)[:\s]+(.{5,80}?)(?:\.|\n)", body, re.I)
    if m:
        event_name = m.group(1).strip()

    checkin = None
    m = re.search(r"(\d{1,2}/\d{1,2}/\d{2,4}|\d{1,2}\s+[a-zç]{3,9}\s+\d{4})", body)
    if m:
        d = parse_date_flexible(m.group(1))
        if d:
            checkin = d.isoformat()

    amount, currency = extract_amount(body)
    city = _event_city_from_text(body)

    return TripFragment(
        kind="ticket",
        provider="Ingresse",
        raw_subject=subject,
        city=city,
        event_city=city,
        event_name=event_name,
        checkin=checkin,
        amount=amount,
        currency=currency,
    )


def parse_eventim(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    """Eventim — international ticket platform."""
    if "eventim" not in from_addr.lower() and "eventim" not in body.lower():
        return None
    if not matches_any(subject, body, ["ticket", "ingresso", "confirma", "purchase"]):
        return None

    amount, currency = extract_amount(body)
    city = _event_city_from_text(body)

    return TripFragment(
        kind="ticket",
        provider="Eventim",
        raw_subject=subject,
        city=city,
        event_city=city,
        amount=amount,
        currency=currency or "EUR",
    )


def parse_tomorrowland(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    """Tomorrowland — Belgian festival, direct from tomorrowland.com."""
    if "tomorrowland" not in from_addr.lower() and "tomorrowland" not in subject.lower():
        return None
    if not matches_any(subject, body, ["ticket", "package", "confirma", "boom", "registration"]):
        return None

    amount, currency = extract_amount(body)
    # Tomorrowland is in Boom, Belgium
    return TripFragment(
        kind="ticket",
        provider="Tomorrowland",
        raw_subject=subject,
        city="Boom",
        country="Bélgica",
        event_city="Boom",
        event_name="Tomorrowland",
        amount=amount,
        currency=currency or "EUR",
    )


# ── registry ─────────────────────────────────────────────────────────

PARSERS = [
    parse_booking, parse_airbnb,
    parse_latam, parse_decolar, parse_smiles, parse_gol,
    parse_sympla, parse_ingresse, parse_eventim, parse_tomorrowland,
]


def parse_email(subject: str, body: str, from_addr: str) -> Optional[TripFragment]:
    """Run all parsers, return the first match."""
    for p in PARSERS:
        try:
            result = p(subject, body, from_addr)
        except Exception as e:  # individual parser failure shouldn't break sync
            print(f"  parser {p.__name__} crashed: {e}")
            continue
        if result:
            return result
    return None
