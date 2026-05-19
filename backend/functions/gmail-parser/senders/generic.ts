// Parsers de senders adicionais.
// Cada um é mais simples (e menos confiável) do que TAP/Booking — captura
// só o suficiente para popular o evento pendente; o usuário refina ao aplicar.

import type { ParseResult, ParserModule } from '../types.ts';

function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d,.\-]/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    return lastComma > lastDot
      ? Number(cleaned.replace(/\./g, '').replace(',', '.'))
      : Number(cleaned.replace(/,/g, ''));
  }
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    return Number(cleaned.replace(',', '.'));
  }
  return Number(cleaned);
}

const PRICE_BRL = /R\$\s?([\d.,]+)/;

// ── LATAM ─────────────────────────────────────────────────────────────
export const latam: ParserModule = {
  matches: (s) => s.toLowerCase().includes('latam.com'),
  parse: (body): ParseResult | null => {
    const pnr = body.match(/(?:c[óo]digo de reserva|reservation code)[:\s]+([A-Z0-9]{6})/i)?.[1];
    const route = body.match(/\b([A-Z]{3})\s*(?:→|->|-)\s*([A-Z]{3})\b/);
    const price = body.match(PRICE_BRL)?.[1];
    if (!pnr && !route) return null;
    return {
      event_type: 'flight',
      payload: {
        airline: 'LATAM',
        pnr: pnr || null,
        from: route?.[1] || null,
        to: route?.[2] || null,
        price_brl: price ? parseNumber(price) : null,
        departure: null,
        arrival: null,
      },
      confidence: pnr && route ? 0.85 : 0.55,
    };
  },
};

// ── GOL ───────────────────────────────────────────────────────────────
export const gol: ParserModule = {
  matches: (s) => s.toLowerCase().includes('voegol.com.br') || s.toLowerCase().includes('@gol.'),
  parse: (body): ParseResult | null => {
    const pnr = body.match(/(?:c[óo]digo|localizador)[:\s]+([A-Z0-9]{6})/i)?.[1];
    const route = body.match(/\b([A-Z]{3})\s*(?:→|->|-)\s*([A-Z]{3})\b/);
    const price = body.match(PRICE_BRL)?.[1];
    if (!pnr && !route) return null;
    return {
      event_type: 'flight',
      payload: {
        airline: 'GOL',
        pnr: pnr || null,
        from: route?.[1] || null,
        to: route?.[2] || null,
        price_brl: price ? parseNumber(price) : null,
        departure: null,
        arrival: null,
      },
      confidence: pnr && route ? 0.85 : 0.55,
    };
  },
};

// ── Airbnb ────────────────────────────────────────────────────────────
export const airbnb: ParserModule = {
  matches: (s) => s.toLowerCase().includes('airbnb.com'),
  parse: (body): ParseResult | null => {
    const ci = body.match(/Check[- ]?in[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    const co = body.match(/Check[- ]?out[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    const price = body.match(PRICE_BRL)?.[1];
    if (!ci && !co) return null;
    return {
      event_type: 'stay',
      payload: {
        platform: 'airbnb',
        name: null,
        check_in: ci ? `${ci[1]}-${ci[2]}-${ci[3]}` : null,
        check_out: co ? `${co[1]}-${co[2]}-${co[3]}` : null,
        price_brl: price ? parseNumber(price) : null,
      },
      confidence: ci && co ? 0.85 : 0.5,
    };
  },
};

// ── Decolar ───────────────────────────────────────────────────────────
export const decolar: ParserModule = {
  matches: (s) => s.toLowerCase().includes('decolar.com'),
  parse: (body): ParseResult | null => {
    const pnr = body.match(/(?:n[úu]mero da reserva|c[óo]digo)[:\s]+([A-Z0-9]{6,10})/i)?.[1];
    const price = body.match(PRICE_BRL)?.[1];
    const isHotel = /hotel|hospedagem/i.test(body);
    const isFlight = /v[ôo]o|flight|aer[óo]reo/i.test(body);
    if (!pnr && !price) return null;
    return {
      event_type: isFlight ? 'flight' : isHotel ? 'stay' : 'unknown',
      payload: {
        platform: 'decolar',
        pnr: pnr || null,
        price_brl: price ? parseNumber(price) : null,
      },
      confidence: pnr && (isFlight || isHotel) ? 0.7 : 0.4,
    };
  },
};

// ── Hotels.com ────────────────────────────────────────────────────────
export const hotelsCom: ParserModule = {
  matches: (s) => s.toLowerCase().includes('hotels.com'),
  parse: (body): ParseResult | null => {
    const ci = body.match(/Check[- ]?in[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    const co = body.match(/Check[- ]?out[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    const price = body.match(PRICE_BRL)?.[1];
    if (!ci && !co) return null;
    return {
      event_type: 'stay',
      payload: {
        platform: 'hotels.com',
        check_in: ci ? `${ci[1]}-${ci[2]}-${ci[3]}` : null,
        check_out: co ? `${co[1]}-${co[2]}-${co[3]}` : null,
        price_brl: price ? parseNumber(price) : null,
      },
      confidence: ci && co ? 0.8 : 0.45,
    };
  },
};

// ── Ticketmaster / Eventim / Cvent (experiences) ──────────────────────
export const events: ParserModule = {
  matches: (s) =>
    ['ticketmaster.com', 'eventim.com', 'cvent.com'].some((d) =>
      s.toLowerCase().includes(d)
    ),
  parse: (body): ParseResult | null => {
    const price = body.match(PRICE_BRL)?.[1];
    const eventDate = body.match(/(?:event date|data do evento)[:\s]+(\d{4})-(\d{2})-(\d{2})/i);
    const name = body.match(/(?:event|evento)[:\s]+([^\n]{3,80})/i)?.[1]?.trim();
    if (!price && !eventDate && !name) return null;
    return {
      event_type: 'experience',
      payload: {
        name: name || null,
        date: eventDate ? `${eventDate[1]}-${eventDate[2]}-${eventDate[3]}` : null,
        price_brl: price ? parseNumber(price) : null,
      },
      confidence: name && eventDate ? 0.8 : 0.45,
    };
  },
};
