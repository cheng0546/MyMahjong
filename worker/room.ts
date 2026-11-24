import { DurableObject } from 'cloudflare:workers';
import { act, activeSeats, closeClaim, newMatch, startRound, type Action, type GameEvent, type Match } from '../shared/engine';
import { DEFAULT_RULES } from '../shared/rules';
import { shuffle } from '../shared/tiles';
import {
  buildGameView,
  diffView,
  redactEvent,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
} from '../shared/view';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

/** 本局结束后等待下一局的最长时间。 */
export const BETWEEN_ROUNDS_MS = 10 * 60 * 1000;
/** 牌局/结算阶段四人全部离线后的宽限期。 */
export const OFFLINE_GRACE_MS = 60 * 1000;
/** 大厅阶段无人在线的宽限期。 */
export const LOBBY_OFFLINE_GRACE_MS = 5 * 60 * 1000;

interface Member {
  id: string;
  tokenHash: string;
  name: string;
  ready: boolean;
}

interface RoomData {
  code: string;
  hostId: string;
  stage: 'lobby' | 'game' | 'between';
  members: Member[];
  match: Match | null;
  nextReady: boolean[];
  betweenDeadline: number | null;
  offlineSince: number | null;
  v: number;
  seenIds: string[];
}

interface Attachment {
  memberId: string | null;
}

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const randomToken = (): string => b64url(crypto.getRandomValues(new Uint8Array(24)));
const sha256 = async (s: string): Promise<string> => b64url(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function cryptoRng(): number {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return (a[0]! * 2 ** 21 + (a[1]! >>> 11)) / 2 ** 53;
}

export function parseAction(x: unknown): Action | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  const int = (v: unknown): v is number => Number.isInteger(v);
  switch (o.a) {
    case 'swapDir':
      return ['none', 'cw', 'ccw', 'opp'].includes(o.dir as string) ? { a: 'swapDir', dir: o.dir as never } : null;
    case 'swapPick':
      return Array.isArray(o.tiles) && o.tiles.length === 3 && o.tiles.every(int)
        ? { a: 'swapPick', tiles: o.tiles as number[] }
        : null;
    case 'que':
      return int(o.suit) ? { a: 'que', suit: o.suit } : null;
    case 'discard':
      return int(o.tile) ? { a: 'discard', tile: o.tile } : null;
    case 'peng':
      return { a: 'peng' };
    case 'gang':
      return o.tile === undefined || o.tile === null ? { a: 'gang' } : int(o.tile) ? { a: 'gang', tile: o.tile } : null;
    case 'hu':
      return { a: 'hu' };
    default:
      return null;
  }
}

