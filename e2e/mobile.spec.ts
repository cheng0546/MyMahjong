import { expect, test, type Page } from '@playwright/test';

const NAMES = ['房主甲', '乙', '丙', '丁'];

async function layoutReport(page: Page, label: string) {
  return page.evaluate((label) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth - vw;
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > vw + 1 || r.left < -1);
      })
      .slice(0, 5)
      .map((e) => e.className || e.tagName);
    const tiles = [...document.querySelectorAll<HTMLElement>('[data-testid^=hand-]')].map((e) => e.getBoundingClientRect());
    const minTile = tiles.length ? { w: Math.min(...tiles.map((r) => r.width)), h: Math.min(...tiles.map((r) => r.height)) } : null;
    const buttons = ['btn-peng', 'btn-gang', 'btn-hu'].map((id) => {
      const el = document.querySelector<HTMLElement>(`[data-testid=${id}]`);
      if (!el) return { id, found: false };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return {
        id,
        found: true,
        w: Math.round(r.width),
        h: Math.round(r.height),
        inView: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh,
        covered: !(top === el || el.contains(top)),
      };
    });
    return { label, vw, vh, overflowX, offenders, tileCount: tiles.length, minTile, buttons };
  }, label);
}

for (const width of [320, 360, 390]) {
  test(`手机窄屏布局 ${width}px`, async ({ browser }) => {
    test.setTimeout(120_000);
    const height = width === 320 ? 568 : 740;
    const pages: Page[] = [];
    for (let i = 0; i < 4; i++) {
      const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
      pages.push(await ctx.newPage());
    }
    const reports: unknown[] = [];
    const [host, ...guests] = pages as [Page, Page, Page, Page];

    await host.goto('/');
    reports.push(await layoutReport(host, 'home'));
    await host.getByTestId('name').fill(NAMES[0]!);
    await host.getByTestId('create-room').click();
    await expect(host.getByTestId('lobby')).toBeVisible();
    const link = await host.getByTestId('invite-link').inputValue();
    for (const [i, g] of guests.entries()) {
      await g.goto(link);
      if (i === 0) reports.push(await layoutReport(g, 'invite'));
      await g.getByTestId('name').fill(NAMES[i + 1]!);
      await g.getByTestId('join-room').click();
      await expect(g.getByTestId('lobby')).toBeVisible();
    }
    await expect(host.getByTestId('slot-3')).toContainText('丁');
    reports.push(await layoutReport(host, 'lobby'));
    for (const p of pages) await p.getByTestId('ready').click();
    await host.getByTestId('start').click();
    for (const p of pages) await expect(p.getByTestId('table')).toBeVisible();

    let dealer: Page | null = null;
    for (let i = 0; i < 100 && !dealer; i++) {
      for (const p of pages) if (await p.getByTestId('swap-none').count()) dealer = p;
      if (!dealer) await host.waitForTimeout(50);
    }
    expect(dealer).not.toBeNull();
    reports.push(await layoutReport(dealer!, 'swap-dir'));
    await dealer!.getByTestId('swap-none').click();
    reports.push(await layoutReport(host, 'que'));
    for (const [i, p] of pages.entries()) await p.getByTestId(`que-${i % 3}`).click();
    for (const p of pages) await expect(p.getByTestId('turn-name')).toBeVisible();

    for (const [i, p] of pages.entries()) {
      reports.push(await layoutReport(p, `table-${i}`));
      if (i === 0) await p.screenshot({ path: `test-results/mobile-${width}-table.png` });
    }
    const sb = host.getByTestId('toggle-score');
    if (await sb.count()) {
      await sb.click();
      reports.push(await layoutReport(host, 'scoreboard-open'));
      await host.screenshot({ path: `test-results/mobile-${width}-score.png` });
    }
    console.log(`REPORT ${width} ` + JSON.stringify(reports));
    for (const r of reports as { label: string; overflowX: number; offenders: string[]; minTile: { w: number; h: number } | null; buttons: { id: string; inView?: boolean; covered?: boolean }[] }[]) {
      expect(r.overflowX, `${r.label} 横向溢出 ${r.offenders.join(',')}`).toBeLessThanOrEqual(0);
      if (r.label.startsWith('table-')) {
        expect(r.minTile!.h).toBeGreaterThanOrEqual(44);
        expect(r.minTile!.w).toBeGreaterThanOrEqual(34);
        for (const b of r.buttons) expect(b.inView && !b.covered, `${r.label} ${b.id} 不可见或被遮挡`).toBe(true);
      }
    }
  });
}
