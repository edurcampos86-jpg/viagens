#!/usr/bin/env python3
"""Ingestão desktop de reservas (voos/hospedagens/experiências) → trips.json.

Segunda metade da skill `voos-gmail`: o Claude lê os e-mails de confirmação no
Gmail, extrai os campos canônicos e monta um payload JSON JÁ SEM PII; este
script funde esse payload em `data/trips.json` de forma determinística, com
duas redes de segurança automáticas que codificam as lições da Frente
Bookings Vivos:

  1. GUARD DE PII (repo público, ADR-001): aborta se o payload contiver
     localizador/PNR, nº de bilhete, cartão, CVV ou qualquer corrida de 13+
     dígitos (itinerário). `localizador` é sempre forçado a null.
  2. GUARD DE CHAVE DE ORÇAMENTO: os widgets leem `budget.planned` pelas
     chaves v2 (flights/stays/experiences/food/other). Um número sob a chave
     legada (voos/hospedagem/…) seria IGNORADO pela UI — o bug do PR #101.
     O script aborta e aponta a chave v2 correta; objetos de detalhe
     (voos/hospedagem) são aceitos como metadado.

Princípios herdados de ingest_picker_json.py:
  - nunca cria viagem: tripId inexistente → aborta;
  - idempotente: rodar o mesmo payload de novo cai todo em dupes (dedup por
    id de booking);
  - preserva a formatação canônica do arquivo (writer byte-fiel: indent=2 com
    arrays `pax` inline) — diff mínimo, só a viagem alvo muda;
  - NÃO commita (quem commita é a skill) e NÃO toca no service worker
    (data/ é NetworkFirst — nada precacheado muda).

Formato do payload (todos os campos de booking conforme $defs/booking):
    {
      "tripId": "marrocos-2027",
      "flights":     [ { "titulo": "...", "status": "confirmado", ... }, ... ],
      "stays":       [ ... ],
      "experiences": [ ... ],
      "budget": {                     # opcional
        "stays": 6876.46,             # NÚMERO na chave v2 (widget lê)
        "hospedagem": { "BRL": 6876.46, "nota": "..." }   # objeto de detalhe
      },
      "tips": "..."                   # opcional — substitui logistics.tips
    }

Uso:
    python3 scripts/ingest_bookings_json.py <bookings.json>
    cat bookings.json | python3 scripts/ingest_bookings_json.py -
"""
import json
import re
import sys
from datetime import datetime, timezone

TRIPS_PATH = "data/trips.json"

CATS = ("flights", "stays", "experiences")
CAT_CODE = {"flights": "fl", "stays": "st", "experiences": "ex"}

# Chaves v2 que os widgets de orçamento leem como número
# (src/components/budget.js CATEGORIES + src/core/plan-budget.js PLAN_BUDGET_CATS).
BUDGET_V2_KEYS = {"flights", "stays", "experiences", "food", "other"}
# Aliases legados → chave v2 correta (para a mensagem de erro do guard).
BUDGET_LEGACY_TO_V2 = {
    "voos": "flights",
    "hospedagem": "stays",
    "passeios": "experiences",
    "comida": "food",
    "outros": "other",
}

# PII proibida em repo público (ADR-001). `milhas_tap` é permitido (placeholder
# null no objeto de detalhe do orçamento), por isso "milhas" NÃO entra aqui.
_FORBIDDEN_KEY = re.compile(
    r"(?i)(bilhete|e[_-]?ticket|\bticket\b|cvv|cvc|cart[aã]o|\bcard\b|frequent|ff[_-]?num)"
)
_DIGITS_13 = re.compile(r"\d{13,}")
_CARD = re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,4}\b")
# Separador entre dígitos (espaço/ponto/hífen). Normalizar antes de procurar
# corridas de 13+ dígitos pega cartão em QUALQUER agrupamento (Amex 4-6-5,
# pontos "4111.1111....") e itinerários quebrados — achado da revisão
# adversarial da F3 (dois formatos passavam pelo _CARD canônico 4-4-4-4).
_SEP_DIGITS = re.compile(r"(?<=\d)[ .\-](?=\d)")


def _digit_normalize(s):
    return _SEP_DIGITS.sub("", s)
# PNR/localizador curto (ex.: UJWZTO) solto em texto livre, junto de uma
# palavra-gatilho ESPECÍFICA (evita falso-positivo com código de voo tipo
# TP644: "voo"/"reserva" não são gatilho; só localizador/bilhete/ticket/código).
# Token em maiúsculas/dígitos (case-sensitive) p/ não pegar palavras minúsculas.
_PNR_NEAR = re.compile(
    r"(?:[Ll]ocalizador|PNR|[Bb]ilhete|[Ee]-?[Tt]icket|[Tt]icket|[Cc][oó]digo)"
    r"[\s:#nNº°.\-]*([A-Z0-9]{5,8})\b"
)

