"""
sync.py — main sync entry point.

Run by GitHub Actions every 6h (or manually). Steps:

  1. Refresh OAuth credentials from GOOGLE_REFRESH_TOKEN.
  2. Read data/sync-state.json to know what was last synced.
  3. Fetch new Gmail messages since last sync, parse each through parsers.py.
  4. Group fragments into trip candidates (by destination + date proximity).
  5. Geocode destinations (Nominatim).
  6. Fetch Google Photos for each trip's date range.
  7. Merge into data/trips.json (de-dup vs existing trips).
  8. Write data/sync-state.json + report what changed.

The workflow then opens a PR with the changes for the user to review/merge.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, date, timezone
from pathlib import Path
from typing import Optional

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from bs4 import BeautifulSoup
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

from parsers import parse_email, TripFragment

# ── paths ────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"
STATE_PATH = REPO_ROOT / "data" / "sync-state.json"
REPORT_PATH = REPO_ROOT / "data" / "sync-report.md"

# ── env ──────────────────────────────────────────────────────────────
CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
REFRESH_TOKEN = os.environ.get("GOOGLE_REFRESH_TOKEN")
TOKEN_URI = "https://oauth2.googleapis.com/token"

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/photoslibrary.readonly",
]

# How far back to look on first run / when state is empty
INITIAL_LOOKBACK_DAYS = 365

# Gmail search — junta domínios que mandam confirmações relevantes
GMAIL_QUERY = (
    "(from:booking.com OR from:airbnb.com OR from:latam.com OR from:smiles.com.br "
    "OR from:decolar.com OR from:despegar.com OR from:voegol.com.br) "
    "newer_than:{days}d"
)

CONTINENT_BY_COUNTRY_CODE = {
    "BR": "Americas", "AR": "Americas", "UY": "Americas", "CL": "Americas",
    "CO": "Americas", "MX": "Americas", "US": "Americas", "CA": "Americas",
    "PE": "Americas", "BO": "Americas", "PY": "Americas", "EC": "Americas",
    "VE": "Americas", "PA": "Americas", "CR": "Americas", "CU": "Americas",
    "PT": "Europe", "ES": "Europe", "FR": "Europe", "IT": "Europe",
    "DE": "Europe", "NL": "Europe", "BE": "Europe", "GR": "Europe",
    "GB": "Europe", "IE": "Europe", "CH": "Europe", "AT": "Europe",
    "CZ": "Europe", "HU": "Europe", "PL": "Europe", "SE": "Europe",
    "NO": "Europe", "DK": "Europe", "FI": "Europe", "IS": "Europe",
    "JP": "Asia", "CN": "Asia", "KR": "Asia", "TH": "Asia", "VN": "Asia",
    "KH": "Asia", "ID": "Asia", "PH": "Asia", "MY": "Asia", "SG": "Asia",
    "IN": "Asia", "AE": "Asia", "TR": "Asia", "IL": "Asia",
    "ZA": "Africa", "EG": "Africa", "MA": "Africa", "KE": "Africa",
    "TZ": "Africa", "NA": "Africa",
    "AU": "Oceania", "NZ": "Oceania", "FJ": "Oceania",
}

CONTINENT_COLORS = {
    "Asia": "#06b6d4", "Europe": "#3b82f6", "Americas": "#22c55e",
    "Africa": "#f97316", "Oceania": "#a855f7",
}

FLAG_BY_CC = {
    "BR": "🇧🇷", "AR": "🇦🇷", "UY": "🇺🇾", "CL": "🇨🇱", "CO": "🇨🇴", "MX": "🇲🇽",
    "US": "🇺🇸", "PT": "🇵🇹", "ES": "🇪🇸", "FR": "🇫🇷", "IT": "🇮🇹", "DE": "🇩🇪",
    "NL": "🇳🇱", "GR": "🇬🇷", "GB": "🇬🇧", "JP": "🇯🇵", "TH": "🇹🇭", "VN": "🇻🇳",
    "KH": "🇰🇭", "ID": "🇮🇩", "MY": "🇲🇾", "SG": "🇸🇬", "AE": "🇦🇪", "ZA": "🇿🇦",
    "MA": "🇲🇦", "AU": "🇦🇺", "NZ": "🇳🇿", "CZ": "🇨🇿",
}

# ── tiny IATA → city/country map for common airports relevant to user data
IATA: dict[str, dict] = {
    "GRU": {"city": "São Paulo", "country": "Brasil", "cc": "BR"},
    "GIG": {"city": "Rio de Janeiro", "country": "Brasil", "cc": "BR"},
    "BSB": {"city": "Brasília", "country": "Brasil", "cc": "BR"},
    "CGH": {"city": "São Paulo", "country": "Brasil", "cc": "BR"},
    "IGU": {"city": "Foz do Iguaçu", "country": "Brasil", "cc": "BR"},
    "VCP": {"city": "Campinas", "country": "Brasil", "cc": "BR"},
    "MAD": {"city": "Madrid", "country": "Espanha", "cc": "ES"},
    "BCN": {"city": "Barcelona", "country": "Espanha", "cc": "ES"},
    "IBZ": {"city": "Ibiza", "country": "Espanha", "cc": "ES"},
    "LIS": {"city": "Lisboa", "country": "Portugal", "cc": "PT"},
    "OPO": {"city": "Porto", "country": "Portugal", "cc": "PT"},
    "ATH": {"city": "Atenas", "country": "Grécia", "cc": "GR"},
    "JMK": {"city": "Mykonos", "country": "Grécia", "cc": "GR"},
    "FCO": {"city": "Roma", "country": "Itália", "cc": "IT"},
    "CDG": {"city": "Paris", "country": "França", "cc": "FR"},
    "AMS": {"city": "Amsterdã", "country": "Holanda", "cc": "NL"},
    "BRU": {"city": "Bruxelas", "country": "Bélgica", "cc": "BE"},
    "TXL": {"city": "Berlim", "country": "Alemanha", "cc": "DE"},
    "BER": {"city": "Berlim", "country": "Alemanha", "cc": "DE"},
    "FRA": {"city": "Frankfurt", "country": "Alemanha", "cc": "DE"},
    "PRG": {"city": "Praga", "country": "Tchéquia", "cc": "CZ"},
    "BUD": {"city": "Budapeste", "country": "Hungria", "cc": "HU"},
    "NRT": {"city": "Tóquio", "country": "Japão", "cc": "JP"},
    "HND": {"city": "Tóquio", "country": "Japão", "cc": "JP"},
    "KIX": {"city": "Osaka", "country": "Japão", "cc": "JP"},
    "CTS": {"city": "Sapporo", "country": "Japão", "cc": "JP"},
    "BKK": {"city": "Bangkok", "country": "Tailândia", "cc": "TH"},
    "HKT": {"city": "Phuket", "country": "Tailândia", "cc": "TH"},
    "KBV": {"city": "Krabi", "country": "Tailândia", "cc": "TH"},
    "REP": {"city": "Siem Reap", "country": "Camboja", "cc": "KH"},
    "HAN": {"city": "Hanói", "country": "Vietnã", "cc": "VN"},
    "SGN": {"city": "Ho Chi Minh", "country": "Vietnã", "cc": "VN"},
    "DXB": {"city": "Dubai", "country": "Emirados", "cc": "AE"},
    "JNB": {"city": "Joanesburgo", "country": "África do Sul", "cc": "ZA"},
    "CPT": {"city": "Cidade do Cabo", "country": "África do Sul", "cc": "ZA"},
    "RAK": {"city": "Marrakech", "country": "Marrocos", "cc": "MA"},
    "FEZ": {"city": "Fez", "country": "Marrocos", "cc": "MA"},
    "AKL": {"city": "Auckland", "country": "Nova Zelândia", "cc": "NZ"},
    "ZQN": {"city": "Queenstown", "country": "Nova Zelândia", "cc": "NZ"},
    "JFK": {"city": "Nova Iorque", "country": "EUA", "cc": "US"},
    "MIA": {"city": "Miami", "country": "EUA", "cc": "US"},
    "LAX": {"city": "Los Angeles", "country": "EUA", "cc": "US"},
    "MCO": {"city": "Orlando", "country": "EUA", "cc": "US"},
    "TPA": {"city": "Tampa", "country": "EUA", "cc": "US"},
    "IAH": {"city": "Houston", "country": "EUA", "cc": "US"},
    "HNL": {"city": "Honolulu", "country": "EUA", "cc": "US"},
    "EZE": {"city": "Buenos Aires", "country": "Argentina", "cc": "AR"},
    "MVD": {"city": "Montevidéu", "country": "Uruguai", "cc": "UY"},
    "PDP": {"city": "Punta del Este", "country": "Uruguai", "cc": "UY"},
    "SCL": {"city": "Santiago", "country": "Chile", "cc": "CL"},
    "CJC": {"city": "Calama", "country": "Chile", "cc": "CL"},
    "CTG": {"city": "Cartagena", "country": "Colômbia", "cc": "CO"},
    "BOG": {"city": "Bogotá", "country": "Colômbia", "cc": "CO"},
    "CUN": {"city": "Cancún", "country": "México", "cc": "MX"},
    "AUA": {"city": "Aruba", "country": "Aruba", "cc": "AW"},
    "CUR": {"city": "Curaçao", "country": "Curaçao", "cc": "CW"},
    "BON": {"city": "Bonaire", "country": "Bonaire", "cc": "BQ"},
}


# ── helpers ──────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(f"[sync] {msg}", flush=True)


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {}


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_trips() -> dict:
    if TRIPS_PATH.exists():
        return json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    return {"trips": []}


def save_trips(data: dict) -> None:
    TRIPS_PATH.parent.mkdir(parents=True, exist_ok=True)
    TRIPS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def get_credentials() -> Credentials:
    if not (CLIENT_ID and CLIENT_SECRET and REFRESH_TOKEN):
        log("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN.")
        log("Run scripts/auth.py locally and store them as repo secrets.")
        sys.exit(2)
    creds = Credentials(
        token=None,
        refresh_token=REFRESH_TOKEN,
        token_uri=TOKEN_URI,
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return creds


# ── Gmail ────────────────────────────────────────────────────────────

def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    return soup.get_text("\n", strip=True)


def decode_part(part) -> str:
    data = part.get("body", {}).get("data")
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
    except Exception:
        return ""


def message_text(msg: dict) -> tuple[str, str, str]:
    headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
    subject = headers.get("subject", "")
    from_addr = headers.get("from", "")

    parts_to_visit = [msg["payload"]]
    text_chunks: list[str] = []
    while parts_to_visit:
        p = parts_to_visit.pop()
        mime = p.get("mimeType", "")
        if mime.startswith("multipart/"):
            parts_to_visit.extend(p.get("parts", []))
            continue
        body = decode_part(p)
        if not body:
            continue
        if mime == "text/html":
            text_chunks.append(html_to_text(body))
        elif mime == "text/plain":
            text_chunks.append(body)
    return subject, "\n".join(text_chunks), from_addr


def fetch_gmail_fragments(creds: Credentials, state: dict) -> list[TripFragment]:
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)

    last_synced = state.get("gmail_last_iso")
    if last_synced:
        # Use newer_than:Nd as approximation (Gmail also accepts after:YYYY/MM/DD)
        last = datetime.fromisoformat(last_synced)
        days = max(1, (datetime.now(timezone.utc) - last.replace(tzinfo=timezone.utc)).days + 1)
    else:
        days = INITIAL_LOOKBACK_DAYS

    query = GMAIL_QUERY.format(days=days)
    log(f"Gmail query: {query}")
    fragments: list[TripFragment] = []
    page_token = None
    seen = 0

    while True:
        try:
            resp = service.users().messages().list(
                userId="me", q=query, maxResults=100, pageToken=page_token,
            ).execute()
        except HttpError as e:
            log(f"Gmail list error: {e}")
            break
        messages = resp.get("messages", [])
        for m in messages:
            seen += 1
            try:
                full = service.users().messages().get(
                    userId="me", id=m["id"], format="full",
                ).execute()
            except HttpError as e:
                log(f"  skip msg {m['id']}: {e}")
                continue
            subject, body, from_addr = message_text(full)
            frag = parse_email(subject, body[:5000], from_addr)
            if frag:
                fragments.append(frag)
                log(f"  + {frag.provider}: {subject[:80]}")
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    log(f"Gmail: {seen} messages scanned, {len(fragments)} fragments extracted.")
    state["gmail_last_iso"] = datetime.now(timezone.utc).isoformat()
    return fragments


# ── Google Photos ────────────────────────────────────────────────────

def fetch_photos_for_period(creds: Credentials, start: date, end: date) -> list[str]:
    """Return Google Photos baseUrls for photos taken between start and end (inclusive)."""
    service = build("photoslibrary", "v1", credentials=creds, cache_discovery=False,
                    static_discovery=False)
    body = {
        "filters": {
            "dateFilter": {
                "ranges": [{
                    "startDate": {"year": start.year, "month": start.month, "day": start.day},
                    "endDate":   {"year": end.year,   "month": end.month,   "day": end.day},
                }]
            },
            "mediaTypeFilter": {"mediaTypes": ["PHOTO"]},
        },
        "pageSize": 50,
    }
    urls: list[str] = []
    try:
        resp = service.mediaItems().search(body=body).execute()
        for item in resp.get("mediaItems", []):
            base = item.get("baseUrl")
            if base:
                # baseUrls expire (~60 min). They're OK for display from a static page if
                # we sync often. For longer life, store as is and refresh on next sync.
                urls.append(base + "=w1200")
    except HttpError as e:
        log(f"Photos error for {start}..{end}: {e}")
    return urls


# ── geocoding ────────────────────────────────────────────────────────

_geocoder: Optional[Nominatim] = None


def geocoder() -> Nominatim:
    global _geocoder
    if _geocoder is None:
        _geocoder = Nominatim(user_agent="viagens-sync (https://edurcampos86-jpg.github.io/viagens/)")
    return _geocoder


def geocode_city(city: str, country: Optional[str] = None) -> Optional[dict]:
    """Returns dict with lat, lon, country, cc on success."""
    if not city:
        return None
    query = f"{city}, {country}" if country else city
    try:
        time.sleep(1.1)  # Nominatim rate limit: 1 req/sec
        loc = geocoder().geocode(query, addressdetails=True, language="pt", timeout=15)
        if not loc:
            return None
        addr = (loc.raw or {}).get("address", {})
        return {
            "lat": round(loc.latitude, 4),
            "lon": round(loc.longitude, 4),
            "country": addr.get("country") or country,
            "cc": (addr.get("country_code") or "").upper(),
        }
    except (GeocoderTimedOut, GeocoderServiceError) as e:
        log(f"  geocode {query} failed: {e}")
        return None


def resolve_location(frag: TripFragment) -> Optional[dict]:
    """Best-effort: try IATA destination, then origin, then city."""
    for code in [frag.destination, frag.origin]:
        if code and code in IATA:
            info = IATA[code]
            geo = geocode_city(info["city"], info["country"]) or {}
            return {
                "city": info["city"],
                "country": info["country"],
                "cc": info.get("cc") or geo.get("cc", ""),
                "lat": geo.get("lat"),
                "lon": geo.get("lon"),
            }
    if frag.city:
        geo = geocode_city(frag.city, frag.country)
        if geo:
            return {"city": frag.city, **geo}
    return None


# ── merge into trips.json ────────────────────────────────────────────

def slugify(s: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    return s or "trip"


def fragments_to_trips(fragments: list[TripFragment]) -> list[dict]:
    """Group fragments into trip dicts. One trip per (year-month, primary destination)."""
    buckets: dict[tuple, dict] = {}
    for f in fragments:
        loc = resolve_location(f)
        if not loc:
            continue
        # Date for grouping
        d = None
        if f.checkin:
            try:
                d = date.fromisoformat(f.checkin)
            except ValueError:
                d = None
        if d is None:
            continue
        key = (d.year, d.month, loc["city"])
        bucket = buckets.setdefault(key, {
            "year": d.year, "month": d.month,
            "city": loc["city"], "country": loc.get("country") or "",
            "cc": loc.get("cc") or "",
            "lat": loc.get("lat"), "lon": loc.get("lon"),
            "fragments": [],
            "first": d, "last": d,
        })
        bucket["fragments"].append(f)
        if f.checkout:
            try:
                co = date.fromisoformat(f.checkout)
                if co > bucket["last"]:
                    bucket["last"] = co
            except ValueError:
                pass
        if d < bucket["first"]:
            bucket["first"] = d

    trips: list[dict] = []
    for (yr, mo, city), b in buckets.items():
        cc = b["cc"]
        continent = CONTINENT_BY_COUNTRY_CODE.get(cc, "")
        nights = max(1, (b["last"] - b["first"]).days)
        flag = FLAG_BY_CC.get(cc, "📍")
        slug = f"{slugify(city)}-{yr}"

        providers = sorted({f.provider for f in b["fragments"]})
        flight_legs = [
            f"{f.origin}→{f.destination}" for f in b["fragments"]
            if f.kind == "flight" and f.origin and f.destination
        ]

        trip = {
            "id": slug,
            "name": city,
            "sub": f"{city} · {b['country']}",
            "status": "planned" if b["first"] > date.today() else "done",
            "continent": continent,
            "country": b["country"],
            "flag": flag,
            "emoji": "📍",
            "year": yr,
            "month": mo,
            "label": f"{['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][mo]} {yr}",
            "lat": b["lat"],
            "lon": b["lon"],
            "col": CONTINENT_COLORS.get(continent, "#888"),
            "air": " + ".join(flight_legs) if flight_legs else "",
            "nts": nights,
            "type": "leisure",
            "highlights": [],
            "memory": "",
            "logistics": {
                "hotels": [],
                "restaurants": [],
                "tips": "",
                "providers": providers,
                "refs": [f.ref for f in b["fragments"] if f.ref],
            },
            "_auto": True,
        }
        trips.append(trip)
    return trips


def merge_trips(existing: list[dict], new: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (combined, added_only). Skip if existing trip shares same year+month+country."""
    added: list[dict] = []
    by_key = {(t.get("year"), t.get("month"), (t.get("country") or "").lower()): t for t in existing}
    out = list(existing)
    for nt in new:
        key = (nt["year"], nt["month"], (nt.get("country") or "").lower())
        if key in by_key:
            continue
        out.append(nt)
        added.append(nt)
    # Keep sorted by date desc
    out.sort(key=lambda t: (-int(t.get("year", 0)), -int(t.get("month", 0))))
    return out, added


