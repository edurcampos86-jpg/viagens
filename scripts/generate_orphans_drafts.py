"""
Gera `docs/drafts-from-places-audit.json` a partir da lista de viagens
órfãs detectadas em https://photos.google.com/places na auditoria de
2026-05-22.

- Reverse-geocode via Nominatim (geopy) com rate-limit 1 req/s.
- Cache em disco em `.cache/geocode.json` para evitar re-bater na API.
- Não toca em `data/trips.json` (somente leitura, p/ checar conflitos).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from geopy.geocoders import Nominatim
from geopy.extra.rate_limiter import RateLimiter

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / ".cache" / "geocode.json"
TRIPS_PATH = ROOT / "data" / "trips.json"
OUT_PATH = ROOT / "docs" / "drafts-from-places-audit.json"

AUDIT_DATE = "2026-05-22"
AUDIT_NOTE = (
    "Detectada em Lugares do Google Photos durante auditoria de "
    f"{AUDIT_DATE}"
)

# Mapeamento país → continente (cobre apenas os países da auditoria)
CONTINENTS = {
    "Brasil": "Americas",
    "Estados Unidos": "Americas",
    "United States": "Americas",
}

# Normaliza países vindos do Nominatim para os rótulos curtos que o
# resto da base usa (ver trips.json).
COUNTRY_ALIASES = {
    "Estados Unidos da América": "Estados Unidos",
    "United States of America": "Estados Unidos",
}

# Cada item: (slug-base, nome-pt, subtítulo, query-nominatim, ano-sugerido, emoji, conflito-com-trip)
ORPHANS: list[dict[str, Any]] = [
    # ---- Internacionais ----
    {
        "slug": "honolulu",
        "name": "Honolulu",
        "sub": "Havaí · Estados Unidos",
        "query": "Honolulu, Hawaii, USA",
        "year": None,
        "emoji": "🌺",
        "country_hint": "Estados Unidos",
        "conflict": "havai-2024",
    },
    {
        "slug": "ny-extra",
        "name": "Nova York (viagens adicionais)",
        "sub": "NY · Estados Unidos",
        "query": "Manhattan, New York City, USA",
        "year": None,
        "emoji": "🗽",
        "country_hint": "Estados Unidos",
        "conflict": "ny-2022 (690 fotos no Lugares sugere mais de uma viagem)",
    },
    {
        "slug": "orlando",
        "name": "Orlando",
        "sub": "Flórida · Estados Unidos",
        "query": "Orlando, Florida, USA",
        "year": None,
        "emoji": "🎢",
        "country_hint": "Estados Unidos",
        "conflict": "florida-2022 (verificar se é a mesma)",
    },
    {
        "slug": "vila-remedios",
        "name": "Vila dos Remédios",
        "sub": "Fernando de Noronha · Brasil",
        "query": "Vila dos Remédios, Fernando de Noronha, Brazil",
        "year": None,
        "emoji": "🐬",
        "country_hint": "Brasil",
        "conflict": "noronha-2024 (provavelmente a mesma viagem)",
    },
    # ---- Nacionais ----
    {
        "slug": "salvador",
        "name": "Salvador",
        "sub": "Bahia · Brasil",
        "query": "Salvador, Bahia, Brazil",
        "year": None,
        "emoji": "🏙️",
        "country_hint": "Brasil",
        "conflict": "Pode ser residência atual — confirmar",
    },
    {
        "slug": "rio-extra",
        "name": "Rio de Janeiro (viagens adicionais)",
        "sub": "Rio de Janeiro · Brasil",
        "query": "Rio de Janeiro, Brazil",
        "year": None,
        "emoji": "🗿",
        "country_hint": "Brasil",
        "conflict": "rio-2023 (verificar se há outras visitas)",
    },
    {
        "slug": "brasilia-pre",
        "name": "Brasília (visitas anteriores)",
        "sub": "Distrito Federal · Brasil",
        "query": "Brasília, Distrito Federal, Brazil",
        "year": None,
        "emoji": "🏛️",
        "country_hint": "Brasil",
        "conflict": "brasilia-2026 está como planned — confirmar se há viagens passadas",
    },
    {
        "slug": "aracaju",
        "name": "Aracaju",
        "sub": "Sergipe · Brasil",
        "query": "Aracaju, Sergipe, Brazil",
        "year": None,
        "emoji": "🌅",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "praia-do-forte",
        "name": "Praia do Forte",
        "sub": "Bahia · Brasil",
        "query": "Praia do Forte, Mata de São João, Bahia, Brazil",
        "year": None,
        "emoji": "🐢",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "maragogi-extra",
        "name": "Maragogi (visitas adicionais)",
        "sub": "Alagoas · Brasil",
        "query": "Maragogi, Alagoas, Brazil",
        "year": None,
        "emoji": "🐠",
        "country_hint": "Brasil",
        "conflict": "maragogi-2024 já existe — só registrar se houver outras",
    },
    {
        "slug": "maceio-extra",
        "name": "Maceió (visitas adicionais)",
        "sub": "Alagoas · Brasil",
        "query": "Maceió, Alagoas, Brazil",
        "year": None,
        "emoji": "🏖️",
        "country_hint": "Brasil",
        "conflict": "maragogi-2024 (Maragogi & Maceió) cobre uma — confirmar outras",
    },
    {
        "slug": "natal",
        "name": "Natal",
        "sub": "Rio Grande do Norte · Brasil",
        "query": "Natal, Rio Grande do Norte, Brazil",
        "year": None,
        "emoji": "🌴",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "morro-de-sao-paulo",
        "name": "Morro de São Paulo",
        "sub": "Bahia · Brasil",
        "query": "Morro de São Paulo, Cairu, Bahia, Brazil",
        "year": None,
        "emoji": "🛥️",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "canoa-quebrada",
        "name": "Canoa Quebrada",
        "sub": "Ceará · Brasil",
        "query": "Canoa Quebrada, Aracati, Ceará, Brazil",
        "year": None,
        "emoji": "🌬️",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "florianopolis",
        "name": "Florianópolis",
        "sub": "Santa Catarina · Brasil",
        "query": "Florianópolis, Santa Catarina, Brazil",
        "year": None,
        "emoji": "🏝️",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "gramado-extra",
        "name": "Gramado (visitas adicionais)",
        "sub": "Rio Grande do Sul · Brasil",
        "query": "Gramado, Rio Grande do Sul, Brazil",
        "year": None,
        "emoji": "🎄",
        "country_hint": "Brasil",
        "conflict": "gramado-2023 já existe — só registrar se houver outras",
    },
    {
        "slug": "campos-do-jordao",
        "name": "Campos do Jordão",
        "sub": "São Paulo · Brasil",
        "query": "Campos do Jordão, São Paulo, Brazil",
        "year": None,
        "emoji": "🌲",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "lencois-maranhenses",
        "name": "Lençóis Maranhenses",
        "sub": "Maranhão · Brasil",
        "query": "Parque Nacional dos Lençóis Maranhenses, Maranhão, Brazil",
        "year": None,
        "emoji": "🏜️",
        "country_hint": "Brasil",
        "conflict": None,
    },
    {
        "slug": "mucuge",
        "name": "Mucugê",
        "sub": "Chapada Diamantina · Brasil",
        "query": "Mucugê, Bahia, Brazil",
        "year": None,
        "emoji": "⛰️",
        "country_hint": "Brasil",
        "conflict": None,
    },
]


def load_cache() -> dict[str, dict[str, Any]]:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict[str, dict[str, Any]]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(cache, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def geocode_all(orphans: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    cache = load_cache()
    needs_lookup = [o for o in orphans if o["query"] not in cache]
    if not needs_lookup:
        print(f"[cache hit] {len(orphans)} queries already cached")
        return cache

    print(f"[network] {len(needs_lookup)} queries miss cache; using Nominatim")
    geolocator = Nominatim(user_agent="viagens-audit/1.0 (edurcampos)")
    geocode = RateLimiter(geolocator.geocode, min_delay_seconds=1.1)

    for o in needs_lookup:
        q = o["query"]
        print(f"  -> {q}")
        try:
            result = geocode(q, language="pt", addressdetails=True)
        except Exception as exc:  # noqa: BLE001
            print(f"     ERRO: {exc}")
            cache[q] = {"error": str(exc)}
            continue
        if result is None:
            print(f"     sem resultado")
            cache[q] = {"error": "no_result"}
            continue
        addr = (result.raw or {}).get("address", {})
        cache[q] = {
            "lat": float(result.latitude),
            "lon": float(result.longitude),
            "country_pt": addr.get("country"),
            "country_code": addr.get("country_code"),
            "display_name": result.address,
        }
        time.sleep(0.1)  # extra cushion

    save_cache(cache)
    return cache


def build_drafts(
    orphans: list[dict[str, Any]],
    cache: dict[str, dict[str, Any]],
    existing_ids: set[str],
) -> list[dict[str, Any]]:
    drafts = []
    for o in orphans:
        geo = cache.get(o["query"], {})
        lat = geo.get("lat")
        lon = geo.get("lon")
        # Prefer país do reverse-geocode (em pt), fallback ao hint
        country_raw = geo.get("country_pt") or o["country_hint"]
        country_pt = COUNTRY_ALIASES.get(country_raw, country_raw)
        continent = CONTINENTS.get(country_pt) or CONTINENTS.get(
            o["country_hint"], "Americas"
        )

        # Slug: nunca colide com um id já existente
        slug = o["slug"]
        if o["year"] is not None:
            tid = f"{slug}-{o['year']}"
        else:
            tid = f"{slug}-draft"
        if tid in existing_ids:
            tid = f"{slug}-audit-draft"

        notes = AUDIT_NOTE
        if o["year"] is None:
            notes += " · ano desconhecido (preencher após confirmação)"
        if o["conflict"]:
            notes += f" · possível conflito com: {o['conflict']}"

        draft = {
            "id": tid,
            "name": o["name"],
            "sub": o["sub"],
            "status": "draft",
            "continent": continent,
            "country": country_pt,
            "year": o["year"],
            "lat": lat,
            "lon": lon,
            "emoji": o["emoji"],
            "_audit_notes": notes,
        }
        drafts.append(draft)
    return drafts


def main() -> None:
    trips_data = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    existing_ids = {t["id"] for t in trips_data["trips"]}

    cache = geocode_all(ORPHANS)
    drafts = build_drafts(ORPHANS, cache, existing_ids)

    payload = {
        "audit_date": AUDIT_DATE,
        "source": "https://photos.google.com/places (auditoria manual)",
        "geocode_source": "Nominatim/OpenStreetMap via geopy",
        "drafts_count": len(drafts),
        "drafts": drafts,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"OK — {OUT_PATH.relative_to(ROOT)} gerado ({len(drafts)} drafts)")


if __name__ == "__main__":
    main()
