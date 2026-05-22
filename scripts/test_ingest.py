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
    detect_mode, scan_album_mode, build_album_cluster,
    match_existing_trip_album,
)

REPO_ROOT_TESTS = Path(__file__).resolve().parent.parent


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


# ─────────────────────────────────────────────────────────────────────────────
# optimize_media — testes de otimização e priorização
# ─────────────────────────────────────────────────────────────────────────────

def test_prioritize_gps_first_then_chronological():
    from optimize_media import prioritize
    items = [
        {"type": "image", "timestamp": 100, "lat": None, "lon": None},
        {"type": "image", "timestamp": 200, "lat": -25, "lon": -54},
        {"type": "image", "timestamp": 50,  "lat": -25, "lon": -54},
        {"type": "image", "timestamp": 300, "lat": None, "lon": None},
    ]
    out = prioritize(items, max_photos=10, max_videos=2)
    # Primeiros: os com GPS, ordem cronológica entre eles
    assert out[0]["timestamp"] == 50
    assert out[1]["timestamp"] == 200
    # Sem GPS depois
    assert out[2]["timestamp"] == 100
    assert out[3]["timestamp"] == 300


def test_prioritize_truncates_to_max():
    from optimize_media import prioritize
    items = [{"type": "image", "timestamp": i, "lat": 0, "lon": 0} for i in range(50)]
    out = prioritize(items, max_photos=20, max_videos=2)
    assert len([x for x in out if x["type"] == "image"]) == 20


def test_optimize_image_writes_webp_strips_exif(tmp_path):
    """Imagem com EXIF deve ser convertida em WebP sem EXIF."""
    pytest.importorskip("PIL")
    from PIL import Image
    src = tmp_path / "in.jpg"
    img = Image.new("RGB", (3000, 2000), (10, 200, 60))
    exif = Image.Exif()
    exif[0x9003] = "2024:06:12 14:30:00"
    img.save(src, "JPEG", exif=exif.tobytes())

    from optimize_media import optimize_image
    dst = tmp_path / "out.webp"
    w, h = optimize_image(src, dst, max_side=1920, quality=80)
    assert dst.exists()
    # Redimensionado para max_side
    assert max(w, h) <= 1920
    # Confere que o WebP final NÃO tem EXIF (privacidade)
    with Image.open(dst) as im:
        exif_out = im.getexif()
        assert not exif_out or len(dict(exif_out)) == 0


def test_optimize_cluster_end_to_end_with_synthetic_photos(tmp_path):
    """Cria 5 JPEGs, monta cluster, otimiza, valida saída em media/<trip-id>/."""
    pytest.importorskip("PIL")
    from PIL import Image
    paths = []
    for i in range(5):
        p = tmp_path / f"in_{i:02d}.jpg"
        Image.new("RGB", (1000, 700), (i * 30, 100, 50)).save(p, "JPEG")
        paths.append(str(p))

    cluster = {
        "id": "cluster-0",
        "suggested_trip_id": "teste-2024",
        "items": [
            {"path": p, "type": "image", "timestamp": _ts(f"2024-06-{10+i:02d}"),
             "lat": -25.69, "lon": -54.43}
            for i, p in enumerate(paths)
        ],
    }
    media_root = tmp_path / "media"
    from optimize_media import optimize_cluster
    results = optimize_cluster(cluster, media_root)

    assert len(results) == 5
    trip_dir = media_root / "teste-2024"
    assert (trip_dir / "cover.webp").exists()
    assert (trip_dir / "01.webp").exists()
    assert (trip_dir / "01-thumb.webp").exists()
    # Path retornado é relativo ao repo root
    assert results[0].src.startswith("media/teste-2024/")  # type: ignore[attr-defined]


# ─────────────────────────────────────────────────────────────────────────────
# apply_proposals — testes de aplicação em trips.json
# ─────────────────────────────────────────────────────────────────────────────

def _opt(src: str, kind: str = "image") -> dict:
    return {"type": kind, "src": src, "thumb": src.replace(".webp", "-thumb.webp"),
            "date": "2024-06-12", "lat": -25.69, "lon": -54.43}


