"""
build_coleta_template.py — gera data/fase-1b-coleta.md, o formulário
que Eduardo preenche para popular os campos novos das 9 viagens
futuras (planned + em_planejamento + wishlist).

Formato pensado para edição direta no GitHub Web. Parser tolerante
(scripts/apply_fase_1b_coleta.py — próximo PR) lê os campos preenchidos.

Uso:
    python scripts/build_coleta_template.py > data/fase-1b-coleta.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"

INCLUI_STATUS = ("planned", "em_planejamento", "wishlist")


HEADER = """# Coleta Fase 1b — viagens futuras

Este arquivo é o formulário para popular os campos novos do schema
(companhia, decisões, tags, documentos, orçamento, inspiração) das
viagens futuras.

## Como preencher

1. Abra este arquivo no GitHub Web e clique no ícone do lápis (canto
   superior direito) para editar.
2. Preencha o que quiser, deixe o resto em branco. **Não precisa
   completar tudo de uma vez.**
3. Commite as mudanças (a mensagem default "Update fase-1b-coleta.md"
   serve). Você pode commitar em `main` direto — este é um arquivo de
   trabalho, não código.
4. Avise no chat que preencheu (ou parte) — eu leio, aplico no
   `trips.json` via PR, e atualizo o status aqui.

## Convenções

- **Listas:** uma entrada por linha começando com `- `. Vazio = pular.
- **Decisões pendentes:** prefira o formato uma-decisão-por-linha
  `- <título da decisão> [criticidade: alta/media/baixa] [prazo: YYYY-MM-DD]`
  (os campos entre colchetes são opcionais).
- **Documentos:** `- <tipo>: <detalhe> [obtido: sim/nao] [valido_ate: YYYY-MM-DD]`
  — tipos válidos: passaporte, visto, vacina, seguro, outro.
- **Orçamento:** valores em BRL. Deixar em branco = não estimar.
- **Inspiração:** texto livre na linha após o título.

---

"""


def trip_block(t: dict) -> str:
    status_emoji = {"planned": "✅", "em_planejamento": "🟠", "wishlist": "⭐"}.get(t["status"], "·")
    return f"""## {status_emoji} `{t['id']}` — {t.get('name', '?')}

**Datas:** {t.get('startDate', t.get('label', '?'))} → {t.get('endDate', '?')}  ·  **Status:** `{t['status']}`  ·  **Destino:** {t.get('sub', t.get('country', '?'))}

### Companhia
_Nomes/relações de quem vai com você. Vazio = sozinho._
-

### Decisões pendentes
_Decisões abertas. Formato: `- título [criticidade: ...] [prazo: ...]`._
-

### Tags
_Palavras-chave livres, vírgula entre elas. Ex: praia, aniversário, amigos._
-

### Documentos necessários
_Formato: `- tipo: detalhe [obtido: sim/nao] [valido_ate: YYYY-MM-DD]`. Tipos: passaporte, visto, vacina, seguro, outro._
-

### Orçamento estimado (BRL)
- voos:
- hospedagem:
- alimentacao:
- transporte_local:
- passeios:
- outros:

### Inspiração
_O que originou essa viagem? Link, conversa, post. Texto livre._


---

"""


def main() -> int:
    data = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    futuras = [t for t in data["trips"] if t.get("status") in INCLUI_STATUS]
    futuras.sort(key=lambda t: (t.get("year", 9999), t.get("month", 12)))

    out = [HEADER]
    out.append(f"_{len(futuras)} viagens futuras neste formulário._\n\n---\n\n")
    for t in futuras:
        out.append(trip_block(t))

    print("".join(out), end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