# ── photos attach ────────────────────────────────────────────────────

PHOTOS_PER_TRIP = 24
# Pad the trip date window so photos taken in transit (day before/after)
# also get associated with the trip.
PHOTO_WINDOW_PAD_DAYS = 1


def _trip_date_window(t: dict) -> Optional[tuple[date, date]]:
    """Compute (start, end) for a trip from its year/month/nts fields."""
    try:
        yr = int(t.get("year"))
        mo = int(t.get("month") or 1)
    except (TypeError, ValueError):
        return None
    try:
        start = date(yr, mo, 1)
    except ValueError:
        return None
    nts = int(t.get("nts") or 4)
    end = start + timedelta(days=max(1, nts) + PHOTO_WINDOW_PAD_DAYS)
    start = start - timedelta(days=PHOTO_WINDOW_PAD_DAYS)
    return start, end


def attach_photos(creds: Credentials, trips: list[dict], added: list[dict]) -> int:
    """Attach a fresh photo gallery to newly added trips."""
    count = 0
    for t in added:
        window = _trip_date_window(t)
        if not window:
            continue
        start, end = window
        try:
            urls = fetch_photos_for_period(creds, start, end)
            if urls:
                t["gallery"] = urls[:PHOTOS_PER_TRIP]
                count += len(t["gallery"])
                log(f"  photos for {t['name']} {t['year']}-{t['month']:02d}: {len(t['gallery'])}")
        except Exception as e:
            log(f"  photos attach failed for {t.get('name')}: {e}")
    return count


