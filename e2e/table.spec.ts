import { expect, test, type BrowserContext, type Page } from '@playwright/test';

interface Player {
  page: Page;
  ctx: BrowserContext;
  name: string;
  frames: string[];
  que: number;
}

const NAMES = ['房主甲', '乙', '丙', '丁'];

async function snapshotState(p: Page) {
  return p.evaluate(() => {
    const bottom = document.querySelector('.seat-bottom');
    return {
      seat: Number((bottom?.getAttribute('data-testid') ?? 'seat--1').split('-')[1]),
      turn: bottom?.classList.contains('turn') ?? false,
      out: bottom?.classList.contains('out') ?? false,
      claim: !!document.querySelector('[data-testid=claim-tile]'),
      result: !!document.querySelector('[data-testid=result]'),
      tiles: [...document.querySelectorAll('[data-testid^=hand-]')].map((e) => Number((e as HTMLElement).dataset.tile)),
    };
  });
}

test('四个独立浏览器客户端完成一桌牌局', async ({ browser }) => {
  const players: Player[] = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await ctx.newPage();
    const frames: string[] = [];
    page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
    players.push({ page, ctx, name: NAMES[i]!, frames, que: i % 3 });
  }
  const [host, ...guests] = players as [Player, Player, Player, Player];

  // 1. 创建房间 + 邀请加入
  await host.page.goto('/');
  await host.page.getByTestId('name').fill(host.name);
  await host.page.getByTestId('create-room').click();
  await expect(host.page.getByTestId('lobby')).toBeVisible();
  const link = await host.page.getByTestId('invite-link').inputValue();
  expect(link).toMatch(/\/r\/[A-Z2-9]{8}$/);
  for (const g of guests) {
    await g.page.goto(link);
    await g.page.getByTestId('name').fill(g.name);
    await g.page.getByTestId('join-room').click();
    await expect(g.page.getByTestId('lobby')).toBeVisible();
  }
  await expect(host.page.getByTestId('slot-3')).toContainText('丁');

  // 2. 未全部确认不能开始；全部确认后房主开始
  await expect(host.page.getByTestId('start')).toBeDisabled();
  for (const p of players) await p.page.getByTestId('ready').click();
  await expect(host.page.getByTestId('start')).toBeEnabled();
  await expect(guests[0].page.getByTestId('start')).toHaveCount(0);
  await host.page.getByTestId('start').click();
  for (const p of players) await expect(p.page.getByTestId('table')).toBeVisible();

  // 3. 换三张(由庄家决定，选择不换)与定缺
  const dealerPage = await (async () => {
    for (let i = 0; i < 100; i++) {
      for (const p of players) if (await p.page.getByTestId('swap-none').count()) return p.page;
      await host.page.waitForTimeout(50);
    }
    throw new Error('no dealer choose UI');
  })();
  await dealerPage.getByTestId('swap-none').click();
  for (const p of players) {
    await p.page.getByTestId(`que-${p.que}`).click();
  }
  for (const p of players) await expect(p.page.getByTestId('turn-name')).toBeVisible();
  for (const p of players) await expect(p.page.getByTestId('wall-count')).toContainText('牌墙 55');
  for (const p of players) await expect(p.page.getByTestId('btn-peng')).toBeEnabled();

  // 4. 隐私：任何下发的消息都不含牌墙，快照中其他玩家没有 hand 字段
  const checkPrivacy = () => {
    for (const p of players) {
      for (const raw of p.frames) {
        expect(raw).not.toMatch(/"wall"\s*:/);
        const m = JSON.parse(raw);
        if (m.t === 'snapshot' && m.view.game) for (const q of m.view.game.players) expect(q).not.toHaveProperty('hand');
      }
    }
  };
  checkPrivacy();

  // 5. 计分表手动隐藏/显示
  await expect(host.page.getByTestId('scoreboard')).toBeVisible();
  await host.page.getByTestId('toggle-score').click();
  await expect(host.page.getByTestId('scoreboard')).toHaveCount(0);
  await host.page.getByTestId('toggle-score').click();
  await expect(host.page.getByTestId('scoreboard')).toBeVisible();

  // 6. 驱动牌局：轮到的玩家出牌；同时不断点击非法的碰/杠，确认牌局不被阻塞
  const discardOnce = async (): Promise<boolean> => {
    for (const p of players) {
      const s = await snapshotState(p.page);
      if (!s.turn || s.claim || s.result) continue;
      const idx = s.tiles.findIndex((t) => Math.floor(t / 9) === p.que);
      const pick = idx >= 0 ? idx : s.tiles.length - 1;
      await p.page.getByTestId(`hand-${pick}`).click();
      await p.page.getByTestId('btn-discard').click();
      return true;
    }
    return false;
  };
  const spamInvalid = async (p: Player) => {
    await p.page.getByTestId('btn-peng').click();
    await p.page.getByTestId('btn-gang').click();
  };
  const wallOf = async (p: Player) => Number(/\d+/.exec(await p.page.getByTestId('wall-count').innerText())![0]);

  for (let i = 0; i < 6; i++) {
    for (let k = 0; k < 40 && !(await discardOnce()); k++) await host.page.waitForTimeout(50);
    await spamInvalid(players[i % 4]!);
  }
  await expect.poll(() => wallOf(host)).toBeLessThan(55);

  // 7. 非法胡 = 炸胡：被扣 8，另外三人 3/3/2 平分；炸胡者退出摸打并公开手牌
  const zhaPlayer = players[3]!;
  const zhaSeat = (await snapshotState(zhaPlayer.page)).seat;
  await zhaPlayer.page.getByTestId('btn-hu').click();
  for (const p of players) {
    await expect(p.page.getByTestId(`seat-${zhaSeat}`)).toContainText('炸胡');
    await expect(p.page.getByTestId(`banner-${zhaSeat}`)).toBeVisible();
  }
  const scores = async (p: Player) => {
    const out: number[] = [];
    for (let s = 0; s < 4; s++) out.push(Number(await p.page.getByTestId(`score-${s}`).innerText()));
    return out;
  };
  await expect.poll(async () => (await scores(host))[zhaSeat]).toBe(-8);
  const sc = await scores(host);
  expect(sc.reduce((a, b) => a + b, 0)).toBe(0);
  expect(sc.filter((_, s) => s !== zhaSeat).sort()).toEqual([2, 3, 3]);
  for (const p of players) expect(await scores(p)).toEqual(sc);
  // 炸胡者之后不能再出牌
  const zs = await snapshotState(zhaPlayer.page);
  expect(zs.out).toBe(true);

  // 8. 断线重连：刷新一位玩家，回到原座位与牌局
  const reloader = players[1]!;
  const before = await snapshotState(reloader.page);
  await reloader.page.reload();
  await expect(reloader.page.getByTestId('table')).toBeVisible();
  const after = await snapshotState(reloader.page);
  expect(after.seat).toBe(before.seat);
  expect(after.tiles.length).toBeGreaterThanOrEqual(13);

  // 9. 打到本局结束(牌墙摸完或三人退出)
  const deadline = Date.now() + 200_000;
  let ended = false;
  while (!ended && Date.now() < deadline) {
    if (!(await discardOnce())) await host.page.waitForTimeout(40);
    for (const p of players) if ((await snapshotState(p.page)).result) ended = true;
  }
  expect(ended).toBe(true);
  checkPrivacy();

  // 10. 结算：显示炸胡扣分，本局分数之和为 0，累计分数一致
  for (const p of players) {
    const r = p.page.getByTestId('result');
    await expect(r).toBeVisible();
    await expect(r).toContainText('炸胡');
    await expect(r).toContainText('共扣 8');
  }
  const total = await host.page
    .getByTestId('result')
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((r) => Number((r.children[1] as HTMLElement).innerText)));
  expect(total.reduce((a, b) => a + b, 0)).toBe(0);

  // 11. 四人进入下一局：局数递增
  for (const p of players) await p.page.getByTestId('next-round').click();
  for (const p of players) {
    await expect(p.page.getByTestId('round-info')).toContainText('第 2 局');
    await expect(p.page.getByTestId('result')).toHaveCount(0);
  }

  for (const p of players) await p.ctx.close();
});
