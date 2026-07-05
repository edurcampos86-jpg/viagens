#!/usr/bin/env python3
"""Testes de ingest_bookings_json.py — skill voos-gmail (Frente 3 Bookings Vivos).

Sem rede, sem pip: só stdlib. Roda da raiz do repo:
    python3 scripts/test_ingest_bookings.py
"""
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ingest_bookings_json as ib  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL_TRIPS = os.path.join(REPO, "data", "trips.json")

_passed = 0
_failed = 0


def test(name, fn):
    global _passed, _failed
    try:
        fn()
        print(f"  ok  {name}")
        _passed += 1
    except AssertionError as e:
        print(f"FAIL  {name}\n        {e}")
        _failed += 1
    except Exception as e:  # noqa: BLE001
        print(f"ERR   {name}\n        {type(e).__name__}: {e}")
        _failed += 1


def expect_abort(fn):
    """Roda fn(); passa se ela chamar fail() (SystemExit 1). Retorna o stderr."""
    buf = io.StringIO()
    try:
        with redirect_stderr(buf), redirect_stdout(io.StringIO()):
            fn()
    except SystemExit as e:
        assert e.code == 1, f"esperava exit 1, veio {e.code}"
        return buf.getvalue()
    raise AssertionError("esperava ABORTO (SystemExit), mas não abortou")


# ── writer / formatação ──────────────────────────────────────────────────

def t_collapse_pax():
    multiline = '{\n  "pax": [\n    "Eduardo",\n    "Jodson"\n  ]\n}'
    assert '"pax": ["Eduardo", "Jodson"]' in ib.collapse_pax(multiline)


def t_writer_byte_fidelity():
    # A garantia de diff-mínimo: o writer reproduz o arquivo real byte-a-byte.
    raw = open(REAL_TRIPS, encoding="utf-8").read()
    doc = json.loads(raw)
    out = ib.collapse_pax(json.dumps(doc, ensure_ascii=False, indent=2)) + "\n"
    assert raw == out, "writer divergiu do arquivo — formatação canônica mudou (drift)"


# ── ids / merge ──────────────────────────────────────────────────────────

def t_next_id():
    assert ib.next_id("marrocos-2027", "flights", {"marrocos-2027-fl-001"}) == "marrocos-2027-fl-002"
    assert ib.next_id("x", "stays", set()) == "x-st-001"
    assert ib.next_id("x", "experiences", {"x-ex-003", "x-ex-001"}) == "x-ex-004"


def t_merge_appends_and_autoids_and_nulls_localizador():
    trip = {"bookings": {"flights": [], "stays": [], "experiences": []}}
    added, dupes = ib.merge_category(
        trip, "stays",
        [{"titulo": "Hotel A", "status": "confirmado", "localizador": "ABC123"}],
        "x",
    )
    assert len(added) == 1 and not dupes
    assert added[0]["id"] == "x-st-001", added[0]
    assert added[0]["localizador"] is None, "localizador deve ser forçado a null"


def t_merge_dedup_idempotent():
    trip = {"bookings": {"flights": [{"id": "x-fl-001", "titulo": "V", "status": "confirmado"}], "stays": [], "experiences": []}}
    added, dupes = ib.merge_category(trip, "flights", [{"id": "x-fl-001", "titulo": "V", "status": "confirmado"}], "x")
    assert not added and dupes == ["x-fl-001"], (added, dupes)


# ── guard de PII ─────────────────────────────────────────────────────────

def t_pii_localizador():
    hits = ib.scan_pii({"stays": [{"titulo": "H", "localizador": "UJWZTO"}]})
    assert any("localizador" in h for h in hits), hits


def t_pii_forbidden_keys():
    for key in ("bilhete", "ticket", "cvv", "cartao", "frequent_flyer"):
        hits = ib.scan_pii({"flights": [{"titulo": "V", key: "x"}]})
        assert any(key.split("_")[0] in h.lower() for h in hits), (key, hits)


