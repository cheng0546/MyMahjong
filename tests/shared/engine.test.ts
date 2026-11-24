import { dealerMultiplier, DEFAULT_RULES, splitZhaHu } from '../../shared/rules';
import {
  act,
  closeClaim,
  newMatch,
  startRound,
  type Action,
  type Match,
  type Round,
} from '../../shared/engine';
import { sortTiles, suitOf } from '../../shared/tiles';
import { buildGameView, redactEvent } from '../../shared/view';
import { evaluateWin, tingInfo } from '../../shared/win';
import { describe, expect, it } from 'vitest';

const SUIT: Record<string, number> = { m: 0, s: 1, p: 2 };
/** h('123m 11s') -> 牌编号数组 */
export function h(s: string): number[] {
  const out: number[] = [];
  for (const part of s.trim().split(/\s+/)) {
    if (!part) continue;
    const suit = SUIT[part.slice(-1)]!;
    for (const d of part.slice(0, -1)) out.push(suit * 9 + Number(d) - 1);
  }
  return out;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const JUNK13 = h('1m 3m 5m 7m 9m 2s 4s 6s 8s 1s 3s 5s 7s'); // 不成牌型
const JUNK14 = [...JUNK13, ...h('9s')];

interface Setup {
  hands?: (number[] | undefined)[];
  que?: number[];
  dealer?: number;
  streak?: number;
  wall?: number[];
  turn?: number;
  canZimo?: boolean;
  melds?: Round['players'][number]['melds'][];
}
function mk(o: Setup = {}): Match {
  const m = newMatch(DEFAULT_RULES, o.dealer ?? 0);
  m.streak = o.streak ?? 0;
  startRound(m, lcg(7));
  const r = m.round!;
  r.phase = 'play';
  r.turn = o.turn ?? r.dealer;
  r.canZimo = o.canZimo ?? false;
  r.wall = o.wall ?? h('1m 1m 1m 1m 2m 2m 2m 2m 3m 3m 3m 3m');
  for (let s = 0; s < 4; s++) {
    const p = r.players[s]!;
    p.que = o.que?.[s] ?? 2;
    p.hand = sortTiles([...(o.hands?.[s] ?? JUNK13)]);
    p.melds = o.melds?.[s] ?? [];
  }
  return m;
}
const go = (m: Match, seat: number, a: Action, now = 0) => act(m, seat, a, now);
const R = (m: Match) => m.round!;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('胡牌判定与番数', () => {
  const rules = DEFAULT_RULES;
  it('平胡 0 番', () => {
    const ev = evaluateWin(h('123m 456m 789m 11s 234s'), [], 2, { zimo: false }, rules);
    expect(ev?.fan).toBe(0);
  });
  it('缺门牌在手不能胡', () => {
    expect(evaluateWin(h('123m 456m 789m 11s 234s'), [], 1, { zimo: false }, rules)).toBeNull();
  });
  it('对对胡 / 清一色 / 七对 / 根', () => {
    expect(evaluateWin(h('111m 222m 333m 44s 555s'), [], 2, { zimo: false }, rules)?.fan).toBe(1);
    expect(evaluateWin(h('123m 456m 789m 11m 234m'), [], 2, { zimo: false }, rules)?.fan).toBe(2);
    expect(evaluateWin(h('11m 22m 33m 44m 55m 66m 77m'), [], 2, { zimo: false }, rules)?.fan).toBe(4); // 七对2 + 清一色2
    const seven = evaluateWin(h('11m 11m 33s 44s 55s 66s 77s'), [], 2, { zimo: false }, rules);
    expect(seven?.fan).toBe(3); // 七对2 + 根1
  });
  it('金钩钓与副露', () => {
    const melds = [1, 2, 3, 4].map((i) => ({ kind: 'peng' as const, tile: i }));
    const ev = evaluateWin(h('99m'), melds, 2, { zimo: false }, rules)!;
    expect(ev.items.map((i) => i.name)).toEqual(expect.arrayContaining(['对对胡', '清一色', '金钩钓']));
  });
  it('杠上花/抢杠/海底/天胡', () => {
    const base = h('123m 456m 789m 11s 234s');
    const ev = evaluateWin(base, [], 2, { zimo: true, gangShang: true, haiDi: true, tianHu: true }, rules)!;
    expect(ev.fan).toBe(1 + 1 + 3);
    expect(evaluateWin(base, [], 2, { zimo: false, qiangGang: true }, rules)?.fan).toBe(1);
  });
  it('听牌与最大番', () => {
    const t = tingInfo(h('123m 456m 789m 1s 1s 2s 3s'), [], 2, rules);
    expect(t.ting).toBe(true);
    expect(tingInfo(JUNK13, [], 2, rules).ting).toBe(false);
  });
});

describe('炸胡分配', () => {
  it('8 分由另外三人平分，余数从下家起各多 1', () => {
    expect(splitZhaHu(8, 0)).toEqual({ 1: 3, 2: 3, 3: 2 });
    expect(splitZhaHu(8, 2)).toEqual({ 3: 3, 0: 3, 1: 2 });
    expect(splitZhaHu(9, 1)).toEqual({ 2: 3, 3: 3, 0: 3 });
  });
});

describe('开局与换牌/定缺', () => {
  it('发牌 14/13/13/13，牌墙 55 张', () => {
    const m = newMatch(DEFAULT_RULES, 2);
    startRound(m, lcg(3));
    const r = R(m);
    expect(r.players.map((p) => p.hand.length)).toEqual([13, 13, 14, 13]);
    expect(r.wall.length).toBe(55);
    expect(r.phase).toBe('swapDir');
  });
  it('庄家选对家换三张，之后定缺进入出牌', () => {
    const m = newMatch(DEFAULT_RULES, 1);
    startRound(m, lcg(5));
    expect(go(m, 0, { a: 'swapDir', dir: 'opp' }).ok).toBe(false);
    expect(go(m, 1, { a: 'swapDir', dir: 'opp' }).ok).toBe(true);
    for (let s = 0; s < 4; s++) {
      R(m).players[s]!.hand = sortTiles([...h('123m 456m 789m 1s 2s 3s 4s'), ...(s === 1 ? h('5s') : [])]);
    }
    expect(go(m, 0, { a: 'swapPick', tiles: h('1m 2m 1s') }).ok).toBe(false);
    const picks = ['123m', '456m', '789m', '123s'];
    for (let s = 0; s < 4; s++) expect(go(m, s, { a: 'swapPick', tiles: h(picks[s]!) }).ok).toBe(true);
    expect(R(m).phase).toBe('que');
    // ????:?? 0 ???? 2 ????
    expect(R(m).players[0]!.hand).toEqual(expect.arrayContaining(h('789m')));
    expect(R(m).players[0]!.hand).not.toEqual(expect.arrayContaining(h('2m')));
    for (let s = 0; s < 4; s++) go(m, s, { a: 'que', suit: s % 3 });
    expect(R(m).phase).toBe('play');
    expect(R(m).turn).toBe(1);
  });
});

describe('自摸、点炮与分数', () => {
  it('非庄家自摸：三家各付 2(底 1 + 自摸加底 1)', () => {
    const hand = h('123m 456m 789m 11s 234s');
    const m = mk({ hands: [undefined, hand], turn: 1, canZimo: true });
    const res = go(m, 1, { a: 'hu' });
    expect(res.ok).toBe(true);
    expect(R(m).players[1]!.status).toBe('hu');
    expect(R(m).players[1]!.out?.hand).toEqual(hand);
    expect(m.scores).toEqual([-2, 6, -2, -2]);
    expect(R(m).turn).toBe(2); // 轮到下一位
  });

  it('点炮：只有点炮者付 2^番', () => {
    const m = mk({
      hands: [[...JUNK13, ...h('4s')], h('123m 456m 789m 1s 1s 2s 3s')],
      turn: 0,
    });
    // 座位 0 持有 4 条以便打出
    R(m).players[0]!.hand = sortTiles([...h('1m 3m 5m 7m 9m 2s 6s 8s 1s 3s 5s 7s 9s'), ...h('4s')]);
    expect(go(m, 0, { a: 'discard', tile: h('4s')[0]! }).ok).toBe(true);
    expect(go(m, 1, { a: 'hu' }).ok).toBe(true);
    closeClaim(m);
    expect(m.scores).toEqual([-1, 1, 0, 0]);
    expect(R(m).players[1]!.out).toMatchObject({ how: 'ron', from: 0 });
  });

  it('一炮多响：放炮者付给每位胡家', () => {
    const wait = h('123m 456m 789m 1s 1s 2s 3s');
    const m = mk({ hands: [undefined, wait, wait, undefined], turn: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4s')]);
    go(m, 0, { a: 'discard', tile: h('4s')[0]! });
    go(m, 2, { a: 'hu' });
    go(m, 1, { a: 'hu' });
    closeClaim(m);
    expect(m.scores).toEqual([-2, 1, 1, 0]);
    expect(R(m).wins.map((w) => w.seat)).toEqual([1, 2]);
  });

  it('胡 > 碰：同时响应时胡牌优先', () => {
    const wait = h('123m 456m 789m 1s 1s 2s 3s');
    const m = mk({ hands: [undefined, wait, h('4s 4s 1m 3m 5m 7m 9m 2s 6s 8s 3s 5s 7s'), undefined], turn: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4s')]);
    go(m, 0, { a: 'discard', tile: h('4s')[0]! });
    go(m, 2, { a: 'peng' });
    go(m, 1, { a: 'hu' });
    closeClaim(m);
    expect(R(m).players[1]!.status).toBe('hu');
    expect(R(m).players[2]!.melds).toEqual([]);
  });
});

describe('碰、杠', () => {
  it('合法碰：窗口结束后生效，碰牌者出牌', () => {
    const m = mk({ hands: [undefined, undefined, h('4s 4s 1m 3m 5m 7m 9m 2s 6s 8s 3s 5s 7s'), undefined], turn: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4s')]);
    go(m, 0, { a: 'discard', tile: h('4s')[0]! });
    expect(go(m, 2, { a: 'peng' }).ok).toBe(true);
    closeClaim(m);
    expect(R(m).turn).toBe(2);
    expect(R(m).players[2]!.melds).toEqual([{ kind: 'peng', tile: h('4s')[0], from: 0 }]);
    expect(R(m).players[0]!.discards[0]!.taken).toBe(true);
  });

  it('非法碰/杠无效：不改变状态、不占窗口、不影响摸打', () => {
    const m = mk({ turn: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4s')]);
    const before = JSON.stringify(m);
    expect(go(m, 1, { a: 'peng' }).ok).toBe(false); // 无弃牌
    expect(go(m, 1, { a: 'gang' }).ok).toBe(false);
    expect(JSON.stringify(m)).toBe(before);
    go(m, 0, { a: 'discard', tile: h('4s')[0]! });
    const mid = JSON.stringify(m);
    expect(go(m, 1, { a: 'peng' }).ok).toBe(false); // 手里没有对子
    expect(go(m, 3, { a: 'gang' }).ok).toBe(false);
    expect(JSON.stringify(m)).toBe(mid);
    closeClaim(m);
    expect(R(m).turn).toBe(1);
    expect(R(m).players[1]!.hand.length).toBe(14); // 正常摸牌
  });

  it('明杠：点杠者付 1，补牌后继续', () => {
    const m = mk({ hands: [undefined, undefined, h('4s 4s 4s 1m 3m 5m 7m 9m 2s 6s 8s 3s 5s'), undefined], turn: 0, wall: h('9m 9m 9m') });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4s')]);
    go(m, 0, { a: 'discard', tile: h('4s')[0]! });
    expect(go(m, 2, { a: 'gang' }).ok).toBe(true);
    closeClaim(m);
    expect(m.scores).toEqual([-1, 0, 1, 0]);
    expect(R(m).turn).toBe(2);
    expect(R(m).players[2]!.hand.length).toBe(11);
    expect(R(m).players[2]!.melds[0]!.kind).toBe('ming');
  });

  it('暗杠、补杠：其余三家各付 2 / 1；补杠可被抢杠胡', () => {
    const m = mk({ hands: [undefined, h('5m 5m 5m 5m 1m 3m 7m 9m 2s 4s 6s 8s 1s 3s')], turn: 1, wall: h('9m 9m 9m 9m') });
    expect(go(m, 1, { a: 'gang' }).ok).toBe(true);
    expect(m.scores).toEqual([-2, 6, -2, -2]);

    const m2 = mk({
      hands: [undefined, h('5m 1m 3m 7m 9m 2s 4s 6s 8s 1s 3s'), h('123m 456m 789m 1s 1s 2s 3s')],
      melds: [[], [{ kind: 'peng', tile: h('5m')[0]! }], []],
      turn: 1,
      wall: h('9m 9m 9m'),
    });
    R(m2).players[2]!.hand = h('1m 2m 3m 4m 6m 7m 8m 9m 5m 5m 1s 1s 1s'); // 不是抢杠牌型占位
    R(m2).players[2]!.hand = sortTiles(h('123m 46m 789m 1s 1s 2s 3s 5m').slice(0, 0).concat(h('123m 789m 11s 234s 46m')));
    R(m2).players[1]!.hand = sortTiles(h('5m 1m 3m 7m 9m 2s 4s 6s 8s 1s 3s'));
    expect(go(m2, 1, { a: 'gang', tile: h('5m')[0]! }).ok).toBe(true);
    expect(go(m2, 2, { a: 'hu' }).ok).toBe(true);
    closeClaim(m2);
    expect(R(m2).players[2]!.out).toMatchObject({ how: 'ron', from: 1 });
    expect(R(m2).players[2]!.out!.items.map((i) => i.name)).toContain('抢杠胡');
    expect(m2.scores[1]).toBe(-(2 ** 1));
    expect(R(m2).players[1]!.melds[0]!.kind).toBe('peng'); // 杠被抢，仍是碰
  });
});

describe('炸胡', () => {
  it('不合法胡牌=炸胡：公开手牌、扣 8 分按 3/3/2 分给其余三人、退出摸打', () => {
    const m = mk({ hands: [JUNK14], turn: 0, canZimo: true, dealer: 0 });
    const res = go(m, 0, { a: 'hu' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.events[0]).toMatchObject({ k: 'zha', seat: 0, penalty: { 1: 3, 2: 3, 3: 2 } });
    expect(m.scores).toEqual([-8, 3, 3, 2]);
    expect(R(m).players[0]!.status).toBe('zha');
    expect(R(m).players[0]!.out?.hand.length).toBe(14);
    expect(R(m).turn).toBe(1); // 牌局继续
    expect(go(m, 0, { a: 'discard', tile: JUNK14[0]! }).ok).toBe(false);
    expect(go(m, 0, { a: 'peng' }).ok).toBe(false);
    expect(go(m, 0, { a: 'hu' }).ok).toBe(false);
  });

  it('非自己回合、无响应窗口时点胡也是炸胡；缺门未打完也是炸胡', () => {
    const m = mk({ turn: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('9s')]);
    expect(go(m, 2, { a: 'hu' }).ok).toBe(true);
    expect(R(m).players[2]!.status).toBe('zha');
    expect(R(m).turn).toBe(0);

    const m2 = mk({ hands: [h('123m 456m 789m 11p 234m')], turn: 0, canZimo: true, que: [2, 2, 2, 2] });
    go(m2, 0, { a: 'hu' });
    expect(R(m2).players[0]!.status).toBe('zha');
  });

  it('三人胡/炸胡后本局结束；炸胡庄家连庄', () => {
    const m = mk({ dealer: 0 });
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('9s')]);
    go(m, 0, { a: 'hu' });
    go(m, 1, { a: 'hu' });
    expect(R(m).phase).toBe('play');
    go(m, 2, { a: 'hu' });
    expect(R(m).phase).toBe('ended');
    expect(R(m).result).toMatchObject({ reason: 'threeOut', nextDealer: 0, nextStreak: 1 });
    expect(sum(m.scores)).toBe(0);
  });
});

describe('庄家与连庄', () => {
  it('庄家未胡 -> 下庄；连庄倍数 2、4 封顶', () => {
    expect(dealerMultiplier(DEFAULT_RULES, 0)).toBe(1);
    expect(dealerMultiplier(DEFAULT_RULES, 1)).toBe(2);
    expect(dealerMultiplier(DEFAULT_RULES, 2)).toBe(4);
    expect(dealerMultiplier(DEFAULT_RULES, 5)).toBe(4);

    const m = mk({ dealer: 1, hands: [undefined, undefined, h('123m 456m 789m 11s 234s')], turn: 2, canZimo: true });
    go(m, 2, { a: 'hu' });
    go(m, 3, { a: 'hu' });
    go(m, 0, { a: 'hu' });
    expect(R(m).result).toMatchObject({ nextDealer: 2, nextStreak: 0 });
  });

  it('庄家合法胡牌连庄，下一局按倍数结算', () => {
    const hand = h('123m 456m 789m 11s 234s');
    const m = mk({ dealer: 0, hands: [hand], turn: 0, canZimo: true });
    go(m, 0, { a: 'hu' });
    go(m, 1, { a: 'hu' });
    go(m, 2, { a: 'hu' });
    expect(m.dealer).toBe(0);
    expect(m.streak).toBe(1);
    startRound(m, lcg(1));
    expect(R(m).mult).toBe(2);
    const m2 = mk({ dealer: 0, streak: 2, hands: [undefined, hand], turn: 1, canZimo: true });
    R(m2).mult = dealerMultiplier(DEFAULT_RULES, 2);
    go(m2, 1, { a: 'hu' });
    expect(m2.scores[1]).toBe(2 * 4 * 3);
  });
});

describe('流局结算：查花猪 / 查大叫 / 退税', () => {
  it('牌墙摸完：花猪赔付、未听赔已听、退税', () => {
    const ting = h('123m 456m 789m 1s 1s 2s 3s'); // 听 1s/4s
    const m = mk({
      hands: [undefined, ting, h('1m 3m 5m 7m 9m 2s 4s 6s 8s 1s 3s 5s 7s'), h('1m 3m 5m 7m 9m 2s 4s 6s 8s 1s 3s 5s 1p')],
      turn: 0,
      wall: [],
    });
    // 座位 2 先前明杠得 1 分(来自 0)，流局未听牌需退税
    R(m).ledger.push({ kind: 'gang-ming', from: 0, to: 2, amount: 1 });
    R(m).players[2]!.melds = [];
    m.scores[0] = -1;
    m.scores[2] = 1;
    R(m).deltas[0] = -1;
    R(m).deltas[2] = 1;
    R(m).players[0]!.hand = sortTiles([...JUNK13, ...h('4m')]);
    go(m, 0, { a: 'discard', tile: h('4m')[0]! });
    closeClaim(m);
    expect(R(m).phase).toBe('ended');
    const res = R(m).result!;
    expect(res.reason).toBe('wall');
    expect(res.huaZhu).toEqual([3]);
    expect(res.ting.map((t) => t.seat)).toEqual([1]);
    // 座位 3 花猪 -> 赔给 0,1,2 各 8；座位 0、2 未听 -> 各赔座位 1 一分(平胡 0 番=1)；座位 2 退税 1
    expect(res.deltas).toEqual([7, 10, 7, -24]);
    expect(sum(m.scores)).toBe(0);
  });
});

describe('隐私：视图与事件不泄露他人手牌/牌墙', () => {
  it('视图只含本人手牌；暗杠牌对他人隐藏', () => {
    const m = mk({ hands: [undefined, h('5m 5m 5m 5m 1m 3m 7m 9m 2s 4s 6s 8s 1s 3s')], turn: 1, wall: h('9m 9m 9m 9m') });
    go(m, 1, { a: 'gang' });
    const v0 = buildGameView(m, 0)!;
    expect(JSON.stringify(v0)).not.toContain('"wall"');
    expect(v0.hand).toEqual(R(m).players[0]!.hand);
    expect(v0.players[1]!.melds[0]!.tile).toBeNull();
    expect(buildGameView(m, 1)!.players[1]!.melds[0]!.tile).toBe(h('5m')[0]);
    expect(v0.players[1]).not.toHaveProperty('hand');
    expect(redactEvent({ k: 'draw', seat: 1, tile: 3 }, 0)).toEqual({ k: 'draw', seat: 1, gang: undefined });
    expect(redactEvent({ k: 'gang', seat: 1, kind: 'an', tile: 4 }, 0)).toMatchObject({ tile: -1 });
  });
});

describe('随机对局稳定性', () => {
  it('随机机器人完成多局：不抛错、分数守恒、牌张守恒', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = lcg(seed);
      const m = newMatch(DEFAULT_RULES, seed % 4);
      for (let round = 0; round < 3; round++) {
        startRound(m, rng);
        go(m, m.dealer, { a: 'swapDir', dir: (['none', 'cw', 'ccw', 'opp'] as const)[seed % 4]! });
        for (let s = 0; s < 4 && R(m).phase === 'swapPick'; s++) {
          const hand = R(m).players[s]!.hand;
          const su = [0, 1, 2].find((x) => hand.filter((t) => suitOf(t) === x).length >= 3)!;
          go(m, s, { a: 'swapPick', tiles: hand.filter((t) => suitOf(t) === su).slice(0, 3) });
        }
        for (let s = 0; s < 4; s++) {
          const hand = R(m).players[s]!.hand;
          const best = [0, 1, 2].sort((a, b) => hand.filter((t) => suitOf(t) === a).length - hand.filter((t) => suitOf(t) === b).length)[0]!;
          go(m, s, { a: 'que', suit: best });
        }
        let guard = 0;
        while (R(m).phase === 'play' && guard++ < 2000) {
          const r = R(m);
          if (r.claim) {
            for (let s = 0; s < 4; s++) {
              const roll = rng();
              if (roll < 0.1) go(m, s, { a: 'peng' });
              else if (roll < 0.15) go(m, s, { a: 'gang' });
              else if (roll < 0.25) go(m, s, { a: 'hu' });
            }
            closeClaim(m);
            continue;
          }
          const p = r.players[r.turn]!;
          const roll = rng();
          if (roll < 0.05) go(m, r.turn, { a: 'hu' });
          else if (roll < 0.1) go(m, r.turn, { a: 'gang' });
          else {
            const que = p.hand.filter((t) => suitOf(t) === p.que);
            const pool = que.length ? que : p.hand;
            const res = go(m, r.turn, { a: 'discard', tile: pool[Math.floor(rng() * pool.length)]! });
            expect(res.ok).toBe(true);
          }
          // 牌张守恒
          let total = r.wall.length;
          for (const q of r.players) {
            total += q.hand.length + q.discards.filter((d) => !d.taken).length;
            for (const me of q.melds) total += me.kind === 'peng' ? 3 : 4;
          }
          expect(total).toBe(108);
          expect(sum(m.scores)).toBe(0);
        }
        expect(R(m).phase).toBe('ended');
        expect(sum(m.scores)).toBe(0);
      }
    }
  });
});
