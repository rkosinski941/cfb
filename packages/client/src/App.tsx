import { useMemo } from 'react';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { GameTable } from './components/GameTable';
import { useGameSocket } from './hooks/useGameSocket';

function roomFromUrl(): string | undefined {
  const q = new URLSearchParams(window.location.search).get('room');
  return q ? q.toUpperCase() : undefined;
}

export default function App() {
  const {
    state,
    error,
    connected,
    createRoom,
    joinRoom,
    startGame,
    placeBid,
    playCard,
    nextHand,
    leaveLocal,
    clearError,
    shareUrl,
  } = useGameSocket();

  const initialRoom = useMemo(() => roomFromUrl(), []);
  const isHost = !!state?.you && !!state.players.find(
    (p) => p.id === state.you!.id && p.isHost,
  );

  return (
    <div className="app">
      <div className="safe">
        {error && (
          <div className="toast error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={clearError} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        {!state && (
          <Home
            initialRoom={initialRoom}
            connected={connected}
            onCreate={createRoom}
            onJoin={(room, name) => joinRoom(room, name)}
          />
        )}

        {state?.phase === 'lobby' && (
          <>
            <Lobby
              state={state}
              shareUrl={shareUrl}
              onStart={startGame}
              isHost={isHost}
            />
            <button type="button" className="btn linkish" onClick={leaveLocal}>
              Leave room
            </button>
          </>
        )}

        {state && state.phase !== 'lobby' && (
          <GameTable
            state={state}
            onBid={placeBid}
            onPlay={playCard}
            onNextHand={nextHand}
          />
        )}
      </div>
    </div>
  );
}
