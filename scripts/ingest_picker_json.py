#!/usr/bin/env python3
"""Ingestão desktop do JSON do picker iPhone→Cloudinary (PR #95).

Recebe o JSON que o picker do celular exporta e, de forma ALL-OR-NOTHING:
  1. baixa o poster .webp (640px) de cada item do Cloudinary;
  2. funde os itens na media.gallery da viagem alvo (dedup por source_id, teto 30);
  3. recalcula cover/stats e escreve data/trips.json preservando a formatação.

NÃO commita (quem commita é a skill, garantindo posters + trips.json no MESMO
commit) e NÃO mexe no service worker (data/ é NetworkFirst, media/ é runtime —
nenhum arquivo precacheado muda).

Princípios herdados do app:
  - nunca cria viagem: se o tripId não existe, aborta;
  - all-or-nothing de rede: baixa TODOS os posters antes de escrever qualquer
    arquivo; falhou um download → nada é escrito;
  - reexecução é idempotente: o mesmo JSON cai todo em "dupes" (sem duplicar).

Uso:
    python3 scripts/ingest_picker_json.py <picker.json>
    cat picker.json | python3 scripts/ingest_picker_json.py -
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

TRIPS_PATH = "data/trips.json"
RES_BASE = "https://res.cloudinary.com"
CLOUD_NAME = "ddskumzp3"   # config pública (igual a src/core/cloudinary-import.js)
POSTER_WIDTH = 640
MAX_GALLERY_ITEMS = 30


def sanitize_id_tail(source_id, n=12):
    clean = re.sub(r"[^A-Za-z0-9_-]", "", str(source_id or ""))
    return (clean[-n:].lower()) or "item"


def poster_path(trip_id, source_id):
    return f"media/{trip_id}/gp-{sanitize_id_tail(source_id)}-poster.webp"


def resource_type(item_type):
    return "video" if item_type == "memory_video" else "image"


def poster_url(source_id, item_type):
    rid = str(source_id or "")
    if resource_type(item_type) == "video":
        return f"{RES_BASE}/{CLOUD_NAME}/video/upload/so_0,w_{POSTER_WIDTH},f_webp,q_auto/{rid}.webp"
    return f"{RES_BASE}/{CLOUD_NAME}/image/upload/w_{POSTER_WIDTH},f_webp,q_auto/{rid}.webp"


def download_poster(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status}")
        return r.read()


def merge_gallery(existing, incoming, max_items=MAX_GALLERY_ITEMS):
    gallery = list(existing)
    seen_ids = {m.get("source_id") for m in existing if m.get("source_id")}
    seen_srcs = {m.get("src") for m in existing if m.get("src")}
    added, dupes, overflow = [], [], []
    for item in incoming:
        if (item.get("source_id") and item["source_id"] in seen_ids) or item.get("src") in seen_srcs:
            dupes.append(item)
            continue
        if len(gallery) >= max_items:
            overflow.append(item)
            continue
        gallery.append(item)
        added.append(item)
        if item.get("source_id"):
            seen_ids.add(item["source_id"])
        if item.get("src"):
            seen_srcs.add(item["src"])
    return gallery, added, dupes, overflow


def gallery_stats(gallery):
    photos = sum(1 for m in gallery if m.get("type") in ("image", "memory_photo"))
    videos = sum(1 for m in gallery if m.get("type") in ("video", "video_link", "memory_video"))
    return {"photos": photos, "videos": videos}


def fail(msg):
    print(f"ABORTADO: {msg}", file=sys.stderr)
    sys.exit(1)


def main(argv):
    if len(argv) != 1:
        fail("uso: ingest_picker_json.py <picker.json | ->")
    src = argv[0]
    raw = sys.stdin.read() if src == "-" else open(src, encoding="utf-8").read()
    try:
        payload = json.loads(raw)
    except Exception as e:
        fail(f"JSON do picker inválido — {e}")

    trip_id = payload.get("tripId")
    items = payload.get("items")
    if not trip_id or not isinstance(items, list):
        fail("JSON do picker sem tripId/items[] — não parece a saída do picker.")

    if not os.path.exists(TRIPS_PATH):
        fail(f"{TRIPS_PATH} não encontrado — rode na raiz do repo.")
    doc = json.loads(open(TRIPS_PATH, encoding="utf-8").read())
    if not isinstance(doc, dict) or not doc.get("config") or not isinstance(doc.get("trips"), list):
        fail("trips.json fora do contrato {config, trips[]} — parse-gate.")

    trip = next((t for t in doc["trips"] if t.get("id") == trip_id), None)
    if trip is None:
        fail(f"viagem '{trip_id}' não existe em trips.json — NÃO crio viagem nova.")

    # Normaliza cada item: poster/thumb determinísticos a partir do source_id.
    incoming = []
    for it in items:
        sid = it.get("source_id")
        if not sid:
            fail("item sem source_id — JSON do picker corrompido.")
        path = poster_path(trip_id, sid)
        node = dict(it)
        node["poster"] = path
        node["thumb"] = path
        incoming.append({"node": node, "sid": sid, "url": poster_url(sid, it.get("type")), "path": path})

    media = trip.get("media") or {}
    existing = media.get("gallery") or []
    merged, added, dupes, overflow = merge_gallery(existing, [c["node"] for c in incoming])

    if not added:
        print(f"Nada novo: {len(dupes)} já no álbum de '{trip_id}'. trips.json intacto.")
        return

    to_write = [c for c in incoming if c["node"] in added]

    # FASE 1 — baixa TODOS os posters (rede, all-or-nothing) ANTES de escrever.
    blobs = {}
    for c in to_write:
        try:
            blobs[c["path"]] = download_poster(c["url"])
        except Exception as e:
            fail(f"download do poster falhou ({c['sid']}): {e} — nada foi escrito.")

    # FASE 2 — só agora escreve posters + trips.json.
    for path, data in blobs.items():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)

    media["gallery"] = merged
    cover_item = next((m for m in merged if m.get("type") in ("image", "memory_photo")), None)
    if not media.get("cover") and cover_item:
        media["cover"] = cover_item.get("poster")
    media["stats"] = gallery_stats(merged)
    trip["media"] = media
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    trip["updated_at"] = now
    doc["atualizado_em"] = now

    out = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    with open(TRIPS_PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print(f"OK: +{len(added)} em '{trip_id}' (dupes {len(dupes)}, overflow {len(overflow)}).")
    print("Posters escritos:")
    for c in to_write:
        print(f"  {c['path']}")
    print(f"trips.json atualizado (stats {media['stats']}).")


if __name__ == "__main__":
    main(sys.argv[1:])
