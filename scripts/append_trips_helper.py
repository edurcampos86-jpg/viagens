"""
Helper interno (usado uma vez na consolidação da auditoria de Lugares).

Acrescenta uma lista de novas trips ao final do array `trips` em
`data/trips.json` SEM reformatar o resto do arquivo (preserva, por
exemplo, o estilo compacto inline da `media.gallery` que foi editado
manualmente em algumas trips como `iguacu-2021`).

Estratégia: edição cirúrgica de texto. Detecta a linha exata onde o
array `trips` fecha (`  ],` após a última `    }`) e injeta as novas
trips ali, indentadas para o mesmo nível.
"""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"


def render_trip(trip: dict) -> str:
    """Renderiza uma trip Python no estilo da indentação do arquivo
    (4 espaços para o nível-trip, 6 para os campos)."""
    body = json.dumps(trip, indent=2, ensure_ascii=False)
    return "\n".join("    " + line for line in body.splitlines())


def append_trips(new_trips: list[dict], *, atualizado_em: str | None = None) -> int:
    text = TRIPS_PATH.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=False)

    # Localiza o fechamento do array trips: a linha "  ]," que vem após
    # a última trip. Procurando de baixo pra cima é mais robusto.
    close_idx = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].rstrip() == "  ],":
            close_idx = i
            break
    if close_idx is None:
        raise RuntimeError("Não encontrei o fechamento do array trips ('  ],').")

    # A linha imediatamente anterior é '    }' (fim da última trip atual).
    prev_idx = close_idx - 1
    if lines[prev_idx].rstrip() != "    }":
        raise RuntimeError(
            f"Esperava '    }}' antes do '  ],' (linha {close_idx + 1}); "
            f"achei: {lines[prev_idx]!r}"
        )

    # Vira a última trip atual em '    },'
    lines[prev_idx] = "    },"

    # Renderiza novas trips, separadas por ',\n'
    rendered = [render_trip(t) for t in new_trips]
    block = ",\n".join(rendered)

    # Injeta o bloco entre prev_idx (já com vírgula) e close_idx
    new_lines = lines[: prev_idx + 1] + block.splitlines() + lines[close_idx:]

    if atualizado_em:
        # Atualiza o campo "atualizado_em" no topo (substituição simples)
        for i, line in enumerate(new_lines):
            if line.lstrip().startswith('"atualizado_em"'):
                indent = line[: len(line) - len(line.lstrip())]
                new_lines[i] = f'{indent}"atualizado_em": "{atualizado_em}",'
                break

    out = "\n".join(new_lines)
    if not out.endswith("\n"):
        out += "\n"
    TRIPS_PATH.write_text(out, encoding="utf-8")
    return len(new_trips)
