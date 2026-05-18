"""
sync_photos.py — sincroniza fotos de álbuns do Google Photos para o Cloudinary
e popula data/trips.json (campos gallery, fotos e photo).

Convenção de nomeação de álbuns:
  O título do álbum no Google Photos deve **começar com o slug (id) da viagem**.
  Exemplos válidos:
    - "brussels-2026"
    - "brussels-2026 — Bélgica & Tomorrowland"
    - "iguacu-2021 - Foz do Iguaçu"
  O slug bate com o campo `id` de uma entrada em data/trips.json.

Variáveis de ambiente esperadas:
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN      (gerado por scripts/auth.py)
  CLOUDINARY_CLOUD_NAME
  CLOUDINARY_API_KEY
  CLOUDINARY_API_SECRET

Uso:
  python scripts/sync_photos.py
  python scripts/sync_photos.py --slug brussels-2026
  python scripts/sync_photos.py --dry-run
  python scripts/sync_photos.py --dry-run --fixture path/to/albums.json

Modo dry-run:
  Não faz upload no Cloudinary nem reescreve trips.json.
  Imprime o mapeamento album→trip e o que seria feito.
  Se --fixture for passado, lê albums + mediaItems de um JSON local em vez de
  bater na API do Google (útil em CI e em testes sem credenciais).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Iterable, Iterator, Optional

# Imports pesados (Google/Cloudinary) só são feitos em get_credentials/cloudinary_setup,
# para permitir importar este módulo (e testar funções puras) sem ter os SDKs.

REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"

# Tier gratuito Cloudinary (referência): 25 GB de storage.
FREE_TIER_STORAGE_BYTES = 25 * 1024 * 1024 * 1024

# Largura máxima da URL otimizada de exibição.
DISPLAY_WIDTH = 1600

# Escopos OAuth — mesmos usados por sync.py para reaproveitar o refresh token existente.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/photoslibrary.readonly",
]
TOKEN_URI = "https://oauth2.googleapis.com/token"


def log(msg: str) -> None:
    print(msg, flush=True)


# ── matching de álbum → viagem ───────────────────────────────────────

# Sanitiza um nome de arquivo para usar como public_id no Cloudinary.
# Mantém apenas letras, dígitos e hífens; reduz separadores duplicados.
_SAN_RE = re.compile(r"[^a-z0-9]+")


def sanitize_basename(name: str) -> str:
    name = name.lower()
    name = _SAN_RE.sub("-", name).strip("-")
    return name or "photo"


def slug_from_album_title(title: str, known_slugs: Iterable[str]) -> Optional[str]:
    """Retorna o slug da viagem se o título do álbum começa com ele.

    Match estrito: o título precisa começar exatamente com o slug seguido de
    fim-de-string ou um caractere separador (espaço, traço, em-dash, etc.).
    Isso evita matches falsos tipo "brussels-2026" casar com "brussels-2026-old".
    """
    if not title:
        return None
    t = title.strip().lower()
    # Tentamos do slug mais longo para o mais curto para resolver casos como
    # 'iguacu-2021' vs hipotético 'iguacu-2021-extra' — sempre privilegia o match maior.
    for slug in sorted(known_slugs, key=len, reverse=True):
        if t == slug:
            return slug
        if t.startswith(slug):
            sep = t[len(slug)]
            if sep in (" ", "-", "_", "—", "–", ":", "·", "|"):
                return slug
    return None


def public_id_for(slug: str, media_item: dict) -> str:
    """Gera um public_id determinístico no Cloudinary para um item do Google Photos.

    Estratégia: usar o nome do arquivo (sanitizado) + hash curto do id do GP.
    Como o id do GP é estável, rodar o script duas vezes produz o mesmo public_id
    e o Cloudinary devolve "asset já existe", o que tratamos como sucesso.
    """
    filename = media_item.get("filename") or media_item.get("id", "photo")
    base = sanitize_basename(Path(filename).stem)
    short = hashlib.sha1(media_item["id"].encode("utf-8")).hexdigest()[:10]
    return f"viagens/{slug}/{base}-{short}"


# ── Google Photos ────────────────────────────────────────────────────


def get_credentials():
    """Cria credenciais OAuth a partir das variáveis de ambiente. Mesma lógica do sync.py."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_REFRESH_TOKEN")
    if not (client_id and client_secret and refresh_token):
        log("✖ Faltam GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN.")
        log("  Rode scripts/auth.py local 1x e armazene como secrets do repo.")
        sys.exit(2)
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )
    creds.refresh(Request())
    return creds


def build_photos_service(creds):
    from googleapiclient.discovery import build
    return build("photoslibrary", "v1", credentials=creds,
                 cache_discovery=False, static_discovery=False)


