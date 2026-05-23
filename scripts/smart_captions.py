"""
smart_captions.py — geração opcional de legendas emocionais via Anthropic API.

Modo opt-in do pipeline de ingestão. Quando ativado (`--smart-captions` em
`ingest_takeout.py`), substitui as captions factuais ("Cidade · DD MMM YYYY")
por legendas curtas e emocionais geradas pela vision do modelo Claude
escolhido (default `claude-haiku-4-5`).

Princípios:

- **Opt-in.** A flag default é `False`. O pipeline padrão continua factual.
- **Fallback gracioso.** Se a API falhar (rede, rate limit, JSON inválido),
  cai na caption factual já calculada — nunca quebra a ingestão.
- **API key da env.** Lê `ANTHROPIC_API_KEY`. Se ausente, levanta
  `SmartCaptionsConfigError` antes de tentar qualquer chamada.
- **Custo previsível.** `estimate_cost(n_items)` devolve o custo aproximado
  em USD para que o usuário veja antes de ativar.
- **Sem chamadas reais nos testes.** O cliente é injetado em `caption_for_item`
  para permitir mock total via `unittest.mock`.

Modelo default: `claude-haiku-4-5` (mais barato e suficiente para legendas
curtas; tier 1 ~50 RPM em maio/2026).
"""

from __future__ import annotations

import base64
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

logger = logging.getLogger(__name__)

# Modelo default — claude-haiku-4-5 (vision-capable, mais barato).
DEFAULT_MODEL = "claude-haiku-4-5"

# Custo aproximado por item (USD).
# Base: Haiku 4.5, ~700 input tokens (incluindo vision) + ~30 output tokens.
# Valor conservador para a estimativa de cliente.
COST_PER_ITEM_USD = 0.0008

# Rate-limit defensivo (tier 1 = ~50 RPM em maio/2026).
DEFAULT_REQUESTS_PER_MINUTE = 45

SYSTEM_PROMPT = """Você é um curador de memórias de viagem para um diário pessoal em português brasileiro.

Para cada foto, escreve uma legenda curta (8-15 palavras) que:

REGRAS OBRIGATÓRIAS:
1. SEMPRE em português brasileiro coloquial e natural. Evita anglicismos como "roar" (use "rugido"), "vibe" (use "energia"/"clima"), "wow" (use "impressionante"). Se uma palavra inglesa não tem tradução natural, prefira reformular.

2. SEMPRE inclui pelo menos UM detalhe visual ÚNICO desta foto específica — algo que a diferencia de outras fotos do mesmo lugar. Exemplos: cor de roupa marcante, elemento meteorológico (arco-íris, neblina, sol), gesto/expressão das pessoas, ângulo incomum. Se a foto não tem detalhe único, descreva a composição visual exata.

3. EVITA repetir vocabulário entre legendas do mesmo álbum. Quando receber [CAPTIONS_JÁ_GERADAS], use vocabulário e estrutura diferente das já existentes.

4. EVITA clichês motivacionais: "força bruta da natureza", "conquistando o mundo", "vivendo o momento", "fazendo história", "criando memórias". São proibidos.

5. EVITA tom de marketing/turismo: "imperdível", "deslumbrante", "espetacular". Prefere observação concreta.

ESTILO:
- Tom: contemplativo, observador, íntimo. Como anotação de diário, não legenda de Instagram.
- Pessoa: sempre 3ª pessoa ou impessoal. Nunca "eu", "nós", "você".
- Pontuação: pode usar travessões e ponto-final. Evita pontos de exclamação.
- Comprimento: 8-15 palavras. Conta antes de responder.

EXEMPLOS DO ESTILO DESEJADO:
- "Arco-íris esticado sobre as quedas, ninguém olha pra outro lugar" (detalhe único + observação humana)
- "Casaco amarelo no calçadão, três horas para chegar nesse ponto" (cor específica + contexto)
- "Mãos no parapeito molhado, ouvido perdendo a noção de silêncio" (detalhe sensorial)

CONTEXTO DA VIAGEM (use para enriquecer, NUNCA copie literal):
- name, country, highlights, memory passados como TripContext

Retorne APENAS a legenda, sem aspas, sem prefixo, sem explicação."""


class SmartCaptionsConfigError(RuntimeError):
    """Erro de configuração (API key faltando, modelo inválido, etc)."""


class SmartCaptionsAPIError(RuntimeError):
    """Erro na chamada à API que NÃO deve abortar a ingestão (será logado e
    o fallback factual usado)."""


