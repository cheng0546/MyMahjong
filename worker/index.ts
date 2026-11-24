import { Room, type Env } from './room';

export { Room };

// 去掉易混淆字符的 32 字符表；8 位 = 40 bit 随机，配合速率限制难以猜测。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

// 基础频率限制：按 IP 的滑动窗口，保存在 isolate 内存中(尽力而为，不跨 isolate)。
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) for (const k of hits.keys()) if (!(hits.get(k)?.some((t) => now - t < windowMs))) hits.delete(k);
  return arr.length > max;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    const parts = url.pathname.split('/').filter(Boolean); // api, rooms, [code], [action]
    if (parts[1] !== 'rooms') return json({ error: 'not-found' }, 404);

    if (parts.length === 2 && request.method === 'POST') {
      if (env.TEST_NO_RATE_LIMIT !== '1' && limited(`create:${ip}`, 10, 60_000)) return json({ error: 'rate-limited' }, 429);
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch(new Request('https://room/create', {
          method: 'POST',
          headers: { 'x-room-code': code },
          body: await request.clone().text(),
        }));
        if (res.status !== 409) return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      }
      return json({ error: 'busy' }, 503);
    }

    const code = (parts[2] ?? '').toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: 'not-found' }, 404);
    const action = parts[3] ?? '';
    const isWs = action === 'ws';
    if (env.TEST_NO_RATE_LIMIT !== '1' && limited(`${isWs ? 'ws' : 'join'}:${ip}`, isWs ? 60 : 30, 60_000)) return json({ error: 'rate-limited' }, 429);
    if (!['', 'join', 'ws'].includes(action)) return json({ error: 'not-found' }, 404);
    if ((action === 'join' && request.method !== 'POST') || (action === '' && request.method !== 'GET')) {
      return json({ error: 'method' }, 405);
    }

    const stub = env.ROOM.get(env.ROOM.idFromName(code));
    const forward = new Request(`https://room/${action || 'info'}`, request);
    forward.headers.set('x-room-code', code);
    return stub.fetch(forward);
  },
} satisfies ExportedHandler<Env>;