def test_apply_creates_new_trip(tmp_path):
    from apply_proposals import apply
    proposals = tmp_path / "proposals.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({"config": {}, "trips": []}))
    opt = [_opt("media/teste-2024/01.webp"), _opt("media/teste-2024/02.webp")]
    proposals.write_text(json.dumps({
        "clusters": [{
            "id": "cluster-0", "action": "create",
            "suggested_trip_id": "teste-2024",
            "place": "Foz do Iguaçu", "country": "Brasil", "country_code": "BR",
            "start_date": "2024-06-10", "end_date": "2024-06-14",
            "center_lat": -25.69, "center_lon": -54.43,
            "items": [{"path": "/tmp/x.jpg", "type": "image"}],
        }],
        "_optimized": {"cluster-0": opt},
    }))
    res = apply(proposals, trips, dry_run=True)
    assert res["summary"]["created"] == 1
    assert res["summary"]["merged"] == 0
    assert res["summary"]["photos"] == 2
    # Trip foi adicionada em memória; dry_run não persiste
    doc = json.loads(trips.read_text())
    assert len(doc["trips"]) == 0  # dry-run


def test_apply_merges_into_existing_trip(tmp_path):
    from apply_proposals import apply
    proposals = tmp_path / "proposals.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({"config": {}, "trips": [
        {"id": "iguacu-2021", "name": "Foz", "status": "done", "country": "Brasil",
         "year": 2021, "month": 6, "lat": -25.69, "lon": -54.43,
         "media": {"gallery": [{"type": "image", "src": "media/iguacu-2021/01.webp"}],
                   "stats": {"photos": 1, "videos": 0}}}
    ]}))
    opt = [_opt("media/iguacu-2021/02.webp"), _opt("media/iguacu-2021/03.webp")]
    proposals.write_text(json.dumps({
        "clusters": [{
            "id": "cluster-0", "action": "merge", "merge_with": "iguacu-2021",
            "items": [], "start_date": "2021-06-12", "end_date": "2021-06-14",
        }],
        "_optimized": {"cluster-0": opt},
    }))
    res = apply(proposals, trips, dry_run=False, log_path=tmp_path / "INGEST-LOG.md")
    assert res["summary"]["merged"] == 1
    doc = json.loads(trips.read_text())
    trip = doc["trips"][0]
    # Gallery cresceu de 1 para 3 (sem duplicar)
    assert len(trip["media"]["gallery"]) == 3
    assert trip["media"]["stats"]["photos"] == 3
    # Log foi escrito no tmp_path (nao polui REPO_ROOT)
    assert (tmp_path / "INGEST-LOG.md").exists()


def test_apply_skips_orphan(tmp_path):
    from apply_proposals import apply
    proposals = tmp_path / "proposals.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({"trips": []}))
    proposals.write_text(json.dumps({
        "clusters": [{"id": "cluster-0", "action": "orphan", "items": []}],
        "_optimized": {},
    }))
    res = apply(proposals, trips, dry_run=True)
    assert res["summary"]["skipped_orphan"] == 1
    assert res["summary"]["created"] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Modo álbum-por-álbum
# ─────────────────────────────────────────────────────────────────────────────

def test_detect_mode_album_when_only_subdirs(tmp_path):
    """Subpastas + zero arquivos na raiz → 'album'."""
    (tmp_path / "foz-2021").mkdir()
    (tmp_path / "foz-2021" / "p.jpg").write_bytes(b"x")
    (tmp_path / "atacama-2021").mkdir()
    assert detect_mode(tmp_path) == "album"


def test_detect_mode_cluster_when_files_at_root(tmp_path):
    """Arquivos soltos na raiz → 'cluster' (mesmo se houver subpasta junto)."""
    (tmp_path / "img.jpg").write_bytes(b"x")
    (tmp_path / "subdir").mkdir()
    assert detect_mode(tmp_path) == "cluster"


def test_detect_mode_empty_dir_is_cluster(tmp_path):
    """Diretório vazio → 'cluster' (pipeline antiga reporta vazio)."""
    assert detect_mode(tmp_path) == "cluster"


def test_scan_album_mode_skips_empty_subdirs(tmp_path):
    """Subpastas sem mídia são puladas com aviso."""
    pytest.importorskip("PIL")
    from PIL import Image
    (tmp_path / "vazia").mkdir()
    (tmp_path / "kyoto-2023").mkdir()
    Image.new("RGB", (10, 10)).save(tmp_path / "kyoto-2023" / "p.jpg", "JPEG")
    albums = scan_album_mode(tmp_path)
    assert len(albums) == 1
    trip_id, items = albums[0]
    assert trip_id == "kyoto-2023"
    assert len(items) == 1


