import { env, runDurableObjectAlarm, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BETWEEN_ROUNDS_MS } from '../../worker/room';

type Msg = { t: string; [k: string]: any };

async function api(path: string, method = 'GET', body?: unknown): Promise<{ status: number; json: any }> {
  const res = await SELF.fetch(`https://example.com${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'cf-connecting-ip': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

class Client {
  msgs: Msg[] = [];
  closed = false;
  constructor(public ws: WebSocket) {
    ws.addEventListener('message', (e) => this.msgs.push(JSON.parse(e.data as string)));
    ws.addEventListener('close', () => (this.closed = true));
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  async wait(pred: (m: Msg) => boolean, from = 0): Promise<Msg> {
    for (let i = 0; i < 200; i++) {
      const m = this.msgs.slice(from).find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timeout: ' + this.ws.url + ' ' + this.msgs.map((m) => m.t + (m.code ?? '') + (m.v ?? '')).join(','));
  }
  lastView(): any {
    let v: any = null;
    for (const m of this.msgs) if (m.t === 'snapshot') v = m.view;
    return v;
  }
}

async function connect(code: string, token: string): Promise<Client> {
  const res = await SELF.fetch(`https://example.com/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket!;
  ws.accept();
  const c = new Client(ws);
  c.send({ t: 'auth', token });
  await c.wait((m) => m.t === 'snapshot');
  return c;
}

async function lobby(): Promise<{ code: string; clients: Client[]; tokens: string[] }> {
  const created = await api('/api/rooms', 'POST', { name: '房主' });
  expect(created.status).toBe(200);
  const code: string = created.json.code;
  const tokens = [created.json.token as string];
  for (const n of ['乙', '丙', '丁']) {
    const j = await api(`/api/rooms/${code}/join`, 'POST', { name: n });
    expect(j.status).toBe(200);
    tokens.push(j.json.token);
  }
  const clients = await Promise.all(tokens.map((t) => connect(code, t)));
  return { code, clients, tokens };
}

async function startGame(clients: Client[]): Promise<void> {
  for (const c of clients) c.send({ t: 'ready', ready: true });
  await new Promise((r) => setTimeout(r, 50));
  clients[0]!.send({ t: 'start' });
  for (const [i, c] of clients.entries()) await c.wait((m) => (m.t === 'snapshot' || m.t === 'patch') && JSON.stringify(m).includes('swapDir'));
}

describe('房间 API', () => {
  it('创建、加入、第五人被拒、重名被拒', async () => {
    const created = await api('/api/rooms', 'POST', { name: 'A' });
    const code = created.json.code as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await api(`/api/rooms/${code}/join`, 'POST', { name: 'A' })).status).toBe(409);
    for (const n of ['B', 'C', 'D']) expect((await api(`/api/rooms/${code}/join`, 'POST', { name: n })).status).toBe(200);
    expect((await api(`/api/rooms/${code}/join`, 'POST', { name: 'E' })).status).toBe(409);
    expect((await api(`/api/rooms/ZZZZZZZZ`)).status).toBe(404);
    expect((await api('/api/rooms', 'POST', { name: '' })).status).toBe(400);
  });

  it('创建房间有频率限制', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await SELF.fetch('https://example.com/api/rooms', {
        method: 'POST',
        body: JSON.stringify({ name: 'x' }),
        headers: { 'cf-connecting-ip': '9.9.9.9' },
      });
      codes.push(res.status);
    }
    expect(codes.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe('WebSocket 与开局', () => {
  it('错误令牌被拒绝', async () => {
    const { code } = await lobby();
    const res = await SELF.fetch(`https://example.com/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } });
    const ws = res.webSocket!;
    ws.accept();
    const c = new Client(ws);
    c.send({ t: 'auth', token: 'nope' });
    await c.wait((m) => m.t === 'error');
    expect(c.msgs.some((m) => m.t === 'snapshot')).toBe(false);
  });

  it('四人未全部确认不能开局，确认后仅房主可开局', async () => {
    const { clients } = await lobby();
    clients[1]!.send({ t: 'ready', ready: true });
    clients[0]!.send({ t: 'start' });
    await clients[0]!.wait((m) => m.t === 'error' && m.code === 'not-ready');
    for (const c of clients) c.send({ t: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 50));
    clients[1]!.send({ t: 'start' });
    await clients[1]!.wait((m) => m.t === 'error' && m.code === 'invalid');
    clients[0]!.send({ t: 'start' });
    const snap = await clients[0]!.wait((m) => (m.t === 'patch' || m.t === 'snapshot') && JSON.stringify(m).includes('swapDir'));
    expect(snap).toBeTruthy();
  });

  it('每位玩家只看到自己的手牌，牌墙顺序不下发', async () => {
    const { clients } = await lobby();
    await startGame(clients);
    for (const c of clients) c.send({ t: 'sync' });
    await new Promise((r) => setTimeout(r, 100));
    const views = clients.map((c) => c.lastView());
    for (let i = 0; i < 4; i++) {
      const g = views[i].game;
      expect(g.hand.length).toBeGreaterThanOrEqual(13);
      const raw = JSON.stringify(clients[i]!.msgs);
      expect(raw).not.toMatch(/"wall"\s*:\s*\[/);
      for (const j of Object.keys(g.players)) {
        const p = g.players[j];
        expect(p.hand === undefined || Number(j) === views[i].mySeat).toBe(true);
      }
    }
  });

  it('同一动作 id 不会重复执行，非法动作返回 error 且不改变状态', async () => {
    const { clients } = await lobby();
    await startGame(clients);
    const c = clients[0]!;
    const before = c.msgs.length;
    c.send({ t: 'act', id: 'a1', action: { a: 'peng' } });
    await c.wait((m) => m.t === 'error' && m.id === 'a1', before);
    c.send({ t: 'act', id: 'a2', action: { a: 'bogus' } });
    await c.wait((m) => m.t === 'error' && m.id === 'a2', before);
    const n = c.msgs.length;
    c.send({ t: 'act', id: 'a1', action: { a: 'peng' } });
    await new Promise((r) => setTimeout(r, 80));
    expect(c.msgs.slice(n).some((m) => m.t === 'error' && m.id === 'a1')).toBe(false);
  });

  it('断线重连得到完整快照，且座位不变', async () => {
    const { code, clients, tokens } = await lobby();
    await startGame(clients);
    const seat = clients[2]!.lastView().mySeat;
    clients[2]!.ws.close();
    await new Promise((r) => setTimeout(r, 50));
    const back = await connect(code, tokens[2]!);
    expect(back.lastView().mySeat).toBe(seat);
    expect(back.lastView().game).toBeTruthy();
    const other = clients[0]!.msgs.filter((m) => m.t === 'patch' || m.t === 'snapshot').length;
    expect(other).toBeGreaterThan(0);
  });
});

describe('解散与清理', () => {
  it('四人全部离线超过宽限期后解散，邀请与凭证失效', async () => {
    const { code, clients, tokens } = await lobby();
    await startGame(clients);
    for (const c of clients) c.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    // 宽限期内闹钟不应解散
    await runDurableObjectAlarm(stub);
    expect((await api(`/api/rooms/${code}`)).status).toBe(200);
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 60 * 1000;
    try {
      await runDurableObjectAlarm(stub);
    } finally {
      Date.now = realNow;
    }
    expect((await api(`/api/rooms/${code}`)).status).toBe(404);
    expect((await api(`/api/rooms/${code}/join`, 'POST', { name: 'Z' })).status).toBe(404);
    const res = await SELF.fetch(`https://example.com/api/rooms/${code}/ws`, { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
    expect(tokens.length).toBe(4);
  });

  it('房主可解散房间', async () => {
    const { code, clients } = await lobby();
    clients[0]!.send({ t: 'dissolve' });
    await clients[1]!.wait((m) => m.t === 'dissolved');
    expect((await api(`/api/rooms/${code}`)).status).toBe(404);
  });

  it('常量：本局结束后等待 10 分钟', () => {
    expect(BETWEEN_ROUNDS_MS).toBe(600_000);
  });
});
