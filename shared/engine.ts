import { dealerMultiplier, snapshotRules, splitZhaHu, type RuleSnapshot } from './rules';
import { buildWall, shuffle, sortTiles, suitOf, toCounts, type Rng } from './tiles';
import { evaluateWin, tingInfo, type FanItem, type Meld, type WinEval } from './win';

export type SwapDir = 'none' | 'cw' | 'ccw' | 'opp';
export type LedgerKind =
  | 'hu-zimo'
  | 'hu-ron'
  | 'gang-ming'
  | 'gang-bu'
  | 'gang-an'
  | 'zha'
  | 'huazhu'
  | 'dajiao'
  | 'refund';

export interface LedgerEntry {
  kind: LedgerKind;
  from: number;
  to: number;
  amount: number;
}

export interface OutInfo {
  how: 'zimo' | 'ron' | 'zha';
  tile?: number;
  from?: number;
  fan: number;
  items: FanItem[];
  hand: number[];
}

export interface PlayerState {
  hand: number[];
  melds: Meld[];
  discards: { tile: number; taken: boolean }[];
  que: number | null;
  status: 'active' | 'hu' | 'zha';
  swapPick: number[] | null;
  out: OutInfo | null;
}

export type ClaimChoice = 'hu' | 'gang' | 'peng';
export interface Claim {
  kind: 'discard' | 'robgang';
  tile: number;
  from: number;
  deadline: number;
  gangShang: boolean;
  haiDi: boolean;
  choices: Record<number, ClaimChoice>;
}

export interface RoundResult {
  reason: 'threeOut' | 'wall';
  deltas: number[];
  ledger: LedgerEntry[];
  wins: { seat: number; how: 'zimo' | 'ron'; from?: number; tile: number; fan: number; items: FanItem[] }[];
  zha: number[];
  huaZhu: number[];
  ting: { seat: number; fan: number }[];
  nextDealer: number;
  nextStreak: number;
}

export interface Round {
  no: number;
  dealer: number;
  streak: number;
  mult: number;
  phase: 'swapDir' | 'swapPick' | 'que' | 'play' | 'ended';
  swapDir: SwapDir | null;
  wall: number[];
  turn: number;
  canZimo: boolean;
  afterGang: boolean;
  drawn: number | null;
  discardCount: number;
  claim: Claim | null;
  players: PlayerState[];
  ledger: LedgerEntry[];
  deltas: number[];
  wins: RoundResult['wins'];
  result: RoundResult | null;
}

export interface Match {
  rules: RuleSnapshot;
  scores: number[];
  roundNo: number;
  dealer: number;
  streak: number;
  round: Round | null;
  history: { no: number; deltas: number[]; reason: string }[];
}

export type Action =
  | { a: 'swapDir'; dir: SwapDir }
  | { a: 'swapPick'; tiles: number[] }
  | { a: 'que'; suit: number }
  | { a: 'discard'; tile: number }
  | { a: 'peng' }
  | { a: 'gang'; tile?: number }
  | { a: 'hu' };

export type GameEvent =
  | { k: 'roundStart'; no: number; dealer: number; streak: number }
  | { k: 'swapDir'; dir: SwapDir }
  | { k: 'swapDone'; got: number[][] | number[] }
  | { k: 'queDone'; que: number[] }
  | { k: 'draw'; seat: number; tile?: number; gang?: boolean }
  | { k: 'discard'; seat: number; tile: number }
  | { k: 'peng'; seat: number; from: number; tile: number }
  | { k: 'gang'; seat: number; kind: 'ming' | 'bu' | 'an'; tile: number; from?: number }
  | { k: 'robGangOpen'; seat: number; tile: number }
  | { k: 'hu'; seat: number; how: 'zimo' | 'ron'; from?: number; tile: number; fan: number; items: FanItem[]; hand: number[] }
  | { k: 'zha'; seat: number; hand: number[]; penalty: Record<number, number> }
  | { k: 'roundEnd'; result: RoundResult };

export type ActResult = { ok: true; events: GameEvent[] } | { ok: false; error: string };

const fail = (error: string): ActResult => ({ ok: false, error });

export function newMatch(rules: RuleSnapshot, dealer: number): Match {
  return { rules: snapshotRules(rules), scores: [0, 0, 0, 0], roundNo: 0, dealer, streak: 0, round: null, history: [] };
}

export function activeSeats(r: Round): number[] {
  return [0, 1, 2, 3].filter((s) => r.players[s]!.status === 'active');
}