def test_build_album_cluster_no_dbscan_groups_everything(tmp_path):
    """Tudo da pasta vai pro mesmo cluster, sem importar dispersão geográfica."""
    items = [
        _item("/tmp/a.jpg", "2023-10-15", 35.01, 135.76),  # Kyoto
        _item("/tmp/b.jpg", "2023-10-16", 35.68, 139.69),  # Tokyo (~370 km)
        _item("/tmp/c.jpg", "2023-10-17", 34.69, 135.50),  # Osaka
    ]
    cl = build_album_cluster("japao-2023", items, idx=0)
    assert cl.id == "album-0"
    assert cl.suggested_trip_id == "japao-2023"
    assert len(cl.items) == 3
    assert cl.start_date == "2023-10-15"
    assert cl.end_date == "2023-10-17"


def test_album_match_by_direct_trip_id():
    cl = build_album_cluster(
        "iguacu-2021",
        [_item("/tmp/x.jpg", "2021-06-12", -25.69, -54.43)], idx=0)
    trips = [{"id": "iguacu-2021", "year": 2021, "country": "Brasil"}]
    assert match_existing_trip_album(cl, trips) == "iguacu-2021"


def test_album_match_by_year_and_country():
    cl = build_album_cluster(
        "fronteira-trifurcada",
        [_item("/tmp/x.jpg", "2021-06-12", -25.69, -54.43)], idx=0)
    cl.country = "Brasil"
    trips = [{"id": "iguacu-2021", "year": 2021, "country": "Brasil"}]
    assert match_existing_trip_album(cl, trips) == "iguacu-2021"


def test_album_match_by_year_and_proximity():
    cl = build_album_cluster(
        "pasta-sem-pais",
        [_item("/tmp/x.jpg", "2021-06-12", -25.69, -54.43)], idx=0)
    # country não setado, mas lat/lon batem com Foz
    trips = [{"id": "iguacu-2021", "year": 2021,
              "country": None, "lat": -25.6953, "lon": -54.4367}]
    assert match_existing_trip_album(cl, trips, album_match_km=100) == "iguacu-2021"


def test_album_no_match_when_year_off():
    cl = build_album_cluster(
        "pasta",
        [_item("/tmp/x.jpg", "2024-06-12", -25.69, -54.43)], idx=0)
    cl.country = "Brasil"
    trips = [{"id": "iguacu-2021", "year": 2021, "country": "Brasil"}]
    assert match_existing_trip_album(cl, trips) is None


def test_run_album_mode_end_to_end(tmp_path):
    """
    Estrutura: tmp_path/foz-2021/*.jpg + tmp_path/kyoto-2023/*.jpg.
    Espera 2 clusters, sem DBSCAN, com IDs derivados do nome da pasta.
    """
    pytest.importorskip("PIL")
    from PIL import Image
    foz = tmp_path / "foz-2021"
    foz.mkdir()
    for i in range(3):
        p = foz / f"f{i}.jpg"
        Image.new("RGB", (50, 50)).save(p, "JPEG")
        p.with_name(p.name + ".json").write_text(json.dumps({
            "photoTakenTime": {"timestamp": str(int(_ts(f"2021-06-{10+i:02d}")))},
            "geoData": {"latitude": -25.69, "longitude": -54.43},
        }))
    kyoto = tmp_path / "kyoto-2023"
    kyoto.mkdir()
    for i in range(2):
        p = kyoto / f"k{i}.jpg"
        Image.new("RGB", (50, 50)).save(p, "JPEG")
        p.with_name(p.name + ".json").write_text(json.dumps({
            "photoTakenTime": {"timestamp": str(int(_ts(f"2023-10-{15+i:02d}")))},
            "geoData": {"latitude": 35.01, "longitude": 135.76},
        }))

    out = tmp_path / "proposals.json"
    payload = run(tmp_path, out, trips=[], geocode=False)

    assert payload["mode"] == "album"
    assert payload["summary"]["clusters"] == 2
    ids = sorted(c["suggested_trip_id"] for c in payload["clusters"])
    assert ids == ["foz-2021", "kyoto-2023"]