def t_pii_itinerary_and_card():
    assert ib.scan_pii({"tips": "itin 72076262343734"}), "13+ dígitos deve pegar"
    assert ib.scan_pii({"tips": "4111 1111 1111 1111"}), "cartão deve pegar"


def t_pii_short_pnr_near_keyword():
    # PNR curto (letras) junto de gatilho específico → pega
    assert ib.scan_pii({"stays": [{"titulo": "H", "notas": "localizador UJWZTO confirmado"}]}), "UJWZTO deve pegar"
    assert ib.scan_pii({"flights": [{"titulo": "V", "notas": "Bilhete: AB12CD"}]}), "bilhete AB12CD deve pegar"


def t_pii_integer_document_blocked():
    # Blocker 1 da revisão adversarial: PII numérica como int JSON passava
    # (scan só varria strings). 13+ dígitos em número → pega, em qualquer chave.
    assert ib.scan_pii({"flights": [{"titulo": "V", "numero_documento": 4726451234567}]}), \
        "int de 13 dígitos deve pegar"
    # valores legítimos (float de dinheiro, noites) NÃO disparam
    assert ib.scan_pii({"stays": [{"titulo": "H", "valor": 3861.92, "noites": 2}]}) == []


def t_pii_card_grouped_formats_blocked():
    # Blocker 2: Amex 4-6-5 agrupado e cartão com pontos passavam pelo _CARD.
    assert ib.scan_pii({"flights": [{"titulo": "V", "notas": "cartao 3782 822463 10005"}]}), "Amex 4-6-5 deve pegar"
    assert ib.scan_pii({"flights": [{"titulo": "V", "notas": "Cartao 4111.1111.1111.1111 garantia"}]}), "cartão com pontos deve pegar"


def t_pii_no_false_positive_on_flightcode_and_generic():
    # NÃO deve pegar: código de voo, frase genérica "reserva cia aérea", cidade
    assert ib.scan_pii({"flights": [{"titulo": "TP644 LIS→BRU", "notas": "TAP. Voo TP644 confirmado."}]}) == []
    assert ib.scan_pii({"stays": [{"titulo": "Hotel", "notas": "Voos LATAM confirmados (reserva cia aérea)."}]}) == []
    assert ib.scan_pii({"stays": [{"titulo": "Boutique Hotel Albus Amsterdam Centre", "cidade": "Amsterdã"}]}) == []


def t_pii_allows_clean_and_milhas():
    clean = {
        "flights": [{"titulo": "TP28 SSA→LIS", "status": "confirmado", "localizador": None, "valor": 2920}],
        "budget": {"voos": {"BRL": 2920, "milhas_tap": None, "nota": "taxas 2 pax"}},
    }
    assert ib.scan_pii(clean) == [], ib.scan_pii(clean)


# ── guard de chave de orçamento (a lição do PR #101) ─────────────────────

def t_budget_v2_numeric_ok():
    trip = {"bookings": {"stays": [], "flights": [], "experiences": []}, "budget": {"planned": {}}}
    ib.apply_budget(trip, {"stays": 6876.46})
    assert trip["budget"]["planned"]["stays"] == 6876.46


def t_budget_legacy_numeric_aborts_with_hint():
    trip = {"bookings": {"stays": [], "flights": [], "experiences": []}, "budget": {"planned": {}}}
    err = expect_abort(lambda: ib.apply_budget(trip, {"hospedagem": 6876.46}))
    assert "stays" in err, f"deveria sugerir a chave v2 'stays': {err}"


def t_budget_detail_object_ok():
    trip = {"bookings": {"stays": [], "flights": [], "experiences": []}, "budget": {"planned": {}}}
    ib.apply_budget(trip, {"stays": 6876.46, "hospedagem": {"BRL": 6876.46, "nota": "x"}})
    assert trip["budget"]["planned"]["hospedagem"]["BRL"] == 6876.46


