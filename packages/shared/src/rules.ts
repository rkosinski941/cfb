import { rankValue } from './cards.js';
import type { Card, Suit } from './types.js';

/** 13 hands: deal sizes 7..1 then 2..7 */
export const HAND_SIZES: readonly number[] = [
  7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7,
] as const;

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const TOTAL_HANDS = HAND_SIZES.length;

export function dealSizeForHand(handNumber: number): number {
  if (handNumber < 1 || handNumber > TOTAL_HANDS) {
    throw new Error(`Invalid hand number: ${handNumber}`);
  }
  return HAND_SIZES[handNumber - 1]!;
}

/**
 * Legal bids for a player. Dealer cannot bid an amount that makes
 * sum of all bids equal to N (deal size).
 */
export function legalBids(options: {
  dealSize: number;
  previousBids: number[];
  isDealer: boolean;
}): number[] {
  const { dealSize, previousBids, isDealer } = options;
  const all = Array.from({ length: dealSize + 1 }, (_, i) => i);
  if (!isDealer) return all;

  const sumSoFar = previousBids.reduce((a, b) => a + b, 0);
  return all.filter((bid) => sumSoFar + bid !== dealSize);
}

export function canFollowSuit(hand: Card[], leadSuit: Suit): boolean {
  return hand.some((c) => c.suit === leadSuit);
}

export function legalPlays(hand: Card[], leadSuit: Suit | null): Card[] {
  if (leadSuit == null) return [...hand];
  if (canFollowSuit(hand, leadSuit)) {
    return hand.filter((c) => c.suit === leadSuit);
  }
  return [...hand];
}

export function isLegalPlay(
  hand: Card[],
  cardId: string,
  leadSuit: Suit | null,
): boolean {
  const card = hand.find((c) => c.id === cardId);
  if (!card) return false;
  return legalPlays(hand, leadSuit).some((c) => c.id === cardId);
}

/**
 * Winner of a trick: highest trump if any trump played, else highest of led suit.
 */
export function trickWinner(
  plays: { playerId: string; card: Card }[],
  trumpSuit: Suit,
): string {
  if (plays.length === 0) throw new Error('Empty trick');
  const leadSuit = plays[0]!.card.suit;
  const trumps = plays.filter((p) => p.card.suit === trumpSuit);
  const contenders = trumps.length > 0
    ? trumps
    : plays.filter((p) => p.card.suit === leadSuit);

  let best = contenders[0]!;
  for (let i = 1; i < contenders.length; i++) {
    const p = contenders[i]!;
    if (rankValue(p.card.rank) > rankValue(best.card.rank)) {
      best = p;
    }
  }
  return best.playerId;
}

export function nextDealerIndex(current: number, playerCount: number): number {
  return (current + 1) % playerCount;
}

/** Seat left of dealer (index + 1). */
export function leftOfDealer(dealerIndex: number, playerCount: number): number {
  return (dealerIndex + 1) % playerCount;
}
