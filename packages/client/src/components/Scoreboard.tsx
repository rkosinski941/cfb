import type { GamePublicState } from '@cfb/shared';

export function Scoreboard({ state }: { state: GamePublicState }) {
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  return (
    <div className="scoreboard">
      <h3>Scores</h3>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Bid</th>
            <th>Tricks</th>
            <th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr
              key={p.id}
              className={
                p.id === state.currentPlayerId
                  ? 'current'
                  : p.id === state.you?.id
                    ? 'you'
                    : ''
              }
            >
              <td>
                {p.name}
                {p.isDealer ? ' 🎴' : ''}
                {!p.connected ? ' ⚠' : ''}
              </td>
              <td>{p.bid === null ? '—' : p.bid}</td>
              <td>{p.tricksTaken}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
