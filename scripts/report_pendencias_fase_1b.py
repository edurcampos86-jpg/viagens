"""
report_pendencias_fase_1b.py — gera relatório markdown das pendências
de input humano para a Fase 1b, organizadas por prioridade.

Prioridades:
  1. planned: precisa input rápido (próximas viagens)
  2. wishlist: input para o Curador
  3. done: preenchimento gradual de memória

Uso:
    python scripts/report_pendencias_fase_1b.py > data/fase-1b-pendencias.md
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"


# Campos novos do schema que dependem de input humano (não inferíveis)
# Para cada um, quais status precisam priorizar.
CAMPOS_PENDENTES = {
    "companhia":             {"prioridade": "alta", "aplica_a": ("planned", "wishlist", "done")},
    "decisoes_pendentes":    {"prioridade": "alta", "aplica_a": ("planned", "wishlist")},
    "tags":                  {"prioridade": "media", "aplica_a": ("planned", "wishlist", "done")},
    "documentos_necessarios":{"prioridade": "alta", "aplica_a": ("planned", "wishlist")},
    "orcamento.estimado":    {"prioridade": "alta", "aplica_a": ("planned", "wishlist")},
    "inspiracao_fonte":      {"prioridade": "baixa", "aplica_a": ("planned", "wishlist", "done")},
}


def trip_pendencias(trip: dict) -> list[str]:
    """Retorna lista de campos pendentes para esta viagem."""
    pendentes = []
    status = trip.get("status", "")
    for campo, meta in CAMPOS_PENDENTES.items():
        if status not in meta["aplica_a"]:
            continue
        if "." in campo:
            top, sub = campo.split(".", 1)
            if not trip.get(top) or sub not in (trip.get(top) or {}):
                pendentes.append(campo)
        else:
            if not trip.get(campo):
                pendentes.append(campo)
    return pendentes


def render() -> str:
    with TRIPS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)

    trips = data.get("trips", [])
    planned   = [t for t in trips if t.get("status") == "planned"]
    em_plan   = [t for t in trips if t.get("status") == "em_planejamento"]
    wishlist  = [t for t in trips if t.get("status") == "wishlist"]
    done      = [t for t in trips if t.get("status") == "done"]

    def linha_trip(t: dict) -> str:
        pend = trip_pendencias(t)
        if not pend:
            return f"- ✅ `{t['id']}` — **{t.get('name','?')}** ({t.get('label','?')}) — nada pendente"
        return (
            f"- ⏳ `{t['id']}` — **{t.get('name','?')}** ({t.get('label','?')})\n"
            f"    - faltam: {', '.join(pend)}"
        )

    lines = []
    lines.append(f"# Pendências Fase 1b — input humano por viagem")
    lines.append("")
    lines.append(f"Gerado em {date.today().isoformat()}. "
                 f"Total: {len(trips)} viagens · "
                 f"{len(planned)} planned · {len(em_plan)} em_planejamento · "
                 f"{len(wishlist)} wishlist · {len(done)} done.")
    lines.append("")
    lines.append("**Como ler:** cada item lista os campos do schema novo que "
                 "este trip ainda não tem populados. Campos podem ficar vazios "
                 "indefinidamente; este relatório existe só para orientar a coleta.")
    lines.append("")

    lines.append("## 🔴 Prioridade alta — `planned` (próximas viagens confirmadas)")
    lines.append("")
    for t in sorted(planned, key=lambda x: (x.get("year", 0), x.get("month", 0))):
        lines.append(linha_trip(t))
    if not planned: lines.append("_(nenhuma)_")
    lines.append("")

    if em_plan:
        lines.append("## 🟠 Prioridade alta — `em_planejamento`")
        lines.append("")
        for t in sorted(em_plan, key=lambda x: (x.get("year", 0), x.get("month", 0))):
            lines.append(linha_trip(t))
        lines.append("")

    lines.append("## 🟡 Prioridade média — `wishlist` (sonhos)")
    lines.append("")
    for t in sorted(wishlist, key=lambda x: (x.get("year", 0), x.get("month", 0))):
        lines.append(linha_trip(t))
    if not wishlist: lines.append("_(nenhuma)_")
    lines.append("")

    lines.append("## 🟢 Prioridade baixa — `done` (memória, preenchimento gradual)")
    lines.append("")
    for t in sorted(done, key=lambda x: (x.get("year", 0), x.get("month", 0)), reverse=True):
        lines.append(linha_trip(t))
    if not done: lines.append("_(nenhuma)_")
    lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Estatísticas")
    lines.append("")
    contagem = {}
    for t in trips:
        for p in trip_pendencias(t):
            contagem[p] = contagem.get(p, 0) + 1
    lines.append("| Campo | Trips pendentes |")
    lines.append("|---|---|")
    for campo, n in sorted(contagem.items(), key=lambda x: -x[1]):
        lines.append(f"| `{campo}` | {n} |")

    return "\n".join(lines) + "\n"


def main() -> int:
    print(render())
    return 0


if __name__ == "__main__":
    sys.exit(main())