function nextActive(r: Round, from: number): number {
  for (let i = 1; i <= 4; i++) {
    const s = (from + i) % 4;
    if (r.players[s]!.status === 'active') return s;
  }
  return from;
}

export function startRound(match: Match, rng: Rng): GameEvent[] {
  const wall = shuffle(buildWall(), rng);
  const players: PlayerState[] = [0, 1, 2, 3].map(() => ({
    hand: [],
    melds: [],
    discards: [],
    que: null,
    status: 'active' as const,
    swapPick: null,
    out: null,
  }));
  for (let i = 0; i < 13; i++) for (let s = 0; s < 4; s++) players[s]!.hand.push(wall.pop()!);
  players[match.dealer]!.hand.push(wall.pop()!);
  for (const p of players) sortTiles(p.hand);
  match.roundNo += 1;
  match.round = {
    no: match.roundNo,
    dealer: match.dealer,
    streak: match.streak,
    mult: dealerMultiplier(match.rules, match.streak),
    phase: 'swapDir',
    swapDir: null,
    wall,
    turn: match.dealer,
    canZimo: false,
    afterGang: false,
    drawn: null,
    discardCount: 0,
    claim: null,
    players,
    ledger: [],
    deltas: [0, 0, 0, 0],
    wins: [],
    result: null,
  };
  return [{ k: 'roundStart', no: match.roundNo, dealer: match.dealer, streak: match.streak }];
}

function pay(match: Match, r: Round, from: number, to: number, amount: number, kind: LedgerKind): void {
  if (amount === 0) return;
  r.ledger.push({ kind, from, to, amount });
  r.deltas[from]! -= amount;
  r.deltas[to]! += amount;
  match.scores[from]! -= amount;
  match.scores[to]! += amount;
}

function removeTiles(hand: number[], tile: number, n: number): void {
  for (let i = 0; i < n; i++) hand.splice(hand.indexOf(tile), 1);
}

function drawFor(r: Round, seat: number, events: GameEvent[], gang: boolean): void {
  const tile = r.wall.pop()!;
  const p = r.players[seat]!;
  p.hand.push(tile);
  sortTiles(p.hand);
  r.drawn = tile;
  r.turn = seat;
  r.canZimo = true;
  r.afterGang = gang;
  events.push({ k: 'draw', seat, tile, gang });
}

function advanceTurn(match: Match, r: Round, from: number, events: GameEvent[]): void {
  if (activeSeats(r).length <= 1) return endRound(match, r, 'threeOut', events);
  if (r.wall.length === 0) return endRound(match, r, 'wall', events);
  r.drawn = null;
  drawFor(r, nextActive(r, from), events, false);
}

function winCtx(r: Round, seat: number, zimo: boolean, claim?: Claim) {
  if (zimo) {
    return {
      zimo: true,
      gangShang: r.afterGang,
      haiDi: r.wall.length === 0,
      tianHu: seat === r.dealer && r.discardCount === 0 && !r.afterGang,
    };
  }
  return {
    zimo: false,
    gangShang: claim?.gangShang,
    qiangGang: claim?.kind === 'robgang',
    haiDi: claim?.haiDi,
  };
}

function winValue(match: Match, r: Round, ev: WinEval, zimo: boolean): number {
  const base = match.rules.baseScore * 2 ** ev.fan + (zimo ? match.rules.zimoExtraBase : 0);
  return base * r.mult;
}

function markOut(r: Round, seat: number, out: OutInfo): void {
  const p = r.players[seat]!;
  p.status = out.how === 'zha' ? 'zha' : 'hu';
  p.out = out;
  if (r.claim) delete r.claim.choices[seat];
}

function zha(match: Match, r: Round, seat: number, events: GameEvent[]): void {
  const p = r.players[seat]!;
  const split = splitZhaHu(match.rules.zhaHuTotal, seat);
  for (const [to, amount] of Object.entries(split)) pay(match, r, seat, Number(to), amount, 'zha');
  markOut(r, seat, { how: 'zha', fan: 0, items: [], hand: [...p.hand] });
  events.push({ k: 'zha', seat, hand: [...p.hand], penalty: split });
  const claim = r.claim;
  if (claim && claim.kind === 'robgang' && claim.from === seat) r.claim = null;
  if (r.claim) return;
  if (activeSeats(r).length <= 1) return endRound(match, r, 'threeOut', events);
  if (r.turn === seat) advanceTurn(match, r, seat, events);
}

