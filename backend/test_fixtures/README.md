# Test fixtures — gmail-parser

E-mails de exemplo (anonimizados / sintéticos) usados para validar os parsers regex sem precisar de credenciais Gmail reais.

Cada arquivo tem o formato:

```
From: <sender>
Subject: <subject>

<corpo do e-mail em texto puro>
```

## Como rodar testes localmente

Com Deno instalado:

```bash
deno test --allow-read backend/functions/gmail-parser/
```

Sem Deno (validação leve via Python regex equivalente):

```bash
python3 scripts/test_email_parsers.py
```

## Cobertura atual

| Fixture | Sender | Tipo esperado | Confidence esperada |
|---|---|---|---|
| `tap_001.txt` | TAP | flight | ≥ 0.85 |
| `booking_001.txt` | Booking | stay | ≥ 0.85 |
| `airbnb_001.txt` | Airbnb | stay | ≥ 0.80 |

Para chegar à meta de ≥ 85% de extração correta em 20 e-mails de teste (critério F2.3), adicionar mais 17 fixtures cobrindo: LATAM, GOL, Decolar, Hotels.com, Ticketmaster, Eventim, Cvent, casos negativos (newsletter, marketing) e edge cases (e-mail apenas em inglês, preço em EUR sem BRL).
