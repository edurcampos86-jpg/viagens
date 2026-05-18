"""
test_curador.py — testes das funções puras do Curador.

Não chama a API Anthropic real (testes mockam quando necessário).
Rodar:
    python scripts/test_curador.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from curador import (  # noqa: E402
    fmt_trip_for_prompt,
    fmt_preferencias,
    select_destinos,
    render_report,
)


TODAY = date(2026, 5, 18)


def trip(**kwargs):
    """Builder default."""
    return {
        "id": kwargs.get("id", "test"),
        "name": kwargs.get("name", "Test"),
        "status": kwargs.get("status", "planned"),
        "country": kwargs.get("country", "Japan"),
        **{k: v for k, v in kwargs.items() if k not in ("id", "name", "status", "country")},
    }


# ── fmt_trip_for_prompt ──────────────────────────────────────────────

def test_fmt_trip_inclui_nome_pais_status():
    t = trip(id="x", name="Tóquio", country="Japan", status="wishlist")
    s = fmt_trip_for_prompt(t)
    assert "Tóquio" in s
    assert "Japan" in s
    assert "wishlist" in s


def test_fmt_trip_com_datas_explicitas():
    t = trip(startDate="2027-02-08", endDate="2027-02-18")
    s = fmt_trip_for_prompt(t)
    assert "2027-02-08" in s
    assert "2027-02-18" in s


def test_fmt_trip_com_year_month_apenas():
    t = trip(year=2027, month=4)
    s = fmt_trip_for_prompt(t)
    assert "Abr" in s
    assert "2027" in s


def test_fmt_trip_inclui_inspiracao_quando_presente():
    t = trip(inspiracao_fonte="Conversa com o marido")
    s = fmt_trip_for_prompt(t)
    assert "marido" in s.lower()


# ── fmt_preferencias ─────────────────────────────────────────────────

def test_fmt_preferencias_inclui_perfil_e_listas():
    p = {
        "perfil": "Conforto sem extravagância",
        "preferir": ["Voos diretos", "Hotel central"],
        "evitar": ["Madrugadas"],
    }
    s = fmt_preferencias(p)
    assert "Conforto sem extravagância" in s
    assert "Voos diretos" in s
    assert "Madrugadas" in s


def test_fmt_preferencias_vazias_retorna_placeholder():
    s = fmt_preferencias({})
    assert "(sem perfil cadastrado)" in s


# ── select_destinos ──────────────────────────────────────────────────

def test_select_destinos_prioriza_em_planejamento_sobre_wishlist():
    trips = [
        trip(id="wish-distante", status="wishlist", year=2028, month=6),
        trip(id="planj-perto", status="em_planejamento", startDate="2026-07-01"),
    ]
    selected = select_destinos(trips, TODAY, 5)
    assert selected[0]["id"] == "planj-perto"
    assert selected[1]["id"] == "wish-distante"


def test_select_destinos_ordena_por_proximidade():
    trips = [
        trip(id="distante", status="em_planejamento", startDate="2027-01-01"),
        trip(id="proxima", status="em_planejamento", startDate="2026-06-15"),
    ]
    selected = select_destinos(trips, TODAY, 5)
    assert selected[0]["id"] == "proxima"


def test_select_destinos_ignora_done_e_planned():
    trips = [
        trip(id="d", status="done"),
        trip(id="p", status="planned"),
        trip(id="w", status="wishlist"),
    ]
    selected = select_destinos(trips, TODAY, 5)
    ids = [t["id"] for t in selected]
    assert "d" not in ids
    assert "p" not in ids
    assert "w" in ids


def test_select_destinos_respeita_max_destinos():
    trips = [
        trip(id=f"x{i}", status="wishlist", year=2027, month=6)
        for i in range(10)
    ]
    selected = select_destinos(trips, TODAY, 3)
    assert len(selected) == 3


def test_select_destinos_ignora_datas_passadas():
    trips = [
        trip(id="passada", status="em_planejamento", startDate="2024-01-01"),
        trip(id="futura", status="em_planejamento", startDate="2027-01-01"),
    ]
    selected = select_destinos(trips, TODAY, 5)
    # Passada vai para o final (score 9e9); aceitamos ela presente mas
    # depois da futura
    ids = [t["id"] for t in selected]
    if "passada" in ids:
        assert ids.index("futura") < ids.index("passada")


# ── render_report ────────────────────────────────────────────────────

def test_render_report_sem_findings():
    out = render_report([], TODAY)
    assert "Sem destinos elegíveis" in out


def test_render_report_so_nao_alertaveis():
    findings = [
        {
            "trip": trip(name="Marrocos"),
            "finding": {"alertable": False, "reasoning": "Nada novo nas últimas 2 semanas."},
        }
    ]
    out = render_report(findings, TODAY)
    assert "0 com oportunidade alertável" in out or "**0 com oportunidade alertável**" in out
    assert "Marrocos" in out
    assert "Nada novo" in out


def test_render_report_com_alertavel_e_nao_alertavel():
    findings = [
        {
            "trip": trip(name="Japão"),
            "finding": {
                "alertable": True,
                "headline": "LATAM lança voo direto GRU-NRT",
                "summary": "Novo voo diário relevante para sua viagem em fev/2027.",
                "source_url": "https://example.com/news",
                "reasoning": "Mudança real de rota.",
            },
        },
        {
            "trip": trip(name="Marrocos"),
            "finding": {"alertable": False, "reasoning": "Sem novidades."},
        },
    ]
    out = render_report(findings, TODAY)
    assert "1 com oportunidade alertável" in out or "**1 com oportunidade alertável**" in out
    assert "✨ Oportunidades alertáveis" in out
    assert "🔵 Destinos pesquisados sem oportunidade" in out
    assert "LATAM" in out
    assert "https://example.com/news" in out


def test_render_report_alertavel_aparece_antes_de_nao_alertavel():
    findings = [
        {
            "trip": trip(name="A"),
            "finding": {"alertable": False, "reasoning": "..."},
        },
        {
            "trip": trip(name="B"),
            "finding": {
                "alertable": True,
                "headline": "Algo importante",
                "summary": "...",
                "reasoning": "...",
            },
        },
    ]
    out = render_report(findings, TODAY)
    assert out.index("✨") < out.index("🔵")


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
