#!/usr/bin/env python3
"""
ingest_takeout.py — detecta viagens a partir de um export do Google Takeout.

Pipeline:
  1. Varre /media-import/ (ou pasta passada via --input).
  2. Para cada foto/vídeo, extrai timestamp e GPS via EXIF (Pillow + exifread)
     ou via metadado pareado .json do Takeout (fallback).
  3. Clusteriza fotos em "viagens candidatas" via DBSCAN espaço-temporal.
  4. Para cada cluster, sugere um trip-id via reverse geocoding (Nominatim).
  5. Compara contra data/trips.json — propõe MERGE com viagem existente OU
     CREATE de nova viagem.
  6. Salva proposals.json para revisão humana (NÃO modifica trips.json).

Por que NÃO usa Google Photos Library API: deprecada em 31/mar/2025
(escopos photoslibrary.readonly retornam 403). Takeout (ZIP de download
manual) é a única forma estável e gratuita.

Uso:
  python scripts/ingest_takeout.py [--input PATH] [--output PATH] [--dry-run]
  python scripts/ingest_takeout.py --input /tmp/Takeout/Google\\ Photos/

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


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

def load_trips(path: Path) -> list[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8")).get("trips", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def serialize_cluster(cl: Cluster) -> dict:
    """Pronto p/ JSON. Lista de items é resumida (paths apenas)."""
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
        "items": [
            {
                "path": it.path,
                "type": it.type,
                "timestamp": it.timestamp,
                "lat": it.lat,
                "lon": it.lon,
                "source": it.source,
            }
            for it in cl.items
        ],
    }


def run(input_dir: Path, output_path: Path, trips: list[dict], *,
        eps_days: float = DEFAULTS["eps_days"],
        eps_km: float = DEFAULTS["eps_km"],
        min_samples: int = DEFAULTS["min_samples"],
        threshold_days: int = DEFAULTS["merge_threshold_days"],
        geocode: bool = True,
        dry_run: bool = False) -> dict:
    """API programática (usada também pelos testes). Retorna o payload final."""
    print(f"→ Escaneando {input_dir}…", file=sys.stderr)
    items = scan_media(input_dir)
    print(f"  {len(items)} arquivo(s) de mídia encontrados.", file=sys.stderr)

    print("→ Clusterizando…", file=sys.stderr)
    clusters = cluster_items(items, eps_days=eps_days, eps_km=eps_km, min_samples=min_samples)
    print(f"  {len(clusters)} cluster(s) detectado(s).", file=sys.stderr)

    for cl in clusters:
        if cl.action == "orphan":
            cl.suggested_trip_id = None
            continue
        if geocode and cl.center_lat is not None and cl.center_lon is not None:
            print(f"→ Reverse geocoding {cl.id}…", file=sys.stderr)
            try:
                geo = reverse_geocode(cl.center_lat, cl.center_lon)
                cl.place = geo.get("place")
                cl.country = geo.get("country")
                cl.country_code = geo.get("country_code")
                time.sleep(1.1)  # rate limit Nominatim
            except Exception as e:
                print(f"  geocoding falhou: {e}", file=sys.stderr)
        cl.suggested_trip_id = suggest_trip_id(cl.place, cl.start_date)
        match = match_existing_trip(cl, trips, threshold_days)
        if match:
            cl.action = "merge"
            cl.merge_with = match

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input_dir": str(input_dir),
        "params": {
            "eps_days": eps_days, "eps_km": eps_km,
            "min_samples": min_samples, "merge_threshold_days": threshold_days,
        },
        "clusters": [serialize_cluster(cl) for cl in clusters],
        "summary": {
            "total_items": len(items),
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Ingere fotos do Google Takeout em proposals.json.")
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="Pasta de entrada (default: ./media-import/)")
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="proposals.json de saída (default: ./proposals.json)")
    ap.add_argument("--eps-days", type=float, default=DEFAULTS["eps_days"])
    ap.add_argument("--eps-km", type=float, default=DEFAULTS["eps_km"])
    ap.add_argument("--min-samples", type=int, default=DEFAULTS["min_samples"])
    ap.add_argument("--no-geocode", action="store_true", help="Pula reverse geocoding (útil em CI)")
    ap.add_argument("--dry-run", action="store_true", help="Não escreve proposals.json")
    args = ap.parse_args(argv)

    if not args.input.exists():
        print(f"✗ Diretório de entrada não encontrado: {args.input}", file=sys.stderr)
        return 2

    trips = load_trips(TRIPS_JSON)
    payload = run(
        args.input, args.output, trips,
        eps_days=args.eps_days, eps_km=args.eps_km,
        min_samples=args.min_samples, geocode=not args.no_geocode,
        dry_run=args.dry_run,
    )
    s = payload["summary"]
    print(f"\nResumo: {s['total_items']} item(s), {s['clusters']} cluster(s) "
          f"({s['create']} novos, {s['merge']} merge, {s['orphan']} órfãos).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
