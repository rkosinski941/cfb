import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { GameRoom } from './gameRoom.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const rooms = new Map<string, GameRoom>();

function getRoom(code: string): GameRoom | undefined {
  return rooms.get(code.toUpperCase());
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
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
  cors: { origin: true, credentials: true },
});

function emitRoom(room: GameRoom): void {
  for (const [, socket] of io.of('/').sockets) {
    const data = socket.data as { roomCode?: string; playerId?: string };
    if (data.roomCode === room.code) {
      socket.emit('state', room.toPublic(data.playerId ?? null));
    }
  }
}

io.on('connection', (socket) => {
  socket.on('create_room', (payload: { name: string }, ack?: (r: unknown) => void) => {
    try {
      const room = GameRoom.create();
      const { playerId, token } = room.addPlayer(payload.name, socket.id);
      rooms.set(room.code, room);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.join(room.code);
      const state = room.toPublic(playerId);
      ack?.({ ok: true, state, token, playerId, roomCode: room.code });
      socket.emit('state', state);
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
    }
  });

  socket.on(
    'join_room',
    (
      payload: { roomCode: string; name: string; token?: string },
      ack?: (r: unknown) => void,
    ) => {
      try {
        const code = payload.roomCode.trim().toUpperCase();
        const room = getRoom(code);
        if (!room) throw new Error('Room not found');

        let playerId: string;
        let token: string;
        if (payload.token) {
          ({ playerId, token } = room.rejoin(payload.name, payload.token, socket.id));
        } else {
          // Try rejoin by saved token in client; else new join
          try {
            ({ playerId, token } = room.addPlayer(payload.name, socket.id));
          } catch (joinErr) {
            // Name taken — attempt rejoin by name in lobby
            ({ playerId, token } = room.rejoin(payload.name, '', socket.id));
          }
        }

        socket.data.roomCode = room.code;
        socket.data.playerId = playerId;
        socket.join(room.code);
        const state = room.toPublic(playerId);
        ack?.({ ok: true, state, token, playerId, roomCode: room.code });
        emitRoom(room);
      } catch (e) {
        ack?.({ ok: false, error: (e as Error).message });
      }
    },
  );

  socket.on('start_game', (_payload: unknown, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.startGame(socket.data.playerId);
      emitRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
      socket.emit('error_message', (e as Error).message);
    }
  });

  socket.on('place_bid', (payload: { amount: number }, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.placeBid(socket.data.playerId, payload.amount);
      emitRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
      socket.emit('error_message', (e as Error).message);
    }
  });

  socket.on('play_card', (payload: { cardId: string }, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.playCard(socket.data.playerId, payload.cardId);
      emitRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
      socket.emit('error_message', (e as Error).message);
    }
  });

  socket.on('next_hand', (_payload: unknown, ack?: (r: unknown) => void) => {
    try {
      const room = getRoom(socket.data.roomCode);
      if (!room) throw new Error('Not in a room');
      room.advanceAfterHandResult(socket.data.playerId);
      emitRoom(room);
      ack?.({ ok: true });
    } catch (e) {
      ack?.({ ok: false, error: (e as Error).message });
      socket.emit('error_message', (e as Error).message);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    room.disconnect(socket.id);
    emitRoom(room);
  });
});

httpServer.listen(PORT, () => {
  console.log(`CFB server listening on http://localhost:${PORT}`);
});