function winZimo(match: Match, r: Round, seat: number, ev: WinEval, events: GameEvent[]): void {
  const p = r.players[seat]!;
  const tile = r.drawn ?? p.hand[p.hand.length - 1]!;
  const amount = winValue(match, r, ev, true);
  for (const s of activeSeats(r)) if (s !== seat) pay(match, r, s, seat, amount, 'hu-zimo');
  const hand = [...p.hand];
  markOut(r, seat, { how: 'zimo', tile, fan: ev.fan, items: ev.items, hand });
  r.wins.push({ seat, how: 'zimo', tile, fan: ev.fan, items: ev.items });
  events.push({ k: 'hu', seat, how: 'zimo', tile, fan: ev.fan, items: ev.items, hand });
  r.drawn = null;
  advanceTurn(match, r, seat, events);
}

export function act(match: Match, seat: number, action: Action, now: number, rng?: Rng): ActResult {
  void rng;
  const r = match.round;
  if (!r || r.phase === 'ended') return fail('no-round');
  const p = r.players[seat];
  if (!p) return fail('bad-seat');
  const events: GameEvent[] = [];

  switch (action.a) {
    case 'swapDir': {
      if (r.phase !== 'swapDir' || seat !== r.dealer) return fail('invalid');
      if (!['none', 'cw', 'ccw', 'opp'].includes(action.dir)) return fail('invalid');
      r.swapDir = action.dir;
      events.push({ k: 'swapDir', dir: action.dir });
      r.phase = action.dir === 'none' ? 'que' : 'swapPick';
      return { ok: true, events };
    }
    case 'swapPick': {
      if (r.phase !== 'swapPick' || p.swapPick) return fail('invalid');
      const t = action.tiles;
      if (!Array.isArray(t) || t.length !== 3 || t.some((x) => !Number.isInteger(x) || x < 0 || x > 26)) return fail('invalid');
      if (new Set(t.map(suitOf)).size !== 1) return fail('same-suit');
      const have = toCounts(p.hand);
      for (const x of t) if (--have[x]! < 0) return fail('invalid');
      p.swapPick = [...t];
      if (r.players.every((q) => q.swapPick)) {
        const dir = r.swapDir!;
        const src = (s: number) => (dir === 'cw' ? (s + 3) % 4 : dir === 'ccw' ? (s + 1) % 4 : (s + 2) % 4);
        const got: number[][] = [];
        for (let s = 0; s < 4; s++) got.push([...r.players[src(s)]!.swapPick!]);
        for (let s = 0; s < 4; s++) {
          const q = r.players[s]!;
          for (const x of q.swapPick!) removeTiles(q.hand, x, 1);
          q.hand.push(...got[s]!);
          sortTiles(q.hand);
          q.swapPick = null;
        }
        events.push({ k: 'swapDone', got });
        r.phase = 'que';
      }
      return { ok: true, events };
    }
    case 'que': {
      if (r.phase !== 'que' || p.que !== null) return fail('invalid');
      if (![0, 1, 2].includes(action.suit)) return fail('invalid');
      p.que = action.suit;
      if (r.players.every((q) => q.que !== null)) {
        r.phase = 'play';
        r.turn = r.dealer;
        r.canZimo = true;
        events.push({ k: 'queDone', que: r.players.map((q) => q.que!) });
      }
      return { ok: true, events };
    }
    case 'discard': {
      if (r.phase !== 'play' || r.claim || r.turn !== seat || p.status !== 'active') return fail('invalid');
      const { tile } = action;
      if (!p.hand.includes(tile)) return fail('invalid');
      if (p.hand.some((t) => suitOf(t) === p.que) && suitOf(tile) !== p.que) return fail('must-discard-que');
      removeTiles(p.hand, tile, 1);
      p.discards.push({ tile, taken: false });
      r.discardCount++;
      r.claim = {
        kind: 'discard',
        tile,
        from: seat,
        deadline: now + match.rules.claimWindowMs,
        gangShang: r.afterGang,
        haiDi: r.wall.length === 0,
        choices: {},
      };
      r.canZimo = false;
      r.afterGang = false;
      r.drawn = null;
      events.push({ k: 'discard', seat, tile });
      return { ok: true, events };
    }
    case 'peng': {
      const c = r.claim;
      if (r.phase !== 'play' || !c || c.kind !== 'discard' || c.from === seat || p.status !== 'active') return fail('invalid');
      if (toCounts(p.hand)[c.tile]! < 2) return fail('invalid');
      if (!c.choices[seat]) c.choices[seat] = 'peng';
      return { ok: true, events };
    }
    case 'gang':
      return actGang(match, r, seat, action.tile, now);
    case 'hu': {
      if (r.phase !== 'play' || p.status !== 'active') return fail('invalid');
      const c = r.claim;
      if (c && c.from !== seat) {
        const ev = evaluateWin([...p.hand, c.tile], p.melds, p.que!, winCtx(r, seat, false, c), match.rules);
        if (ev) c.choices[seat] = 'hu';
        else zha(match, r, seat, events);
      } else if (!c && r.turn === seat && r.canZimo) {
        const ev = evaluateWin(p.hand, p.melds, p.que!, winCtx(r, seat, true), match.rules);
        if (ev) winZimo(match, r, seat, ev, events);
        else zha(match, r, seat, events);
      } else {
        zha(match, r, seat, events);
      }
      return { ok: true, events };
    }
    default:
      return fail('invalid');
  }
}

