import { timingSafeEqual } from 'node:crypto';
import { customAlphabet } from 'nanoid';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_HANDS,
  applyHandScores,
  createDeck,
  dealSizeForHand,
  isLegalPlay,
  leftOfDealer,
  legalBids,
  legalPlays,
  nextDealerIndex,
  shuffle,
  trickWinner,
  winnersFromTotals,
  type Card,
  type GamePublicState,
  type HandResult,
  type Phase,
  type Suit,
  type TrickPlay,
} from '@cfb/shared';
import { cleanName } from './validation.js';

const codeAlphabet = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 5);
const tokenAlphabet = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  24,
);

interface InternalPlayer {
  id: string;
  name: string;
  token: string;
  socketId: string | null;
  connected: boolean;
  hand: Card[];
  bid: number | null;
  tricksTaken: number;
  score: number;
  isHost: boolean;
}

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export class GameRoom {
  readonly code: string;
  private players: InternalPlayer[] = [];
  private phase: Phase = 'lobby';
  private handNumber = 0;
  private dealSize = 0;
  private trump: Card | null = null;
  private dealerIndex = 0;
  private currentPlayerIndex = 0;
  private currentTrick: TrickPlay[] = [];
  private leadSuit: Suit | null = null;
  private trickNumber = 0;
  private lastTrickWinnerId: string | null = null;
  private handResult: HandResult | null = null;
  private winners: string[] = [];
  private message: string | null = null;
  private bidIndex = 0;
  /** Last time anything happened in this room (ms since epoch). */
  lastActivity = Date.now();

  constructor(code?: string) {
    this.code = code ?? codeAlphabet();
  }

  /**
   * Create a room with a code that is not already in use. Without the
   * check a random collision would silently replace a live room.
   */
  static create(isTaken: (code: string) => boolean = () => false): GameRoom {
    for (let i = 0; i < 50; i++) {
      const code = codeAlphabet();
      if (!isTaken(code)) return new GameRoom(code);
    }
    throw new Error('Server busy — try again');
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  get connectedCount(): number {
    return this.players.filter((p) => p.connected).length;
  }

  /**
   * A room can be removed once nobody is connected and it has been idle
   * for `idleMs`, or once the game is over and idle for `idleMs`.
   */
  isAbandoned(now: number, idleMs: number): boolean {
    if (now - this.lastActivity < idleMs) return false;
    return this.connectedCount === 0 || this.phase === 'game_over';
  }

  get playerCount(): number {
    return this.players.length;
  }

  addPlayer(name: string, socketId: string): { playerId: string; token: string } {
    const trimmed = cleanName(name);
    if (this.phase !== 'lobby') throw new Error('Game already started');
    if (this.players.length >= MAX_PLAYERS) throw new Error('Room is full (max 7)');
    if (this.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Name already taken — use rejoin with your token');
    }

    const player: InternalPlayer = {
      id: tokenAlphabet(),
      name: trimmed,
      token: tokenAlphabet(),
      socketId,
      connected: true,
      hand: [],
      bid: null,
      tricksTaken: 0,
      score: 0,
      isHost: this.players.length === 0,
    };
    this.players.push(player);
    this.touch();
    this.message = `${player.name} joined`;
    return { playerId: player.id, token: player.token };
  }

  /**
   * Rejoin an existing seat. The secret session token is the only proof
   * of identity — a name alone is public and must never be enough.
   * Returns the socket id previously bound to the seat (if any) so the
   * caller can detach it.
   */
  rejoin(
    token: string,
    socketId: string,
  ): { playerId: string; token: string; previousSocketId: string | null } {
    const player = token ? this.players.find((p) => tokensEqual(p.token, token)) : undefined;
    if (!player) throw new Error('Session not found — join with a new name');

    const previousSocketId = player.socketId !== socketId ? player.socketId : null;
    player.socketId = socketId;
    player.connected = true;
    this.touch();
    this.message = `${player.name} reconnected`;
    return { playerId: player.id, token: player.token, previousSocketId };
  }

  /** Player id owning this token, or null. Does not change any state. */
  seatForToken(token: string): string | null {
    return this.players.find((p) => tokensEqual(p.token, token))?.id ?? null;
  }

  disconnect(socketId: string): void {
    const p = this.players.find((x) => x.socketId === socketId);
    if (!p) return;
    p.connected = false;
    p.socketId = null;
    this.touch();
    this.message = `${p.name} disconnected`;
  }

  startGame(requesterId: string): void {
    const host = this.players.find((p) => p.id === requesterId);
    if (!host?.isHost) throw new Error('Only the host can start');
    if (this.players.length < MIN_PLAYERS) {
      throw new Error(`Need at least ${MIN_PLAYERS} players`);
    }
    if (this.players.length > MAX_PLAYERS) {
      throw new Error(`Max ${MAX_PLAYERS} players`);
    }
    if (this.phase !== 'lobby') throw new Error('Already started');

    this.dealerIndex = 0;
    this.handNumber = 0;
    this.touch();
    this.beginNextHand();
  }

  private beginNextHand(): void {
    this.handNumber += 1;
    if (this.handNumber > TOTAL_HANDS) {
      this.phase = 'game_over';
      const totals: Record<string, number> = {};
      for (const p of this.players) totals[p.id] = p.score;
      this.winners = winnersFromTotals(totals);
      this.message = 'Game over!';
      this.handResult = null;
      return;
    }

    this.dealSize = dealSizeForHand(this.handNumber);
    this.trump = null;
    this.currentTrick = [];
    this.leadSuit = null;
    this.trickNumber = 0;
    this.lastTrickWinnerId = null;
    this.handResult = null;
    this.winners = [];

    for (const p of this.players) {
      p.hand = [];
      p.bid = null;
      p.tricksTaken = 0;
    }

    const deck = shuffle(createDeck());
    const n = this.dealSize;
    const need = n * this.players.length + 1;
    if (need > deck.length) throw new Error('Not enough cards');

    let idx = 0;
    for (let r = 0; r < n; r++) {
      for (const p of this.players) {
        p.hand.push(deck[idx++]!);
      }
    }
    this.trump = deck[idx++]!;

    const rankOrder = '2345678910JQKA';
    for (const p of this.players) {
      p.hand.sort((a, b) => {
        if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
        return rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
      });
    }

    this.phase = 'bidding';
    this.bidIndex = 0;
    this.currentPlayerIndex = leftOfDealer(this.dealerIndex, this.players.length);
    this.message = `Hand ${this.handNumber}/${TOTAL_HANDS} — bid (deal ${n})`;
  }

  placeBid(playerId: string, amount: number): void {
    if (this.phase !== 'bidding') throw new Error('Not bidding now');
    const currentId = this.players[this.currentPlayerIndex]?.id;
    if (playerId !== currentId) throw new Error('Not your turn to bid');

    const isDealer = this.players[this.dealerIndex]?.id === playerId;
    const previousBids = this.players
      .filter((p) => p.bid !== null)
      .map((p) => p.bid as number);
    const allowed = legalBids({
      dealSize: this.dealSize,
      previousBids,
      isDealer,
    });
    if (!Number.isInteger(amount) || !allowed.includes(amount)) {
      const wouldLock =
        isDealer &&
        previousBids.reduce((a, b) => a + b, 0) + amount === this.dealSize;
      throw new Error(
        wouldLock
          ? `Dealer cannot bid ${amount} (total would equal ${this.dealSize})`
          : `Illegal bid: ${amount}`,
      );
    }

    const player = this.players.find((p) => p.id === playerId)!;
    player.bid = amount;
    this.touch();
    this.bidIndex += 1;

    if (this.bidIndex >= this.players.length) {
      this.phase = 'playing';
      this.currentPlayerIndex = leftOfDealer(this.dealerIndex, this.players.length);
      this.trickNumber = 1;
      this.currentTrick = [];
      this.leadSuit = null;
      this.message = 'Play — left of dealer leads';
    } else {
      this.currentPlayerIndex =
        (this.currentPlayerIndex + 1) % this.players.length;
      this.message = `${player.name} bid ${amount}`;
    }
  }

  playCard(playerId: string, cardId: string): void {
    if (this.phase !== 'playing') throw new Error('Not playing now');
    const currentId = this.players[this.currentPlayerIndex]?.id;
    if (playerId !== currentId) throw new Error('Not your turn');

    const player = this.players.find((p) => p.id === playerId)!;
    if (!isLegalPlay(player.hand, cardId, this.leadSuit)) {
      throw new Error('Illegal play — must follow suit if able');
    }

    const cardIndex = player.hand.findIndex((c) => c.id === cardId);
    const card = player.hand[cardIndex]!;
    player.hand.splice(cardIndex, 1);
    this.touch();

    if (this.currentTrick.length === 0) {
      this.leadSuit = card.suit;
    }
    this.currentTrick.push({ playerId, card });

    if (this.currentTrick.length < this.players.length) {
      this.currentPlayerIndex =
        (this.currentPlayerIndex + 1) % this.players.length;
      return;
    }

    const winnerId = trickWinner(this.currentTrick, this.trump!.suit);
    const winner = this.players.find((p) => p.id === winnerId)!;
    winner.tricksTaken += 1;
    this.lastTrickWinnerId = winnerId;
    this.currentPlayerIndex = this.players.findIndex((p) => p.id === winnerId);
    this.message = `${winner.name} won the trick`;
    this.currentTrick = [];
    this.leadSuit = null;

    const cardsLeft = this.players.reduce((n, p) => n + p.hand.length, 0);
    if (cardsLeft === 0) {
      this.finishHand();
    } else {
      this.trickNumber += 1;
    }
  }

  private finishHand(): void {
    const bids: Record<string, number> = {};
    const tricks: Record<string, number> = {};
    const currentTotals: Record<string, number> = {};
    for (const p of this.players) {
      bids[p.id] = p.bid ?? 0;
      tricks[p.id] = p.tricksTaken;
      currentTotals[p.id] = p.score;
    }
    const { deltas, totals } = applyHandScores(bids, tricks, currentTotals);
    for (const p of this.players) {
      p.score = totals[p.id]!;
    }
    this.handResult = {
      handNumber: this.handNumber,
      dealSize: this.dealSize,
      bids,
      tricks,
      deltas,
      totals,
    };
    this.phase = 'hand_result';
    this.message = `Hand ${this.handNumber} complete`;
  }

  advanceAfterHandResult(requesterId: string): void {
    if (this.phase !== 'hand_result') throw new Error('No hand result to advance');
    if (!this.players.some((p) => p.id === requesterId)) {
      throw new Error('Not in room');
    }
    this.dealerIndex = nextDealerIndex(this.dealerIndex, this.players.length);
    this.touch();
    this.beginNextHand();
  }

  getPlayerBySocket(socketId: string): InternalPlayer | undefined {
    return this.players.find((p) => p.socketId === socketId);
  }

  toPublic(viewerId: string | null): GamePublicState {
    const viewer = viewerId
      ? this.players.find((p) => p.id === viewerId) ?? null
      : null;

    let legalBidList: number[] | null = null;
    let legalCardIds: string[] | null = null;

    if (viewer && this.phase === 'bidding') {
      const currentId = this.players[this.currentPlayerIndex]?.id;
      if (viewer.id === currentId) {
        const isDealer = this.players[this.dealerIndex]?.id === viewer.id;
        const previousBids = this.players
          .filter((p) => p.bid !== null)
          .map((p) => p.bid as number);
        legalBidList = legalBids({
          dealSize: this.dealSize,
          previousBids,
          isDealer,
        });
      }
    }

    if (viewer && this.phase === 'playing') {
      const currentId = this.players[this.currentPlayerIndex]?.id;
      if (viewer.id === currentId) {
        legalCardIds = legalPlays(viewer.hand, this.leadSuit).map((c) => c.id);
      }
    }

    return {
      roomCode: this.code,
      phase: this.phase,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        bid: p.bid,
        tricksTaken: p.tricksTaken,
        score: p.score,
        handCount: p.hand.length,
        isDealer: i === this.dealerIndex && this.phase !== 'lobby',
        isHost: p.isHost,
      })),
      handNumber: this.handNumber,
      dealSize: this.dealSize,
      trump: this.trump,
      dealerIndex: this.dealerIndex,
      currentPlayerId: this.players[this.currentPlayerIndex]?.id ?? null,
      currentTrick: this.currentTrick,
      leadSuit: this.leadSuit,
      trickNumber: this.trickNumber,
      lastTrickWinnerId: this.lastTrickWinnerId,
      handResult: this.handResult,
      winners: this.winners,
      maxPlayers: MAX_PLAYERS,
      you: viewer
        ? {
            id: viewer.id,
            hand: viewer.hand,
            token: viewer.token,
            legalBids: legalBidList,
            legalCardIds,
          }
        : null,
      message: this.message,
    };
  }
}

export { MIN_PLAYERS, MAX_PLAYERS };