@dataclass
class TripContext:
    """Contexto da viagem alimentado ao modelo para enriquecer a legenda."""

    name: str
    country: str | None = None
    highlights: list[str] = field(default_factory=list)
    memory: str | None = None

    def as_prompt_block(self) -> str:
        parts = [f"Viagem: {self.name}"]
        if self.country:
            parts.append(f"País: {self.country}")
        if self.highlights:
            parts.append("Destaques: " + ", ".join(self.highlights[:5]))
        if self.memory:
            # Trunca memória para não inflar o prompt — só os primeiros 280
            # caracteres bastam para dar tom.
            mem = self.memory.strip().replace("\n", " ")
            if len(mem) > 280:
                mem = mem[:277] + "..."
            parts.append(f"Memória registrada: {mem}")
        return "\n".join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Configuração / cliente
# ─────────────────────────────────────────────────────────────────────────────

def get_api_key() -> str:
    """Lê ANTHROPIC_API_KEY da env. Levanta SmartCaptionsConfigError se ausente."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise SmartCaptionsConfigError(
            "ANTHROPIC_API_KEY não está configurada. Defina a variável de "
            "ambiente antes de usar --smart-captions. Veja "
            "docs/LEGENDAS-INTELIGENTES.md para instruções."
        )
    return key


def build_client(api_key: str | None = None) -> Any:
    """Constrói cliente anthropic.Anthropic com a key. Falha cedo se SDK ausente."""
    try:
        import anthropic  # noqa: WPS433 — import preguiçoso
    except ImportError as exc:
        raise SmartCaptionsConfigError(
            "Pacote `anthropic` não instalado. Rode "
            "`pip install -r scripts/requirements-curator.txt`."
        ) from exc
    return anthropic.Anthropic(api_key=api_key or get_api_key())


# ─────────────────────────────────────────────────────────────────────────────
# Estimativa de custo
# ─────────────────────────────────────────────────────────────────────────────

def estimate_cost(n_items: int, cost_per_item: float = COST_PER_ITEM_USD) -> float:
    """Devolve custo aproximado em USD para `n_items` legendas."""
    if n_items < 0:
        raise ValueError("n_items não pode ser negativo")
    return round(n_items * cost_per_item, 4)


def format_cost_report(n_items: int, model: str = DEFAULT_MODEL) -> str:
    """Mensagem amigável para imprimir antes de rodar (--estimate-cost)."""
    cost = estimate_cost(n_items)
    return (
        f"Estimativa de custo (--smart-captions, modelo {model}):\n"
        f"  {n_items} foto(s) × ~${COST_PER_ITEM_USD:.4f} = ~${cost:.4f} USD\n"
        f"  (cálculo conservador; não chama a API)"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Geração de uma única legenda
# ─────────────────────────────────────────────────────────────────────────────

# Tipos auxiliares; o cliente Anthropic é Any (duck-typed).
_ClientLike = Any
_GeocodeLike = Callable[[float, float], Mapping[str, Any]]


def _read_image_b64(path: Path) -> tuple[str, str]:
    """Devolve (mime_type, base64_data) para uma imagem em disco."""
    suffix = path.suffix.lower()
    mime = {
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
    }.get(suffix, "image/webp")
    data = path.read_bytes()
    return mime, base64.standard_b64encode(data).decode("ascii")


def _build_user_prompt(
    trip_context: TripContext | None,
    exif_data: Mapping[str, Any] | None,
    factual_caption: str | None,
    previous_captions: list[str] | None = None,
) -> str:
    """Monta a parte textual do prompt do usuário."""
    parts: list[str] = []
    if trip_context:
        parts.append(trip_context.as_prompt_block())
    if exif_data:
        date = exif_data.get("date") or exif_data.get("timestamp")
        place = exif_data.get("place")
        if date:
            parts.append(f"Data da foto: {date}")
        if place:
            parts.append(f"Local da foto: {place}")
    if factual_caption:
        parts.append(f"Caption factual atual: {factual_caption}")
    if previous_captions:
        lines = ["[CAPTIONS_JÁ_GERADAS_NESTE_ÁLBUM (evite repetir vocabulário):"]
        for i, cap in enumerate(previous_captions, 1):
            lines.append(f"  {i}. {cap}")
        lines.append("]")
        parts.append("\n".join(lines))
    parts.append(
        "Olhando a foto + esse contexto, escreve UMA legenda emocional "
        "(8-15 palavras) em português brasileiro. Só a legenda, sem aspas, "
        "sem prefixo, sem ponto final desnecessário."
    )
    return "\n\n".join(parts)


def generate_smart_caption(
    image_path: str | Path,
    *,
    trip_context: TripContext | None = None,
    exif_data: Mapping[str, Any] | None = None,
    factual_caption: str | None = None,
    previous_captions: list[str] | None = None,
    client: _ClientLike | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 64,
) -> str:
    """
    Gera uma legenda emocional para `image_path` usando vision do Claude.

    Em sucesso, devolve a string limpa (sem aspas/prefixos).

    Em erro de API (rede, rate limit, resposta mal-formada), levanta
    `SmartCaptionsAPIError` para o caller decidir fallback. NÃO levanta
    `SmartCaptionsConfigError` aqui — chame `get_api_key()` antes se quiser
    pré-validar.
    """
    path = Path(image_path)
    if not path.exists():
        raise SmartCaptionsAPIError(f"imagem não encontrada: {path}")
    if client is None:
        client = build_client()

    mime, b64 = _read_image_b64(path)
    user_text = _build_user_prompt(trip_context, exif_data, factual_caption, previous_captions)

    try:
        message = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )
    except Exception as exc:  # noqa: BLE001 — qualquer falha vira API error
        raise SmartCaptionsAPIError(f"falha na chamada Anthropic: {exc}") from exc

    # Extrai o texto. SDK retorna message.content como lista de blocks.
    text = _extract_text(message)
    if not text:
        raise SmartCaptionsAPIError("resposta vazia do modelo")
    return _clean_caption(text)


def _extract_text(message: Any) -> str:
    """Compatível com o formato message.content = [TextBlock(...), ...]."""
    content = getattr(message, "content", None)
    if content is None:
        return ""
    chunks: list[str] = []
    for block in content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            chunks.append(text)
        elif isinstance(block, dict) and isinstance(block.get("text"), str):
            chunks.append(block["text"])
    return " ".join(chunks).strip()


def _clean_caption(text: str) -> str:
    """Remove aspas/prefixos/marcas que o modelo às vezes adiciona."""
    t = text.strip()
    # Remove aspas envolventes
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("“") and t.endswith("”")):
        t = t[1:-1].strip()
    # Modelo às vezes coloca "Legenda:" como prefixo
    for prefix in ("Legenda:", "legenda:", "Caption:", "caption:"):
        if t.lower().startswith(prefix.lower()):
            t = t[len(prefix):].strip()
    # Sem quebras internas
    return " ".join(t.split())


# ─────────────────────────────────────────────────────────────────────────────
# Geração em lote (com rate-limit + fallback)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SmartCaptionResult:
    """Resultado por item — usado para popular caption + caption_smart_source."""

    caption: str
    source_model: str | None  # None quando caiu em fallback factual
    error: str | None = None  # mensagem do erro original, para log


def generate_smart_captions_batch(
    items: Iterable[Mapping[str, Any]],
    *,
    trip_context: TripContext | None = None,
    fallback_captions: Mapping[str, str] | None = None,
    client: _ClientLike | None = None,
    model: str = DEFAULT_MODEL,
    requests_per_minute: int = DEFAULT_REQUESTS_PER_MINUTE,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, SmartCaptionResult]:
    """
    Aplica `generate_smart_caption` a uma lista de itens.

    Cada item deve ser um mapping com pelo menos `path` (str). Pode ter
    `exif` (mapping) com `date`/`place`.

    Fallback: se a chamada falhar para um item, usa `fallback_captions[path]`
    se existir; senão devolve string vazia (caller decide o que fazer).

    Rate limit: enforça `requests_per_minute` com `sleep_fn`. Injetável para
    permitir teste sem dormir de verdade.
    """
    fallback_captions = fallback_captions or {}
    out: dict[str, SmartCaptionResult] = {}

    if client is None:
        client = build_client()

    if requests_per_minute <= 0:
        raise ValueError("requests_per_minute precisa ser > 0")
    min_interval = 60.0 / requests_per_minute
    last_call_at: float | None = None
    generated_captions: list[str] = []

    for item in items:
        path = item.get("path")
        if not path:
            continue

        if last_call_at is not None:
            elapsed = time.monotonic() - last_call_at
            if elapsed < min_interval:
                sleep_fn(min_interval - elapsed)

        last_call_at = time.monotonic()
        try:
            caption = generate_smart_caption(
                path,
                trip_context=trip_context,
                exif_data=item.get("exif"),
                factual_caption=fallback_captions.get(path),
                previous_captions=list(generated_captions) if generated_captions else None,
                client=client,
                model=model,
            )
            out[path] = SmartCaptionResult(caption=caption, source_model=model)
            generated_captions.append(caption)
        except SmartCaptionsAPIError as exc:
            fallback = fallback_captions.get(path, "")
            logger.warning("smart caption falhou para %s: %s (fallback=%r)",
                           path, exc, fallback)
            out[path] = SmartCaptionResult(
                caption=fallback, source_model=None, error=str(exc),
            )

    return out
