import { useCallback, useEffect, useRef, useState } from 'react';
import type { Action, GameEvent } from '../../shared/engine';
import { applyPatch, type ClientMessage, type RoomView, type ServerMessage } from '../../shared/view';

export type Status = 'connecting' | 'online' | 'offline' | 'dissolved' | 'denied';

export interface Fx {
  seq: number;
  events: GameEvent[];
}

const tokenKey = (code: string) => `mj-token-${code}`;
export const getToken = (code: string): string | null => localStorage.getItem(tokenKey(code));
export const saveToken = (code: string, token: string): void => localStorage.setItem(tokenKey(code), token);
export const clearToken = (code: string): void => localStorage.removeItem(tokenKey(code));

export async function api<T = Record<string, unknown>>(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<{ status: number; data: T & { error?: string } }> {
  const res = await fetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  return { status: res.status, data };
}

const newId = (): string => crypto.randomUUID();

export function useRoom(code: string, token: string) {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [fx, setFx] = useState<Fx>({ seq: 0, events: [] });
  const [notice, setNotice] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<RoomView | null>(null);
  const seqRef = useRef(0);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const setBoth = (v: RoomView) => {
      viewRef.current = v;
      setView(v);
    };

    const connect = () => {
      if (closed) return;
      setStatus((s) => (s === 'online' ? 'offline' : 'connecting'));
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${code}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'auth', token } satisfies ClientMessage));
        clearInterval(ping);
        ping = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"t":"ping"}'), 20000);
      };
      ws.onmessage = (e) => {
        let m: ServerMessage;
        try {
          m = JSON.parse(e.data as string) as ServerMessage;
        } catch {
          return;
        }
        if (m.t === 'snapshot') {
          attempt = 0;
          setBoth(m.view);
          setStatus('online');
        } else if (m.t === 'patch') {
          const cur = viewRef.current;
          if (!cur || m.v <= cur.v) return;
          if (m.v !== cur.v + 1) {
            ws.send('{"t":"sync"}');
            return;
          }
          const next = structuredClone(cur);
          applyPatch(next, m.ops);
          next.v = m.v;
          setBoth(next);
          if (m.evs.length) {
            seqRef.current += 1;
            setFx({ seq: seqRef.current, events: m.evs });
          }
        } else if (m.t === 'error') {
          if (m.code === 'auth') {
            closed = true;
            clearToken(code);
            setStatus('denied');
          } else if (m.code === 'rate-limited') {
            setNotice('请求过于频繁，请稍后再试');
          }
        } else if (m.t === 'dissolved') {
          closed = true;
          clearToken(code);
          setStatus('dissolved');
        }
      };
      ws.onclose = () => {
        clearInterval(ping);
        if (closed) return;
        setStatus('offline');
        attempt += 1;
        timer = setTimeout(connect, Math.min(500 * 2 ** attempt, 8000));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(ping);
      wsRef.current?.close();
    };
  }, [code, token]);

  const act = useCallback((action: Action) => send({ t: 'act', id: newId(), action }), [send]);
  return { view, status, fx, notice, send, act };
}
