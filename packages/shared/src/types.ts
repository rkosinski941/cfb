export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
}

export type Phase =
  | 'lobby'
  | 'bidding'
  | 'playing'
  | 'hand_result'
  | 'game_over';

export interface PlayerPublic {
  id: string;
  name: string;
  connected: boolean;
  bid: number | null;
  tricksTaken: number;
  score: number;
  handCount: number;
  isDealer: boolean;
  isHost: boolean;
}

export interface TrickPlay {
  playerId: string;
  card: Card;
}

export interface HandResult {
  handNumber: number;
  dealSize: number;
  bids: Record<string, number>;
  tricks: Record<string, number>;
  deltas: Record<string, number>;
  totals: Record<string, number>;
}

export interface GamePublicState {
  roomCode: string;
  phase: Phase;
  players: PlayerPublic[];
  handNumber: number;
  dealSize: number;
  trump: Card | null;
  dealerIndex: number;
  currentPlayerId: string | null;
  currentTrick: TrickPlay[];
  leadSuit: Suit | null;
  trickNumber: number;
  lastTrickWinnerId: string | null;
  handResult: HandResult | null;
  winners: string[];
  maxPlayers: number;
  you: {
    id: string;
    hand: Card[];
    token: string;
    legalBids: number[] | null;
    legalCardIds: string[] | null;
  } | null;
  message: string | null;
}

export interface CreateRoomPayload {
  name: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  name: string;
  token?: string;
}

export interface BidPayload {
  amount: number;
}

export interface PlayCardPayload {
  cardId: string;
}
