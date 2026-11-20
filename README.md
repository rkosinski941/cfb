# CFB — Multiplayer Card Game

iPhone-friendly Progressive Web App for a real-time trump trick-taking game.
3-7 players, 13 hands, Ace high. Rules are enforced on the server.

## Stack

- Client: Vite + React + TypeScript (PWA / Add to Home Screen)
- Server: Node + Express + Socket.IO
- Shared: @cfb/shared authoritative game logic

## Layout

packages/shared — cards, bidding lockout, follow-suit, trump, scoring
packages/server — rooms, Socket.IO, serves client build in production
packages/client — mobile portrait UI

## Rules (short)

- Hands deal 7,6,5,4,3,2,1,2,3,4,5,6,7 cards
- Dealer flips next card for trump; dealer rotates left each hand
- Bidding starts left of dealer; each bids 0..N
- Dealer cannot bid an amount that makes total bids = N (server-enforced)
- Must follow suit if able; highest trump wins, else highest of led suit
- Make bid: +10 + bid; Miss: -|tricks - bid|
- Highest score after hand 13 wins (ties allowed)

## Local development

Requires Node 22.12+ (the dev and test tools need it; the server itself runs on 18+).

```
cd cfb
npm install
npm test
npm run build
npm run dev
```

- Client (dev): http://localhost:5173 (proxies Socket.IO)
- Server: http://localhost:3000

Production-style:

```
npm run build
npm start
```

### Test on iPhone (same Wi-Fi)

1. Find your computer LAN IP
2. Start npm run dev (Vite host: true)
3. Open http://YOUR_LAN_IP:5173 in Safari
4. Share then Add to Home Screen

## Deploy

Single Node process: API + Socket.IO + static client.

Railway / Render / Fly:

1. Connect this GitHub repo
2. Build: `npm install && npm run build`
3. Start: `npm start`
4. Use process.env.PORT

Enable WebSocket support. Prefer always-on hosting for multiplayer.
Open HTTPS URL on iPhone Safari then Add to Home Screen.
Share ?room=CODE or the 5-character room code.

## Rejoin

localStorage keeps room code, name, and token for refresh reconnect.
Reclaiming a seat requires that token; a name alone is never enough.
If a seat is reclaimed from another device, the old connection is cut off.

## Server settings (environment)

- `ALLOWED_ORIGINS` — comma-separated extra browser origins allowed to
  connect. The server's own origin is always allowed; others are refused.
- `TRUST_PROXY=1` — set when behind a hosting proxy (Railway/Render/Fly) so
  per-client rate limits use the real client IP.
- `MAX_ROOMS` — cap on live rooms (default 500). Idle rooms with nobody
  connected, or finished games, are removed after 30 minutes.

## License

Private — all rights reserved.