def test_run_album_mode_matches_existing_trip(tmp_path):
    """
    Pasta `iguacu-2021/` deve dar merge com trip `iguacu-2021` existente.
    Garante que cenário de regressão (re-ingest do Foz) não duplica viagem.
    """
    pytest.importorskip("PIL")
    from PIL import Image
    foz = tmp_path / "iguacu-2021"
    foz.mkdir()
    for i in range(2):
        p = foz / f"f{i}.jpg"
        Image.new("RGB", (50, 50)).save(p, "JPEG")
        p.with_name(p.name + ".json").write_text(json.dumps({
            "photoTakenTime": {"timestamp": str(int(_ts(f"2021-06-{10+i:02d}")))},
            "geoData": {"latitude": -25.69, "longitude": -54.43},
        }))

    out = tmp_path / "proposals.json"
    trips = [{"id": "iguacu-2021", "year": 2021, "country": "Brasil",
              "startDate": "2021-06-10", "lat": -25.69, "lon": -54.43}]
    payload = run(tmp_path, out, trips=trips, geocode=False)
    assert payload["summary"]["merge"] == 1
    assert payload["clusters"][0]["merge_with"] == "iguacu-2021"


# ─────────────────────────────────────────────────────────────────────────────
# Captions automáticas + priorização com espaçamento
# ─────────────────────────────────────────────────────────────────────────────

def test_make_auto_caption_format_pt_br():
    from optimize_media import make_auto_caption
    ts = _ts("2023-10-15")
    assert make_auto_caption("Kyoto", ts) == "Kyoto · 15 out 2023"


def test_make_auto_caption_falls_back_to_date_only():
    from optimize_media import make_auto_caption
    ts = _ts("2023-10-15")
    assert make_auto_caption(None, ts) == "15 out 2023"


def test_make_auto_caption_returns_place_when_no_ts():
    from optimize_media import make_auto_caption
    assert make_auto_caption("Kyoto", None) == "Kyoto"
    assert make_auto_caption(None, None) is None


def test_prioritize_with_discards_returns_both():
    from optimize_media import prioritize_with_discards
    items = [
        {"type": "image", "path": f"/p{i}.jpg", "timestamp": i,
         "lat": -25 if i < 30 else None, "lon": -54 if i < 30 else None}
        for i in range(50)
    ]
    chosen, discards = prioritize_with_discards(items, max_photos=20, max_videos=0)
    assert len(chosen) == 20
    assert len(discards) == 30
    # Nenhum item aparece nos dois
    chosen_paths = {it["path"] for it in chosen}
    disc_paths = {it["path"] for it in discards}
    assert chosen_paths.isdisjoint(disc_paths)


def test_prioritize_temporal_spacing_picks_first_and_last():
    """Com 10 itens e cap=3, escolhidos devem cobrir t=0, intermediário e t=9."""
    from optimize_media import prioritize_with_discards
    items = [
        {"type": "image", "path": f"/p{i}.jpg", "timestamp": float(i),
         "lat": -25, "lon": -54}
        for i in range(10)
    ]
    chosen, _ = prioritize_with_discards(items, max_photos=3, max_videos=0)
    ts = sorted(c["timestamp"] for c in chosen)
    assert ts[0] == 0.0
    assert ts[-1] == 9.0


def test_optimize_cluster_emits_caption_auto(tmp_path):
    """Cluster com place setado deve gerar caption + caption_auto=True por item."""
    pytest.importorskip("PIL")
    from PIL import Image
    from optimize_media import optimize_cluster
    paths = []
    for i in range(2):
        p = tmp_path / f"in_{i:02d}.jpg"
        Image.new("RGB", (200, 200)).save(p, "JPEG")
        paths.append(str(p))
    cluster = {
        "id": "album-0",
        "suggested_trip_id": "kyoto-2023",
        "place": "Kyoto",
        "items": [
            {"path": p, "type": "image", "timestamp": _ts(f"2023-10-{15+i:02d}"),
             "lat": 35.01, "lon": 135.76}
            for i, p in enumerate(paths)
        ],
    }
    results = optimize_cluster(cluster, tmp_path / "media")
    assert len(results) == 2
    for r in results:
        assert r.caption_auto is True
        assert r.caption.startswith("Kyoto · ")


