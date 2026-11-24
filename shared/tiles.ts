// 牌编号 0..26：花色 = floor(id/9)，0 万 / 1 条 / 2 筒；点数 = id%9+1。共 108 张(每种 4 张)。
export const SUIT_NAMES = ['万', '条', '筒'] as const;
export const NUM_TILE_KINDS = 27;

export const suitOf = (t: number): number => Math.floor(t / 9);
export const rankOf = (t: number): number => (t % 9) + 1;
export const tileName = (t: number): string => `${rankOf(t)}${SUIT_NAMES[suitOf(t)]}`;

export function buildWall(): number[] {
  const wall: number[] = [];
  for (let t = 0; t < NUM_TILE_KINDS; t++) for (let i = 0; i < 4; i++) wall.push(t);
  return wall;
}

export type Rng = () => number;

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export const sortTiles = (tiles: number[]): number[] => tiles.sort((a, b) => a - b);

export function toCounts(tiles: number[]): number[] {
  const c = new Array<number>(NUM_TILE_KINDS).fill(0);
  for (const t of tiles) c[t]!++;
  return c;
}