function actGang(match: Match, r: Round, seat: number, tile: number | undefined, now: number): ActResult {
  const p = r.players[seat]!;
  const events: GameEvent[] = [];
  if (r.phase !== 'play' || p.status !== 'active') return fail('invalid');
  const c = r.claim;
  if (c) {
    if (c.kind !== 'discard' || c.from === seat || r.wall.length === 0) return fail('invalid');
    if (toCounts(p.hand)[c.tile]! < 3) return fail('invalid');
    if (c.choices[seat] !== 'hu') c.choices[seat] = 'gang';
    return { ok: true, events };
  }
  if (r.turn !== seat || r.wall.length === 0) return fail('invalid');
  const counts = toCounts(p.hand);
  const an = (t: number) => counts[t]! === 4;
  const bu = (t: number) => counts[t]! >= 1 && p.melds.some((m) => m.kind === 'peng' && m.tile === t);
  const cand = tile !== undefined ? [tile] : [...new Set(p.hand)];
  const pick = cand.find((t) => Number.isInteger(t) && t >= 0 && t <= 26 && (an(t) || bu(t)));
  if (pick === undefined) return fail('invalid');
  if (an(pick)) {
    removeTiles(p.hand, pick, 4);
    p.melds.push({ kind: 'an', tile: pick });
    for (const s of activeSeats(r)) if (s !== seat) pay(match, r, s, seat, match.rules.gangAn * r.mult, 'gang-an');
    events.push({ k: 'gang', seat, kind: 'an', tile: pick });
    r.drawn = null;
    drawFor(r, seat, events, true);
    return { ok: true, events };
  }
  r.claim = {
    kind: 'robgang',
    tile: pick,
    from: seat,
    deadline: now + match.rules.claimWindowMs,
    gangShang: false,
    haiDi: false,
    choices: {},
  };
  events.push({ k: 'robGangOpen', seat, tile: pick });
  return { ok: true, events };
}

