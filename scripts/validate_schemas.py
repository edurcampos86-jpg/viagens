"""
validate_schemas.py — valida arquivos de dados contra os JSON Schemas.

Roda no CI a cada PR. Falha o build se qualquer arquivo violar seu schema.
Dependência única: jsonschema (sem libs Google, leve).

Uso:
    python scripts/validate_schemas.py

Sai com 0 se tudo válido, 1 se houver erros (com detalhes no stderr).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012


REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SCHEMAS_DIR = DATA_DIR / "schemas"


EVENTOS_SCHEMA = SCHEMAS_DIR / "eventos-file.schema.json"

# (arquivo de dados, arquivo de schema)
TARGETS = [
    (DATA_DIR / "trips.json",       SCHEMAS_DIR / "trips-file.schema.json"),
    (DATA_DIR / "documentos.json",  SCHEMAS_DIR / "documentos.schema.json"),
    (DATA_DIR / "preferencias.json", SCHEMAS_DIR / "preferencias.schema.json"),
    # Sprint 3.0 — entidade Evento (ver docs/ADR-002-entidade-evento.md).
    # Exemplo histórico mantido coberto explicitamente.
    (DATA_DIR / "exemplos" / "eventos-sp-junho-2026.json", EVENTOS_SCHEMA),
]

# Cobertura por glob da pasta canônica de eventos (ADR-002 Fase 3): qualquer
# arquivo data/eventos/*.json entra no validador automaticamente, sem edição
# manual. sorted() garante ordem determinística no CI.
TARGETS += [
    (evento_file, EVENTOS_SCHEMA)
    for evento_file in sorted((DATA_DIR / "eventos").glob("*.json"))
]


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def build_registry() -> Registry:
    """Registra todos os schemas locais para resolver $refs entre eles."""
    registry = Registry()
    for schema_path in SCHEMAS_DIR.glob("*.schema.json"):
        schema = load_json(schema_path)
        schema_id = schema.get("$id") or schema_path.name
        resource = Resource(contents=schema, specification=DRAFT202012)
        registry = registry.with_resource(uri=schema_id, resource=resource)
        # Também registra pelo nome do arquivo (para $refs relativos como "./trip.schema.json")
        registry = registry.with_resource(uri=schema_path.name, resource=resource)
        registry = registry.with_resource(uri=f"./{schema_path.name}", resource=resource)
    return registry


def validate_one(data_path: Path, schema_path: Path, registry: Registry) -> list[str]:
    """Retorna lista de erros formatados. Vazia = válido."""
    if not data_path.exists():
        return [f"{data_path.relative_to(REPO_ROOT)}: arquivo não encontrado"]
    if not schema_path.exists():
        return [f"{schema_path.relative_to(REPO_ROOT)}: schema não encontrado"]

    data = load_json(data_path)
    schema = load_json(schema_path)
    validator = Draft202012Validator(schema, registry=registry)

    errors: list[str] = []
    for err in sorted(validator.iter_errors(data), key=lambda e: list(e.path)):
        path_str = "/".join(str(p) for p in err.absolute_path) or "(raiz)"
        errors.append(f"  {path_str}: {err.message}")
    if errors:
        rel = data_path.relative_to(REPO_ROOT)
        return [f"\n{rel} — {len(errors)} erro(s):"] + errors
    return []


def main() -> int:
    registry = build_registry()
    all_errors: list[str] = []
    print(f"Validando {len(TARGETS)} arquivo(s) contra schemas em {SCHEMAS_DIR.relative_to(REPO_ROOT)}/\n")
    for data_path, schema_path in TARGETS:
        rel = data_path.relative_to(REPO_ROOT)
        errs = validate_one(data_path, schema_path, registry)
        if errs:
            all_errors.extend(errs)
            print(f"FAIL {rel}")
        else:
            print(f"OK   {rel}")

    if all_errors:
        print("\n".join(all_errors), file=sys.stderr)
        print("\nValidação falhou.", file=sys.stderr)
        return 1

    print("\nTudo válido.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
