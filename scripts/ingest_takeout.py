#!/usr/bin/env python3
"""
ingest_takeout.py — detecta viagens a partir de um export do Google Takeout.

Dois modos de operação, detectados automaticamente a partir do conteúdo
de /media-import/:

  Modo `cluster` (legado) — quando /media-import/ contém ARQUIVOS soltos.
    1. Varre /media-import/ recursivamente.
    2. Extrai EXIF/Takeout-JSON.
    3. Clusteriza via DBSCAN espaço-temporal.
    4. Match contra trips.json + reverse geocoding.

  Modo `album` (recomendado) — quando /media-import/ contém SUBPASTAS.
    Cada subpasta = uma viagem. Nome da subpasta = sugestão de trip-id.
    1. Para cada subpasta /<trip-id>/, lê todas as fotos/vídeos.
    2. Pula DBSCAN — tudo ali é uma viagem só.
    3. Extrai data range, centro geográfico, contagem.
    4. Match em trips.json por: (a) trip-id direto, (b) ano+país,
       (c) ano + lat/lon próximo (haversine ≤ 300 km).
    5. Output em proposals.json no mesmo formato (clusters[]).

Por que NÃO usa Google Photos Library API: deprecada em 31/mar/2025
(escopos photoslibrary.readonly retornam 403). Takeout (ZIP de download
manual) é a única forma estável e gratuita.

Uso:
  python scripts/ingest_takeout.py [--input PATH] [--output PATH] [--dry-run]
  python scripts/ingest_takeout.py --input /tmp/Takeout/Google\\ Photos/
  python scripts/ingest_takeout.py --mode album  # força modo álbum

Saída padrão: ./proposals.json (gitignored).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

# Imports pesados são lazy (só quando rodamos de fato), pra que testes
# unitários que mockam estes módulos consigam rodar sem instalar tudo.

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "media-import"
DEFAULT_OUTPUT = REPO_ROOT / "proposals.json"
TRIPS_JSON = REPO_ROOT / "data" / "trips.json"

# Extensões aceitas (imagens e vídeos).
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".avif"}
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".avi"}
MEDIA_EXTS = IMAGE_EXTS | VIDEO_EXTS

# Parâmetros do DBSCAN espaço-temporal.
# eps_days: 2 → fotos a até 2 dias de distância podem ser do mesmo cluster.
# eps_km: 500 → fotos a até 500 km podem ser do mesmo cluster.
# min_samples: 5 → cluster precisa de ao menos 5 fotos.
DEFAULTS = {
    "eps_days": 2.0,
    "eps_km": 500.0,
    "min_samples": 5,
    "merge_threshold_days": 7,  # match com trip existente se start/end estão a <=7d
    "album_match_km": 300.0,    # match por lat/lon: até 300 km do centro da trip
}


@dataclass
class MediaItem:
    """Representação leve de uma foto/vídeo + seus metadados."""
    path: str  # absoluto
    type: str  # "image" | "video"
    timestamp: float | None = None  # epoch seconds, UTC
    lat: float | None = None
    lon: float | None = None
    width: int | None = None
    height: int | None = None
    duration: float | None = None  # vídeos
    source: str = "unknown"  # "exif" | "takeout-json" | "stat-mtime"

    def has_gps(self) -> bool:
        return self.lat is not None and self.lon is not None

    def has_time(self) -> bool:
        return self.timestamp is not None


@dataclass
class Cluster:
    """Cluster de mídia detectado pelo DBSCAN."""
    id: str  # ex.: "cluster-0"
    items: list[MediaItem] = field(default_factory=list)
    start_date: str | None = None  # ISO YYYY-MM-DD
    end_date: str | None = None
    center_lat: float | None = None
    center_lon: float | None = None
    photos: int = 0
    videos: int = 0
    place: str | None = None  # reverse-geocoded
    country: str | None = None
    country_code: str | None = None
    suggested_trip_id: str | None = None
    action: str = "create"  # "create" | "merge" | "orphan"
    merge_with: str | None = None  # trip.id se action=="merge"


# ─────────────────────────────────────────────────────────────────────────────
# EXIF + Takeout JSON
# ─────────────────────────────────────────────────────────────────────────────

def _dms_to_decimal(dms, ref) -> float:
    """Converte (deg, min, sec) DMS de EXIF p/ decimal. Negativo se S/W."""
    deg, minutes, sec = [float(x.num) / float(x.den) if hasattr(x, "num") else float(x) for x in dms.values]
    val = deg + minutes / 60.0 + sec / 3600.0
    if str(ref).upper() in ("S", "W"):
        val = -val
    return val


def read_exif(path: Path) -> dict:
    """Lê EXIF de uma imagem. Retorna dict {timestamp, lat, lon, width, height}."""
    import exifread
    out: dict = {}
    try:
        with path.open("rb") as f:
            tags = exifread.process_file(f, details=False, stop_tag="GPS GPSLongitude")
    except Exception:
        return out

    # Timestamp: prefere DateTimeOriginal, depois DateTimeDigitized, depois DateTime.
    for k in ("EXIF DateTimeOriginal", "EXIF DateTimeDigitized", "Image DateTime"):
        if k in tags:
            try:
                dt = datetime.strptime(str(tags[k]), "%Y:%m:%d %H:%M:%S")
                out["timestamp"] = dt.replace(tzinfo=timezone.utc).timestamp()
                break
            except (ValueError, TypeError):
                continue

    # GPS
    lat = tags.get("GPS GPSLatitude")
    lat_ref = tags.get("GPS GPSLatitudeRef")
    lon = tags.get("GPS GPSLongitude")
    lon_ref = tags.get("GPS GPSLongitudeRef")
    if lat and lon and lat_ref and lon_ref:
        try:
            out["lat"] = _dms_to_decimal(lat, lat_ref)
            out["lon"] = _dms_to_decimal(lon, lon_ref)
        except Exception:
            pass

    # Dimensões (Pillow é mais confiável que EXIF para tamanho real)
    try:
        from PIL import Image
        with Image.open(path) as im:
            out["width"], out["height"] = im.size
    except Exception:
        pass

    return out


def read_takeout_json(media_path: Path) -> dict:
    """Lê metadado pareado do Takeout: <foto.jpg.json>. Retorna {timestamp, lat, lon}."""
    sidecar = media_path.with_name(media_path.name + ".json")
    if not sidecar.exists():
        # Takeout às vezes usa .supplemental-metadata.json ou trunca o nome
        for alt in (
            media_path.with_suffix(media_path.suffix + ".supplemental-metadata.json"),
            media_path.parent / (media_path.stem + ".json"),
        ):
            if alt.exists():
                sidecar = alt
                break
        else:
            return {}
    try:
        data = json.loads(sidecar.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}

    out: dict = {}
    pt = data.get("photoTakenTime") or data.get("creationTime") or {}
    ts = pt.get("timestamp")
    if ts:
        try:
            out["timestamp"] = float(ts)
        except (TypeError, ValueError):
            pass
    geo = data.get("geoData") or data.get("geoDataExif") or {}
    lat, lon = geo.get("latitude"), geo.get("longitude")
    # Takeout marca "0.0" para "sem GPS" — descartamos.
    if lat and lon and (lat != 0 or lon != 0):
        out["lat"], out["lon"] = float(lat), float(lon)
    return out


def probe_video(path: Path) -> dict:
    """Extrai duração e dimensões de vídeo via ffprobe."""
    import subprocess
    out: dict = {}
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=width,height,codec_type",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            info = json.loads(r.stdout)
            dur = info.get("format", {}).get("duration")
            if dur:
                out["duration"] = float(dur)
            for s in info.get("streams", []):
                if s.get("codec_type") == "video":
                    out["width"], out["height"] = s.get("width"), s.get("height")
                    break
    except (FileNotFoundError, subprocess.TimeoutExpired, json.JSONDecodeError):
        pass
    return out


def scan_media(input_dir: Path) -> list[MediaItem]:
    """Varre input_dir recursivamente e devolve MediaItem para cada arquivo aceito."""
    items: list[MediaItem] = []
    if not input_dir.exists():
        return items
    for path in sorted(input_dir.rglob("*")):
        if not path.is_file():
            continue
        ext = path.suffix.lower()
        if ext not in MEDIA_EXTS:
            continue
        kind = "image" if ext in IMAGE_EXTS else "video"
        item = MediaItem(path=str(path), type=kind)

        # 1. EXIF (imagens) / ffprobe (vídeos)
        if kind == "image":
            meta = read_exif(path)
            if meta:
                item.timestamp = meta.get("timestamp")
                item.lat = meta.get("lat")
                item.lon = meta.get("lon")
                item.width = meta.get("width")
                item.height = meta.get("height")
                item.source = "exif"
        else:
            meta = probe_video(path)
            item.duration = meta.get("duration")
            item.width = meta.get("width")
            item.height = meta.get("height")

        # 2. Takeout JSON sidecar (preenche o que faltou)
        side = read_takeout_json(path)
        if side:
            if item.timestamp is None and "timestamp" in side:
                item.timestamp = side["timestamp"]
                item.source = "takeout-json"
            if not item.has_gps() and "lat" in side:
                item.lat, item.lon = side["lat"], side["lon"]
                if item.source == "unknown":
                    item.source = "takeout-json"

        # 3. mtime como último recurso para timestamp
        if item.timestamp is None:
            try:
                item.timestamp = path.stat().st_mtime
                if item.source == "unknown":
                    item.source = "stat-mtime"
            except OSError:
                pass

        items.append(item)
    return items


# ─────────────────────────────────────────────────────────────────────────────
# Clusterização DBSCAN espaço-temporal
# ─────────────────────────────────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância em km entre dois pontos. Forma fechada (numpy não obrigatório)."""
    import math
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def cluster_items(
    items: list[MediaItem],
    eps_days: float = DEFAULTS["eps_days"],
    eps_km: float = DEFAULTS["eps_km"],
    min_samples: int = DEFAULTS["min_samples"],
) -> list[Cluster]:
    """
    DBSCAN com métrica customizada (tempo OU distância dentro do eps).
    Itens sem GPS *e* sem timestamp são marcados como órfãos (cluster próprio).
    Itens sem GPS mas com timestamp tentam herdar de cluster vizinho temporal.
    """
    import numpy as np
    from sklearn.cluster import DBSCAN

    # Só passa pelo DBSCAN itens com GPS + timestamp.
    geotagged = [it for it in items if it.has_gps() and it.has_time()]
    orphans = [it for it in items if not (it.has_gps() and it.has_time())]

    clusters: list[Cluster] = []
    if not geotagged:
        # Sem nada geotagged — devolve um cluster órfão se houver mídia.
        if items:
            clusters.append(_make_orphan_cluster(items, idx=0))
        return clusters

    # Features normalizadas: cada componente em "unidades de eps".
    eps_seconds = eps_days * 86400.0
    X = np.array([
        [it.timestamp / eps_seconds, it.lat / eps_km * 111.0, it.lon / eps_km * 111.0]
        for it in geotagged
    ])
    # Como já normalizamos por eps, eps efetivo é 1.0 e métrica é Chebyshev
    # (qualquer dimensão exceder eps já desempata para "fora").
    labels = DBSCAN(eps=1.0, min_samples=min_samples, metric="chebyshev").fit_predict(X)

    by_label: dict[int, list[MediaItem]] = defaultdict(list)
    for label, item in zip(labels, geotagged):
        by_label[int(label)].append(item)

    for label in sorted(by_label):
        items_in = by_label[label]
        if label == -1:
            # Ruído: cada um vira candidato órfão isolado (se ainda houver chance).
            # Para simplicidade, agrupamos como um único "outliers" cluster.
            continue
        clusters.append(_make_cluster(items_in, idx=len(clusters)))

    # Tenta agregar órfãos sem GPS mas com timestamp a algum cluster vizinho.
    for orph in list(orphans):
        if not orph.has_time():
            continue
        attached = False
        for cl in clusters:
            if cl.start_date and cl.end_date:
                t = orph.timestamp
                s = _iso_to_epoch(cl.start_date)
                e = _iso_to_epoch(cl.end_date) + 86400.0  # inclui o dia inteiro
                if s - eps_seconds <= t <= e + eps_seconds:
                    cl.items.append(orph)
                    cl.photos += 1 if orph.type == "image" else 0
                    cl.videos += 1 if orph.type == "video" else 0
                    orphans.remove(orph)
                    attached = True
                    break
        if attached:
            continue

    # Órfãos remanescentes viram seu próprio cluster (acao=orphan).
    if orphans:
        clusters.append(_make_orphan_cluster(orphans, idx=len(clusters)))

    return clusters


