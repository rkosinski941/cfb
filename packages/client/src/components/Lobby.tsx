import { useMemo, useState } from 'react';
import type { GamePublicState } from '@cfb/shared';

interface Props {
  state: GamePublicState;
  shareUrl: string;
  onStart: () => void;
  isHost: boolean;
}

export function Lobby({ state, shareUrl, onStart, isHost }: Props) {
  const [copied, setCopied] = useState(false);
  const canStart = state.players.length >= 3 && state.players.length <= 7;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl || state.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const tip = useMemo(() => {
    if (state.players.length < 3) return `Need ${3 - state.players.length} more player(s)`;
    if (state.players.length > 7) return 'Too many players';
    return 'Ready to start';
  }, [state.players.length]);

  return (
    <div className="panel lobby">
      <h2>Room {state.roomCode}</h2>
      <p className="muted">Share this code or link with friends</p>
      <div className="row">
        <button type="button" className="btn secondary" onClick={copy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <ul className="player-list">
        {state.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'offline'}>
            <span>
              {p.name}
              {p.isHost ? ' (host)' : ''}
              {!p.connected ? ' · offline' : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="status">{tip}</p>
      {isHost ? (
        <button
          type="button"
          className="btn primary"
          disabled={!canStart}
          onClick={onStart}
        >
          Start game
        </button>
      ) : (
        <p className="muted">Waiting for host to start…</p>
      )}
    </div>
  );
}