/** 响应窗口结束：按 胡 > 杠 > 碰 的优先级统一裁定。可重复调用，无窗口时无动作。 */
export function closeClaim(match: Match): GameEvent[] {
  const r = match.round;
  const events: GameEvent[] = [];
  if (!r || !r.claim) return events;
  const c = r.claim;
  const from = c.from;
  const winners = [1, 2, 3]
    .map((i) => (from + i) % 4)
    .filter((s) => c.choices[s] === 'hu' && r.players[s]!.status === 'active');

  if (winners.length > 0) {
    for (const s of winners) {
      const p = r.players[s]!;
      const hand = sortTiles([...p.hand, c.tile]);
      const ev = evaluateWin(hand, p.melds, p.que!, winCtx(r, s, false, c), match.rules)!;
      pay(match, r, from, s, winValue(match, r, ev, false), 'hu-ron');
      markOut(r, s, { how: 'ron', tile: c.tile, from, fan: ev.fan, items: ev.items, hand });
      r.wins.push({ seat: s, how: 'ron', from, tile: c.tile, fan: ev.fan, items: ev.items });
      events.push({ k: 'hu', seat: s, how: 'ron', from, tile: c.tile, fan: ev.fan, items: ev.items, hand });
    }
    r.claim = null;
    if (c.kind === 'discard') {
      const d = r.players[from]!.discards;
      if (d.length) d[d.length - 1]!.taken = true;
    } else {
      removeTiles(r.players[from]!.hand, c.tile, 1);
    }
    advanceTurn(match, r, from, events);
    return events;
  }

  r.claim = null;
  if (c.kind === 'robgang') {
    const p = r.players[from]!;
    if (p.status !== 'active') return events;
    removeTiles(p.hand, c.tile, 1);
    p.melds.find((m) => m.kind === 'peng' && m.tile === c.tile)!.kind = 'bu';
    for (const s of activeSeats(r)) if (s !== from) pay(match, r, s, from, match.rules.gangBu * r.mult, 'gang-bu');
    events.push({ k: 'gang', seat: from, kind: 'bu', tile: c.tile });
    r.drawn = null;
    if (r.wall.length === 0) endRound(match, r, 'wall', events);
    else drawFor(r, from, events, true);
    return events;
  }

  const claimer = [1, 2, 3].map((i) => (from + i) % 4).find((s) => c.choices[s] === 'gang' && r.players[s]!.status === 'active');
  const penger = [1, 2, 3].map((i) => (from + i) % 4).find((s) => c.choices[s] === 'peng' && r.players[s]!.status === 'active');
  const taken = () => {
    const d = r.players[from]!.discards;
    if (d.length) d[d.length - 1]!.taken = true;
  };
  if (claimer !== undefined) {
    const p = r.players[claimer]!;
    removeTiles(p.hand, c.tile, 3);
    p.melds.push({ kind: 'ming', tile: c.tile, from });
    taken();
    pay(match, r, from, claimer, match.rules.gangMing * r.mult, 'gang-ming');
    events.push({ k: 'gang', seat: claimer, kind: 'ming', tile: c.tile, from });
    if (r.wall.length === 0) endRound(match, r, 'wall', events);
    else drawFor(r, claimer, events, true);
    return events;
  }
  if (penger !== undefined) {
    const p = r.players[penger]!;
    removeTiles(p.hand, c.tile, 2);
    p.melds.push({ kind: 'peng', tile: c.tile, from });
    taken();
    r.turn = penger;
    r.canZimo = false;
    r.afterGang = false;
    r.drawn = null;
    events.push({ k: 'peng', seat: penger, from, tile: c.tile });
    return events;
  }
  advanceTurn(match, r, from, events);
  return events;
}

function endRound(match: Match, r: Round, reason: RoundResult['reason'], events: GameEvent[]): void {
  const ting: RoundResult['ting'] = [];
  const huaZhu: number[] = [];
  const rules = match.rules;
  if (reason === 'wall') {
    const active = activeSeats(r);
    const nonTing: number[] = [];
    const tingSeats: { seat: number; fan: number }[] = [];
    for (const s of active) {
      const p = r.players[s]!;
      const hz = p.hand.some((t) => suitOf(t) === p.que) || p.melds.some((m) => suitOf(m.tile) === p.que);
      if (hz) {
        huaZhu.push(s);
        nonTing.push(s);
        continue;
      }
      const info = tingInfo(p.hand, p.melds, p.que!, rules);
      if (info.ting) tingSeats.push({ seat: s, fan: info.maxFan });
      else nonTing.push(s);
    }
    ting.push(...tingSeats);
    // 退税：未听牌/花猪退回本局杠所得
    for (const e of [...r.ledger]) {
      if (e.kind.startsWith('gang-') && nonTing.includes(e.to)) pay(match, r, e.to, e.from, e.amount, 'refund');
    }
    for (const hz of huaZhu) {
      for (let s = 0; s < 4; s++) {
        if (s !== hz && !huaZhu.includes(s)) pay(match, r, hz, s, rules.huaZhuPenalty * r.mult, 'huazhu');
      }
    }
    for (const s of nonTing) {
      if (huaZhu.includes(s)) continue;
      for (const t of tingSeats) pay(match, r, s, t.seat, rules.baseScore * 2 ** t.fan * r.mult, 'dajiao');
    }
  }
  const dealerOut = r.players[r.dealer]!.status !== 'active';
  const result: RoundResult = {
    reason,
    deltas: [...r.deltas],
    ledger: [...r.ledger],
    wins: [...r.wins],
    zha: [0, 1, 2, 3].filter((s) => r.players[s]!.status === 'zha'),
    huaZhu,
    ting,
    nextDealer: dealerOut ? r.dealer : (r.dealer + 1) % 4,
    nextStreak: dealerOut ? r.streak + 1 : 0,
  };
  r.result = result;
  r.phase = 'ended';
  r.claim = null;
  match.dealer = result.nextDealer;
  match.streak = result.nextStreak;
  match.history.push({ no: r.no, deltas: result.deltas, reason });
  if (match.history.length > 30) match.history.shift();
  events.push({ k: 'roundEnd', result });
}
