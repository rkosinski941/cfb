import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { GameRoom } from './gameRoom.js';
import {
  RateLimiter,
  isOriginAllowed,
  parseBid,
  parseCardId,
  parseCreateRoom,
  parseJoinRoom,
  safeAck,
} from './validation.js';
import { securityHeaders } from './securityHeaders.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

/** Extra browser origins allowed to connect (comma-separated). Same-origin is always allowed. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
/** Set when running behind a reverse proxy (Railway/Render/Fly) so client IPs come from X-Forwarded-For. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MAX_MESSAGE_BYTES = 16 * 1024;

const rooms = new Map<string, GameRoom>();

function getRoom(code: unknown): GameRoom | undefined {
  if (typeof code !== 'string') return undefined;
  return rooms.get(code.toUpperCase());
}

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Serve client build in production
const clientDist = path.resolve(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: MAX_MESSAGE_BYTES,
  // Only send CORS headers for explicitly allowed extra origins; the client
  // is normally served from this same server.
  cors: ALLOWED_ORIGINS.length > 0 ? { origin: ALLOWED_ORIGINS } : undefined,
  // CORS does not apply to WebSocket upgrades, so check Origin here too.
  allowRequest: (req, callback) => {
    callback(null, isOriginAllowed(req.headers.origin, req.headers.host, ALLOWED_ORIGINS));
  },
});

// Join/create attempts per client IP (slows room-code guessing).
const ipJoinLimiters = new Map<string, { limiter: RateLimiter; lastSeen: number }>();
function clientIp(socket: Socket): string {
  if (TRUST_PROXY) {
    const xff = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address;
}
function allowJoinAttempt(socket: Socket): boolean {
  const ip = clientIp(socket);
  let entry = ipJoinLimiters.get(ip);
  if (!entry) {
    entry = { limiter: new RateLimiter(30, 60_000), lastSeen: Date.now() };
    ipJoinLimiters.set(ip, entry);
  }
  entry.lastSeen = Date.now();
  return entry.limiter.allow();
}

function emitRoom(room: GameRoom): void {
  const members = io.sockets.adapter.rooms.get(room.code);
  if (!members) return;
  for (const id of members) {
    const socket = io.sockets.sockets.get(id);
    if (!socket) continue;
    const data = socket.data as { roomCode?: string; playerId?: string };
    if (data.roomCode === room.code) {
      socket.emit('state', room.toPublic(data.playerId ?? null));
    }
  }
}

/** Detach a socket from whatever room it is in (one seat per socket). */
function leaveCurrentRoom(socket: Socket): void {
  const room = getRoom(socket.data.roomCode);
  if (room) {
    socket.leave(room.code);
    room.disconnect(socket.id);
    emitRoom(room);
  }
  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;
}

/** When a seat is reclaimed by token, cut off the socket that held it before. */
function detachSocket(socketId: string | null, roomCode: string): void {
  if (!socketId) return;
  const old = io.sockets.sockets.get(socketId);
  if (!old || old.data.roomCode !== roomCode) return;
  old.data.roomCode = undefined;
  old.data.playerId = undefined;
  old.leave(roomCode);
  old.emit('error_message', 'This seat was reconnected from another device');
  old.disconnect(true);
}

io.on('connection', (socket) => {
  // Per-socket flood control for all game events.
  const eventLimiter = new RateLimiter(40, 10_000);

  /** Wrap a handler so bad input or a missing ack can never throw out of it. */
  function on(
    event: string,
    handler: (payload: unknown, ack: (r: unknown) => void) => void,
    opts: { emitError?: boolean } = {},
  ): void {
    socket.on(event, (payload: unknown, rawAck?: unknown) => {
      const ack = safeAck(typeof payload === 'function' ? payload : rawAck);
      try {
        if (!eventLimiter.allow()) throw new Error('Too many requests — slow down');
        handler(typeof payload === 'function' ? undefined : payload, ack);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Request failed';
        try {
          ack({ ok: false, error: message });
          if (opts.emitError) socket.emit('error_message', message);
        } catch {
          /* ignore */
        }
      }
    });
  }

  on('create_room', (payload, ack) => {
    if (!allowJoinAttempt(socket)) throw new Error('Too many attempts — wait a minute');
    const { name } = parseCreateRoom(payload);
    if (rooms.size >= MAX_ROOMS) throw new Error('Server is full — try again later');
    leaveCurrentRoom(socket);
    const room = GameRoom.create((code) => rooms.has(code));
    const { playerId, token } = room.addPlayer(name, socket.id);
    rooms.set(room.code, room);
    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    const state = room.toPublic(playerId);
    ack({ ok: true, state, token, playerId, roomCode: room.code });
    socket.emit('state', state);
  });

  on('join_room', (payload, ack) => {
    if (!allowJoinAttempt(socket)) throw new Error('Too many attempts — wait a minute');
    const { roomCode, name, token: suppliedToken } = parseJoinRoom(payload);
    const room = getRoom(roomCode);
    if (!room) throw new Error('Room not found');

    let playerId: string;
    let token: string;
    if (suppliedToken) {
      const seat = room.seatForToken(suppliedToken);
      if (!seat) throw new Error('Session not found — join with a new name');
      // Switching seat or room on this socket: release the old seat first.
      if (socket.data.roomCode && (socket.data.roomCode !== room.code || socket.data.playerId !== seat)) {
        leaveCurrentRoom(socket);
      }
      const result = room.rejoin(suppliedToken, socket.id);
      ({ playerId, token } = result);
      detachSocket(result.previousSocketId, room.code);
    } else {
      // New seat only. A taken name is an error — never a takeover.
      if (socket.data.roomCode) leaveCurrentRoom(socket);
      ({ playerId, token } = room.addPlayer(name, socket.id));
    }

    socket.data.roomCode = room.code;
    socket.data.playerId = playerId;
    socket.join(room.code);
    const state = room.toPublic(playerId);
    ack({ ok: true, state, token, playerId, roomCode: room.code });
    emitRoom(room);
  });

  on(
    'start_game',
    (_payload, ack) => {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.startGame(socket.data.playerId);
      emitRoom(room);
      ack({ ok: true });
    },
    { emitError: true },
  );

  on(
    'place_bid',
    (payload, ack) => {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.placeBid(socket.data.playerId, parseBid(payload));
      emitRoom(room);
      ack({ ok: true });
    },
    { emitError: true },
  );

  on(
    'play_card',
    (payload, ack) => {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.playCard(socket.data.playerId, parseCardId(payload));
      emitRoom(room);
      ack({ ok: true });
    },
    { emitError: true },
  );

  on(
    'next_hand',
    (_payload, ack) => {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.advanceAfterHandResult(socket.data.playerId);
      emitRoom(room);
      ack({ ok: true });
    },
    { emitError: true },
  );

  socket.on('disconnect', () => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (!room) return;
      room.disconnect(socket.id);
      emitRoom(room);
    } catch (e) {
      console.error('disconnect handler error', e);
    }
  });
});

// Remove abandoned rooms and stale rate-limit entries so memory stays bounded.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isAbandoned(now, ROOM_IDLE_MS)) rooms.delete(code);
  }
  for (const [ip, entry] of ipJoinLimiters) {
    if (now - entry.lastSeen > 5 * 60_000) ipJoinLimiters.delete(ip);
  }
}, SWEEP_INTERVAL_MS).unref();

httpServer.listen(PORT, () => {
  console.log(`CFB server listening on http://localhost:${PORT}`);
});
