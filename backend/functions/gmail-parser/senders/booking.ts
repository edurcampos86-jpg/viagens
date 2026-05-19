// Parser para e-mails da Booking.com.
// Senders: noreply@booking.com, customer.service@booking.com,
//          confirmation@booking.com.

import type { ParseResult } from '../types.ts';

const SENDERS = ['booking.com'];

export function matches(sender: string): boolean {
  return SENDERS.some((s) => sender.toLowerCase().includes(s));
}

const CHECKIN_RE = /Check[- ]?in[:\s]+(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i;
const CHECKOUT_RE = /Check[- ]?out[:\s]+(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i;
const CHECKIN_EN_RE = /Check[- ]?in[:\s]+(\d{4})-(\d{2})-(\d{2})/i;
const CHECKOUT_EN_RE = /Check[- ]?out[:\s]+(\d{4})-(\d{2})-(\d{2})/i;
const PRICE_RE = /(?:Pre[çc]o total|Total price|Total)[:\s]+R\$\s?([\d.,]+)/i;
const HOTEL_RE = /(?:Reserva confirmada|Booking confirmed)[\s\S]{0,200}?\n([^\n]{5,80})/;

const MES_PT: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03', abril: '04',
  maio: '05', junho: '06', julho: '07', agosto: '08',
  setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
};

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

function ptDate(d: string, m: string, y: string): string | null {
  const mm = MES_PT[m.toLowerCase()] || MES_PT[m.toLowerCase().replace('ç', 'c')];
  if (!mm) return null;
  return `${y}-${mm}-${d.padStart(2, '0')}`;
}

export function parse(body: string): ParseResult | null {
  let check_in: string | null = null;
  let check_out: string | null = null;

  const ciEn = body.match(CHECKIN_EN_RE);
  const coEn = body.match(CHECKOUT_EN_RE);
  if (ciEn) check_in = `${ciEn[1]}-${ciEn[2]}-${ciEn[3]}`;
  if (coEn) check_out = `${coEn[1]}-${coEn[2]}-${coEn[3]}`;
  if (!check_in) {
    const ci = body.match(CHECKIN_RE);
    if (ci) check_in = ptDate(ci[1], ci[2], ci[3]);
  }
  if (!check_out) {
    const co = body.match(CHECKOUT_RE);
    if (co) check_out = ptDate(co[1], co[2], co[3]);
  }

  let price_brl: number | null = null;
  const p = body.match(PRICE_RE);
  if (p) price_brl = parseNumber(p[1]);

  const hotel = body.match(HOTEL_RE)?.[1]?.trim() || null;

  if (!check_in && !check_out && !hotel) return null;

  return {
    event_type: 'stay',
    payload: {
      platform: 'booking',
      name: hotel,
      check_in,
      check_out,
      price_brl,
    },
    confidence: check_in && check_out && hotel ? 0.9 : check_in ? 0.6 : 0.4,
  };
}
