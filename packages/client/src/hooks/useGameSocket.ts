import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GamePublicState } from '@cfb/shared';

const STORAGE_KEY = 'cfb-session';

export interface Session {
  roomCode: string;
  name: string;
  token: string;
  playerId: string;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null) {
  if (!s) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function useGameSocket() {
  const [state, setState] = useState<GamePublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      const s = loadSession();
      if (s) {
        socket.emit(
          'join_room',
          { roomCode: s.roomCode, name: s.name, token: s.token },
          (res: { ok: boolean; error?: string; state?: GamePublicState; token?: string; playerId?: string; roomCode?: string }) => {
            if (!res?.ok) {
              setError(res?.error ?? 'Rejoin failed');
              return;
            }
            if (res.state) setState(res.state);
            if (res.token && res.playerId && res.roomCode) {
              const next = {
                roomCode: res.roomCode,
                name: s.name,
                token: res.token,
                playerId: res.playerId,
              };
              saveSession(next);
              setSession(next);
            }
          },
        );
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', (s: GamePublicState) => {
      setState(s);
      setError(null);
    });
    socket.on('error_message', (msg: string) => setError(msg));

    return () => {
      socket.disconnect();
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const createRoom = useCallback((name: string) => {
    return new Promise<void>((resolve, reject) => {
      socketRef.current?.emit(
        'create_room',
        { name },
        (res: { ok: boolean; error?: string; state?: GamePublicState; token?: string; playerId?: string; roomCode?: string }) => {
          if (!res?.ok) {
            setError(res?.error ?? 'Create failed');
            reject(new Error(res?.error));
            return;
          }
          const next = {
            roomCode: res.roomCode!,
            name,
            token: res.token!,
            playerId: res.playerId!,
          };
          saveSession(next);
          setSession(next);
          if (res.state) setState(res.state);
          resolve();
        },
      );
    });
  }, []);

  const joinRoom = useCallback((roomCode: string, name: string, token?: string) => {
    return new Promise<void>((resolve, reject) => {
      socketRef.current?.emit(
        'join_room',
        { roomCode, name, token },
        (res: { ok: boolean; error?: string; state?: GamePublicState; token?: string; playerId?: string; roomCode?: string }) => {
          if (!res?.ok) {
            setError(res?.error ?? 'Join failed');
            reject(new Error(res?.error));
            return;
          }
          const next = {
            roomCode: res.roomCode!,
            name,
            token: res.token!,
            playerId: res.playerId!,
          };
          saveSession(next);
          setSession(next);
          if (res.state) setState(res.state);
          resolve();
        },
      );
    });
  }, []);

  const startGame = useCallback(() => {
    socketRef.current?.emit('start_game', {}, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Start failed');
    });
  }, []);

  const placeBid = useCallback((amount: number) => {
    socketRef.current?.emit('place_bid', { amount }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Bid failed');
    });
  }, []);

  const playCard = useCallback((cardId: string) => {
    socketRef.current?.emit('play_card', { cardId }, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Play failed');
    });
  }, []);

  const nextHand = useCallback(() => {
    socketRef.current?.emit('next_hand', {}, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok) setError(res?.error ?? 'Continue failed');
    });
  }, []);

  const leaveLocal = useCallback(() => {
    saveSession(null);
    setSession(null);
    setState(null);
  }, []);

  const shareUrl = useMemo(() => {
    if (!state?.roomCode) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', state.roomCode);
    return url.toString();
  }, [state?.roomCode]);

  return {
    state,
    error,
    connected,
    session,
    createRoom,
    joinRoom,
    startGame,
    placeBid,
    playCard,
    nextHand,
    leaveLocal,
    clearError,
    shareUrl,
  };
}
