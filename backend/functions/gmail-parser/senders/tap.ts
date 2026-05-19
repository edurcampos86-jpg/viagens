// Parser para e-mails de confirmação da TAP Portugal.
// Senders: noreply@flytap.com, voos@flytap.com.
//
// Estratégia: regex sobre o corpo HTML→texto. Procura PNR (6 chars
// alfanuméricos), data ISO ou DD/MM/YYYY, valor em EUR/BRL, IATA codes.

import type { ParseResult } from '../types.ts';

const SENDERS = ['noreply@flytap.com', 'voos@flytap.com', 'confirmacao@flytap.com'];

export function matches(sender: string): boolean {
  const s = sender.toLowerCase();
  return SENDERS.some((known) => s.includes(known));
}

const PNR_RE = /\b(?:PNR|Localizador|Reservation Code)[:\s]+([A-Z0-9]{6})\b/i;
const FLIGHT_RE = /\bTP\s?(\d{2,4})\b/g;
const IATA_RE = /\b([A-Z]{3})\s*(?:→|->|-)\s*([A-Z]{3})\b/;
const PRICE_BRL_RE = /R\$\s?([\d.,]+)/;
const PRICE_EUR_RE = /€\s?([\d.,]+)/;
const DATE_ISO_RE = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
const DATE_BR_RE = /(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/;

function parseNumber(raw: string): number {
  // "4.890,00" → 4890.00 ; "4,890.00" → 4890.00
  const cleaned = raw.replace(/[^\d,.\-]/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // se ambos existem, separador decimal é o último que aparece
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      return Number(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    return Number(cleaned.replace(/,/g, ''));
  }
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    return Number(cleaned.replace(',', '.'));
  }
  return Number(cleaned);
}

export function parse(body: string): ParseResult | null {
  const pnr = body.match(PNR_RE)?.[1];
  const route = body.match(IATA_RE);
  const dateIso = body.match(DATE_ISO_RE);
  const dateBr = !dateIso ? body.match(DATE_BR_RE) : null;
  const flights = [...body.matchAll(FLIGHT_RE)].map((m) => `TP${m[1]}`);

  let departure: string | null = null;
  if (dateIso) {
    const [, y, m, d, h = '00', mi = '00'] = dateIso;
    departure = `${y}-${m}-${d}T${h}:${mi}:00`;
  } else if (dateBr) {
    const [, d, m, y, h = '00', mi = '00'] = dateBr;
    departure = `${y}-${m}-${d}T${h}:${mi}:00`;
  }

  let price_brl: number | null = null;
  const brlMatch = body.match(PRICE_BRL_RE);
  if (brlMatch) price_brl = parseNumber(brlMatch[1]);
  else {
    const eurMatch = body.match(PRICE_EUR_RE);
    if (eurMatch) {
      // Sem cotação online aqui — flag como EUR e o frontend converte.
      const v = parseNumber(eurMatch[1]);
      price_brl = null;
      if (v) return basePayload({ pnr, route, flights, departure, price_brl, price_eur: v });
    }
  }

  if (!route && !pnr && !flights.length) return null;
  return basePayload({ pnr, route, flights, departure, price_brl, price_eur: null });
}

function basePayload({
  pnr,
  route,
  flights,
  departure,
  price_brl,
  price_eur,
}: {
  pnr: string | undefined;
  route: RegExpMatchArray | null;
  flights: string[];
  departure: string | null;
  price_brl: number | null;
  price_eur: number | null;
}): ParseResult {
  return {
    event_type: 'flight',
    payload: {
      airline: 'TAP',
      pnr: pnr || null,
      flights,
      from: route?.[1] || null,
      to: route?.[2] || null,
      departure,
      arrival: null,
      price_brl,
      price_eur,
    },
    confidence: pnr && route && departure ? 0.92 : pnr || route ? 0.7 : 0.4,
  };
}
