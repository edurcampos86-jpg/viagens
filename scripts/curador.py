"""
curador.py — Curador de viagens usando Claude API.

Roda toda manhã 7h BRT (10h UTC) via GitHub Actions. Para cada viagem
em planejamento + wishlist (limitado a N por execução para custo), pede
ao Claude que pesquise oportunidades reais usando web_search e avalie
relevância de forma CONSERVADORA. Output estruturado via tool_use forçada.

Sempre gera/atualiza data/curator-report.md. Se houver findings
alertable=true E SLACK_WEBHOOK_URL configurado, envia ao Slack.

Variáveis de ambiente:
  ANTHROPIC_API_KEY     obrigatório
  CURADOR_MODEL         opcional, default: claude-haiku-4-5
  CURADOR_MAX_DESTINOS  opcional, default: 5
  SLACK_WEBHOOK_URL     opcional (sem ele só gera relatório)
  CURADOR_TODAY         opcional, simular data (YYYY-MM-DD)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date
from pathlib import Path
from typing import Optional

try:
    import anthropic
except ImportError:
    anthropic = None  # validação no main()


REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
TRIPS_PATH = DATA_DIR / "trips.json"
PREFERENCIAS_PATH = DATA_DIR / "preferencias.json"
REPORT_PATH = DATA_DIR / "curator-report.md"

DEFAULT_MODEL = "claude-haiku-4-5"
# Modelos que suportam thinking adaptive
MODELS_WITH_ADAPTIVE = ("claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6")


SYSTEM_PROMPT = """Você é o Curador de Viagens — um assistente que monitora oportunidades \
para viagens futuras do usuário (em planejamento e wishlist) e relata SOMENTE \
o que for genuinamente acionável e relevante.

O usuário é Eduardo Campos, brasileiro baseado em São Paulo. Ele já te disse que \
**70% dos alertas de viagem falham por excesso**, então sua diretriz central é \
SER CONSERVADOR. Em caso de dúvida, NÃO alerte. Prefira deixar passar a importunar.

## O que reportar (alertable = true)

Conteúdo recente (últimas 2 semanas) sobre o destino que se encaixe em:

1. **Nova rota direta de voo São Paulo → destino** ou variação significativa \
   (nova companhia aérea, frequência semanal alterada relevante)
2. **Promoção/oferta significativa** de voo (≥25% abaixo da média) ou \
   hotel/resort específico (em destinos com hospedagem-protagonista, ex: Maldivas)
3. **Mudança em política de entrada/visto** (eVisa, isenção, novo requisito \
   sanitário, mudança de prazo de antecedência)
4. **Evento cultural/temporada relevante** acontecendo no período/estilo \
   compatível com o perfil do viajante (não eventos genéricos turísticos)
5. **Fenômeno natural raro** com janela específica (aurora boreal forte, \
   floração rara, eclipse local, etc.)
6. **Alerta sério de segurança** que impeça/desaconselhe turismo (mas não \
   pequenos protestos urbanos comuns)

## O que IGNORAR (alertable = false)

- Notícias políticas/econômicas que NÃO afetam turismo
- Posts de blog/listas genéricas ("10 lugares para visitar", "melhor época")
- Conteúdo de marketing genérico de operadoras de turismo
- Notícias com mais de 2 semanas
- Reportagens que mencionam o destino tangencialmente
- Conflitos/protestos urbanos pontuais que não fecham a região
- Eventos genéricos (festivais comuns, qualquer feriado local)
- "Influenciador X visitou destino Y" sem informação nova
- Variação cambial pequena/normal

## Como pesquisar

Use a ferramenta `web_search` em portuguÊs e/ou ingles. Foque em:
- Sites de companhias aéreas e agências (LATAM, Smiles, Decolar, Kayak)
- Sites oficiais de turismo do destino
- Notícias recentes em veículos respeitáveis (BBC, NYT, Reuters, G1)
- NÃO confie em blogs aleatórios ou social media

Limite-se a no máximo 4 buscas por destino. Após pesquisar, use a ferramenta \
`report_finding` para entregar seu veredito final.

## Tom do alerta (quando alertable=true)

- `headline`: máximo 80 caracteres, direto ao ponto. Ex: \
  "LATAM anuncia voo direto SP→Tóquio diário a partir de set/2027"
- `summary`: 1-2 frases. Contextualize POR QUE isso importa para a viagem \
  específica do Eduardo (datas, modo de viagem).