export class Room extends DurableObject<Env> {
  private data: RoomData | null = null;
  private lastViews = new Map<string, RoomView>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    const rows = ctx.storage.sql.exec("SELECT v FROM kv WHERE k = 'room'").toArray();
    if (rows.length) this.data = JSON.parse(rows[0]!.v as string) as RoomData;
  }

  private save(): void {
    if (!this.data) return;
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('room', ?)", JSON.stringify(this.data));
  }

  // ---------- HTTP (由 Worker 转发) ----------
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const code = request.headers.get('x-room-code') ?? '';
    if (url.pathname.endsWith('/ws')) return this.openSocket(request);
    if (request.method === 'GET') {
      if (!this.data) return json({ error: 'not-found' }, 404);
      return json({ stage: this.data.stage, count: this.data.members.length, full: this.data.members.length >= 4 });
    }
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
    if (!name) return json({ error: 'bad-name' }, 400);

    if (url.pathname.endsWith('/create')) {
      if (this.data) return json({ error: 'exists' }, 409);
      const token = randomToken();
      const id = randomToken();
      this.data = {
        code,
        hostId: id,
        stage: 'lobby',
        members: [{ id, tokenHash: await sha256(token), name, ready: false }],
        match: null,
        nextReady: [false, false, false, false],
        betweenDeadline: null,
        offlineSince: Date.now(),
        v: 0,
        seenIds: [],
      };
      this.save();
      await this.reschedule();
      return json({ code, token });
    }
    if (url.pathname.endsWith('/join')) {
      const d = this.data;
      if (!d) return json({ error: 'not-found' }, 404);
      if (d.stage !== 'lobby') return json({ error: 'started' }, 409);
      if (d.members.length >= 4) return json({ error: 'full' }, 409);
      if (d.members.some((m) => m.name === name)) return json({ error: 'name-taken' }, 409);
      const token = randomToken();
      d.members.push({ id: randomToken(), tokenHash: await sha256(token), name, ready: false });
      this.save();
      this.commit([]);
      return json({ code: d.code, token });
    }
    return json({ error: 'not-found' }, 404);
  }

  private openSocket(request: Request): Response {
    if (!this.data) return json({ error: 'not-found' }, 404);
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'upgrade-required' }, 426);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ memberId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- WebSocket ----------
  private memberOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.memberId ?? null;
  }
  private seatOfMember(id: string): number {
    return this.data ? this.data.members.findIndex((m) => m.id === id) : -1;
  }
  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 连接已关闭 */
    }
  }
  private online(id: string): boolean {
    return this.ctx.getWebSockets().some((w) => this.memberOf(w) === id);
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 2048) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const d = this.data;
    if (!d) {
      ws.close(1008, 'gone');
      return;
    }
    const me = this.memberOf(ws);
    if (!me) {
      if (msg.t !== 'auth' || typeof msg.token !== 'string' || msg.token.length > 64) {
        ws.close(1008, 'auth');
        return;
      }
      const h = await sha256(msg.token);
      const m = d.members.find((x) => x.tokenHash === h);
      if (!m) {
        this.send(ws, { t: 'error', code: 'auth' });
        ws.close(1008, 'auth');
        return;
      }
      ws.serializeAttachment({ memberId: m.id } satisfies Attachment);
      d.offlineSince = null;
      this.lastViews.delete(m.id);
      this.save();
      this.sendSnapshot(ws, m.id);
      this.commit([]);
      await this.reschedule();
      return;
    }
    const seat = this.seatOfMember(me);
    if (seat < 0) return;

    switch (msg.t) {
      case 'ping':
        this.send(ws, { t: 'pong' });
        return;
      case 'sync':
        this.lastViews.delete(me);
        this.sendSnapshot(ws, me);
        return;
      case 'ready':
        if (d.stage !== 'lobby' || typeof msg.ready !== 'boolean') return;
        d.members[seat]!.ready = msg.ready;
        break;
      case 'start': {
        if (d.stage !== 'lobby' || d.hostId !== me) return this.send(ws, { t: 'error', code: 'invalid' });
        if (d.members.length !== 4 || !d.members.every((m) => m.ready)) return this.send(ws, { t: 'error', code: 'not-ready' });
        shuffle(d.members, cryptoRng);
        const dealer = Math.floor(cryptoRng() * 4);
        d.match = newMatch(DEFAULT_RULES, dealer);
        d.stage = 'game';
        this.lastViews.clear();
        startRound(d.match, cryptoRng);
        break;
      }
      case 'next':
        if (d.stage !== 'between' || !d.match) return;
        d.nextReady[seat] = true;
        if (d.nextReady.every(Boolean)) {
          d.stage = 'game';
          d.betweenDeadline = null;
          d.nextReady = [false, false, false, false];
          startRound(d.match, cryptoRng);
        }
        break;
      case 'dissolve':
        if (d.hostId !== me) return;
        await this.dissolve('host');
        return;
      case 'act': {
        if (d.stage !== 'game' || !d.match || typeof msg.id !== 'string' || msg.id.length > 64) return;
        const key = `${me}:${msg.id}`;
        if (d.seenIds.includes(key)) return;
        d.seenIds.push(key);
        if (d.seenIds.length > 200) d.seenIds.shift();
        const action = parseAction(msg.action);
        if (!action) return this.send(ws, { t: 'error', code: 'invalid', id: msg.id });
        const res = act(d.match, seat, action, Date.now());
        if (!res.ok) {
          this.save();
          return this.send(ws, { t: 'error', code: 'invalid', id: msg.id });
        }
        this.afterEvents(res.events);
        this.save();
        this.commit(res.events);
        await this.reschedule();
        return;
      }
      default:
        return;
    }
    this.save();
    this.commit([]);
    await this.reschedule();
  }

  private afterEvents(events: GameEvent[]): void {
    const d = this.data!;
    if (events.some((e) => e.k === 'roundEnd')) {
      d.stage = 'between';
      d.nextReady = [false, false, false, false];
      d.betweenDeadline = Date.now() + BETWEEN_ROUNDS_MS;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }
  private async onDisconnect(ws: WebSocket): Promise<void> {
    const d = this.data;
    if (!d) return;
    const me = this.memberOf(ws);
    try {
      ws.close(1000, 'bye');
    } catch {
      /* 已关闭 */
    }
    if (!me) return;
    if (!d.members.some((m) => this.online(m.id) && this.ctx.getWebSockets().some((w) => w !== ws && this.memberOf(w) === m.id))) {
      d.offlineSince ??= Date.now();
    }
    this.save();
    this.commit([]);
    await this.reschedule();
  }

  // ---------- 视图与广播 ----------
  private isOnline(id: string, excluding?: WebSocket): boolean {
    return this.ctx.getWebSockets().some((w) => w !== excluding && this.memberOf(w) === id);
  }

  buildView(id: string): RoomView {
    const d = this.data!;
    const seat = this.seatOfMember(id);
    const hostSeat = this.seatOfMember(d.hostId);
    return {
      v: d.v,
      code: d.code,
      stage: d.stage,
      mySeat: seat,
      hostSeat,
      members: d.members.map((m) => ({ name: m.name, online: this.isOnline(m.id), ready: m.ready })),
      nextReady: [...d.nextReady],
      dissolveAt: d.stage === 'between' ? d.betweenDeadline : null,
      game: d.match ? buildGameView(d.match, seat) : null,
    };
  }

  private sendSnapshot(ws: WebSocket, id: string): void {
    const view = this.buildView(id);
    this.lastViews.set(id, view);
    this.send(ws, { t: 'snapshot', v: view.v, view });
  }

  private commit(events: GameEvent[]): void {
    const d = this.data;
    if (!d) return;
    const next = new Map<string, { view: RoomView; ops: ReturnType<typeof diffView> }>();
    let changed = events.length > 0;
    for (const m of d.members) {
      const prev = this.lastViews.get(m.id);
      const view = this.buildView(m.id);
      const ops = prev ? diffView(prev, { ...view, v: prev.v }) : [];
      if (ops.length || (!prev && this.isOnline(m.id))) changed = true;
      next.set(m.id, { view, ops });
    }
    if (!changed) return;
    d.v += 1;
    this.save();
    for (const ws of this.ctx.getWebSockets()) {
      const id = this.memberOf(ws);
      if (!id) continue;
      const entry = next.get(id);
      if (!entry) continue;
      const prev = this.lastViews.get(id);
      const seat = this.seatOfMember(id);
      entry.view.v = d.v;
      if (!prev) {
        this.send(ws, { t: 'snapshot', v: d.v, view: entry.view });
      } else {
        this.send(ws, {
          t: 'patch',
          v: d.v,
          ops: entry.ops,
          evs: events.map((e) => redactEvent(e, seat)),
        });
      }
    }
    for (const [id, e] of next) this.lastViews.set(id, e.view);
  }

  // ---------- 定时器(Durable Object alarm) ----------
  private nextDeadline(): number | null {
    const d = this.data;
    if (!d) return null;
    const times: number[] = [];
    const claim = d.match?.round?.claim;
    if (d.stage === 'game' && claim) times.push(claim.deadline);
    if (d.stage === 'between' && d.betweenDeadline) times.push(d.betweenDeadline);
    if (d.offlineSince !== null) {
      times.push(d.offlineSince + (d.stage === 'lobby' ? LOBBY_OFFLINE_GRACE_MS : OFFLINE_GRACE_MS));
    }
    return times.length ? Math.min(...times) : null;
  }

  private async reschedule(): Promise<void> {
    const t = this.nextDeadline();
    if (t === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(t, Date.now() + 1));
  }

  async alarm(): Promise<void> {
    const d = this.data;
    if (!d) return;
    const now = Date.now();
    if (d.offlineSince !== null && !d.members.some((m) => this.isOnline(m.id))) {
      const grace = d.stage === 'lobby' ? LOBBY_OFFLINE_GRACE_MS : OFFLINE_GRACE_MS;
      if (now >= d.offlineSince + grace) return this.dissolve('all-offline');
    }
    if (d.stage === 'between' && d.betweenDeadline && now >= d.betweenDeadline) return this.dissolve('idle');
    const claim = d.match?.round?.claim;
    if (d.stage === 'game' && d.match && claim && now >= claim.deadline) {
      const events = closeClaim(d.match);
      this.afterEvents(events);
      this.save();
      this.commit(events);
    }
    await this.reschedule();
  }

  private async dissolve(reason: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'dissolved', reason });
      try {
        ws.close(1000, 'dissolved');
      } catch {
        /* 已关闭 */
      }
    }
    this.data = null;
    this.lastViews.clear();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** 仅供测试：当前在场人数。 */
  activeCount(): number {
    const r = this.data?.match?.round;
    return r ? activeSeats(r).length : 0;
  }
}
