import { describe, expect, it } from 'vitest';
import { GameRoom } from './gameRoom.js';
import {
  RateLimiter,
  cleanName,
  isOriginAllowed,
  parseBid,
  parseCardId,
  parseCreateRoom,
  parseJoinRoom,
  safeAck,
} from './validation.js';
import { createDeck, secureRandom, shuffle } from '@cfb/shared';

function lobby(n = 3) {
  const room = new GameRoom('ABCDE');
  const seats = Array.from({ length: n }, (_, i) =>
    room.addPlayer(`P${i}`, `sock${i}`),
  );
  return { room, seats };
}

describe('seat takeover (session hijack)', () => {
  it('cannot claim a seat with only a name', () => {
    const { room } = lobby();
    expect(() => room.rejoin('', 'evil')).toThrow();
    expect(() => room.addPlayer('P0', 'evil')).toThrow(/taken/);
  });

  it('cannot claim a seat with a wrong token', () => {
    const { room } = lobby();
    expect(() => room.rejoin('x'.repeat(24), 'evil')).toThrow();
  });

  it('rejoins with the right token and reports the old socket', () => {
    const { room, seats } = lobby();
    const r = room.rejoin(seats[1]!.token, 'newsock');
    expect(r.playerId).toBe(seats[1]!.playerId);
    expect(r.previousSocketId).toBe('sock1');
  });
});

describe('hidden information', () => {
  it('only shows the viewer their own hand and token', () => {
    const { room, seats } = lobby();
    room.startGame(seats[0]!.playerId);
    const view = room.toPublic(seats[1]!.playerId);
    const json = JSON.stringify(view);
    expect(view.you?.id).toBe(seats[1]!.playerId);
    expect(json).not.toContain(seats[0]!.token);
    expect(json).not.toContain(seats[2]!.token);
    for (const p of view.players) expect(p).not.toHaveProperty('hand');
    expect(JSON.stringify(room.toPublic(null))).not.toContain('"token"');
  });
});

describe('turn and rule enforcement', () => {
  it('rejects out-of-turn and dealer-lockout bids', () => {
    const { room, seats } = lobby();
    room.startGame(seats[0]!.playerId);
    // dealer is seat 0, bidding starts with seat 1 (deal 7)
    expect(() => room.placeBid(seats[2]!.playerId, 1)).toThrow(/turn/);
    room.placeBid(seats[1]!.playerId, 3);
    room.placeBid(seats[2]!.playerId, 2);
    expect(() => room.placeBid(seats[0]!.playerId, 2)).toThrow(/Dealer/);
    expect(() => room.placeBid(seats[0]!.playerId, 99)).toThrow();
  });

  it('rejects cards that are not in hand', () => {
    const { room, seats } = lobby();
    room.startGame(seats[0]!.playerId);
    room.placeBid(seats[1]!.playerId, 0);
    room.placeBid(seats[2]!.playerId, 0);
    room.placeBid(seats[0]!.playerId, 0);
    const mine = new Set(room.toPublic(seats[1]!.playerId).you!.hand.map((c) => c.id));
    const notMine = createDeck().find((c) => !mine.has(c.id))!;
    expect(() => room.playCard(seats[1]!.playerId, notMine.id)).toThrow();
  });
});

describe('room codes and cleanup', () => {
  it('never reuses a code that is already live', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = GameRoom.create((c) => taken.has(c));
      expect(taken.has(r.code)).toBe(false);
      taken.add(r.code);
    }
  });

  it('gives up instead of overwriting when every code is taken', () => {
    expect(() => GameRoom.create(() => true)).toThrow();
  });

  it('marks rooms abandoned only when idle and empty', () => {
    const { room } = lobby();
    const later = room.lastActivity + 31 * 60_000;
    expect(room.isAbandoned(later, 30 * 60_000)).toBe(false); // still connected
    room.disconnect('sock0');
    room.disconnect('sock1');
    room.disconnect('sock2');
    expect(room.isAbandoned(room.lastActivity + 1000, 30 * 60_000)).toBe(false);
    expect(room.isAbandoned(room.lastActivity + 31 * 60_000, 30 * 60_000)).toBe(true);
  });
});

describe('payload validation', () => {
  it('rejects malformed payloads without throwing TypeErrors', () => {
    for (const bad of [null, undefined, 42, 'x', [], { name: 7 }, { name: '' }]) {
      expect(() => parseCreateRoom(bad)).toThrow(/Name/);
    }
    expect(() => parseJoinRoom({ roomCode: 123, name: 'a' })).toThrow(/Room/);
    expect(() => parseJoinRoom({ roomCode: 'ab', name: 'a' })).toThrow(/Room/);
    expect(() => parseJoinRoom({ roomCode: 'ABCDE', name: 'a', token: {} })).toThrow(/token/);
    expect(parseJoinRoom({ roomCode: ' abcde ', name: 'Sam' })).toEqual({
      roomCode: 'ABCDE',
      name: 'Sam',
    });
  });

  it('ignores inherited properties (no prototype tricks)', () => {
    const proto = { name: 'Sneaky' };
    const payload = Object.create(proto);
    expect(() => parseCreateRoom(payload)).toThrow();
  });

  it('validates bids and card ids strictly', () => {
    expect(parseBid({ amount: 3 })).toBe(3);
    for (const a of [-1, 1.5, '3', NaN, Infinity, 1e9, null]) {
      expect(() => parseBid({ amount: a })).toThrow();
    }
    expect(parseCardId({ cardId: '10-hearts' })).toBe('10-hearts');
    for (const c of ['__proto__', 'x'.repeat(5000), 5, '1-hearts']) {
      expect(() => parseCardId({ cardId: c })).toThrow();
    }
  });

  it('cleans names of control and direction-override characters', () => {
    expect(cleanName('  Al\u202Eice\u0000  ')).toBe('Alice');
    expect(cleanName('a'.repeat(50))).toHaveLength(20);
    expect(() => cleanName('\u200b\u200b')).toThrow();
    expect(() => cleanName('x'.repeat(10_000))).toThrow();
  });

  it('safeAck tolerates a missing or non-function ack', () => {
    expect(() => safeAck(undefined)({ ok: true })).not.toThrow();
    expect(() => safeAck(123)({ ok: true })).not.toThrow();
  });
});

describe('rate limiting and origin checks', () => {
  it('blocks after the limit and resets after the window', () => {
    let t = 0;
    const rl = new RateLimiter(2, 1000, () => t);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(true);
    expect(rl.allow()).toBe(false);
    t = 1000;
    expect(rl.allow()).toBe(true);
  });

  it('allows same-origin and listed origins only', () => {
    expect(isOriginAllowed(undefined, 'game.example', [])).toBe(true);
    expect(isOriginAllowed('https://game.example', 'game.example', [])).toBe(true);
    expect(isOriginAllowed('https://other.example', 'game.example', [])).toBe(false);
    expect(
      isOriginAllowed('https://other.example', 'game.example', ['https://other.example']),
    ).toBe(true);
    expect(isOriginAllowed('not a url', 'game.example', [])).toBe(false);
  });
});

describe('shuffle randomness source', () => {
  it('uses a CSPRNG in [0,1) and still permutes the deck', () => {
    for (let i = 0; i < 1000; i++) {
      const r = secureRandom();
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(1);
    }
    const deck = shuffle(createDeck());
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });
});
