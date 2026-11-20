import type { Card, Rank, Suit } from './types.js';

export const SUITS: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
export const RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];

const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export function rankValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}-${suit}`, suit, rank });
    }
  }
  return deck;
}

/**
 * Uniform random float in [0, 1) from the platform CSPRNG (Web Crypto,
 * available in browsers and Node 18+). Math.random is not suitable for
 * dealing cards: its internal state can be recovered from observed output.
 */
export function secureRandom(): number {
  const buf = new Uint32Array(2);
  globalThis.crypto.getRandomValues(buf);
  // 53 random bits -> [0, 1)
  return (buf[0]! * 2 ** 21 + (buf[1]! >>> 11)) / 2 ** 53;
}

/** Fisher–Yates shuffle (mutates and returns). */
export function shuffle<T>(items: T[], rng: () => number = secureRandom): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function suitSymbol(suit: Suit): string {
  switch (suit) {
    case 'clubs':
      return '♣';
    case 'diamonds':
      return '♦';
    case 'hearts':
      return '♥';
    case 'spades':
      return '♠';
  }
}

export function suitColor(suit: Suit): 'red' | 'black' {
  return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

export function formatCard(card: Card): string {
  return `${card.rank}${suitSymbol(card.suit)}`;
}
