import { describe, expect, it } from 'vitest';
import type { Card } from './types.js';
import {
  HAND_SIZES,
  dealSizeForHand,
  isLegalPlay,
  legalBids,
  legalPlays,
  trickWinner,
} from './rules.js';
import { applyHandScores, scoreHand, winnersFromTotals } from './scoring.js';

function c(rank: Card['rank'], suit: Card['suit']): Card {
  return { id: `${rank}-${suit}`, rank, suit };
}

describe('hand-size sequence', () => {
  it('has 13 hands: 7..1 then 2..7', () => {
    expect(HAND_SIZES).toEqual([7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
    expect(HAND_SIZES).toHaveLength(13);
  });

  it('maps hand numbers correctly', () => {
    expect(dealSizeForHand(1)).toBe(7);
    expect(dealSizeForHand(7)).toBe(1);
    expect(dealSizeForHand(8)).toBe(2);
    expect(dealSizeForHand(13)).toBe(7);
  });
});

describe('dealer bid lockout', () => {
  it('allows any bid for non-dealer', () => {
    expect(legalBids({ dealSize: 5, previousBids: [2, 1], isDealer: false })).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('disallows dealer bid that would make sum === N', () => {
    // previous 2+1=3, N=5 → dealer cannot bid 2
    const bids = legalBids({ dealSize: 5, previousBids: [2, 1], isDealer: true });
    expect(bids).toEqual([0, 1, 3, 4, 5]);
    expect(bids).not.toContain(2);
  });

  it('disallows 0 when previous sum already equals N', () => {
    const bids = legalBids({ dealSize: 3, previousBids: [1, 2], isDealer: true });
    expect(bids).toEqual([1, 2, 3]);
    expect(bids).not.toContain(0);
  });

  it('allows all when no forbidden amount in range', () => {
    // sum 0, N=1 → cannot bid 1, can bid 0
    expect(legalBids({ dealSize: 1, previousBids: [], isDealer: true })).toEqual([0]);
  });
});

describe('follow-suit', () => {
  const hand = [c('A', 'hearts'), c('3', 'clubs'), c('9', 'spades')];

  it('must follow lead suit when able', () => {
    const plays = legalPlays(hand, 'hearts');
    expect(plays.map((x) => x.id)).toEqual(['A-hearts']);
    expect(isLegalPlay(hand, 'A-hearts', 'hearts')).toBe(true);
    expect(isLegalPlay(hand, '3-clubs', 'hearts')).toBe(false);
  });

  it('allows any card when cannot follow', () => {
    const plays = legalPlays(hand, 'diamonds');
    expect(plays).toHaveLength(3);
    expect(isLegalPlay(hand, '9-spades', 'diamonds')).toBe(true);
  });

  it('allows any card when leading', () => {
    expect(legalPlays(hand, null)).toHaveLength(3);
  });
});

describe('trump winning', () => {
  it('highest of led suit wins with no trump', () => {
    const winner = trickWinner(
      [
        { playerId: 'a', card: c('10', 'hearts') },
        { playerId: 'b', card: c('K', 'hearts') },
        { playerId: 'c', card: c('2', 'spades') },
      ],
      'clubs',
    );
    expect(winner).toBe('b');
  });

  it('highest trump wins over higher led suit', () => {
    const winner = trickWinner(
      [
        { playerId: 'a', card: c('A', 'hearts') },
        { playerId: 'b', card: c('3', 'clubs') },
        { playerId: 'c', card: c('K', 'hearts') },
      ],
      'clubs',
    );
    expect(winner).toBe('b');
  });

  it('higher trump beats lower trump', () => {
    const winner = trickWinner(
      [
        { playerId: 'a', card: c('Q', 'spades') },
        { playerId: 'b', card: c('2', 'diamonds') },
        { playerId: 'c', card: c('A', 'diamonds') },
      ],
      'diamonds',
    );
    expect(winner).toBe('c');
  });
});

describe('scoring', () => {
  it('make bid scores +10 + bid', () => {
    expect(scoreHand(3, 3)).toBe(13);
    expect(scoreHand(0, 0)).toBe(10);
    expect(scoreHand(7, 7)).toBe(17);
  });

  it('miss scores −|tricks − bid|', () => {
    expect(scoreHand(3, 1)).toBe(-2);
    expect(scoreHand(0, 2)).toBe(-2);
    expect(scoreHand(5, 7)).toBe(-2);
  });

  it('applies running totals', () => {
    const { deltas, totals } = applyHandScores(
      { a: 2, b: 0 },
      { a: 2, b: 1 },
      { a: 10, b: 5 },
    );
    expect(deltas).toEqual({ a: 12, b: -1 });
    expect(totals).toEqual({ a: 22, b: 4 });
  });

  it('handles ties for winners', () => {
    expect(winnersFromTotals({ a: 40, b: 40, c: 10 })).toEqual(['a', 'b']);
    expect(winnersFromTotals({ a: 50, b: 40 })).toEqual(['a']);
  });
});