def t_budget_sum_mismatch_warns():
    trip = {"bookings": {"stays": [{"valor": 1000, "moeda": "BRL"}], "flights": [], "experiences": []}, "budget": {"planned": {}}}
    warns = ib.apply_budget(trip, {"stays": 6876.46})
    assert warns and "difere" in warns[0], warns


# ── end-to-end via main() contra cópia temporária ────────────────────────

def _prepare(payload, trips_src=REAL_TRIPS):
    """Cria cópia temporária de trips.json + payload; aponta ib.TRIPS_PATH pra cópia."""
    tmpdir = tempfile.mkdtemp()
    trips_tmp = os.path.join(tmpdir, "trips.json")
    with open(trips_tmp, "w", encoding="utf-8") as f:
        f.write(open(trips_src, encoding="utf-8").read())
    pay_tmp = os.path.join(tmpdir, "payload.json")
    with open(pay_tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f)
    ib.TRIPS_PATH = trips_tmp
    return trips_tmp, pay_tmp


def _run_ok(pay_tmp):
    """Roda main() capturando stdout (stderr = warnings, descartado). Sem abort."""
    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(io.StringIO()):
        ib.main([pay_tmp])
    return out.getvalue()


def t_e2e_merge_minimal_diff_and_idempotent():
    before = open(REAL_TRIPS, encoding="utf-8").read()
    payload = {
        "tripId": "marrocos-2027",
        "stays": [{"titulo": "Riad Test", "status": "confirmado", "data": "2027-04-12",
                   "valor": 1234.5, "moeda": "BRL", "pax": ["Eduardo", "Jodson"], "localizador": None}],
        "budget": {"stays": 1234.5, "hospedagem": {"BRL": 1234.5, "nota": "teste"}},
    }
    trips_tmp, pay_tmp = _prepare(payload)
    _run_ok(pay_tmp)
    after = open(trips_tmp, encoding="utf-8").read()
    doc = json.loads(after)
    t = next(x for x in doc["trips"] if x["id"] == "marrocos-2027")
    assert any(s["titulo"] == "Riad Test" for s in t["bookings"]["stays"]), "stay não entrou"
    assert t["budget"]["planned"]["stays"] == 1234.5
    # diff mínimo: nenhuma outra trip pode aparecer no diff
    import difflib
    changed = [l for l in difflib.unified_diff(before.splitlines(), after.splitlines(), n=0)
               if l and l[0] in "+-" and not l.startswith(("+++", "---"))]
    assert not any("europa-tomorrowland" in l or "sanisland" in l for l in changed), \
        f"diff vazou para outra trip: {changed[:5]}"
    # idempotência: re-rodar o MESMO payload (sem id) na cópia já mesclada → nada novo
    _, pay2 = _prepare(json.loads(json.dumps(payload)), trips_src=trips_tmp)
    out2 = _run_ok(pay2)
    assert "Nada novo" in out2, out2


def t_e2e_never_creates_trip():
    _, pay_tmp = _prepare({"tripId": "inexistente-9999", "stays": [{"titulo": "X", "status": "confirmado"}]})
    err = expect_abort(lambda: ib.main([pay_tmp]))
    assert "NÃO crio viagem" in err or "não existe" in err, err


def t_e2e_pii_payload_aborts():
    _, pay_tmp = _prepare({"tripId": "marrocos-2027", "stays": [{"titulo": "H", "status": "confirmado", "localizador": "ABC123"}]})
    err = expect_abort(lambda: ib.main([pay_tmp]))
    assert "PII" in err or "localizador" in err, err


def main():
    for name, fn in list(globals().items()):
        pass
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("t_") and callable(f)]
    print(f"ingest_bookings_json — {len(tests)} testes\n")
    for name, fn in tests:
        test(name, fn)
    print(f"\n{_passed} passed, {_failed} failed")
    sys.exit(1 if _failed else 0)


if __name__ == "__main__":
    main()