def list_all_albums(service) -> list[dict]:
    """Lista todos os álbuns criados pelo usuário, paginando."""
    albums: list[dict] = []
    page_token: Optional[str] = None
    while True:
        resp = service.albums().list(pageSize=50, pageToken=page_token).execute()
        albums.extend(resp.get("albums", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return albums


def iter_media_items_in_album(service, album_id: str) -> Iterator[dict]:
    """Itera todos os itens (fotos) de um álbum, paginando."""
    page_token: Optional[str] = None
    while True:
        body = {"albumId": album_id, "pageSize": 100}
        if page_token:
            body["pageToken"] = page_token
        resp = service.mediaItems().search(body=body).execute()
        for item in resp.get("mediaItems", []):
            # Filtra só fotos (ignora vídeos por enquanto).
            mime = item.get("mimeType", "")
            if mime.startswith("image/"):
                yield item
        page_token = resp.get("nextPageToken")
        if not page_token:
            break


# ── Cloudinary ───────────────────────────────────────────────────────


def cloudinary_setup():
    import cloudinary
    cloud = os.environ.get("CLOUDINARY_CLOUD_NAME")
    key = os.environ.get("CLOUDINARY_API_KEY")
    secret = os.environ.get("CLOUDINARY_API_SECRET")
    if not (cloud and key and secret):
        log("✖ Faltam CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET.")
        sys.exit(2)
    cloudinary.config(cloud_name=cloud, api_key=key, api_secret=secret, secure=True)


def build_display_url(public_id: str) -> str:
    """URL otimizada: até 1600px de largura, qualidade e formato automáticos."""
    from cloudinary.utils import cloudinary_url
    url, _ = cloudinary_url(
        public_id,
        secure=True,
        transformation=[
            {"width": DISPLAY_WIDTH, "crop": "limit"},
            {"quality": "auto", "fetch_format": "auto"},
        ],
    )
    return url


def upload_media_item(media: dict, slug: str) -> dict:
    """Faz upload do mediaItem do Google Photos para o Cloudinary.

    Idempotente: se o public_id já existe, recupera o asset existente.
    Passa o baseUrl do Google Photos (com =d para baixar original) direto pro
    Cloudinary fazer fetch — não precisamos baixar localmente.
    """
    import cloudinary.uploader
    import cloudinary.api

    public_id = public_id_for(slug, media)
    base_url = media.get("baseUrl")
    if not base_url:
        return {"ok": False, "filename": media.get("filename", "?"), "error": "sem baseUrl"}
    # =d = baixa o arquivo original (mais alto possível). Cloudinary aceita URL remota.
    source = f"{base_url}=d"

    try:
        result = cloudinary.uploader.upload(
            source,
            public_id=public_id,
            overwrite=False,
            unique_filename=False,
            use_filename=False,
            resource_type="image",
        )
        return {
            "ok": True,
            "reused": False,
            "filename": media.get("filename", public_id),
            "public_id": result.get("public_id", public_id),
            "url": build_display_url(result.get("public_id", public_id)),
            "bytes": result.get("bytes", 0),
        }
    except Exception as err:  # cloudinary.exceptions varia; capturamos amplo
        message = str(err)
        if re.search(r"exist|already|duplicate", message, re.IGNORECASE):
            try:
                info = cloudinary.api.resource(public_id)
                return {
                    "ok": True,
                    "reused": True,
                    "filename": media.get("filename", public_id),
                    "public_id": info.get("public_id", public_id),
                    "url": build_display_url(info.get("public_id", public_id)),
                    "bytes": info.get("bytes", 0),
                }
            except Exception as fetch_err:
                return {"ok": False, "filename": media.get("filename", public_id),
                        "error": f"asset existente porém não recuperável: {fetch_err}"}
        return {"ok": False, "filename": media.get("filename", public_id), "error": message}


# ── trips.json ───────────────────────────────────────────────────────


def load_trips() -> dict:
    return json.loads(TRIPS_PATH.read_text(encoding="utf-8"))


def save_trips(trips_data: dict) -> None:
    TRIPS_PATH.write_text(
        json.dumps(trips_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def apply_photos_to_trip(trip: dict, urls: list[str]) -> None:
    """Popula gallery (string[]) + fotos (object[]) + photo (string) no formato
    consumido por app.js e canônico do schema. Mesmo formato do upload-trip-photos.js."""
    trip["gallery"] = urls
    trip["photo"] = urls[0]
    trip["fotos"] = [
        ({"url": u, "destaque": True} if i == 0 else {"url": u})
        for i, u in enumerate(urls)
    ]


# ── orquestração ─────────────────────────────────────────────────────


def format_bytes(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    if n < 1024 ** 3:
        return f"{n / 1024 / 1024:.2f} MB"
    return f"{n / 1024 / 1024 / 1024:.2f} GB"


def match_albums(albums: list[dict], known_slugs: set[str],
                 only_slug: Optional[str]) -> list[tuple[dict, str]]:
    """Para cada álbum, decide se mapeia para alguma viagem.

    Retorna lista de (album, slug). Se only_slug for passado, filtra só esse.
    Se há múltiplos álbuns para o mesmo slug, agrupamos mais à frente.
    """
    matches: list[tuple[dict, str]] = []
    for album in albums:
        title = album.get("title", "")
        slug = slug_from_album_title(title, known_slugs)
        if not slug:
            continue
        if only_slug and slug != only_slug:
            continue
        matches.append((album, slug))
    return matches


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--slug", help="Sincroniza apenas a viagem com este id (filtra álbuns)")
    p.add_argument("--dry-run", action="store_true",
                   help="Não faz upload nem grava trips.json; só imprime o mapeamento")
    p.add_argument("--fixture", help="JSON local com {albums: [...], mediaItems: {albumId: [...]}}")
    return p.parse_args(argv)


def run(args: argparse.Namespace) -> int:
    trips_data = load_trips()
    trips = trips_data.get("trips", [])
    slug_index = {t["id"]: t for t in trips}
    known_slugs = set(slug_index.keys())

    # ── carrega álbuns ──
    fixture_data: Optional[dict] = None
    creds = None
    service = None
    if args.fixture:
        fixture_data = json.loads(Path(args.fixture).read_text(encoding="utf-8"))
        albums = fixture_data.get("albums", [])
        log(f"→ Lendo álbuns de fixture: {args.fixture} ({len(albums)} álbum(ns))")
    else:
        if args.dry_run:
            log("✖ --dry-run sem --fixture exige autenticação real só para listar álbuns.")
            log("  Para teste offline use --fixture path/to/albums.json")
            return 2
        creds = get_credentials()
        service = build_photos_service(creds)
        log("→ Listando álbuns do Google Photos…")
        albums = list_all_albums(service)
        log(f"  encontrados {len(albums)} álbum(ns) no total")

    matches = match_albums(albums, known_slugs, args.slug)
    if not matches:
        log("Nenhum álbum bateu com um slug de viagem em data/trips.json.")
        log("Lembre: o título do álbum no Google Photos deve começar com o id da viagem.")
        return 0

    log(f"→ {len(matches)} álbum(ns) mapeado(s) para viagem(ns):")
    for album, slug in matches:
        log(f"  • '{album.get('title','?')}' → {slug}")

    if args.dry_run and not args.fixture:
        # Sem fixture e sem creds, paramos aqui.
        return 0

    # ── Cloudinary só conecta quando vai mesmo subir ──
    if not args.dry_run:
        cloudinary_setup()

    # ── agrupa por slug (várias caixas podem virar a mesma viagem) ──
    by_slug: dict[str, list[dict]] = {}
    for album, slug in matches:
        by_slug.setdefault(slug, []).append(album)

    total_ok = 0
    total_failed = 0
    total_bytes = 0
    start_ts = time.time()
    changed_slugs: list[str] = []

    for slug, slug_albums in by_slug.items():
        trip = slug_index[slug]
        log(f"\n── {slug} ({len(slug_albums)} álbum(ns)) ──")
        urls: list[str] = []
        failures: list[str] = []

        for album in slug_albums:
            if fixture_data:
                items = fixture_data.get("mediaItems", {}).get(album["id"], [])
            else:
                items = list(iter_media_items_in_album(service, album["id"]))
            # Ordena por nome do arquivo (igual ao script Node) para ordem previsível.
            items.sort(key=lambda m: m.get("filename", m.get("id", "")))
            log(f"  '{album.get('title','?')}': {len(items)} item(s)")

            for media in items:
                if args.dry_run:
                    pid = public_id_for(slug, media)
                    log(f"    [dry-run] {media.get('filename','?')} → {pid}")
                    urls.append(f"(dry-run){pid}")
                    continue
                r = upload_media_item(media, slug)
                if r["ok"]:
                    tag = "reutilizada" if r.get("reused") else "enviada"
                    log(f"    ✓ {r['filename']} ({tag}, {format_bytes(r.get('bytes', 0))})")
                    urls.append(r["url"])
                    total_ok += 1
                    total_bytes += r.get("bytes", 0)
                else:
                    log(f"    ✖ {r['filename']} — {r['error']}")
                    failures.append(f"{r['filename']}: {r['error']}")
                    total_failed += 1

        if urls and not args.dry_run:
            apply_photos_to_trip(trip, urls)
            changed_slugs.append(slug)

        if failures:
            log(f"  {len(failures)} falha(s) em {slug}:")
            for f in failures:
                log(f"    - {f}")

    if changed_slugs and not args.dry_run:
        save_trips(trips_data)
        log(f"\n→ data/trips.json atualizado para: {', '.join(changed_slugs)}")

    elapsed = time.time() - start_ts
    log("\n─── Resumo ───")
    log(f"Álbuns mapeados:   {len(matches)}")
    log(f"Viagens atingidas: {len(by_slug)}")
    log(f"Fotos ok:          {total_ok}")
    log(f"Fotos com falha:   {total_failed}")
    log(f"Volume:            {format_bytes(total_bytes)}")
    log(f"Quota free:        ~{(total_bytes / FREE_TIER_STORAGE_BYTES * 100):.4f}% dos 25 GB")
    log(f"Tempo:             {elapsed:.1f}s")

    return 1 if total_failed > 0 else 0


def main() -> int:
    args = parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
