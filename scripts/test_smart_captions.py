"""
Testes do módulo smart_captions e da integração com ingest_takeout.

Todos os testes mockam o cliente Anthropic — nenhuma chamada real à API.
Cobre:

1. estimate_cost / format_cost_report — pura.
2. TripContext.as_prompt_block — pura.
3. get_api_key — sucesso e falha (env).
4. generate_smart_caption — sucesso com mock.
5. generate_smart_caption — erro da API vira SmartCaptionsAPIError.
6. generate_smart_captions_batch — sucesso + rate-limit (mock sleep_fn).
7. generate_smart_captions_batch — fallback factual quando item falha.
8. _clean_caption — remove aspas / prefixos.
9. Integração via run() — default (smart_captions=False) não chama nada.
10. Integração via run() — smart_captions=True com client mockado preenche
    caption_smart_source no proposals.json.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Garante import direto (mesmo padrão de test_ingest.py)
sys.path.insert(0, str(Path(__file__).resolve().parent))

import smart_captions as sc  # noqa: E402


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _fake_message(text: str) -> object:
    """Constrói um objeto que imita anthropic.types.Message.content[].text."""
    block = types.SimpleNamespace(text=text)
    return types.SimpleNamespace(content=[block])


def _mock_client_returning(texts: list[str]) -> MagicMock:
    """Mock client cuja messages.create devolve `texts` em sequência."""
    client = MagicMock()
    client.messages.create.side_effect = [_fake_message(t) for t in texts]
    return client


def _write_dummy_image(path: Path) -> Path:
    """Escreve um arquivo .webp não-decodificável — basta existir e ser b64-encodable.

    O cliente Anthropic é mockado, então o conteúdo real não importa.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x52\x49\x46\x46FAKEWEBPDATA")
    return path


# ─────────────────────────────────────────────────────────────────────────────
# 1. Pure functions
# ─────────────────────────────────────────────────────────────────────────────

def test_estimate_cost_zero_and_typical_values():
    assert sc.estimate_cost(0) == 0
    assert sc.estimate_cost(1) == round(sc.COST_PER_ITEM_USD, 4)
    # 840 imagens (42 trips × 20 fotos) → ~$0.67
    assert 0.6 < sc.estimate_cost(840) < 0.8


def test_estimate_cost_rejects_negative():
    with pytest.raises(ValueError):
        sc.estimate_cost(-1)


def test_format_cost_report_mentions_count_and_model():
    msg = sc.format_cost_report(100, "claude-haiku-4-5")
    assert "100" in msg
    assert "claude-haiku-4-5" in msg
    assert "USD" in msg


def test_trip_context_prompt_block_truncates_long_memory():
    long_memory = "a" * 500
    ctx = sc.TripContext(name="Test", country="Brasil", memory=long_memory)
    block = ctx.as_prompt_block()
    # Trunca para ~280 chars + "..."
    mem_line = [l for l in block.splitlines() if l.startswith("Memória")][0]
    assert "..." in mem_line
    assert len(mem_line) < 320


def test_trip_context_prompt_block_omits_empty_fields():
    ctx = sc.TripContext(name="Foz do Iguaçu")
    block = ctx.as_prompt_block()
    assert "Viagem: Foz do Iguaçu" in block
    assert "País:" not in block
    assert "Destaques:" not in block
    assert "Memória" not in block


def test_clean_caption_strips_quotes_and_prefixes():
    assert sc._clean_caption('"Sorrisos diante das cataratas"') == "Sorrisos diante das cataratas"
    assert sc._clean_caption("Legenda: Cores vivas em Bangkok") == "Cores vivas em Bangkok"
    assert sc._clean_caption("Cores\nvivas em\n  Bangkok") == "Cores vivas em Bangkok"


def test_system_prompt_v2_contains_calibration_keywords():
    """V2 do system prompt cobre: anti-anglicismo, detalhe único, contexto
    inter-batch e veto a clichês motivacionais."""
    prompt = sc.SYSTEM_PROMPT
    # Anti-anglicismo (problema 2 da calibração)
    assert "anglicismo" in prompt.lower()
    assert "roar" in prompt and "rugido" in prompt
    # Detalhe único da foto (problema 3)
    assert "detalhe visual ÚNICO" in prompt or "detalhe único" in prompt.lower()
    # Contexto inter-batch (problema 1)
    assert "CAPTIONS_JÁ_GERADAS" in prompt
    # Anti-clichê motivacional
    assert "força bruta" in prompt
    # Pessoa: 3ª pessoa ou impessoal
    assert "3ª pessoa" in prompt or "impessoal" in prompt


