// Tipos compartilhados pelo parser e seus senders.

export type EventType = 'flight' | 'stay' | 'experience' | 'unknown';

export interface ParseResult {
  event_type: EventType;
  payload: Record<string, unknown>;
  confidence: number; // 0..1 — abaixo de 0.6, parser principal dispara fallback LLM.
}

export interface ParserModule {
  matches(sender: string): boolean;
  parse(body: string): ParseResult | null;
}

export interface RawEmail {
  message_id: string;
  sender: string;        // raw "From" header
  subject: string;
  body_text: string;     // body convertido para texto puro
  received_at: string;   // ISO
}
