import { useState } from 'react';

interface Props {
  initialRoom?: string;
  connected: boolean;
  onCreate: (name: string) => Promise<void>;
  onJoin: (room: string, name: string) => Promise<void>;
}

export function Home({ initialRoom, connected, onCreate, onJoin }: Props) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState(initialRoom ?? '');
  const [busy, setBusy] = useState(false);

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate(name);
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onJoin(room, name);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <h1>CFB</h1>
      <p className="tagline">Trick-taking for 3–7 players · Ace high · Trump</p>
      <p className={`conn ${connected ? 'on' : 'off'}`}>
        {connected ? 'Connected' : 'Connecting…'}
      </p>

      <label className="field">
        Display name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={20}
          placeholder="Your name"
          autoComplete="nickname"
          enterKeyHint="done"
        />
      </label>

      <form className="panel" onSubmit={submitCreate}>
        <h2>Create room</h2>
        <button
          type="submit"
          className="btn primary"
          disabled={!name.trim() || busy || !connected}
        >
          Create
        </button>
      </form>

      <form className="panel" onSubmit={submitJoin}>
        <h2>Join room</h2>
        <label className="field">
          Room code
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="ABC12"
            autoCapitalize="characters"
            autoCorrect="off"
          />
        </label>
        <button
          type="submit"
          className="btn primary"
          disabled={!name.trim() || !room.trim() || busy || !connected}
        >
          Join
        </button>
      </form>

      <details className="rules">
        <summary>Quick rules</summary>
        <ul>
          <li>13 hands: deal 7→1 then 2→7</li>
          <li>Bid 0…N; dealer cannot make total bids = N</li>
          <li>Follow suit if able; trump beats led suit</li>
          <li>Make bid: +10+bid · miss: −|tricks−bid|</li>
        </ul>
      </details>
    </div>
  );
}