def _make_cluster(items: list[MediaItem], idx: int) -> Cluster:
    photos = sum(1 for it in items if it.type == "image")
    videos = sum(1 for it in items if it.type == "video")
    timestamps = sorted(it.timestamp for it in items if it.has_time())
    geotagged = [it for it in items if it.has_gps()]
    cl = Cluster(
        id=f"cluster-{idx}",
        items=items,
        photos=photos,
        videos=videos,
        start_date=_epoch_to_iso(timestamps[0]) if timestamps else None,
        end_date=_epoch_to_iso(timestamps[-1]) if timestamps else None,
        center_lat=sum(it.lat for it in geotagged) / len(geotagged) if geotagged else None,
        center_lon=sum(it.lon for it in geotagged) / len(geotagged) if geotagged else None,
    )
    return cl


def _make_orphan_cluster(items: list[MediaItem], idx: int) -> Cluster:
    cl = _make_cluster(items, idx)
    cl.action = "orphan"
    return cl


def _epoch_to_iso(ts: float) -> str:
    return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")


def _iso_to_epoch(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()


# ─────────────────────────────────────────────────────────────────────────────
# Captions automáticas (cidade · data) com cache de reverse geocoding
# ─────────────────────────────────────────────────────────────────────────────

MONTHS_PT = ["", "jan", "fev", "mar", "abr", "mai", "jun",
             "jul", "ago", "set", "out", "nov", "dez"]


def _format_date_pt(ts: float | None) -> str | None:
    """Formata epoch → 'DD MMM YYYY' em pt-BR. Ex.: '15 out 2023'."""
    if not ts:
        return None
    try:
        dt = datetime.utcfromtimestamp(float(ts))
    except (OverflowError, OSError, ValueError):
        return None
    return f"{dt.day:02d} {MONTHS_PT[dt.month]} {dt.year}"


def _round_coord(v: float, precision: float = 0.05) -> float:
    """Arredonda lat/lon p/ usar como chave de cache (~5 km a latitudes médias)."""
    return round(v / precision) * precision


def generate_captions(
    items: list[MediaItem],
    geocode_fn=None,
    fallback_place: str | None = None,
) -> dict[str, str]:
    """
    Gera caption automática "Cidade · DD MMM YYYY" para cada item.

    - Mapeia path → caption.
    - Reverse geocode é cacheado por (lat, lon) arredondado a ~5 km, então
      um álbum com 30 fotos no mesmo bairro faz só 1 request ao Nominatim.
    - Em álbuns multi-cidade (Tokyo+Kyoto na mesma viagem), cada foto pega
      a cidade certa via seu próprio GPS — não o centro do álbum.
    - Se geocode_fn=None (ex.: CI com --no-geocode), pula geocoding e
      cai em fallback_place ou só data.
    - Se reverse geocoding falhar para uma coordenada, cacheia None e
      reutiliza fallback_place para os próximos itens daquele cluster.
    """
    cache: dict[tuple[float, float], str | None] = {}
    out: dict[str, str] = {}

    for it in items:
        date_str = _format_date_pt(it.timestamp)
        place: str | None = None

        if it.has_gps() and geocode_fn is not None:
            key = (_round_coord(it.lat), _round_coord(it.lon))
            if key in cache:
                place = cache[key]
            else:
                try:
                    geo = geocode_fn(it.lat, it.lon)
                    place = (geo or {}).get("place")
                    cache[key] = place
                    time.sleep(1.1)  # rate-limit Nominatim
                except Exception:
                    cache[key] = None

        if not place:
            place = fallback_place

        if place and date_str:
            out[it.path] = f"{place} · {date_str}"
        elif date_str:
            out[it.path] = date_str
        elif place:
            out[it.path] = place
        # Se não tem nem data nem lugar, omite (apply mantém caption None).

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Reverse geocoding + trip ID + match contra trips.json
# ─────────────────────────────────────────────────────────────────────────────

def reverse_geocode(lat: float, lon: float, user_agent: str = "viagens-ingest") -> dict:
    """
    Reverse geocoding via Nominatim (OSM, gratuito, rate-limit 1 req/s).
    Retorna {place, country, country_code}. Falha silenciosa devolve {}.
    """
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderUnavailable, GeocoderTimedOut
    geolocator = Nominatim(user_agent=user_agent)
    try:
        loc = geolocator.reverse((lat, lon), language="pt", timeout=10)
    except (GeocoderUnavailable, GeocoderTimedOut):
        return {}
    if not loc:
        return {}
    addr = loc.raw.get("address", {})
    city = (
        addr.get("city") or addr.get("town") or addr.get("village")
        or addr.get("county") or addr.get("state")
    )
    return {
        "place": city or loc.address.split(",")[0].strip(),
        "country": addr.get("country"),
        "country_code": (addr.get("country_code") or "").upper() or None,
    }


def slugify(s: str) -> str:
    """Converte 'São Paulo' → 'sao-paulo'."""
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s


def suggest_trip_id(place: str | None, start_date: str | None) -> str:
    slug = slugify(place or "viagem")
    year = (start_date or "").split("-")[0] if start_date else ""
    return f"{slug}-{year}" if year else slug


def match_existing_trip(cluster: Cluster, trips: list[dict], threshold_days: int) -> str | None:
    """Devolve trip.id se houver match plausivel; senão None."""
    if not cluster.start_date or not cluster.country:
        return None
    cs = _iso_to_epoch(cluster.start_date)
    ce = _iso_to_epoch(cluster.end_date or cluster.start_date)
    win = threshold_days * 86400.0
    for trip in trips:
        # Match por país + datas próximas
        if trip.get("country") and cluster.country:
            same_country = (
                cluster.country.lower() in trip["country"].lower()
                or trip["country"].lower() in cluster.country.lower()
            )
        else:
            same_country = False
        if not same_country:
            continue
        ts = trip.get("startDate")
        if ts:
            try:
                tep = _iso_to_epoch(ts)
                if abs(tep - cs) <= win or abs(tep - ce) <= win:
                    return trip["id"]
            except ValueError:
                pass
        # Fallback: year+month
        ty, tm = trip.get("year"), trip.get("month")
        if ty and tm and cluster.start_date:
            cy = int(cluster.start_date[:4])
            cm = int(cluster.start_date[5:7])
            if ty == cy and abs(tm - cm) <= 1:
                return trip["id"]
    return None


def match_existing_trip_album(
    cluster: Cluster,
    trips: list[dict],
    *,
    album_match_km: float = DEFAULTS["album_match_km"],
) -> str | None:
    """
    Match para modo álbum, mais lenientes que cluster — testa três estratégias
    em ordem de confiança:
      (a) trip-id direto: cluster.suggested_trip_id == trip.id
      (b) ano (start_date) + país (case-insensitive substring)
      (c) ano + lat/lon próximos (haversine ≤ album_match_km)
    Devolve trip.id se houver match; senão None.
    """
    sid = cluster.suggested_trip_id
    if sid:
        for t in trips:
            if t.get("id") == sid:
                return sid

    year = int(cluster.start_date[:4]) if cluster.start_date else None
    if not year:
        return None

    # (b) ano + país
    if cluster.country:
        for t in trips:
            ty = t.get("year")
            if ty != year:
                continue
            tc = t.get("country") or ""
            if not tc:
                continue
            if (cluster.country.lower() in tc.lower()
                    or tc.lower() in cluster.country.lower()):
                return t["id"]

    # (c) ano + proximidade geográfica
    if cluster.center_lat is not None and cluster.center_lon is not None:
        for t in trips:
            if t.get("year") != year:
                continue
            tlat, tlon = t.get("lat"), t.get("lon")
            if tlat is None or tlon is None:
                continue
            if haversine_km(cluster.center_lat, cluster.center_lon,
                            float(tlat), float(tlon)) <= album_match_km:
                return t["id"]

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Modo álbum-por-álbum
# ─────────────────────────────────────────────────────────────────────────────

def _is_junk_dir(name: str) -> bool:
    """
    Subpastas que devem ser ignoradas na detecção de modo e no scan:
      - __MACOSX (criado por unzip de ZIPs do Finder no macOS)
      - Dotfiles (.DS_Store por exemplo aparece como arquivo, mas também
        guardamos contra subpastas tipo .Spotlight-V100, .Trashes, .git)
    """
    return name.startswith(".") or name == "__MACOSX"


def detect_mode(input_dir: Path) -> str:
    """
    Inspeciona input_dir e retorna 'album' se contém subpastas (cada uma uma
    viagem) ou 'cluster' se contém arquivos soltos na raiz.

    Heurística:
      - Se há ao menos uma subpasta legítima E nenhum arquivo de mídia na
        raiz → album.
      - Se há arquivos de mídia na raiz → cluster (mesmo se também houver
        subpastas, prevalece o comportamento legado).
      - Diretório vazio → cluster (default, pipeline antiga lida com isso).
      - Subpastas __MACOSX/.dotfiles são ignoradas na contagem.
    """
    if not input_dir.exists():
        return "cluster"
    root_media = any(
        p.is_file() and p.suffix.lower() in MEDIA_EXTS
        for p in input_dir.iterdir()
    )
    if root_media:
        return "cluster"
    has_subdir = any(p.is_dir() and not _is_junk_dir(p.name)
                     for p in input_dir.iterdir())
    return "album" if has_subdir else "cluster"


def scan_album_mode(input_dir: Path) -> list[tuple[str, list[MediaItem]]]:
    """
    Para cada subpasta de input_dir, devolve (trip_id_sugerido, items[]).
    O trip_id sugerido é o slug do nome da pasta (preservando ano se já houver).
    Subpastas __MACOSX/.dotfiles são puladas silenciosamente.
    """
    out: list[tuple[str, list[MediaItem]]] = []
    if not input_dir.exists():
        return out
    for sub in sorted(input_dir.iterdir()):
        if not sub.is_dir():
            continue
        if _is_junk_dir(sub.name):
            continue
        items = scan_media(sub)
        if not items:
            print(f"  ⚠ subpasta {sub.name} sem mídia — pulando", file=sys.stderr)
            continue
        out.append((_album_trip_id(sub.name), items))
    return out


def _album_trip_id(folder_name: str) -> str:
    """
    Converte 'Foz do Iguaçu 2021' → 'foz-do-iguacu-2021'.
    Se a pasta já tem ano embutido, preserva. Sem ano? deixa sem ano.
    """
    return slugify(folder_name)


def build_album_cluster(trip_id: str, items: list[MediaItem], idx: int) -> Cluster:
    """
    Constrói um Cluster a partir de uma subpasta — sem DBSCAN. Tudo dentro
    é considerado uma viagem só. Itens sem GPS são incluídos; centro é a
    média dos que têm GPS (se houver).
    """
    cl = _make_cluster(items, idx=idx)
    cl.id = f"album-{idx}"
    cl.suggested_trip_id = trip_id
    return cl


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

def load_trips(path: Path) -> list[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("trips", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def serialize_cluster(
    cl: Cluster,
    captions: dict[str, str] | None = None,
    smart_sources: dict[str, str | None] | None = None,
    preserved_manual: dict[str, bool] | None = None,
) -> dict:
    """
    Pronto p/ JSON. Lista de items é resumida (paths apenas).

    captions: mapa path → caption_str (de generate_captions). Quando
    presente, cada item ganha `caption` + `caption_auto: true`.

    smart_sources: opcional, mapa path → modelo Claude usado. Quando
    presente e não-None para o path, item ganha `caption_smart_source`.
    Pode coexistir com caption_auto: true. Quando o smart caiu em
    fallback factual, smart_sources[path] é None — comportamento idêntico
    a apenas `captions`.

    preserved_manual: opcional, mapa path → bool. Quando True, indica que
    a caption deste item veio de uma caption manual já existente em
    trip.media.gallery e foi PRESERVADA (smart não rodou). Nesse caso
    `caption_auto` sai False (curadoria manual) e o item ganha
    `preserved_manual_caption: true`.
    """
    captions = captions or {}
    smart_sources = smart_sources or {}
    preserved_manual = preserved_manual or {}
    def _item(it):
        cap = captions.get(it.path)
        is_preserved = bool(preserved_manual.get(it.path))
        return {
            "path": it.path,
            "type": it.type,
            "timestamp": it.timestamp,
            "lat": it.lat,
            "lon": it.lon,
            "source": it.source,
            "caption": cap,
            # caption_auto=False quando preservamos uma caption manual;
            # True para qualquer outra caption gerada (factual ou smart).
            "caption_auto": False if (is_preserved and cap) else (True if cap else None),
            "caption_smart_source": smart_sources.get(it.path),
            "preserved_manual_caption": True if is_preserved else None,
        }
    return {
        "id": cl.id,
        "action": cl.action,  # "create" | "merge" | "orphan"
        "merge_with": cl.merge_with,
        "suggested_trip_id": cl.suggested_trip_id,
        "place": cl.place,
        "country": cl.country,
        "country_code": cl.country_code,
        "start_date": cl.start_date,
        "end_date": cl.end_date,
        "center_lat": cl.center_lat,
        "center_lon": cl.center_lon,
        "stats": {"photos": cl.photos, "videos": cl.videos, "total": len(cl.items)},
        "items": [_item(it) for it in cl.items],
    }


def _geocode_cluster(cl: Cluster) -> None:
    """Reverse-geocoda o centro do cluster e popula place/country/country_code."""
    if cl.center_lat is None or cl.center_lon is None:
        return
    try:
        geo = reverse_geocode(cl.center_lat, cl.center_lon)
        cl.place = geo.get("place")
        cl.country = geo.get("country")
        cl.country_code = geo.get("country_code")
        time.sleep(1.1)  # rate limit Nominatim
    except Exception as e:
        print(f"  geocoding falhou: {e}", file=sys.stderr)


def run(input_dir: Path, output_path: Path, trips: list[dict], *,
        mode: str = "auto",
        eps_days: float = DEFAULTS["eps_days"],
        eps_km: float = DEFAULTS["eps_km"],
        min_samples: int = DEFAULTS["min_samples"],
        threshold_days: int = DEFAULTS["merge_threshold_days"],
        album_match_km: float = DEFAULTS["album_match_km"],
        geocode: bool = True,
        dry_run: bool = False,
        smart_captions: bool = False,
        smart_model: str | None = None,
        smart_rpm: int | None = None,
        smart_client: object | None = None) -> dict:
    """
    API programática (usada também pelos testes). Retorna o payload final.

    mode='auto'    → detect_mode(input_dir)
    mode='cluster' → DBSCAN clássico
    mode='album'   → uma viagem por subpasta

    smart_captions: quando True, substitui captions factuais pela versão
    emocional gerada via Anthropic vision (módulo `smart_captions`). Cai
    no fallback factual em qualquer falha — nunca aborta a ingestão.
    smart_client é uma porta de injeção para testes (mock).
    """
    resolved_mode = detect_mode(input_dir) if mode == "auto" else mode
    print(f"→ Modo: {resolved_mode}", file=sys.stderr)

    if resolved_mode == "album":
        clusters, total_items = _run_album(
            input_dir, trips, geocode=geocode,
            album_match_km=album_match_km,
            threshold_days=threshold_days,
        )
    else:
        clusters, total_items = _run_cluster(
            input_dir, trips, geocode=geocode,
            eps_days=eps_days, eps_km=eps_km,
            min_samples=min_samples, threshold_days=threshold_days,
        )

    # Gera captions per-photo. Em CI (--no-geocode), cai pra cluster.place
    # ou só data. Em uso local com geocode, cada foto pega sua própria
    # cidade (álbum Tokyo+Kyoto vira "Tokyo · DD" / "Kyoto · DD" por foto).
    geocode_fn = reverse_geocode if geocode else None
    captions_by_cluster: dict[str, dict[str, str]] = {}
    smart_sources_by_cluster: dict[str, dict[str, str | None]] = {}
    preserved_manual_by_cluster: dict[str, dict[str, bool]] = {}
    for cl in clusters:
        if cl.action == "orphan":
            continue
        captions_by_cluster[cl.id] = generate_captions(
            cl.items, geocode_fn=geocode_fn, fallback_place=cl.place,
        )

    if smart_captions:
        _apply_smart_captions(
            clusters, trips,
            factual_captions=captions_by_cluster,
            smart_sources=smart_sources_by_cluster,
            preserved_manual=preserved_manual_by_cluster,
            model=smart_model,
            rpm=smart_rpm,
            client=smart_client,
        )

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_dir": str(input_dir),
        "mode": resolved_mode,
        "params": {
            "eps_days": eps_days, "eps_km": eps_km,
            "min_samples": min_samples,
            "merge_threshold_days": threshold_days,
            "album_match_km": album_match_km,
            "smart_captions": smart_captions,
            "smart_model": smart_model if smart_captions else None,
        },
        "clusters": [
            serialize_cluster(
                cl,
                captions_by_cluster.get(cl.id),
                smart_sources_by_cluster.get(cl.id),
                preserved_manual_by_cluster.get(cl.id),
            )
            for cl in clusters
        ],
        "summary": {
            "total_items": total_items,
            "clusters": len(clusters),
            "create": sum(1 for c in clusters if c.action == "create"),
            "merge": sum(1 for c in clusters if c.action == "merge"),
            "orphan": sum(1 for c in clusters if c.action == "orphan"),
        },
    }
    if not dry_run:
        output_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"✓ proposals.json salvo em {output_path}", file=sys.stderr)
    return payload


def _apply_smart_captions(
    clusters,
    trips: list[dict],
    *,
    factual_captions: dict[str, dict[str, str]],
    smart_sources: dict[str, dict[str, str | None]],
    preserved_manual: dict[str, dict[str, bool]] | None = None,
    model: str | None,
    rpm: int | None,
    client: object | None,
) -> None:
    """Substitui in-place as captions factuais pelas smart, populando
    smart_sources com o modelo (None quando caiu em fallback factual).

    Precedência: **manual > smart > factual**. Antes de chamar a API,
    cruza `cluster.items` com `trip.media.gallery` (match por basename
    do arquivo). Para cada foto cuja gallery já tem `caption` e
    `caption_auto != True`, a chamada à API é PULADA, a caption manual
    é preservada em `factual_captions[cluster_id][path]`, e
    `preserved_manual[cluster_id][path] = True` (rastreado no proposals.json
    como `preserved_manual_caption: true`).

    Imports preguiçosos: o módulo `smart_captions` só carrega quando a flag
    é usada, evitando dependência dura do SDK em testes do pipeline default.
    """
    from smart_captions import (  # noqa: WPS433
        DEFAULT_MODEL,
        DEFAULT_REQUESTS_PER_MINUTE,
        TripContext,
        build_client,
        generate_smart_captions_batch,
    )

    use_model = model or DEFAULT_MODEL
    use_rpm = rpm if rpm and rpm > 0 else DEFAULT_REQUESTS_PER_MINUTE
    use_client: object | None = client  # init lazy: só criamos cliente real
    # se houver algum item que vai realmente chamar a API
    if preserved_manual is None:
        preserved_manual = {}

    trips_by_id = {t["id"]: t for t in trips}

    for cl in clusters:
        if cl.action == "orphan":
            continue
        ctx_trip = trips_by_id.get(cl.merge_with) if cl.merge_with else None
        if ctx_trip:
            context = TripContext(
                name=ctx_trip.get("name") or cl.id,
                country=ctx_trip.get("country") or cl.country,
                highlights=list(ctx_trip.get("highlights") or []),
                memory=ctx_trip.get("memory") or None,
            )
        else:
            context = TripContext(
                name=cl.suggested_trip_id or cl.id,
                country=cl.country,
            )

        # ── Detecção de captions manuais já existentes ─────────────────
        # Match por basename do arquivo (gallery.src é "media/<trip>/01.webp",
        # cluster.path é "<input>/<trip>/01.webp"; basename é o denominador
        # comum). Só conta como "manual" se houver caption e caption_auto
        # NÃO for True (default em gallery é ausente/None → considera manual).
        manual_by_basename: dict[str, str] = {}
        if ctx_trip:
            existing_gallery = (ctx_trip.get("media") or {}).get("gallery") or []
            for g in existing_gallery:
                src = g.get("src")
                cap = g.get("caption")
                if not src or not cap:
                    continue
                if g.get("caption_auto") is True:
                    continue  # gerada automaticamente → pode sobrescrever
                manual_by_basename[Path(src).name] = cap

        # ── Separar items: protegidos (manual) vs candidatos a smart ──
        items_for_api: list[dict] = []
        manual_results: dict[str, str] = {}
        for it in cl.items:
            basename = Path(it.path).name
            if basename in manual_by_basename:
                manual_results[it.path] = manual_by_basename[basename]
            else:
                items_for_api.append({
                    "path": it.path,
                    "exif": {"date": it.timestamp, "place": cl.place},
                })

        # ── Chamada à API só para items sem caption manual ─────────────
        fallback = factual_captions.get(cl.id, {})
        results: dict[str, object] = {}
        if items_for_api:
            if use_client is None:
                use_client = build_client()
            results = generate_smart_captions_batch(
                items_for_api,
                trip_context=context,
                fallback_captions=fallback,
                client=use_client,
                model=use_model,
                requests_per_minute=use_rpm,
            )

        # ── Merge: manuais preservados + resultados da API ─────────────
        new_captions: dict[str, str] = {}
        new_sources: dict[str, str | None] = {}
        new_preserved: dict[str, bool] = {}
        for path, cap in manual_results.items():
            new_captions[path] = cap
            new_sources[path] = None  # sem modelo: caption é manual
            new_preserved[path] = True
        for path, res in results.items():
            if res.caption:
                new_captions[path] = res.caption
            new_sources[path] = res.source_model
            new_preserved[path] = False

        factual_captions[cl.id] = new_captions
        smart_sources[cl.id] = new_sources
        preserved_manual[cl.id] = new_preserved


def _run_cluster(input_dir, trips, *, geocode, eps_days, eps_km,
                 min_samples, threshold_days):
    print(f"→ Escaneando {input_dir}…", file=sys.stderr)
    items = scan_media(input_dir)
    print(f"  {len(items)} arquivo(s) de mídia encontrados.", file=sys.stderr)

    print("→ Clusterizando (DBSCAN)…", file=sys.stderr)
    clusters = cluster_items(items, eps_days=eps_days, eps_km=eps_km,
                             min_samples=min_samples)
    print(f"  {len(clusters)} cluster(s) detectado(s).", file=sys.stderr)

    for cl in clusters:
        if cl.action == "orphan":
            cl.suggested_trip_id = None
            continue
        if geocode:
            print(f"→ Reverse geocoding {cl.id}…", file=sys.stderr)
            _geocode_cluster(cl)
        cl.suggested_trip_id = suggest_trip_id(cl.place, cl.start_date)
        match = match_existing_trip(cl, trips, threshold_days)
        if match:
            cl.action = "merge"
            cl.merge_with = match
    return clusters, len(items)


def _run_album(input_dir, trips, *, geocode, album_match_km, threshold_days):
    print(f"→ Escaneando subpastas em {input_dir}…", file=sys.stderr)
    albums = scan_album_mode(input_dir)
    print(f"  {len(albums)} álbum(ns) detectado(s).", file=sys.stderr)

    clusters: list[Cluster] = []
    total_items = 0
    for idx, (trip_id, items) in enumerate(albums):
        total_items += len(items)
        cl = build_album_cluster(trip_id, items, idx=idx)
        print(f"  album-{idx}: {trip_id} → {len(items)} item(s) "
              f"(fotos={cl.photos}, vídeos={cl.videos})", file=sys.stderr)
        if geocode:
            print(f"→ Reverse geocoding {cl.id}…", file=sys.stderr)
            _geocode_cluster(cl)
        # Em modo álbum, suggested_trip_id já veio do nome da pasta — só
        # acrescentamos o ano se a pasta não tinha e o EXIF revelou.
        if cl.start_date and not any(ch.isdigit() for ch in trip_id):
            year = cl.start_date[:4]
            cl.suggested_trip_id = f"{trip_id}-{year}"

        # Match estendido (3 estratégias).
        match = match_existing_trip_album(cl, trips, album_match_km=album_match_km)
        if not match:
            # Fallback: tenta a lógica clássica (país+datas)
            match = match_existing_trip(cl, trips, threshold_days)
        if match:
            cl.action = "merge"
            cl.merge_with = match
        clusters.append(cl)

    return clusters, total_items


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ingere fotos do Google Takeout em proposals.json.")
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Pasta de entrada (default: ./media-import/)")
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="proposals.json de saída (default: ./proposals.json)")
    ap.add_argument("--mode", choices=("auto", "album", "cluster"), default="auto",
                    help="auto = detecta pelo conteúdo; album = uma viagem por subpasta; cluster = DBSCAN.")
    ap.add_argument("--eps-days", type=float, default=DEFAULTS["eps_days"])
    ap.add_argument("--eps-km", type=float, default=DEFAULTS["eps_km"])
    ap.add_argument("--min-samples", type=int, default=DEFAULTS["min_samples"])
    ap.add_argument("--album-match-km", type=float, default=DEFAULTS["album_match_km"],
                    help="Raio (km) para match por proximidade em modo álbum.")
    ap.add_argument("--no-geocode", action="store_true", help="Pula reverse geocoding (útil em CI)")
    ap.add_argument("--dry-run", action="store_true", help="Não escreve proposals.json")
    ap.add_argument("--smart-captions", action="store_true",
                    help="Substitui captions factuais por legendas emocionais via Anthropic API (opt-in).")
    ap.add_argument("--smart-model", default=None,
                    help="Modelo Claude para smart-captions (default: claude-haiku-4-5)")
    ap.add_argument("--smart-rpm", type=int, default=None,
                    help="Rate limit em requests/min para smart-captions (default: 45)")
    ap.add_argument("--estimate-cost", action="store_true",
                    help="Combinada com --smart-captions, conta itens e imprime estimativa de custo SEM chamar a API.")
    args = ap.parse_args(argv)

    if not args.input.exists():
        print(f"✗ Diretório de entrada não encontrado: {args.input}", file=sys.stderr)
        return 2

    trips = load_trips(TRIPS_JSON)

    # --estimate-cost: só conta e sai (não chama API, não escreve proposals).
    if args.estimate_cost:
        if not args.smart_captions:
            print("✗ --estimate-cost só faz sentido com --smart-captions.", file=sys.stderr)
            return 2
        try:
            from smart_captions import DEFAULT_MODEL, format_cost_report  # noqa: WPS433
        except ImportError as exc:
            print(f"✗ Pacote `anthropic` ausente: {exc}", file=sys.stderr)
            return 2
        items = scan_media(args.input)
        n = sum(1 for it in items if it.type == "image")
        print(format_cost_report(n, args.smart_model or DEFAULT_MODEL))
        return 0

    if args.smart_captions:
        try:
            from smart_captions import get_api_key, SmartCaptionsConfigError  # noqa: WPS433
            get_api_key()  # falha cedo se ANTHROPIC_API_KEY ausente
        except SmartCaptionsConfigError as exc:
            print(f"✗ {exc}", file=sys.stderr)
            return 2
        except ImportError as exc:
            print(f"✗ Pacote `anthropic` ausente: {exc}", file=sys.stderr)
            return 2

    payload = run(
        args.input, args.output, trips,
        mode=args.mode,
        eps_days=args.eps_days, eps_km=args.eps_km,
        min_samples=args.min_samples,
        album_match_km=args.album_match_km,
        geocode=not args.no_geocode,
        dry_run=args.dry_run,
        smart_captions=args.smart_captions,
        smart_model=args.smart_model,
        smart_rpm=args.smart_rpm,
    )
    s = payload["summary"]
    print(f"\nResumo ({payload['mode']}): {s['total_items']} item(s), "
          f"{s['clusters']} cluster(s) "
          f"({s['create']} novos, {s['merge']} merge, {s['orphan']} órfãos).",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