_STR = r'"(?:[^"\\]|\\.)*"'
_PAX = re.compile(r'"pax":\s*\[\s*(' + _STR + r"(?:\s*,\s*" + _STR + r")*)\s*\]")


def fail(msg):
    print(f"ABORTADO: {msg}", file=sys.stderr)
    sys.exit(1)


def collapse_pax(text):
    """Re-inline `pax` (writer byte-fiel ao estilo hand-authored do arquivo)."""
    def repl(m):
        return '"pax": [' + ", ".join(re.findall(_STR, m.group(1))) + "]"
    return _PAX.sub(repl, text)


def scan_pii(obj, path="payload"):
    """Varre recursivamente por PII proibida. Retorna lista de violações."""
    hits = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if _FORBIDDEN_KEY.search(str(k)):
                hits.append(f"{path}.{k}: chave proibida (identificador de reserva/pagamento)")
            if k == "localizador" and v not in (None, ""):
                hits.append(f"{path}.localizador='{v}': PNR/localizador não pode entrar (use null)")
            hits += scan_pii(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, x in enumerate(obj):
            hits += scan_pii(x, f"{path}[{i}]")
    elif isinstance(obj, str):
        if _DIGITS_13.search(obj) or _DIGITS_13.search(_digit_normalize(obj)):
            hits.append(f"{path}: corrida de 13+ dígitos, contígua ou agrupada (itinerário/bilhete/cartão?) em {obj!r}")
        elif _CARD.search(obj):
            hits.append(f"{path}: padrão de cartão em {obj!r}")
        m = _PNR_NEAR.search(obj)
        if m:
            hits.append(f"{path}: PNR/localizador '{m.group(1)}' junto de palavra-gatilho em {obj!r}")
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        # PII numérica como número JSON (nº de bilhete/documento/itinerário
        # passado como int) — achado da revisão adversarial da F3: o scan só
        # varria strings, então 4726451234567 (int) era gravado sem alarme.
        if len(re.sub(r"\D", "", repr(obj))) >= 13:
            hits.append(f"{path}: número com 13+ dígitos ({obj!r}) — itinerário/bilhete/documento não pode entrar")
    return hits


def next_id(trip_id, cat, existing_ids):
    code = CAT_CODE[cat]
    n = 0
    for bid in existing_ids:
        m = re.match(rf"^{re.escape(trip_id)}-{code}-(\d+)$", str(bid))
        if m:
            n = max(n, int(m.group(1)))
    return f"{trip_id}-{code}-{n + 1:03d}"


def booking_sig(b):
    """Assinatura de conteúdo p/ dedup de bookings sem id (idempotência)."""
    return (b.get("titulo"), b.get("data") or b.get("check_in"))


def merge_category(trip, cat, incoming, trip_id):
    """Funde bookings novos em bookings[cat]. Dedup por id (quando há) ou por
    assinatura de conteúdo (titulo+data) quando o booking não traz id — assim
    reexecutar o mesmo payload é idempotente mesmo sem ids estáveis.
    Retorna (added, dupes)."""
    bookings = trip.setdefault("bookings", {"flights": [], "stays": [], "experiences": []})
    arr = bookings.setdefault(cat, [])
    existing_ids = {b.get("id") for b in arr if b.get("id")}
    existing_sigs = {booking_sig(b) for b in arr}
    added, dupes = [], []
    for b in incoming:
        b = dict(b)
        b["localizador"] = None  # defesa em profundidade: nunca grava localizador
        bid = b.get("id")
        if bid and bid in existing_ids:
            dupes.append(bid)
            continue
        if not bid and booking_sig(b) in existing_sigs:
            dupes.append(booking_sig(b))
            continue
        if not bid:
            bid = next_id(trip_id, cat, existing_ids)
            b["id"] = bid
        arr.append(b)
        existing_ids.add(bid)
        existing_sigs.add(booking_sig(b))
        added.append(b)
    return added, dupes


def apply_budget(trip, budget):
    """Aplica budget.planned com o guard de chave v2. Retorna lista de warnings."""
    warnings = []
    planned = trip.setdefault("budget", {"planned": {}, "actual": {}, "currency": "BRL"}).setdefault("planned", {})
    for k, v in budget.items():
        if isinstance(v, bool):
            fail(f"budget.{k}: booleano inesperado")
        if isinstance(v, (int, float)):
            if k not in BUDGET_V2_KEYS:
                hint = BUDGET_LEGACY_TO_V2.get(k)
                extra = f" — use a chave v2 '{hint}' (é a que os widgets leem como número)" if hint else ""
                fail(f"budget.{k}={v}: número em chave não-lida pela UI{extra}. "
                     f"Chaves v2 numéricas: {sorted(BUDGET_V2_KEYS)}. "
                     f"Objetos de detalhe (voos/hospedagem) são ok.")
            planned[k] = v
        elif isinstance(v, dict):
            planned[k] = v  # objeto de detalhe (voos/hospedagem) — metadado
        else:
            fail(f"budget.{k}: tipo inesperado {type(v).__name__}")
    # Sanidade não-fatal: número v2 deve bater com a soma dos valores dos bookings.
    for cat in CATS:
        if cat in budget and isinstance(budget[cat], (int, float)):
            s = sum(b.get("valor") for b in trip.get("bookings", {}).get(cat, [])
                    if isinstance(b.get("valor"), (int, float)) and (b.get("moeda") or "BRL") == "BRL")
            if s and abs(s - budget[cat]) > 0.01:
                warnings.append(f"budget.{cat}={budget[cat]} difere da soma dos valores dos bookings ({round(s, 2)}) — confirme se é intencional (planejado ≠ realizado?).")
    return warnings


def main(argv):
    if len(argv) != 1:
        fail("uso: ingest_bookings_json.py <bookings.json | ->")
    raw_in = sys.stdin.read() if argv[0] == "-" else open(argv[0], encoding="utf-8").read()
    try:
        payload = json.loads(raw_in)
    except Exception as e:
        fail(f"JSON do payload inválido — {e}")

    trip_id = payload.get("tripId")
    if not trip_id:
        fail("payload sem tripId.")
    if not any(payload.get(c) for c in CATS) and "budget" not in payload and "tips" not in payload:
        fail("payload sem flights/stays/experiences/budget/tips — nada a fazer.")

    # GUARD DE PII — antes de qualquer escrita.
    violations = scan_pii({c: payload.get(c) for c in CATS} | {"tips": payload.get("tips"), "budget": payload.get("budget")})
    if violations:
        print("ABORTADO: PII detectada no payload (repo público — ADR-001):", file=sys.stderr)
        for v in violations:
            print(f"  - {v}", file=sys.stderr)
        sys.exit(1)

    original_raw = open(TRIPS_PATH, encoding="utf-8").read()
    doc = json.loads(original_raw)
    if not isinstance(doc, dict) or not doc.get("config") or not isinstance(doc.get("trips"), list):
        fail("trips.json fora do contrato {config, trips[]} — parse-gate.")
    trip = next((t for t in doc["trips"] if t.get("id") == trip_id), None)
    if trip is None:
        fail(f"viagem '{trip_id}' não existe em trips.json — NÃO crio viagem nova.")

    total_added, all_dupes = {}, {}
    for cat in CATS:
        incoming = payload.get(cat) or []
        if not isinstance(incoming, list):
            fail(f"payload.{cat} não é lista.")
        added, dupes = merge_category(trip, cat, incoming, trip_id)
        total_added[cat] = added
        all_dupes[cat] = dupes

    warnings = []
    if isinstance(payload.get("budget"), dict):
        warnings += apply_budget(trip, payload["budget"])
    if "tips" in payload:
        trip.setdefault("logistics", {})["tips"] = payload["tips"]

    n_added = sum(len(v) for v in total_added.values())
    n_dupes = sum(len(v) for v in all_dupes.values())

    # No-op por conteúdo: serializa ANTES de bumpar o timestamp; se ficou
    # byte-idêntico ao arquivo, nada mudou de fato → não escreve (idempotência
    # real, sem churn de updated_at ao reprocessar o mesmo payload).
    body_no_ts = collapse_pax(json.dumps(doc, ensure_ascii=False, indent=2)) + "\n"
    if body_no_ts == original_raw:
        print(f"Nada novo em '{trip_id}': payload já aplicado ({n_dupes} dupes). trips.json intacto.")
        return

    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    trip["updated_at"] = now
    doc["atualizado_em"] = now

    out = collapse_pax(json.dumps(doc, ensure_ascii=False, indent=2)) + "\n"
    with open(TRIPS_PATH, "w", encoding="utf-8") as f:
        f.write(out)

    print(f"OK: '{trip_id}' — +{n_added} bookings (dupes {n_dupes}).")
    for cat in CATS:
        for b in total_added[cat]:
            valor = f" R${b['valor']}" if isinstance(b.get("valor"), (int, float)) else ""
            print(f"  +{cat[:-1]}: {b.get('id')} — {b.get('titulo')}{valor}")
    if isinstance(payload.get("budget"), dict):
        print(f"  budget.planned: {json.dumps(trip['budget']['planned'], ensure_ascii=False)}")
    for w in warnings:
        print(f"  AVISO: {w}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1:])
