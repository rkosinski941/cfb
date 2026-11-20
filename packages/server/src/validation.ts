/**
 * Input validation for untrusted Socket.IO payloads.
 * Everything a client sends is treated as unknown until checked here.
 */

export const NAME_MAX_LENGTH = 20;
export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
export const TOKEN_PATTERN = /^[A-Za-z0-9]{24}$/;
export const CARD_ID_PATTERN = /^(?:[2-9]|10|[JQKA])-(?:clubs|diamonds|hearts|spades)$/;
const MAX_RAW_STRING = 200;

export class ValidationError extends Error {}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function field(payload: unknown, key: string): unknown {
  if (!isPlainObject(payload)) return undefined;
  // Own properties only — never read through the prototype chain.
  return Object.prototype.hasOwnProperty.call(payload, key) ? payload[key] : undefined;
}

/**
 * Normalise a display name: strip control and bidi-override characters,
 * collapse whitespace, cap length. Throws if nothing usable remains.
 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_STRING) {
    throw new ValidationError('Name is required (max 20 characters)');
  }
  const cleaned = raw
    // C0/C1 controls, zero-width chars, bidi embeddings/overrides/isolates
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const capped = Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join('').trim();
  if (!capped) throw new ValidationError('Name is required (max 20 characters)');
  return capped;
}

export function parseCreateRoom(payload: unknown): { name: string } {
  return { name: cleanName(field(payload, 'name')) };
}

export function parseRoomCode(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 20) throw new ValidationError('Room not found');
  const code = raw.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(code)) throw new ValidationError('Room not found');
  return code;
}

export function parseJoinRoom(payload: unknown): {
  roomCode: string;
  name: string;
  token?: string;
} {
  const roomCode = parseRoomCode(field(payload, 'roomCode'));
  const rawToken = field(payload, 'token');
  if (rawToken !== undefined && rawToken !== null && rawToken !== '') {
    if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) {
      throw new ValidationError('Invalid session token');
    }
    // Name is informational on rejoin; the token identifies the seat.
    const rawName = field(payload, 'name');
    let name = '';
    try {
      name = cleanName(rawName);
    } catch {
      name = '';
    }
    return { roomCode, name, token: rawToken };
  }
  return { roomCode, name: cleanName(field(payload, 'name')) };
}

export function parseBid(payload: unknown): number {
  const amount = field(payload, 'amount');
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > 52) {
    throw new ValidationError('Illegal bid');
  }
  return amount;
}

export function parseCardId(payload: unknown): string {
  const cardId = field(payload, 'cardId');
  if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) {
    throw new ValidationError('Illegal play');
  }
  return cardId;
}

/** Socket.IO only passes a function when the client asked for an ack. */
export function safeAck(ack: unknown): (r: unknown) => void {
  return typeof ack === 'function' ? (ack as (r: unknown) => void) : () => {};
}

/** Simple fixed-window rate limiter keyed by socket. */
export class RateLimiter {
  private hits = 0;
  private windowStart = 0;
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(): boolean {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.hits = 0;
    }
    this.hits += 1;
    return this.hits <= this.max;
  }
}

/**
 * Same-origin / allow-list check for browser connections. Requests with
 * no Origin header (native apps, curl, server-to-server) are allowed;
 * browser requests must come from this server's own host or an origin
 * listed in ALLOWED_ORIGINS.
 */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowList: readonly string[],
): boolean {
  if (!origin) return true;
  if (allowList.includes(origin)) return true;
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