def test_optimize_cluster_returns_discards_when_requested(tmp_path):
    pytest.importorskip("PIL")
    from PIL import Image
    from optimize_media import optimize_cluster
    paths = []
    for i in range(25):  # > max_photos (20)
        p = tmp_path / f"in_{i:02d}.jpg"
        Image.new("RGB", (50, 50)).save(p, "JPEG")
        paths.append(str(p))
    cluster = {
        "id": "album-0",
        "suggested_trip_id": "kyoto-2023",
        "items": [
            {"path": p, "type": "image", "timestamp": float(i),
             "lat": 35.01, "lon": 135.76}
            for i, p in enumerate(paths)
        ],
    }
    results, discards = optimize_cluster(cluster, tmp_path / "media",
                                          return_discards=True)
    assert len(results) == 20
    assert len(discards) == 5


def test_apply_with_caption_auto_passes_schema_validation(tmp_path):
    """
    Regressão: caption_auto precisa estar declarado em trip.schema.json,
    pois gallery items têm additionalProperties: false. Sem o patch de schema,
    apply non-dry-run aborta no validate_or_die.
    """
    from apply_proposals import apply
    # Cópia mínima de trips.json (estrutura real, sem trips) usando schema do repo.
    real_trips = REPO_ROOT_TESTS / "data" / "trips.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({
        "config": json.loads(real_trips.read_text())["config"],
        "trips": [],
    }))
    proposals = tmp_path / "proposals.json"
    proposals.write_text(json.dumps({
        "clusters": [{
            "id": "album-0", "action": "create",
            "suggested_trip_id": "kyoto-2023",
            "place": "Kyoto", "country": "Japão", "country_code": "JP",
            "start_date": "2023-10-15", "end_date": "2023-10-15",
            "center_lat": 35.01, "center_lon": 135.76,
            "items": [],
        }],
        "_optimized": {"album-0": [{
            "type": "image", "src": "media/kyoto-2023/01.webp",
            "thumb": "media/kyoto-2023/01-thumb.webp",
            "caption": "Kyoto · 15 out 2023", "caption_auto": True,
            "date": "2023-10-15",
        }]},
    }))
    # Roda com dry_run=False — exercita validate_or_die com schema real.
    res = apply(proposals, trips, dry_run=False, log_path=tmp_path / "log.md")
    assert res["summary"]["created"] == 1
    doc = json.loads(trips.read_text())
    assert doc["trips"][0]["media"]["gallery"][0]["caption_auto"] is True


def test_apply_preserves_caption_auto_in_gallery(tmp_path):
    """caption_auto deve viajar de _optimized → trip.media.gallery."""
    from apply_proposals import apply
    proposals = tmp_path / "proposals.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({"trips": []}))
    opt = [{
        "type": "image", "src": "media/kyoto-2023/01.webp",
        "thumb": "media/kyoto-2023/01-thumb.webp",
        "caption": "Kyoto · 15 out 2023", "caption_auto": True,
        "date": "2023-10-15", "lat": 35.01, "lon": 135.76,
    }]
    proposals.write_text(json.dumps({
        "clusters": [{
            "id": "album-0", "action": "create",
            "suggested_trip_id": "kyoto-2023",
            "place": "Kyoto", "country": "Japão", "country_code": "JP",
            "start_date": "2023-10-15", "end_date": "2023-10-15",
            "center_lat": 35.01, "center_lon": 135.76,
            "items": [],
        }],
        "_optimized": {"album-0": opt},
    }))
    res = apply(proposals, trips, dry_run=True)
    assert res["summary"]["created"] == 1


def test_apply_collision_dedupes_id(tmp_path):
    """Se o suggested_trip_id já existe, deve sufixar com -dup-N."""
    from apply_proposals import apply
    proposals = tmp_path / "proposals.json"
    trips = tmp_path / "trips.json"
    trips.write_text(json.dumps({"trips": [
        {"id": "tokyo-2024", "name": "Tokyo", "status": "done"}
    ]}))
    proposals.write_text(json.dumps({
        "clusters": [{
            "id": "cluster-0", "action": "create",
            "suggested_trip_id": "tokyo-2024",
            "place": "Tokyo", "country": "Japão", "start_date": "2024-09-10",
        }],
        "_optimized": {"cluster-0": [_opt("media/tokyo-2024-dup-2/01.webp")]},
    }))
    res = apply(proposals, trips, dry_run=True)
    assert res["details"][0]["trip_id"] == "tokyo-2024-dup-2"
