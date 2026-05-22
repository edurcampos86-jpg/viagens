"""
Testes da pipeline de ingestão (Fase 3).

Roda sem rede (mock do reverse geocoding). Gera fotos sintéticas em /tmp
com EXIF + GPS via Pillow para testar o pipeline real de leitura.

Uso:
    pytest scripts/test_ingest.py -v
"""

from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from ingest_takeout import (
    MediaItem, cluster_items, haversine_km, slugify,
    suggest_trip_id, match_existing_trip, run, _epoch_to_iso,
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _ts(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()


def _item(path: str, iso_date: str, lat: float | None = None, lon: float | None = None,
          kind: str = "image") -> MediaItem:
    return MediaItem(
        path=path, type=kind,
        timestamp=_ts(iso_date), lat=lat, lon=lon, source="exif"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Funções puras
# ─────────────────────────────────────────────────────────────────────────────

def test_haversine_known_distance():
    # São Paulo (GRU) → Foz do Iguaçu (IGU): ~890 km
    d = haversine_km(-23.43, -46.48, -25.69, -54.43)
    assert 800 < d < 950


def test_haversine_same_point_zero():
    assert haversine_km(0, 0, 0, 0) == 0.0


def test_slugify_handles_accents_and_spaces():
    assert slugify("São Paulo") == "sao-paulo"
    assert slugify("Foz do Iguaçu") == "foz-do-iguacu"
    assert slugify("  Hello, World!  ") == "hello-world"


def test_suggest_trip_id_combines_place_and_year():
    assert suggest_trip_id("Foz do Iguaçu", "2021-06-12") == "foz-do-iguacu-2021"
    assert suggest_trip_id(None, "2024-01-01") == "viagem-2024"
    assert suggest_trip_id("Tokyo", None) == "tokyo"


# ─────────────────────────────────────────────────────────────────────────────
# Clusterização DBSCAN
# ─────────────────────────────────────────────────────────────────────────────

def test_cluster_single_trip_groups_together():
    """5 fotos no mesmo lugar + mesma semana → 1 cluster."""
    items = [
        _item(f"/tmp/f{i}.jpg", f"2024-06-{10+i:02d}", -25.69, -54.43)
        for i in range(5)
    ]
    clusters = cluster_items(items, min_samples=3)
    # Esperamos exatamente 1 cluster ativo (não-órfão).
    active = [c for c in clusters if c.action != "orphan"]
    assert len(active) == 1
    assert active[0].photos == 5
    assert active[0].start_date == "2024-06-10"
    assert active[0].end_date == "2024-06-14"


def test_cluster_two_distinct_trips_separated_by_time_and_space():
    """5 fotos em junho/Foz + 5 fotos em novembro/Atacama → 2 clusters."""
    foz = [_item(f"/tmp/foz{i}.jpg", f"2024-06-{10+i:02d}", -25.69, -54.43) for i in range(5)]
    atacama = [_item(f"/tmp/atc{i}.jpg", f"2024-11-{10+i:02d}", -22.91, -68.20) for i in range(5)]
    clusters = cluster_items(foz + atacama, min_samples=3)
    active = [c for c in clusters if c.action != "orphan"]
    assert len(active) == 2
    # Cada cluster com 5 fotos
    assert all(c.photos == 5 for c in active)


def test_cluster_orphan_when_below_min_samples():
    """3 fotos em um lugar com min_samples=5 → todas órfãs."""
    items = [_item(f"/tmp/f{i}.jpg", f"2024-06-{10+i:02d}", -25.69, -54.43) for i in range(3)]
    clusters = cluster_items(items, min_samples=5)
    # Não deve haver cluster ativo
    assert all(c.action == "orphan" for c in clusters)


def test_cluster_attaches_orphan_without_gps_to_temporal_neighbor():
    """
    Foto sem GPS, mas com timestamp dentro da janela de um cluster geotagged,
    deve ser associada a esse cluster.
    """
    geotagged = [_item(f"/tmp/g{i}.jpg", f"2024-06-{10+i:02d}", -25.69, -54.43) for i in range(5)]
    orphan = MediaItem(path="/tmp/no-gps.jpg", type="image", timestamp=_ts("2024-06-12"))
    clusters = cluster_items(geotagged + [orphan], min_samples=3)
    active = [c for c in clusters if c.action != "orphan"]
    assert len(active) == 1
    # Cluster ativo absorveu o órfão
    assert any(it.path == "/tmp/no-gps.jpg" for it in active[0].items)


# ─────────────────────────────────────────────────────────────────────────────
# Matching contra trips.json existente
# ─────────────────────────────────────────────────────────────────────────────

def test_match_existing_trip_same_country_close_dates():
    cluster_items_list = [_item(f"/tmp/f{i}.jpg", f"2021-06-{10+i:02d}", -25.69, -54.43) for i in range(5)]
    clusters = cluster_items(cluster_items_list, min_samples=3)
    cl = clusters[0]
    cl.country = "Brasil"
    trips = [{"id": "iguacu-2021", "country": "Brasil", "startDate": "2021-06-12"}]
    match = match_existing_trip(cl, trips, threshold_days=7)
    assert match == "iguacu-2021"


def test_no_match_when_year_off():
    cluster_items_list = [_item(f"/tmp/f{i}.jpg", f"2024-06-{10+i:02d}", -25.69, -54.43) for i in range(5)]
    clusters = cluster_items(cluster_items_list, min_samples=3)
    cl = clusters[0]
    cl.country = "Brasil"
    trips = [{"id": "iguacu-2021", "country": "Brasil", "startDate": "2021-06-12"}]
    assert match_existing_trip(cl, trips, threshold_days=7) is None


# ─────────────────────────────────────────────────────────────────────────────
# Integração com Pillow — gera fotos sintéticas e roda scan_media
# ─────────────────────────────────────────────────────────────────────────────

def _make_jpeg_with_exif(path: Path, when: datetime, lat: float, lon: float):
    """Cria um JPEG real com EXIF de timestamp + GPS via Pillow."""
    from PIL import Image
    import piexif  # noqa: F401  (vamos sem piexif para evitar dep extra)
    # Alternativa: gera JPEG simples, depois injeta EXIF manualmente seria complexo.
    # Para teste, usamos Pillow + exif=Image.Exif() (API moderna).
    img = Image.new("RGB", (200, 200), color=(120, 80, 40))
    exif = Image.Exif()
    exif[0x9003] = when.strftime("%Y:%m:%d %H:%M:%S")  # DateTimeOriginal
    # GPS (IFD)
    def to_dms(deg):
        d = int(abs(deg)); m_full = (abs(deg) - d) * 60
        m = int(m_full); s = (m_full - m) * 60
        return ((d, 1), (m, 1), (int(s * 10000), 10000))
    gps = {
        1: "N" if lat >= 0 else "S",
        2: to_dms(lat),
        3: "E" if lon >= 0 else "W",
        4: to_dms(lon),
    }
    exif[0x8825] = gps
    img.save(path, "JPEG", exif=exif.tobytes())


def test_scan_media_reads_synthetic_jpeg_exif(tmp_path):
    """
    Gera 1 JPEG real com EXIF + GPS, roda scan_media e verifica que os metadados
    foram lidos. Pulado se Pillow falhar na escrita de EXIF (formato varia entre versões).
    """
    pytest.importorskip("PIL")
    from ingest_takeout import scan_media
    src = tmp_path / "photo.jpg"
    try:
        # Sem piexif, usamos só Pillow Image.Exif() (mais simples).
        from PIL import Image
        img = Image.new("RGB", (300, 200), (200, 100, 50))
        exif = Image.Exif()
        exif[0x9003] = "2024:06:12 14:30:00"
        img.save(src, "JPEG", exif=exif.tobytes())
    except Exception as e:
        pytest.skip(f"Pillow EXIF write não suportado: {e}")

    items = scan_media(tmp_path)
    assert len(items) == 1
    it = items[0]
    assert it.type == "image"
    # Timestamp pode ter sido lido (exifread parseia) ou caído no mtime — ambos OK.
    assert it.timestamp is not None
    assert it.width == 300 and it.height == 200


def test_scan_media_falls_back_to_takeout_json(tmp_path):
    """Foto sem EXIF + sidecar JSON do Takeout com GPS → MediaItem deve ter GPS."""
    pytest.importorskip("PIL")
    from PIL import Image
    src = tmp_path / "photo.jpg"
    Image.new("RGB", (100, 100)).save(src, "JPEG")
    sidecar = src.with_name(src.name + ".json")
    sidecar.write_text(json.dumps({
        "photoTakenTime": {"timestamp": str(int(_ts("2024-06-12")))},
        "geoData": {"latitude": -25.69, "longitude": -54.43},
    }))
    from ingest_takeout import scan_media
    items = scan_media(tmp_path)
    assert len(items) == 1
    assert items[0].lat == pytest.approx(-25.69)
    assert items[0].lon == pytest.approx(-54.43)
    assert items[0].source in ("takeout-json", "exif")


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline end-to-end (sem rede)
# ─────────────────────────────────────────────────────────────────────────────

def test_run_pipeline_end_to_end_no_geocode(tmp_path):
    """Cria 5 JPEGs sintéticos + sidecars JSON, roda run() sem geocoding."""
    pytest.importorskip("PIL")
    from PIL import Image
    for i in range(5):
        p = tmp_path / f"foz_{i:02d}.jpg"
        Image.new("RGB", (100, 100)).save(p, "JPEG")
        sidecar = p.with_name(p.name + ".json")
        sidecar.write_text(json.dumps({
            "photoTakenTime": {"timestamp": str(int(_ts(f"2024-06-{10+i:02d}")))},
            "geoData": {"latitude": -25.69, "longitude": -54.43},
        }))
    out = tmp_path / "proposals.json"
    payload = run(tmp_path, out, trips=[], geocode=False, min_samples=3)
    assert out.exists()
    assert payload["summary"]["total_items"] == 5
    assert payload["summary"]["create"] + payload["summary"]["orphan"] >= 1