def refresh_existing_photos(creds: Credentials, trips: list[dict], skip_ids: set[str],
                            force: bool = False) -> tuple[int, int]:
    """
    Re-fetch Google Photos for every "done" trip and update its gallery when
    the photo count differs (i.e., the user added new photos in Google Photos
    for that trip's date range).

    By default we keep existing URLs and only write when the count grows, to
    avoid creating a noisy PR every 6h with refreshed-but-equivalent baseUrls
    (those expire ~60 min). Pass force=True (via FORCE_PHOTO_REFRESH=1) to
    overwrite all galleries with fresh URLs — useful when galleries went stale.

    Returns (refreshed_trip_count, total_new_photo_count).
    """
    refreshed = 0
    new_photos_total = 0
    for t in trips:
        if t.get("id") in skip_ids:
            continue
        if t.get("status") != "done":
            continue
        window = _trip_date_window(t)
        if not window:
            continue
        start, end = window
        try:
            urls = fetch_photos_for_period(creds, start, end)
        except Exception as e:
            log(f"  photo refresh failed for {t.get('name')}: {e}")
            continue
        if not urls:
            continue

        existing = t.get("gallery") or []
        new_slice = urls[:PHOTOS_PER_TRIP]
        # Only write when the count grew (new photos added) or force=True.
        if not force and len(new_slice) <= len(existing):
            continue
        t["gallery"] = new_slice
        delta = max(0, len(new_slice) - len(existing))
        refreshed += 1
        new_photos_total += delta
        log(f"  refreshed photos: {t['name']} {t.get('year')}-{int(t.get('month') or 0):02d} "
            f"({len(existing)} → {len(new_slice)})")
    return refreshed, new_photos_total


