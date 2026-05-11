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

    return TripFragment(
        kind="hotel",
        provider="Booking.com",
        raw_subject=subject,
        ref=ref,
        city=city,
        checkin=checkin,
        checkout=checkout,
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
    return TripFragment(
        kind="flight",
        provider="LATAM",
        raw_subject=subject,
        ref=ref,
        origin=origin,
        destination=destination,
        checkin=checkin,
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


# ── registry ─────────────────────────────────────────────────────────

PARSERS = [parse_booking, parse_airbnb, parse_latam, parse_decolar, parse_smiles, parse_gol]


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
