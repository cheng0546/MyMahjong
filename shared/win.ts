import type { RuleSnapshot } from './rules';
import { NUM_TILE_KINDS, suitOf, toCounts } from './tiles';

export type MeldKind = 'peng' | 'ming' | 'bu' | 'an';
export interface Meld {
  kind: MeldKind;
  tile: number;
  from?: number;
}

export interface WinCtx {
  zimo: boolean;
  /** 杠上花(自摸)或杠上炮(点炮)。 */
  gangShang?: boolean;
  qiangGang?: boolean;
  /** 海底捞月 / 海底炮。 */
  haiDi?: boolean;
  tianHu?: boolean;
}

export interface FanItem {
  name: string;
  fan: number;
}
export interface WinEval {
  fan: number;
  items: FanItem[];
}

function removeSets(c: number[], tripletsOnly: boolean): boolean {
  let i = 0;
  while (i < NUM_TILE_KINDS && c[i] === 0) i++;
  if (i === NUM_TILE_KINDS) return true;
  if (c[i]! >= 3) {
    c[i]! -= 3;
    const ok = removeSets(c, tripletsOnly);
    c[i]! += 3;
    if (ok) return true;
  }
  if (!tripletsOnly && i % 9 <= 6 && c[i + 1]! > 0 && c[i + 2]! > 0) {
    c[i]!--;
    c[i + 1]!--;
    c[i + 2]!--;
    const ok = removeSets(c, tripletsOnly);
    c[i]!++;
    c[i + 1]!++;
    c[i + 2]!++;
    if (ok) return true;
  }
  return false;
}

/** 手牌(不含副露)能否拆成若干面子 + 一对将。 */
export function isWinShape(c: number[], tripletsOnly = false): boolean {
  for (let i = 0; i < NUM_TILE_KINDS; i++) {
    if (c[i]! >= 2) {
      c[i]! -= 2;
      const ok = removeSets(c, tripletsOnly);
      c[i]! += 2;
      if (ok) return true;
    }
  }
  return false;
}

export function isSevenPairs(c: number[]): boolean {
  let total = 0;
  for (const n of c) {
    if (n % 2 !== 0) return false;
    total += n;
  }
  return total === 14;
}

export function meldTileCount(m: Meld): number {
  return m.kind === 'peng' ? 3 : 4;
}

/** 评估一手完整牌(hand 含和牌张)。不能胡返回 null。 */
export function evaluateWin(
  hand: number[],
  melds: Meld[],
  que: number,
  ctx: WinCtx,
  rules: RuleSnapshot,
): WinEval | null {
  if (hand.length + melds.length * 3 !== 14) return null;
  if (hand.some((t) => suitOf(t) === que) || melds.some((m) => suitOf(m.tile) === que)) return null;
  const c = toCounts(hand);
  const items: FanItem[] = [];
  const seven = melds.length === 0 && isSevenPairs(c);
  const standard = isWinShape(c);
  if (!seven && !standard) return null;

  const std: FanItem | null = standard
    ? isWinShape(c, true)
      ? { name: '对对胡', fan: rules.fan.duiDui }
      : { name: '平胡', fan: 0 }
    : null;
  const sev: FanItem | null = seven ? { name: '七对', fan: rules.fan.qiDui } : null;
  items.push(std && sev ? (sev.fan > std.fan ? sev : std) : (std ?? sev)!);

  const suits = new Set<number>();
  for (const t of hand) suits.add(suitOf(t));
  for (const m of melds) suits.add(suitOf(m.tile));
  if (suits.size === 1) items.push({ name: '清一色', fan: rules.fan.qingYiSe });

  if (melds.length === 4) items.push({ name: '金钩钓', fan: rules.fan.jinGouDiao });

  const total = c.slice();
  for (const m of melds) total[m.tile]! += meldTileCount(m);
  let roots = 0;
  for (const n of total) if (n === 4) roots++;
  if (roots > 0) items.push({ name: roots > 1 ? `根×${roots}` : '根', fan: rules.fan.gen * roots });

  if (ctx.tianHu) items.push({ name: '天胡', fan: rules.fan.tianHu });
  if (ctx.gangShang) items.push({ name: ctx.zimo ? '杠上花' : '杠上炮', fan: rules.fan.gangShang });
  if (ctx.qiangGang) items.push({ name: '抢杠胡', fan: rules.fan.qiangGang });
  if (ctx.haiDi) items.push({ name: ctx.zimo ? '海底捞月' : '海底炮', fan: rules.fan.haiDi });

  return { fan: items.reduce((s, i) => s + i.fan, 0), items };
}

/** 13 张牌是否听牌，以及点炮最大番数(用于查大叫)。 */
export function tingInfo(
  hand: number[],
  melds: Meld[],
  que: number,
  rules: RuleSnapshot,
): { ting: boolean; maxFan: number } {
  let maxFan = -1;
  const held = toCounts(hand);
  for (const m of melds) held[m.tile]! += meldTileCount(m);
  for (let t = 0; t < NUM_TILE_KINDS; t++) {
    if (suitOf(t) === que || held[t]! >= 4) continue;
    const ev = evaluateWin([...hand, t], melds, que, { zimo: false }, rules);
    if (ev && ev.fan > maxFan) maxFan = ev.fan;
  }
  return { ting: maxFan >= 0, maxFan: Math.max(maxFan, 0) };
}