# ── report ──────────────────────────────────────────────────────────

def write_report(added: list[dict], photo_count: int, refreshed_count: int = 0,
                 refreshed_photos: int = 0) -> None:
    lines = [
        "# Sync report",
        "",
        f"Run: {datetime.now(timezone.utc).isoformat()}",
        f"Trips added: **{len(added)}**  ·  Photos attached: **{photo_count}**",
        f"Existing trips with photos refreshed: **{refreshed_count}** "
        f"(**{refreshed_photos}** photos re-synced)",
        "",
    ]
    if added:
        lines.append("## New trips")
        for t in added:
            lines.append(f"- **{t.get('flag','')} {t.get('name')}** — {t.get('label')} "
                         f"({t.get('country')}, {t.get('continent')})")
            log_ = t.get("logistics", {})
            if log_.get("providers"):
                lines.append(f"  - Providers: {', '.join(log_['providers'])}")
            if log_.get("refs"):
                lines.append(f"  - Refs: {', '.join(log_['refs'])}")
    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── main ────────────────────────────────────────────────────────────

def main() -> int:
    log("Starting sync")
    creds = get_credentials()
    state = load_state()
    trips_data = load_trips()
    existing = trips_data.get("trips", [])

    fragments = fetch_gmail_fragments(creds, state)
    new_trips = fragments_to_trips(fragments)
    log(f"Built {len(new_trips)} new trip candidates from {len(fragments)} fragments.")

    combined, added = merge_trips(existing, new_trips)
    log(f"After merge: {len(combined)} total, {len(added)} added.")

    photo_count = 0
    if added:
        photo_count = attach_photos(creds, combined, added)

    # Always check for new photos for existing "done" trips so user-added
    # photos in Google Photos flow into trips that already exist on the site.
    # Set FORCE_PHOTO_REFRESH=1 to also rewrite expired baseUrls.
    added_ids = {t.get("id") for t in added}
    force = os.environ.get("FORCE_PHOTO_REFRESH", "").lower() in ("1", "true", "yes")
    refreshed_count, refreshed_photos = refresh_existing_photos(creds, combined, added_ids, force=force)
    log(f"Refreshed photos for {refreshed_count} existing trips ({refreshed_photos} photos).")

    trips_data["trips"] = combined
    save_trips(trips_data)

    save_state(state)
    write_report(added, photo_count, refreshed_count, refreshed_photos)

    if not added and refreshed_count == 0:
        log("No new trips and no photo updates — nothing to commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
