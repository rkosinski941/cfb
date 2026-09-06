import type { GamePublicState } from '@cfb/shared';
import { formatCard, suitSymbol } from '@cfb/shared';
import { CardView } from './CardView';
import { Scoreboard } from './Scoreboard';

interface Props {
  state: GamePublicState;
  onBid: (n: number) => void;
  onPlay: (cardId: string) => void;
  onNextHand: () => void;
}

export function GameTable({ state, onBid, onPlay, onNextHand }: Props) {
  const you = state.you;
  const isYourTurn = !!(you && state.currentPlayerId === you.id);
  const nameOf = (id: string) =>
    state.players.find((p) => p.id === id)?.name ?? 'Player';

  return (
    <div className="game-table">
      <header className="game-header">
        <div>
          <strong>
            Hand {state.handNumber}/13 · Deal {state.dealSize}
          </strong>
          <div className="muted small">{state.message}</div>
        </div>
        {state.trump && (
          <div className="trump-badge" title="Trump">
            <span className="label">Trump</span>
            <CardView card={state.trump} compact />
          </div>
        )}
      </header>

      <Scoreboard state={state} />

      {state.phase === 'playing' && (
        <section className="trick">
          <h3>
            Trick {state.trickNumber}
            {state.leadSuit ? ` · lead ${suitSymbol(state.leadSuit)}` : ''}
          </h3>
          <div className="trick-cards">
            {state.currentTrick.length === 0 && (
              <p className="muted">Waiting for lead…</p>
            )}
            {state.currentTrick.map((play) => (
              <div key={play.playerId} className="trick-play">
                <CardView card={play.card} compact />
                <span className="small">{nameOf(play.playerId)}</span>
              </div>
            ))}
          </div>
          {state.lastTrickWinnerId && state.currentTrick.length === 0 && (
            <p className="muted small">
              Last trick: {nameOf(state.lastTrickWinnerId)}
            </p>
          )}
        </section>
      )}

      {state.phase === 'bidding' && you && (
        <section className="bidding">
          <h3>
            {isYourTurn
              ? you.legalBids &&
                state.players.find((p) => p.id === you.id)?.isDealer
                ? 'Your bid (dealer — total ≠ deal size)'
                : 'Your bid'
              : `Waiting for ${nameOf(state.currentPlayerId ?? '')}`}
          </h3>
          <div className="bid-buttons">
            {(you.legalBids ?? []).map((n) => (
              <button
                key={n}
                type="button"
                className="btn bid"
                disabled={!isYourTurn}
                onClick={() => onBid(n)}
              >
                {n}
              </button>
            ))}
            {!isYourTurn && <p className="muted">Not your turn</p>}
          </div>
        </section>
      )}

      {state.phase === 'hand_result' && state.handResult && (
        <section className="hand-result panel">
          <h3>Hand {state.handResult.handNumber} results</h3>
          <ul>
            {state.players.map((p) => {
              const d = state.handResult!.deltas[p.id] ?? 0;
              return (
                <li key={p.id}>
                  {p.name}: bid {state.handResult!.bids[p.id]} / took{' '}
                  {state.handResult!.tricks[p.id]} →{' '}
                  <strong className={d >= 0 ? 'pos' : 'neg'}>
                    {d >= 0 ? `+${d}` : d}
                  </strong>{' '}
                  (total {state.handResult!.totals[p.id]})
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn primary" onClick={onNextHand}>
            {state.handNumber >= 13 ? 'See final scores' : 'Next hand'}
          </button>
        </section>
      )}

      {state.phase === 'game_over' && (
        <section className="game-over panel">
          <h2>Game over</h2>
          <p>
            Winner
            {state.winners.length > 1 ? 's' : ''}:{' '}
            {state.winners.map((id) => nameOf(id)).join(', ')}
          </p>
          <Scoreboard state={state} />
        </section>
      )}

      {you && (state.phase === 'bidding' || state.phase === 'playing') && (
        <section className="hand">
          <h3>Your hand ({you.hand.length})</h3>
          <div className="hand-cards">
            {you.hand.map((card) => {
              const legal =
                state.phase !== 'playing' ||
                !isYourTurn ||
                (you.legalCardIds?.includes(card.id) ?? false);
              const canClick =
                state.phase === 'playing' &&
                isYourTurn &&
                (you.legalCardIds?.includes(card.id) ?? false);
              return (
                <CardView
                  key={card.id}
                  card={card}
                  dimmed={state.phase === 'playing' && isYourTurn && !legal}
                  disabled={!canClick}
                  onClick={canClick ? () => onPlay(card.id) : undefined}
                />
              );
            })}
          </div>
          {state.phase === 'playing' && isYourTurn && (
            <p className="muted small">Tap a highlighted card to play</p>
          )}
          {state.phase === 'playing' && !isYourTurn && (
            <p className="muted small">
              Waiting for {nameOf(state.currentPlayerId ?? '')}…
            </p>
          )}
        </section>
      )}

      {state.phase === 'playing' && you && isYourTurn && you.legalCardIds && (
        <p className="sr-only">
          Legal: {you.legalCardIds.map((id) => formatCard(you.hand.find((c) => c.id === id)!)).join(', ')}
        </p>
      )}
    </div>
  );
}
