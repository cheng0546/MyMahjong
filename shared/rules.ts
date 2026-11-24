// 集中管理的规则配置。每局开局时拷贝为快照保存，牌局中不得修改。
// 完整说明见 docs/RULES.md。

export interface RuleSnapshot {
  version: 1;
  /** 弃牌后允许碰/杠/胡的响应窗口(毫秒)。窗口结束时由服务器按优先级统一裁定。 */
  claimWindowMs: number;
  /** 底分。胡牌每人基础付分 = baseScore * 2^番数。 */
  baseScore: number;
  /** 自摸时每位付分者额外多付的底分(自摸加底)。 */
  zimoExtraBase: number;
  /** 明杠(点杠者一人付)。 */
  gangMing: number;
  /** 补杠(其余在场玩家各付)。 */
  gangBu: number;
  /** 暗杠(其余在场玩家各付)。 */
  gangAn: number;
  /** 炸胡处罚总额，由另外三名玩家平分；余数从炸胡者下家起按座位顺序各多得 1 分。 */
  zhaHuTotal: number;
  /** 查花猪：每个花猪赔给每个非花猪玩家的分数。 */
  huaZhuPenalty: number;
  /** 连庄倍数封顶(含)。连庄 n 次，倍数 = min(2^n, cap)。 */
  dealerMultiplierCap: number;
  /** 番数表。胡牌番型不封顶。 */
  fan: {
    duiDui: number;
    qingYiSe: number;
    qiDui: number;
    jinGouDiao: number;
    gen: number;
    gangShang: number;
    qiangGang: number;
    haiDi: number;
    tianHu: number;
  };
}

export const DEFAULT_RULES: RuleSnapshot = {
  version: 1,
  claimWindowMs: 3000,
  baseScore: 1,
  zimoExtraBase: 1,
  gangMing: 1,
  gangBu: 1,
  gangAn: 2,
  zhaHuTotal: 8,
  huaZhuPenalty: 8,
  dealerMultiplierCap: 4,
  fan: {
    duiDui: 1,
    qingYiSe: 2,
    qiDui: 2,
    jinGouDiao: 1,
    gen: 1,
    gangShang: 1,
    qiangGang: 1,
    haiDi: 1,
    tianHu: 3,
  },
};

export function snapshotRules(overrides: Partial<RuleSnapshot> = {}): RuleSnapshot {
  return JSON.parse(JSON.stringify({ ...DEFAULT_RULES, ...overrides })) as RuleSnapshot;
}

export function dealerMultiplier(rules: RuleSnapshot, streak: number): number {
  return Math.min(2 ** streak, rules.dealerMultiplierCap);
}

/** 炸胡处罚分配：返回另外三人各得多少(按座位顺序)。 */
export function splitZhaHu(total: number, zhaSeat: number): Record<number, number> {
  const base = Math.floor(total / 3);
  let rem = total - base * 3;
  const out: Record<number, number> = {};
  for (let i = 1; i <= 3; i++) {
    const seat = (zhaSeat + i) % 4;
    out[seat] = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}
