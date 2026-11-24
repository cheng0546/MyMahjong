import type { Action, GameEvent, Match, OutInfo, RoundResult, SwapDir } from './engine';
import type { RuleSnapshot } from './rules';

export interface PublicMeld {
  kind: 'peng' | 'ming' | 'bu' | 'an';
  /** 暗杠对其他玩家不公开(null)。 */
  tile: number | null;
  from: number | null;
}

export interface PublicPlayer {
  handCount: number;
  melds: PublicMeld[];
  discards: { tile: number; taken: boolean }[];
  /** 定缺：全员选定前只有本人可见。 */
  que: number | null;
  status: 'active' | 'hu' | 'zha';
  out: OutInfo | null;
  /** 换三张是否已提交(不含具体牌)。 */
  swapDone: boolean;
}

export interface GameView {
  rules: RuleSnapshot;
  roundNo: number;
  dealer: number;
  streak: number;
  mult: number;
  phase: 'swapDir' | 'swapPick' | 'que' | 'play' | 'ended';
  swapDir: SwapDir | null;
  wallCount: number;
  turn: number;
  scores: number[];
  deltas: number[];
  hand: number[];
  drawn: number | null;
  players: PublicPlayer[];
  claim: { kind: 'discard' | 'robgang'; tile: number; from: number; deadline: number } | null;
  result: RoundResult | null;
  history: Match['history'];
}

export interface RoomMember {
  name: string;
  online: boolean;
  ready: boolean;
}

export interface RoomView {
  v: number;
  code: string;
  stage: 'lobby' | 'game' | 'between';
  mySeat: number;
  hostSeat: number;
  members: RoomMember[];
  /** 一局结束后各座位是否已确认进入下一局。 */
  nextReady: boolean[];
  /** 牌桌将在此时间(ms 时间戳)自动解散；null 表示没有解散计时。 */
  dissolveAt: number | null;
  game: GameView | null;
}

export function buildGameView(match: Match, seat: number): GameView | null {
  const r = match.round;
  if (!r) return null;
  const queRevealed = r.phase === 'play' || r.phase === 'ended';
  return {
    rules: match.rules,
    roundNo: r.no,
    dealer: r.dealer,
    streak: r.streak,
    mult: r.mult,
    phase: r.phase,
    swapDir: r.swapDir,
    wallCount: r.wall.length,
    turn: r.turn,
    scores: [...match.scores],
    deltas: [...r.deltas],
    hand: [...r.players[seat]!.hand],
    drawn: r.turn === seat && r.phase === 'play' && !r.claim ? r.drawn : null,
    players: r.players.map((p, s) => ({
      handCount: p.hand.length,
      melds: p.melds.map((m) => ({
        kind: m.kind,
        tile: m.kind === 'an' && s !== seat && p.status === 'active' ? null : m.tile,
        from: m.from ?? null,
      })),
      discards: p.discards.map((d) => ({ ...d })),
      que: queRevealed || s === seat ? p.que : null,
      status: p.status,
      out: p.out,
      swapDone: p.swapPick !== null,
    })),
    claim: r.claim ? { kind: r.claim.kind, tile: r.claim.tile, from: r.claim.from, deadline: r.claim.deadline } : null,
    result: r.result,
    history: match.history,
  };
}

/** 事件按接收者脱敏：他人摸到的牌、他人换来的牌不可见。 */
export function redactEvent(ev: GameEvent, seat: number): GameEvent {
  if (ev.k === 'draw' && ev.seat !== seat) return { k: 'draw', seat: ev.seat, gang: ev.gang };
  if (ev.k === 'swapDone') return { k: 'swapDone', got: (ev.got as number[][])[seat]! };
  if (ev.k === 'gang' && ev.kind === 'an' && ev.seat !== seat) return { ...ev, tile: -1 };
  return ev;
}

export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'next' }
  | { t: 'act'; id: string; action: Action }
  | { t: 'sync' }
  | { t: 'ping' }
  | { t: 'dissolve' };

export type PatchPath = (string | number)[];
export type PatchOp = [PatchPath, unknown];

export type ServerMessage =
  | { t: 'snapshot'; v: number; view: RoomView }
  | { t: 'patch'; v: number; ops: PatchOp[]; evs: GameEvent[] }
  | { t: 'error'; code: string; id?: string }
  | { t: 'dissolved'; reason: string }
  | { t: 'pong' };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function diffView(a: unknown, b: unknown, path: PatchPath = [], depth = 0, ops: PatchOp[] = []): PatchOp[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return ops;
  if (depth < 4 && isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffView(a[k], b[k], [...path, k], depth + 1, ops);
  } else if (depth < 4 && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < a.length; i++) diffView(a[i], b[i], [...path, i], depth + 1, ops);
  } else {
    ops.push([path, b === undefined ? null : b]);
  }
  return ops;
}

/** 就地应用补丁；调用方应先对旧视图做 structuredClone。 */
export function applyPatch(root: unknown, ops: PatchOp[]): void {
  for (const [path, value] of ops) {
    let cur = root as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]!] as Record<string | number, unknown>;
    cur[path[path.length - 1]!] = value;
  }
}
