"""
test_auditor.py — testes das regras do Auditor.

Rodar:
    python scripts/test_auditor.py

Sem deps externas (apenas lib padrão + jsonschema, instalado via
scripts/requirements-validate.txt).
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from auditor import (  # noqa: E402
    check_passaporte_vence,
    check_hospedagem,
    check_em_planejamento_proxima,
    check_documentos_pendentes,
    check_decisoes_criticas,
    render_report,
    run_auditor,
)


TODAY = date(2026, 5, 18)


def trip(**kwargs):
    """Builder default — preenche campos comuns para teste."""
    return {
        "id": kwargs.get("id", "test"),
        "name": kwargs.get("name", "Test"),
        "status": kwargs.get("status", "planned"),
        "country": kwargs.get("country", "Japan"),
        **{k: v for k, v in kwargs.items() if k not in ("id", "name", "status", "country")},
    }


# ── R2: passaporte vence < 6m após volta ─────────────────────────────

def test_passaporte_vence_antes_de_viagem_internacional_critico():
    trips = [trip(id="japao", startDate="2027-02-08", endDate="2027-02-18", country="Japan")]
    docs = {"passaporte": {"valido_ate": "2027-05-01"}}  # < 6m após 18/02/2027
    f = check_passaporte_vence(trips, docs, TODAY)
    assert len(f) == 1
    assert f[0]["regra"] == "R2"
    assert f[0]["severidade"] == "critico"


def test_passaporte_valido_o_suficiente_nao_alerta():
    trips = [trip(id="japao", startDate="2027-02-08", endDate="2027-02-18", country="Japan")]
    docs = {"passaporte": {"valido_ate": "2028-09-01"}}  # > 6m após 18/02/2027
    f = check_passaporte_vence(trips, docs, TODAY)
    assert len(f) == 0


def test_passaporte_sem_validade_e_viagem_internacional_info():
    trips = [trip(id="japao", startDate="2027-02-08", endDate="2027-02-18", country="Japan")]
    docs = {"passaporte": {}}
    f = check_passaporte_vence(trips, docs, TODAY)
    assert len(f) == 1
    assert f[0]["regra"] == "R7"
    assert f[0]["severidade"] == "info"


def test_viagem_nacional_nao_dispara_passaporte():
    trips = [trip(id="rio", startDate="2026-12-20", endDate="2026-12-30", country="Brasil")]
    docs = {"passaporte": {}}
    f = check_passaporte_vence(trips, docs, TODAY)
    assert len(f) == 0


# ── R3: planned ≤30d sem hospedagem ─────────────────────────────────

def test_planned_proximo_sem_hospedagem_critico():
    proxima = (TODAY + timedelta(days=15)).isoformat()
    trips = [trip(id="sp", startDate=proxima, status="planned", country="Brasil")]
    f = check_hospedagem(trips, TODAY)
    assert len(f) == 1
    assert f[0]["regra"] == "R3"
    assert f[0]["severidade"] == "critico"


def test_planned_com_hospedagem_nao_alerta():
    proxima = (TODAY + timedelta(days=15)).isoformat()
    trips = [trip(id="sp", startDate=proxima, status="planned", country="Brasil",
                  hospedagem=[{"nome": "Hotel X"}])]
    f = check_hospedagem(trips, TODAY)
    assert len(f) == 0


def test_planned_distante_sem_hospedagem_nao_alerta():
    distante = (TODAY + timedelta(days=180)).isoformat()
    trips = [trip(id="japao", startDate=distante, status="planned")]
    f = check_hospedagem(trips, TODAY)
    assert len(f) == 0


def test_em_planejamento_sem_hospedagem_nao_dispara_r3():
    """R3 só vale para 'planned' confirmada."""
    proxima = (TODAY + timedelta(days=15)).isoformat()
    trips = [trip(id="x", startDate=proxima, status="em_planejamento", country="Brasil")]
    f = check_hospedagem(trips, TODAY)
    assert len(f) == 0


# ── R4: em_planejamento ≤60d ─────────────────────────────────────────

def test_em_planejamento_proxima_warn():
    proxima = (TODAY + timedelta(days=45)).isoformat()
    trips = [trip(id="x", startDate=proxima, status="em_planejamento")]
    f = check_em_planejamento_proxima(trips, TODAY)
    assert len(f) == 1
    assert f[0]["regra"] == "R4"
    assert f[0]["severidade"] == "warn"


def test_em_planejamento_distante_nao_alerta():
    distante = (TODAY + timedelta(days=180)).isoformat()
    trips = [trip(id="x", startDate=distante, status="em_planejamento")]
    f = check_em_planejamento_proxima(trips, TODAY)
    assert len(f) == 0


# ── R5: documento pendente para viagem internacional ≤30d ─────────────

def test_documento_pendente_internacional_critico():
    proxima = (TODAY + timedelta(days=20)).isoformat()
    trips = [trip(id="japao", startDate=proxima, country="Japan",
                  documentos_necessarios=[{"tipo": "visto", "obtido": False}])]
    f = check_documentos_pendentes(trips, TODAY)
    assert len(f) == 1
    assert f[0]["regra"] == "R5"
    assert f[0]["severidade"] == "critico"


def test_documento_obtido_nao_alerta():
    proxima = (TODAY + timedelta(days=20)).isoformat()
    trips = [trip(id="japao", startDate=proxima, country="Japan",
                  documentos_necessarios=[{"tipo": "visto", "obtido": True}])]
    f = check_documentos_pendentes(trips, TODAY)
    assert len(f) == 0


def test_documento_pendente_para_viagem_nacional_nao_dispara():
    proxima = (TODAY + timedelta(days=20)).isoformat()
    trips = [trip(id="rio", startDate=proxima, country="Brasil",
                  documentos_necessarios=[{"tipo": "outro", "obtido": False}])]
    f = check_documentos_pendentes(trips, TODAY)
    assert len(f) == 0


# ── R6: decisões críticas ────────────────────────────────────────────

def test_decisao_alta_sem_prazo_warn():
    trips = [trip(id="x", startDate="2027-01-01",
                  decisoes_pendentes=[{"titulo": "Qual hotel?", "criticidade": "alta"}])]
    f = check_decisoes_criticas(trips, TODAY)
    assert len(f) == 1
    assert f[0]["severidade"] == "warn"


def test_decisao_alta_com_prazo_futuro_nao_alerta():
    futuro = (TODAY + timedelta(days=60)).isoformat()
    trips = [trip(id="x", startDate="2027-01-01",
                  decisoes_pendentes=[{"titulo": "Qual hotel?", "criticidade": "alta", "prazo": futuro}])]
    f = check_decisoes_criticas(trips, TODAY)
    assert len(f) == 0


def test_decisao_alta_prazo_vencido_warn():
    passado = (TODAY - timedelta(days=10)).isoformat()
    trips = [trip(id="x", startDate="2027-01-01",
                  decisoes_pendentes=[{"titulo": "Q", "criticidade": "alta", "prazo": passado}])]
    f = check_decisoes_criticas(trips, TODAY)
    assert len(f) == 1
    assert f[0]["severidade"] == "warn"


def test_decisao_media_ou_baixa_nao_dispara_r6():
    trips = [trip(id="x", startDate="2027-01-01",
                  decisoes_pendentes=[{"titulo": "Q", "criticidade": "media"}])]
    f = check_decisoes_criticas(trips, TODAY)
    assert len(f) == 0


# ── Report rendering ─────────────────────────────────────────────────

def test_render_report_sem_findings():
    out = render_report([], TODAY)
    assert "Tudo em ordem" in out
    assert "✅" in out


def test_render_report_agrupa_por_severidade():
    findings = [
        {"regra": "R3", "severidade": "critico", "msg": "A"},
        {"regra": "R4", "severidade": "warn", "msg": "B"},
        {"regra": "R7", "severidade": "info", "msg": "C"},
    ]
    out = render_report(findings, TODAY)
    assert "🔴 Crítico" in out
    assert "🟡 Atenção" in out
    assert "🔵 Informativo" in out
    # ordem: critico antes de warn antes de info
    assert out.index("🔴") < out.index("🟡") < out.index("🔵")


def test_run_auditor_returns_list():
    """Smoke test sobre os dados reais do repo."""
    findings = run_auditor(TODAY)
    assert isinstance(findings, list)


if __name__ == "__main__":
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ✓ {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {t.__name__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ! {t.__name__} CRASHED: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