- `source_url`: link primário da informação.
- `reasoning`: 1-2 frases sobre por que vale alertar (ou por que não)."""


REPORT_FINDING_TOOL = {
    "name": "report_finding",
    "description": (
        "Reporta o veredito do Curador sobre este destino. SEMPRE use esta "
        "ferramenta no final, mesmo quando não há nada para alertar "
        "(alertable=false). Seja conservador."
    ),
    "input_schema": {
        "type": "object",
        "required": ["alertable", "reasoning"],
        "properties": {
            "alertable": {
                "type": "boolean",
                "description": (
                    "true APENAS se há oportunidade genuinamente relevante. "
                    "Em dúvida, false."
                ),
            },
            "headline": {
                "type": "string",
                "description": "Título curto (≤80 chars). Vazio se !alertable.",
            },
            "summary": {
                "type": "string",
                "description": (
                    "1-2 frases explicando a oportunidade e por que importa "
                    "para o Eduardo. Vazio se !alertable."
                ),
            },
            "source_url": {
                "type": "string",
                "description": "Link primário. Vazio se !alertable.",
            },
            "reasoning": {
                "type": "string",
                "description": "1-2 frases justificando alertar ou não.",
            },
        },
    },
}


def load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def fmt_trip_for_prompt(t: dict) -> str:
    """Formata uma viagem como contexto para o Curador."""
    parts = [f"- Nome: {t.get('name', '?')}"]
    if t.get("country"):  parts.append(f"- País: {t['country']}")
    if t.get("sub"):      parts.append(f"- Local: {t['sub']}")
    parts.append(f"- Status: {t.get('status', '?')}")
    if t.get("startDate") and t.get("endDate"):
        parts.append(f"- Datas previstas: {t['startDate']} a {t['endDate']}")
    elif t.get("year") and t.get("month"):
        meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
        parts.append(f"- Período previsto: {meses[t['month']-1]}/{t['year']}")
    if t.get("highlights"):
        parts.append(f"- Interesses: {', '.join(t['highlights'][:5])}")
    if t.get("tags"):
        parts.append(f"- Tags: {', '.join(t['tags'])}")
    if t.get("inspiracao_fonte"):
        parts.append(f"- Inspiração original: {t['inspiracao_fonte']}")
    return "\n".join(parts)


def fmt_preferencias(p: dict) -> str:
    parts = []
    if p.get("perfil"): parts.append(f"Perfil: {p['perfil']}")
    if p.get("preferir"):
        parts.append("Prefere:\n  - " + "\n  - ".join(p["preferir"]))
    if p.get("evitar"):
        parts.append("Evita:\n  - " + "\n  - ".join(p["evitar"]))
    return "\n\n".join(parts) if parts else "(sem perfil cadastrado)"


def curate_trip(client, trip: dict, preferencias: dict, today: date,
                model: str = DEFAULT_MODEL) -> Optional[dict]:
    """Roda o Curador para uma viagem. Retorna dict de report_finding ou None."""
    user_msg = f"""HOJE: {today.isoformat()}

PERFIL DO VIAJANTE:
{fmt_preferencias(preferencias)}

DESTINO ALVO:
{fmt_trip_for_prompt(trip)}

