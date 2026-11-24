import { useEffect, useState } from 'react';
import { Table } from './Table';
import { api, clearToken, getToken, saveToken, useRoom } from './net';

const nameKey = 'mj-name';
const roomPath = () => /^\/r\/([A-Za-z0-9]{8})\/?$/.exec(location.pathname)?.[1]?.toUpperCase() ?? null;

const ERR: Record<string, string> = {
  'bad-name': '请输入昵称（最多 12 个字）',
  full: '房间已满',
  started: '牌局已经开始，无法加入',
  'name-taken': '昵称已被占用，请换一个',
  'not-found': '房间不存在或已解散',
  'rate-limited': '请求过于频繁，请稍后再试',
};
const errText = (e?: string): string => (e ? (ERR[e] ?? `出错了：${e}`) : '网络错误，请重试');

function Home({ onEnter }: { onEnter: (code: string, token: string) => void }) {
  const [name, setName] = useState(localStorage.getItem(nameKey) ?? '');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async (join: boolean) => {
    setErr('');
    setBusy(true);
    localStorage.setItem(nameKey, name);
    try {
      const target = join ? code.trim().toUpperCase() : '';
      const res = join
        ? await api<{ code: string; token: string }>(`/api/rooms/${target}/join`, 'POST', { name })
        : await api<{ code: string; token: string }>('/api/rooms', 'POST', { name });
      if (res.status !== 200) setErr(errText(res.data.error));
      else onEnter(res.data.code, res.data.token);
    } catch {
      setErr(errText());
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="home">
      <h1>私人川麻</h1>
      <p className="muted">四人 · 血战到底 · 仅限好友私人房间</p>
      <label>
        昵称
        <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} data-testid="name" placeholder="你的昵称" />
      </label>
      <button className="primary" disabled={busy || !name.trim()} onClick={() => go(false)} data-testid="create-room">
        创建房间
      </button>
      <hr />
      <label>
        房间码
        <input value={code} maxLength={8} onChange={(e) => setCode(e.target.value)} data-testid="code" placeholder="8 位房间码" />
      </label>
      <button disabled={busy || !name.trim() || code.trim().length !== 8} onClick={() => go(true)} data-testid="join-room">
        加入房间
      </button>
      {err && <p className="error" data-testid="error">{err}</p>}
    </main>
  );
}

function Lobby({ code, send, view }: { code: string; send: ReturnType<typeof useRoom>['send']; view: NonNullable<ReturnType<typeof useRoom>['view']> }) {
  const link = `${location.origin}/r/${code}`;
  const [copied, setCopied] = useState(false);
  const isHost = view.mySeat === view.hostSeat;
  const me = view.members[view.mySeat];
  const all = view.members.length === 4 && view.members.every((m) => m.ready);
  return (
    <main className="home lobby" data-testid="lobby">
      <h1>房间 {code}</h1>
      <p className="muted">把邀请链接发给三位朋友：</p>
      <div className="row">
        <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link" />
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <ul className="slots">
        {[0, 1, 2, 3].map((i) => {
          const m = view.members[i];
          return (
            <li key={i} className={m ? '' : 'empty'} data-testid={`slot-${i}`}>
              {m ? (
                <>
                  <span className={`dot ${m.online ? 'on' : 'off'}`} />
                  {m.name}
                  {i === view.hostSeat && <span className="badge dealer">房主</span>}
                  <span className={m.ready ? 'ready' : 'muted'}>{m.ready ? '已确认' : '未确认'}</span>
                </>
              ) : (
                <span className="muted">等待加入…</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button className="primary" onClick={() => send({ t: 'ready', ready: !me?.ready })} data-testid="ready">
          {me?.ready ? '取消确认' : '确认准备'}
        </button>
        {isHost && (
          <button className="primary" disabled={!all} onClick={() => send({ t: 'start' })} data-testid="start">
            开始游戏
          </button>
        )}
      </div>
      <p className="muted">座位和庄家由服务器在开局时随机决定。</p>
      {isHost && (
        <button className="small danger" onClick={() => confirm('确定解散房间？') && send({ t: 'dissolve' })}>
          解散房间
        </button>
      )}
    </main>
  );
}

function Room({ code, token, leave }: { code: string; token: string; leave: () => void }) {
  const { view, status, fx, send, act } = useRoom(code, token);
  if (status === 'denied' || status === 'dissolved') {
    return (
      <main className="home" data-testid="gone">
        <h1>{status === 'dissolved' ? '牌桌已解散' : '无法进入房间'}</h1>
        <p className="muted">{status === 'dissolved' ? '邀请链接与重连凭证已失效。' : '凭证无效或房间已不存在。'}</p>
        <button className="primary" onClick={leave}>返回首页</button>
      </main>
    );
  }
  if (!view) return <main className="home"><p>连接中…</p></main>;
  if (view.stage === 'lobby' || !view.game) return <Lobby code={code} send={send} view={view} />;
  return <Table view={view} game={view.game} fx={fx} act={act} send={send} online={status === 'online'} />;
}

function Invite({ code, onEnter }: { code: string; onEnter: (code: string, token: string) => void }) {
  const [name, setName] = useState(localStorage.getItem(nameKey) ?? '');
  const [info, setInfo] = useState<{ ok: boolean; msg?: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<{ stage: string; full: boolean }>(`/api/rooms/${code}`)
      .then((r) => setInfo(r.status !== 200 ? { ok: false, msg: errText(r.data.error) } : r.data.stage !== 'lobby' ? { ok: false, msg: errText('started') } : r.data.full ? { ok: false, msg: errText('full') } : { ok: true }))
      .catch(() => setInfo({ ok: false, msg: errText() }));
  }, [code]);
  const join = async () => {
    localStorage.setItem(nameKey, name);
    const r = await api<{ code: string; token: string }>(`/api/rooms/${code}/join`, 'POST', { name });
    if (r.status !== 200) setErr(errText(r.data.error));
    else onEnter(r.data.code, r.data.token);
  };
  return (
    <main className="home" data-testid="invite">
      <h1>你被邀请加入川麻房间</h1>
      <p className="muted">房间码 {code}</p>
      {info && !info.ok && <p className="error">{info.msg}</p>}
      {(!info || info.ok) && (
        <>
          <label>
            昵称
            <input value={name} maxLength={12} onChange={(e) => setName(e.target.value)} data-testid="name" placeholder="你的昵称" />
          </label>
          <button className="primary" disabled={!info || !name.trim()} onClick={join} data-testid="join-room">
            加入房间
          </button>
        </>
      )}
      {err && <p className="error" data-testid="error">{err}</p>}
    </main>
  );
}

export function App() {
  const [code, setCode] = useState<string | null>(roomPath());
  const [token, setToken] = useState<string | null>(code ? getToken(code) : null);

  useEffect(() => {
    const onPop = () => {
      const c = roomPath();
      setCode(c);
      setToken(c ? getToken(c) : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const enter = (c: string, t: string) => {
    saveToken(c, t);
    history.pushState(null, '', `/r/${c}`);
    setCode(c);
    setToken(t);
  };
  const leave = () => {
    if (code) clearToken(code);
    history.pushState(null, '', '/');
    setCode(null);
    setToken(null);
  };

  if (code && token) return <Room code={code} token={token} leave={leave} />;
  if (code) return <Invite code={code} onEnter={enter} />;
  return <Home onEnter={enter} />;
}