# ─────────────────────────────────────────────────────────────────────────────
# 2. API key gating
# ─────────────────────────────────────────────────────────────────────────────

def test_get_api_key_raises_when_env_missing(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(sc.SmartCaptionsConfigError):
        sc.get_api_key()


def test_get_api_key_returns_value_when_env_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    assert sc.get_api_key() == "sk-test"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Single-image generation
# ─────────────────────────────────────────────────────────────────────────────

def test_generate_smart_caption_returns_clean_text(tmp_path):
    img = _write_dummy_image(tmp_path / "foo.webp")
    client = _mock_client_returning(['"Vento salgado e luz dourada na praia."'])
    caption = sc.generate_smart_caption(
        img,
        trip_context=sc.TripContext(name="Mykonos 2022", country="Grécia"),
        exif_data={"date": "2022-09-12", "place": "Mykonos"},
        factual_caption="Mykonos · 12 set 2022",
        client=client,
    )
    assert caption == "Vento salgado e luz dourada na praia."

    # Confere que o cliente foi chamado com vision + system + user
    assert client.messages.create.called
    call = client.messages.create.call_args
    assert call.kwargs["model"] == sc.DEFAULT_MODEL
    assert call.kwargs["system"] == sc.SYSTEM_PROMPT
    content = call.kwargs["messages"][0]["content"]
    assert any(part.get("type") == "image" for part in content)
    assert any(part.get("type") == "text" for part in content)


def test_generate_smart_caption_raises_api_error_when_client_throws(tmp_path):
    img = _write_dummy_image(tmp_path / "foo.webp")
    client = MagicMock()
    client.messages.create.side_effect = RuntimeError("timeout")
    with pytest.raises(sc.SmartCaptionsAPIError):
        sc.generate_smart_caption(img, client=client)


def test_generate_smart_caption_raises_when_image_missing(tmp_path):
    missing = tmp_path / "doesnt-exist.webp"
    with pytest.raises(sc.SmartCaptionsAPIError):
        sc.generate_smart_caption(missing, client=MagicMock())


# ─────────────────────────────────────────────────────────────────────────────
# 4. Batch generation + rate limit + fallback
# ─────────────────────────────────────────────────────────────────────────────

def test_batch_uses_rate_limit_via_injected_sleep(tmp_path):
    paths = [_write_dummy_image(tmp_path / f"{i}.webp") for i in range(3)]
    client = _mock_client_returning([
        "Primeira sensação.", "Segunda sensação.", "Terceira sensação.",
    ])
    sleeps: list[float] = []
    results = sc.generate_smart_captions_batch(
        [{"path": str(p)} for p in paths],
        client=client,
        requests_per_minute=60,  # 1/sec
        sleep_fn=sleeps.append,
    )

    assert len(results) == 3
    captions = [r.caption for r in results.values()]
    assert captions == ["Primeira sensação.", "Segunda sensação.", "Terceira sensação."]
    # Cada chamada de sleep foi pelo menos ~1s? Sleeps[0] não acontece (1ª chamada).
    # As 2 subsequentes devem ter sido pedidas.
    # Como time.monotonic() é praticamente instantâneo nos testes, as 2 sleeps
    # devem ter sido chamadas com algo próximo de 1.0.
    assert len(sleeps) == 2
    for s in sleeps:
        assert 0.9 < s <= 1.0
    # Source model preservado em todos
    for r in results.values():
        assert r.source_model == sc.DEFAULT_MODEL
        assert r.error is None


def test_batch_falls_back_when_one_item_fails(tmp_path):
    p_ok = _write_dummy_image(tmp_path / "ok.webp")
    p_bad = _write_dummy_image(tmp_path / "bad.webp")

    # 1º sucesso, 2º falha (RateLimitError-like exception)
    client = MagicMock()
    client.messages.create.side_effect = [
        _fake_message("Sucesso emocional."),
        RuntimeError("rate_limit_exceeded"),
    ]

    fallbacks = {
        str(p_ok): "Local · 01 jan 2024",
        str(p_bad): "Local · 02 jan 2024",
    }
    results = sc.generate_smart_captions_batch(
        [{"path": str(p_ok)}, {"path": str(p_bad)}],
        client=client,
        fallback_captions=fallbacks,
        requests_per_minute=600,
        sleep_fn=lambda _s: None,
    )

    assert results[str(p_ok)].caption == "Sucesso emocional."
    assert results[str(p_ok)].source_model == sc.DEFAULT_MODEL
    assert results[str(p_ok)].error is None

    # Item que falhou: caption = fallback, source_model = None
    assert results[str(p_bad)].caption == "Local · 02 jan 2024"
    assert results[str(p_bad)].source_model is None
    assert results[str(p_bad)].error is not None


def test_batch_passes_previous_captions_to_next_call(tmp_path):
    """Cada chamada dentro do mesmo batch deve receber as captions já geradas
    como `previous_captions`, garantindo que o modelo veja o contexto do álbum."""
    paths = [_write_dummy_image(tmp_path / f"{i}.webp") for i in range(3)]
    client = _mock_client_returning([
        "Primeira observação calma.",
        "Segundo ângulo, gente molhada.",
        "Terceiro: arco-íris cortando a vastidão.",
    ])

    captured_user_texts: list[str] = []
    original_create = client.messages.create

    def spy(**kwargs):
        for part in kwargs["messages"][0]["content"]:
            if part.get("type") == "text":
                captured_user_texts.append(part["text"])
        return original_create(**kwargs)

    client.messages.create = spy

    sc.generate_smart_captions_batch(
        [{"path": str(p)} for p in paths],
        client=client,
        requests_per_minute=600,
        sleep_fn=lambda _s: None,
    )

    # 1ª chamada: sem previous_captions no prompt
    assert "CAPTIONS_JÁ_GERADAS" not in captured_user_texts[0]
    # 2ª chamada: vê a 1ª caption
    assert "CAPTIONS_JÁ_GERADAS" in captured_user_texts[1]
    assert "Primeira observação calma." in captured_user_texts[1]
    # 3ª chamada: vê as duas anteriores
    assert "CAPTIONS_JÁ_GERADAS" in captured_user_texts[2]
    assert "Primeira observação calma." in captured_user_texts[2]
    assert "Segundo ângulo, gente molhada." in captured_user_texts[2]


def test_batch_skips_items_without_path(tmp_path):
    client = MagicMock()
    results = sc.generate_smart_captions_batch(
        [{"foo": "bar"}, {"path": ""}],
        client=client,
        sleep_fn=lambda _s: None,
    )
    assert results == {}
    assert not client.messages.create.called


def test_batch_rejects_invalid_rpm():
    with pytest.raises(ValueError):
        sc.generate_smart_captions_batch(
            [], client=MagicMock(), requests_per_minute=0,
            sleep_fn=lambda _s: None,
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. Integração com ingest_takeout (via _apply_smart_captions e serialize_cluster
#    — não usa pipeline real de scan, que precisaria de EXIF/Pillow.)
# ─────────────────────────────────────────────────────────────────────────────

def _make_synthetic_cluster(items_data: list[tuple[str, str]]):
    """Constrói um Cluster sintético com items dummy para testar smart-captions
    isoladamente. Cada tupla é (path, timestamp_iso)."""
    from ingest_takeout import Cluster, MediaItem
    from datetime import datetime, timezone

    media = [
        MediaItem(
            path=p, type="image",
            timestamp=datetime.strptime(ts, "%Y-%m-%d")
                .replace(tzinfo=timezone.utc).timestamp(),
            lat=-25.69, lon=-54.43, source="exif",
        )
        for p, ts in items_data
    ]
    cl = Cluster(id="cluster-0", items=media)
    cl.action = "merge"
    cl.merge_with = "iguacu-2021"
    cl.suggested_trip_id = "iguacu-2021"
    cl.place = "Foz do Iguaçu"
    cl.country = "Brasil"
    cl.start_date = items_data[0][1]
    cl.end_date = items_data[-1][1]
    cl.center_lat = -25.69
    cl.center_lon = -54.43
    cl.photos = len(items_data)
    cl.videos = 0
    return cl


def test_serialize_cluster_default_has_null_smart_source(tmp_path):
    """Sem smart_sources, items vêm com caption_smart_source: None."""
    from ingest_takeout import serialize_cluster

    cl = _make_synthetic_cluster([("a.webp", "2021-06-12")])
    captions = {"a.webp": "Foz do Iguaçu · 12 jun 2021"}
    payload = serialize_cluster(cl, captions=captions)
    item = payload["items"][0]
    assert item["caption"] == "Foz do Iguaçu · 12 jun 2021"
    assert item["caption_auto"] is True
    assert item["caption_smart_source"] is None


def test_apply_smart_captions_populates_source_per_item():
    """Com client mockado, _apply_smart_captions preenche smart_sources."""
    from ingest_takeout import _apply_smart_captions

    cl = _make_synthetic_cluster([
        ("a.webp", "2021-06-12"),
        ("b.webp", "2021-06-13"),
    ])
    factual = {cl.id: {"a.webp": "Foz · 12 jun", "b.webp": "Foz · 13 jun"}}
    smart_sources: dict[str, dict[str, str | None]] = {}

    # Mocka generate_smart_caption no módulo smart_captions para evitar
    # ler image em disco (path é fake). Retorna strings emocionais.
    with patch.object(sc, "generate_smart_caption") as mock_gen:
        mock_gen.side_effect = [
            "Trovão azul no horizonte.",
            "Spray gelado e gente pequena.",
        ]
        _apply_smart_captions(
            [cl], trips=[{"id": "iguacu-2021", "name": "Foz do Iguaçu",
                          "country": "Brasil",
                          "highlights": ["Cataratas"],
                          "memory": "Família em peso."}],
            factual_captions=factual,
            smart_sources=smart_sources,
            model="claude-haiku-4-5",
            rpm=600,
            client=MagicMock(),
        )

    assert mock_gen.call_count == 2
    assert factual[cl.id]["a.webp"] == "Trovão azul no horizonte."
    assert factual[cl.id]["b.webp"] == "Spray gelado e gente pequena."
    assert smart_sources[cl.id]["a.webp"] == "claude-haiku-4-5"
    assert smart_sources[cl.id]["b.webp"] == "claude-haiku-4-5"


def test_apply_smart_captions_fallback_when_api_fails():
    """Quando a chamada do modelo falha, mantém caption factual e source=None."""
    from ingest_takeout import _apply_smart_captions

    cl = _make_synthetic_cluster([("a.webp", "2021-06-12"), ("b.webp", "2021-06-13")])
    factual = {cl.id: {"a.webp": "Foz · 12 jun", "b.webp": "Foz · 13 jun"}}
    smart_sources: dict[str, dict[str, str | None]] = {}

    with patch.object(sc, "generate_smart_caption") as mock_gen:
        # 1ª sucesso, 2ª falha
        mock_gen.side_effect = [
            "Trovão azul no horizonte.",
            sc.SmartCaptionsAPIError("rate limit"),
        ]
        _apply_smart_captions(
            [cl], trips=[],
            factual_captions=factual,
            smart_sources=smart_sources,
            model="claude-haiku-4-5",
            rpm=600,
            client=MagicMock(),
        )

    assert factual[cl.id]["a.webp"] == "Trovão azul no horizonte."
    assert factual[cl.id]["b.webp"] == "Foz · 13 jun"  # ← fallback factual
    assert smart_sources[cl.id]["a.webp"] == "claude-haiku-4-5"
    assert smart_sources[cl.id]["b.webp"] is None  # ← marcador de fallback


def test_apply_smart_captions_skips_when_manual_caption_exists():
    """Caption já presente em trip.media.gallery sem caption_auto=True é
    manual: smart pula a foto, preserva a caption, marca preserved_manual."""
    from ingest_takeout import _apply_smart_captions

    cl = _make_synthetic_cluster([
        ("input/iguacu-2021/01.webp", "2021-06-12"),  # tem caption manual
        ("input/iguacu-2021/02.webp", "2021-06-13"),  # sem caption manual
    ])
    factual = {cl.id: {
        "input/iguacu-2021/01.webp": "Foz · 12 jun",
        "input/iguacu-2021/02.webp": "Foz · 13 jun",
    }}
    smart_sources: dict[str, dict[str, str | None]] = {}
    preserved: dict[str, dict[str, bool]] = {}

    trips = [{
        "id": "iguacu-2021",
        "name": "Foz do Iguaçu",
        "media": {
            "gallery": [
                # 01.webp: caption manual (sem caption_auto)
                {"src": "media/iguacu-2021/01.webp",
                 "caption": "Pose espontânea no mirante das quedas"},
                # 02.webp existe na gallery mas sem caption → não bloqueia
                {"src": "media/iguacu-2021/02.webp", "caption": None},
            ],
        },
    }]

    with patch.object(sc, "generate_smart_caption") as mock_gen:
        mock_gen.side_effect = ["Spray gelado e gente pequena."]
        _apply_smart_captions(
            [cl], trips=trips,
            factual_captions=factual,
            smart_sources=smart_sources,
            preserved_manual=preserved,
            model="claude-haiku-4-5",
            rpm=600,
            client=MagicMock(),
        )

    # 01.webp: caption manual preservada, API não foi chamada para ela
    assert factual[cl.id]["input/iguacu-2021/01.webp"] == \
        "Pose espontânea no mirante das quedas"
    assert smart_sources[cl.id]["input/iguacu-2021/01.webp"] is None
    assert preserved[cl.id]["input/iguacu-2021/01.webp"] is True

    # 02.webp: smart rodou normal
    assert factual[cl.id]["input/iguacu-2021/02.webp"] == "Spray gelado e gente pequena."
    assert smart_sources[cl.id]["input/iguacu-2021/02.webp"] == "claude-haiku-4-5"
    assert preserved[cl.id]["input/iguacu-2021/02.webp"] is False

    # API chamada apenas uma vez (não para 01)
    assert mock_gen.call_count == 1


def test_apply_smart_captions_overwrites_when_caption_auto_is_true():
    """Caption gerada automaticamente (caption_auto=True) NÃO é manual e
    pode ser sobrescrita pelo smart na próxima rodada."""
    from ingest_takeout import _apply_smart_captions

    cl = _make_synthetic_cluster([("input/iguacu-2021/01.webp", "2021-06-12")])
    factual = {cl.id: {"input/iguacu-2021/01.webp": "Foz · 12 jun"}}
    smart_sources: dict[str, dict[str, str | None]] = {}
    preserved: dict[str, dict[str, bool]] = {}

    trips = [{
        "id": "iguacu-2021",
        "name": "Foz do Iguaçu",
        "media": {
            "gallery": [
                # Caption gerada anteriormente pelo pipeline (caption_auto=True)
                {"src": "media/iguacu-2021/01.webp",
                 "caption": "Foz do Iguaçu · 12 jun 2021",
                 "caption_auto": True},
            ],
        },
    }]

    with patch.object(sc, "generate_smart_caption") as mock_gen:
        mock_gen.side_effect = ["Trovão azul no horizonte."]
        _apply_smart_captions(
            [cl], trips=trips,
            factual_captions=factual,
            smart_sources=smart_sources,
            preserved_manual=preserved,
            model="claude-haiku-4-5",
            rpm=600,
            client=MagicMock(),
        )

    # Sobrescrita: smart rodou e bateu por cima da caption_auto anterior
    assert factual[cl.id]["input/iguacu-2021/01.webp"] == "Trovão azul no horizonte."
    assert smart_sources[cl.id]["input/iguacu-2021/01.webp"] == "claude-haiku-4-5"
    assert preserved[cl.id]["input/iguacu-2021/01.webp"] is False
    assert mock_gen.call_count == 1


def test_apply_smart_captions_skips_orphan_cluster():
    """Cluster com action='orphan' nem entra no loop de smart-captions."""
    from ingest_takeout import _apply_smart_captions

    cl = _make_synthetic_cluster([("a.webp", "2021-06-12")])
    cl.action = "orphan"
    cl.merge_with = None
    factual: dict[str, dict[str, str]] = {}
    smart_sources: dict[str, dict[str, str | None]] = {}

    with patch.object(sc, "generate_smart_caption") as mock_gen:
        _apply_smart_captions(
            [cl], trips=[],
            factual_captions=factual,
            smart_sources=smart_sources,
            model="claude-haiku-4-5",
            rpm=600,
            client=MagicMock(),
        )

    assert mock_gen.call_count == 0
    assert smart_sources == {}