Pesquise (máx. 4 buscas) e use `report_finding` para entregar seu veredito. \
LEMBRE-SE: em dúvida, alertable=false."""

    kwargs = {
        "model": model,
        "max_tokens": 1500,
        "system": [{
            "type": "text",
            "text": SYSTEM_PROMPT,
            "cache_control": {"type": "ephemeral"},
        }],
        "tools": [
            {
                "type": "web_search_20250305",
                "name": "web_search",
                "max_uses": 4,
            },
            REPORT_FINDING_TOOL,
        ],
        "tool_choice": {"type": "tool", "name": "report_finding"},
        "messages": [{"role": "user", "content": user_msg}],
    }
    if model in MODELS_WITH_ADAPTIVE:
        kwargs["thinking"] = {"type": "adaptive"}

    try:
        response = client.messages.create(**kwargs)
    except anthropic.APIError as e:
        print(f"⚠ API error em {trip.get('id')}: {e}", file=sys.stderr)
        return None

    # Extrai o tool_use forçado (report_finding)
    for block in response.content:
        if block.type == "tool_use" and block.name == "report_finding":
            return block.input

    print(f"⚠ Sem tool_use em {trip.get('id')}", file=sys.stderr)
    return None


def select_destinos(trips: list[dict], today: date, max_destinos: int) -> list[dict]:
    """Seleciona destinos prioritários para o Curador. Foca em em_planejamento,
    depois wishlist, ordenado por proximidade da data prevista."""
    def proximity_score(t):
        # Quanto menor, mais prioritário (em ordem ascendente)
        if t.get("status") == "em_planejamento":
            base = 0
        elif t.get("status") == "wishlist":
            base = 1000
        else:
            return 9e9
        # Adiciona dias até a viagem (se conhecido)
        if t.get("startDate"):
            try:
                d = date.fromisoformat(t["startDate"])
                days = (d - today).days
                if days < 0:
                    return 9e9  # passada
                return base + days
            except ValueError:
                pass
        if t.get("year") and t.get("month"):
            try:
                d = date(t["year"], t["month"], 15)
                days = (d - today).days
                if days < 0:
                    return 9e9
                return base + days
            except (ValueError, TypeError):
                pass
        return base + 10000

    elegiveis = [t for t in trips
                 if t.get("status") in ("em_planejamento", "wishlist")]
    elegiveis.sort(key=proximity_score)
    return elegiveis[:max_destinos]


def render_report(findings: list[dict], today: date) -> str:
    """Gera o relatório markdown."""
    alertaveis = [f for f in findings if f["finding"].get("alertable")]
    nao_alertaveis = [f for f in findings if not f["finding"].get("alertable")]

    lines = [f"# Relatório do Curador — {today.isoformat()}", ""]

    if not findings:
        lines.append("_Sem destinos elegíveis nesta execução._")
        return "\n".join(lines) + "\n"

    lines.append(
        f"Curei {len(findings)} destino(s). "
        f"**{len(alertaveis)} com oportunidade alertável**, "
        f"{len(nao_alertaveis)} sem nada novo relevante."
    )
    lines.append("")

    if alertaveis:
        lines.append("## ✨ Oportunidades alertáveis")
        lines.append("")
        for entry in alertaveis:
            f = entry["finding"]
            trip = entry["trip"]
            lines.append(f"### {trip.get('name', '?')} — {f.get('headline', '?')}")
            lines.append("")
            if f.get("summary"):
                lines.append(f.get("summary"))
                lines.append("")
            if f.get("source_url"):
                lines.append(f"Fonte: {f['source_url']}")
                lines.append("")
            lines.append(f"_Raciocínio do Curador: {f.get('reasoning', '')}_")
            lines.append("")

    if nao_alertaveis:
        lines.append("## 🔵 Destinos pesquisados sem oportunidade nova")
        lines.append("")
        for entry in nao_alertaveis:
            f = entry["finding"]
            trip = entry["trip"]
            lines.append(
                f"- **{trip.get('name', '?')}**: "
                f"{f.get('reasoning', 'sem detalhes')}"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def send_slack(findings: list[dict], today: date) -> Optional[bool]:
    """Envia ao Slack se há alertáveis E webhook configurado.
    Retorna True/False/None (None = pulou)."""
    webhook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        return None

    alertaveis = [f for f in findings if f["finding"].get("alertable")]
    if not alertaveis:
        return None

    lines = [f"*Curador de Viagens — {today.isoformat()}*",
             f"✨ {len(alertaveis)} oportunidade(s) acionável(is):"]
    for entry in alertaveis[:5]:
        f = entry["finding"]
        trip = entry["trip"]
        lines.append(f"• *{trip.get('name', '?')}* — {f.get('headline', '?')}")
        if f.get("source_url"):
            lines.append(f"  <{f['source_url']}|fonte>")
    if len(alertaveis) > 5:
        lines.append(f"_(... +{len(alertaveis) - 5} omitido(s))_")
    lines.append("")
    lines.append("Detalhes em `data/curator-report.md`.")

    payload = json.dumps({"text": "\n".join(lines)}).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except urllib.error.URLError as e:
        print(f"⚠ Slack notify failed: {e}", file=sys.stderr)
        return False


def main() -> int:
    if anthropic is None:
        print("✗ Pacote 'anthropic' não instalado. "
              "Instale com: pip install -r scripts/requirements-curator.txt",
              file=sys.stderr)
        return 1

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("✗ ANTHROPIC_API_KEY não configurada. Veja docs/CURADOR.md",
              file=sys.stderr)
        return 1

    override = os.environ.get("CURADOR_TODAY", "").strip()
    today = date.today()
    if override:
        try:
            today = date.fromisoformat(override)
            print(f"(simulando today={today})")
        except ValueError:
            print(f"⚠ CURADOR_TODAY mal formatado: {override!r} — usando data real")

    max_destinos = int(os.environ.get("CURADOR_MAX_DESTINOS", "5"))
    model = os.environ.get("CURADOR_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    trips_file = load_json(TRIPS_PATH) or {}
    trips = trips_file.get("trips") or []
    preferencias = load_json(PREFERENCIAS_PATH) or {}

    destinos = select_destinos(trips, today, max_destinos)
    print(f"Curador — modelo {model}, {len(destinos)} destino(s) elegível(is)")
    if not destinos:
        REPORT_PATH.write_text(render_report([], today), encoding="utf-8")
        print("Sem destinos elegíveis. Relatório vazio gerado.")
        return 0

    client = anthropic.Anthropic()
    findings: list[dict] = []
    for trip in destinos:
        print(f"  → {trip['id']} ({trip.get('name', '?')})")
        result = curate_trip(client, trip, preferencias, today, model=model)
        if result:
            findings.append({"trip": trip, "finding": result})
            print(f"    {'✨ ALERT' if result.get('alertable') else '🔵 ok'}: "
                  f"{result.get('headline') or result.get('reasoning', '')[:80]}")

    REPORT_PATH.write_text(render_report(findings, today), encoding="utf-8")
    print(f"\nRelatório escrito em {REPORT_PATH.relative_to(REPO_ROOT)}")

    slack_status = send_slack(findings, today)
    if slack_status is True:
        print("Slack: notificação enviada.")
    elif slack_status is False:
        print("Slack: falha ao enviar.")
    elif slack_status is None and os.environ.get("SLACK_WEBHOOK_URL"):
        print("Slack: nenhuma oportunidade — sem notificação.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
