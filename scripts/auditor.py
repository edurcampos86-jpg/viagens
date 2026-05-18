"""
auditor.py — relatório semanal do estado das viagens.

Roda toda segunda 9h BRT (12h UTC) via GitHub Actions, ou manualmente
(`python scripts/auditor.py`). Aplica regras de auditoria sobre
trips.json / documentos.json / preferencias.json e:

  1. Sempre gera/atualiza `data/audit-report.md`.
  2. Se houver findings de severidade "critico" E variável
     SLACK_WEBHOOK_URL configurada: envia resumo ao Slack.
  3. Sai com 0 sempre (auditoria não é "build broken").

Regras (severidades: critico, warn, info):

  R1  critico  Schema inválido em algum arquivo
  R2  critico  Passaporte vence em <6 meses após volta de viagem internacional
  R3  critico  planned com ≤30 dias sem hospedagem
  R4  warn     em_planejamento com ≤60 dias (precisa virar planned)
  R5  critico  Documento não obtido para viagem internacional ≤30 dias
  R6  warn     Decisão pendente de criticidade=alta sem prazo
  R7  info     Passaporte com validade desconhecida em documentos.json

Slack: SLACK_WEBHOOK_URL como variável de ambiente (secret no GHA).
Se ausente, pula notificação silenciosamente.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SCHEMAS_DIR = DATA_DIR / "schemas"
REPORT_PATH = DATA_DIR / "audit-report.md"

TRIPS_PATH = DATA_DIR / "trips.json"
DOCUMENTOS_PATH = DATA_DIR / "documentos.json"
PREFERENCIAS_PATH = DATA_DIR / "preferencias.json"


SEV_ORDER = {"critico": 0, "warn": 1, "info": 2}
SEV_EMOJI = {"critico": "🔴", "warn": "🟡", "info": "🔵"}
SEV_LABEL = {"critico": "Crítico", "warn": "Atenção", "info": "Informativo"}


def load_json(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def trip_start(t: dict) -> Optional[date]:
    """Best-effort: lê startDate, senão year+month dia 1."""
    s = t.get("startDate")
    if s:
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
    y, m = t.get("year"), t.get("month")
    if isinstance(y, int) and isinstance(m, int):
        try:
            return date(y, m, 1)
        except ValueError:
            pass
    return None


def trip_end(t: dict) -> Optional[date]:
    e = t.get("endDate")
    if e:
        try:
            return date.fromisoformat(e)
        except ValueError:
            pass
    s = trip_start(t)
    nts = t.get("nts")
    if s and isinstance(nts, int):
        return s + timedelta(days=nts)
    return s


def is_international(t: dict) -> bool:
    country = (t.get("country") or "").strip().lower()
    return bool(country) and country != "brasil"


def days_until(t: dict, today: date) -> Optional[int]:
    s = trip_start(t)
    return (s - today).days if s else None


# ── Regras ───────────────────────────────────────────────────────────

def check_schemas() -> list[dict]:
    """R1 — Reusa validate_schemas.py para detectar falha de schema."""
    try:
        from validate_schemas import build_registry, validate_one
    except ImportError:
        return [{
            "regra": "R1",
            "severidade": "critico",
            "msg": "validate_schemas.py não disponível (rodar Auditor isolado?)",
        }]

    registry = build_registry()
    findings = []
    targets = [
        (TRIPS_PATH, SCHEMAS_DIR / "trips-file.schema.json"),
        (DOCUMENTOS_PATH, SCHEMAS_DIR / "documentos.schema.json"),
        (PREFERENCIAS_PATH, SCHEMAS_DIR / "preferencias.schema.json"),
    ]
    for data_path, schema_path in targets:
        errs = validate_one(data_path, schema_path, registry)
        if errs:
            findings.append({
                "regra": "R1",
                "severidade": "critico",
                "msg": f"Schema inválido: {data_path.name} — {len(errs) - 1} erro(s)",
                "detalhes": "\n".join(errs),
            })
    return findings


def check_passaporte_vence(trips: list[dict], documentos: dict, today: date) -> list[dict]:
    """R2 + R7 — Passaporte vence em <6m após volta de viagem internacional / sem validade."""
    findings = []
    pp = (documentos or {}).get("passaporte") or {}
    valido_ate = pp.get("valido_ate")

    internacionais_futuras = [
        t for t in trips
        if t.get("status") in ("planned", "em_planejamento", "wishlist")
        and is_international(t)
        and (trip_start(t) or today) >= today
    ]

    if not valido_ate and internacionais_futuras:
        findings.append({
            "regra": "R7",
            "severidade": "info",
            "msg": (
                f"Passaporte sem `valido_ate` em documentos.json — "
                f"{len(internacionais_futuras)} viagem(ns) internacional(is) futura(s) sem validação"
            ),
        })
        return findings

    if not valido_ate:
        return findings

    try:
        venc = date.fromisoformat(valido_ate)
    except ValueError:
        findings.append({
            "regra": "R7",
            "severidade": "warn",
            "msg": f"`passaporte.valido_ate` mal-formatado: {valido_ate!r}",
        })
        return findings

    for t in internacionais_futuras:
        s = trip_start(t)
        e = trip_end(t) or s
        if not s or not e:
            continue
        # Regra dos 6 meses: passaporte precisa estar válido por 6m após volta
        minimo_necessario = e + timedelta(days=180)
        if venc < minimo_necessario:
            findings.append({
                "regra": "R2",
                "severidade": "critico",
                "msg": (
                    f"`{t['id']}` ({t.get('name')}) começa em {s} — "
                    f"passaporte vence em {venc}, precisa estar válido até pelo menos {minimo_necessario}"
                ),
            })
    return findings


def check_hospedagem(trips: list[dict], today: date) -> list[dict]:
    """R3 — planned com ≤30 dias sem hospedagem."""
    findings = []
    for t in trips:
        if t.get("status") != "planned":
            continue
        d = days_until(t, today)
        if d is None or d < 0 or d > 30:
            continue
        hosp = t.get("hospedagem") or []
        if not hosp:
            findings.append({
                "regra": "R3",
                "severidade": "critico",
                "msg": f"`{t['id']}` ({t.get('name')}) em {d} dias e sem hospedagem confirmada",
            })
    return findings


def check_em_planejamento_proxima(trips: list[dict], today: date) -> list[dict]:
    """R4 — em_planejamento com ≤60 dias."""
    findings = []
    for t in trips:
        if t.get("status") != "em_planejamento":
            continue
        d = days_until(t, today)
        if d is None or d < 0 or d > 60:
            continue
        findings.append({
            "regra": "R4",
            "severidade": "warn",
            "msg": (
                f"`{t['id']}` ({t.get('name')}) em {d} dias ainda como em_planejamento — "
                f"considerar promover para planned ou ajustar status"
            ),
        })
    return findings


def check_documentos_pendentes(trips: list[dict], today: date) -> list[dict]:
    """R5 — Documento não obtido para viagem internacional ≤30 dias."""
    findings = []
    for t in trips:
        if t.get("status") not in ("planned", "em_planejamento"):
            continue
        d = days_until(t, today)
        if d is None or d < 0 or d > 30:
            continue
        if not is_international(t):
            continue
        docs = t.get("documentos_necessarios") or []
        pendentes = [d for d in docs if not d.get("obtido")]
        if pendentes:
            tipos = ", ".join(p.get("tipo", "?") for p in pendentes)
            findings.append({
                "regra": "R5",
                "severidade": "critico",
                "msg": (
                    f"`{t['id']}` ({t.get('name')}) em {d} dias com "
                    f"{len(pendentes)} documento(s) pendente(s): {tipos}"
                ),
            })
    return findings


def check_decisoes_criticas(trips: list[dict], today: date) -> list[dict]:
    """R6 — Decisão criticidade=alta sem prazo (ou prazo já passou)."""
    findings = []
    for t in trips:
        if t.get("status") not in ("planned", "em_planejamento"):
            continue
        for dec in (t.get("decisoes_pendentes") or []):
            if dec.get("criticidade") != "alta":
                continue
            prazo = dec.get("prazo")
            if not prazo:
                findings.append({
                    "regra": "R6",
                    "severidade": "warn",
                    "msg": (
                        f"`{t['id']}` ({t.get('name')}): decisão crítica "
                        f"`{dec.get('titulo','?')}` sem prazo definido"
                    ),
                })
                continue
            try:
                p = date.fromisoformat(prazo)
            except ValueError:
                continue
            if p < today:
                findings.append({
                    "regra": "R6",
                    "severidade": "warn",
                    "msg": (
                        f"`{t['id']}` ({t.get('name')}): decisão `{dec.get('titulo','?')}` "
                        f"com prazo vencido em {prazo}"
                    ),
                })
    return findings


# ── Pipeline ─────────────────────────────────────────────────────────

def run_auditor(today: Optional[date] = None) -> list[dict]:
    today = today or date.today()

    findings: list[dict] = []
    findings += check_schemas()

    trips_file = load_json(TRIPS_PATH) or {}
    trips = trips_file.get("trips") or []
    documentos = load_json(DOCUMENTOS_PATH) or {}

    findings += check_passaporte_vence(trips, documentos, today)
    findings += check_hospedagem(trips, today)
    findings += check_em_planejamento_proxima(trips, today)
    findings += check_documentos_pendentes(trips, today)
    findings += check_decisoes_criticas(trips, today)

    findings.sort(key=lambda f: (SEV_ORDER.get(f["severidade"], 99), f["regra"]))
    return findings


def render_report(findings: list[dict], today: date) -> str:
    if not findings:
        return (
            f"# Relatório do Auditor — {today.isoformat()}\n\n"
            f"✅ **Tudo em ordem.** Nenhum finding nesta execução.\n"
        )

    by_sev: dict[str, list[dict]] = {}
    for f in findings:
        by_sev.setdefault(f["severidade"], []).append(f)

    lines = [f"# Relatório do Auditor — {today.isoformat()}", ""]
    counts = " · ".join(
        f"{SEV_EMOJI[s]} {len(by_sev[s])} {SEV_LABEL[s].lower()}"
        for s in ("critico", "warn", "info") if s in by_sev
    )
    lines.append(f"Resumo: {counts}.")
    lines.append("")

    for sev in ("critico", "warn", "info"):
        if sev not in by_sev:
            continue
        lines.append(f"## {SEV_EMOJI[sev]} {SEV_LABEL[sev]}")
        lines.append("")
        for f in by_sev[sev]:
            lines.append(f"- **{f['regra']}** {f['msg']}")
            if f.get("detalhes"):
                lines.append("")
                lines.append("```")
                lines.append(f["detalhes"])
                lines.append("```")
        lines.append("")

    return "\n".join(lines)


def send_slack(findings: list[dict], today: date) -> Optional[bool]:
    """Envia resumo ao Slack se houver crítico E webhook configurado.
    Retorna True/False/None (None = pulou)."""
    webhook = os.environ.get("SLACK_WEBHOOK_URL", "").strip()
    if not webhook:
        return None

    criticos = [f for f in findings if f["severidade"] == "critico"]
    if not criticos:
        return None

    lines = [f"*Auditor de Viagens — {today.isoformat()}*",
             f"🔴 {len(criticos)} finding(s) crítico(s):"]
    for f in criticos[:10]:
        lines.append(f"• {f['regra']} — {f['msg']}")
    if len(criticos) > 10:
        lines.append(f"_(... +{len(criticos) - 10} omitido(s))_")
    lines.append("")
    lines.append("Detalhes em `data/audit-report.md`.")

    payload = json.dumps({"text": "\n".join(lines)}).encode("utf-8")
    req = urllib.request.Request(webhook, data=payload,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except urllib.error.URLError as e:
        print(f"⚠ Slack notify failed: {e}", file=sys.stderr)
        return False


def main() -> int:
    override = os.environ.get("AUDIT_TODAY", "").strip()
    today = date.today()
    if override:
        try:
            today = date.fromisoformat(override)
            print(f"(simulando today={today})")
        except ValueError:
            print(f"⚠ AUDIT_TODAY mal formatado: {override!r} — usando data real")

    findings = run_auditor(today)
    report = render_report(findings, today)

    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"Relatório escrito em {REPORT_PATH.relative_to(REPO_ROOT)}")

    if findings:
        print(f"\n{len(findings)} finding(s):")
        for f in findings:
            print(f"  {SEV_EMOJI[f['severidade']]} {f['regra']} {f['msg']}")
    else:
        print("\n✅ Tudo em ordem.")

    slack_status = send_slack(findings, today)
    if slack_status is True:
        print("\nSlack: notificação enviada.")
    elif slack_status is False:
        print("\nSlack: falha ao enviar (ver erro acima).")
    elif slack_status is None and os.environ.get("SLACK_WEBHOOK_URL"):
        # webhook configurado mas sem críticos
        print("\nSlack: nenhum crítico — sem notificação.")

    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
