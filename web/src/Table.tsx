import { useEffect, useMemo, useState } from 'react';
import type { Action, LedgerEntry, SwapDir } from '../../shared/engine';
import type { ClientMessage, GameView, PublicMeld, PublicPlayer, RoomView } from '../../shared/view';
import type { Fx } from './net';
import { Tile, suitName } from './Tile';

const LEDGER_LABEL: Record<string, string> = {
  'hu-zimo': '自摸',
  'hu-ron': '点炮',
  'gang-ming': '明杠',
  'gang-bu': '补杠',
  'gang-an': '暗杠',
  zha: '炸胡处罚',
  huazhu: '查花猪',
  dajiao: '查大叫',
  refund: '退税',
};
const END_REASON: Record<string, string> = { threeOut: '三人已胡/炸胡', wall: '牌墙摸完' };
const DIR_LABEL: Record<SwapDir, string> = { cw: '顺时针换', ccw: '逆时针换', opp: '与对家换', none: '不换牌' };
const POS = ['bottom', 'right', 'top', 'left'] as const;
const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

interface Props {
  view: RoomView;
  game: GameView;
  fx: Fx;
  act: (a: Action) => void;
  send: (m: ClientMessage) => void;
  online: boolean;
}

function Melds({ melds, size = 'sm' }: { melds: PublicMeld[]; size?: 'sm' | 'md' }) {
  return (
    <span className="melds">
      {melds.map((m, i) => {
        const n = m.kind === 'peng' ? 3 : 4;
        return (
          <span key={i} className={`meld meld-${m.kind}`}>
            {Array.from({ length: n }, (_, k) => (
              <Tile key={k} tile={m.tile ?? -1} size={size} />
            ))}
          </span>
        );
      })}
    </span>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return <span>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>;
}

function Seat({
  seat,
  view,
  game,
  banner,
}: {
  seat: number;
  view: RoomView;
  game: GameView;
  banner: string | null;
}) {
  const p: PublicPlayer = game.players[seat]!;
  const m = view.members[seat]!;
  const rel = (seat - view.mySeat + 4) % 4;
  const turn = game.phase === 'play' && game.turn === seat && p.status === 'active';
  const lastIdx = game.claim && game.claim.kind === 'discard' && game.claim.from === seat ? p.discards.length - 1 : -1;
  return (
    <section
      className={`seat seat-${POS[rel]} ${turn ? 'turn' : ''} ${p.status !== 'active' ? 'out' : ''}`}
      data-testid={`seat-${seat}`}
    >
      <header className="seat-head">
        <span className={`dot ${m.online ? 'on' : 'off'}`} title={m.online ? '在线' : '离线'} />
        <strong className="pname">{m.name}</strong>
        {game.dealer === seat && <span className="badge dealer">庄</span>}
        {p.que !== null && <span className="badge que">缺{suitName(p.que)}</span>}
        {p.status === 'hu' && <span className="badge hu">已胡</span>}
        {p.status === 'zha' && <span className="badge zha">炸胡</span>}
        <span className="pscore">{game.scores[seat]}</span>
      </header>
      {banner && (
        <div className="banner" key={banner + game.wallCount + p.discards.length} data-testid={`banner-${seat}`}>
          {banner}
        </div>
      )}
      <div className="discards">
        {p.discards.map((d, i) => (
          <Tile key={i} tile={d.tile} size="sm" dim={d.taken} fresh={i === lastIdx} />
        ))}
      </div>
      <div className="melds-row">
        <Melds melds={p.melds} />
        {p.status === 'active' && rel !== 0 && <span className="hidden-count">手牌 {p.handCount}</span>}
      </div>
      {p.out && (
        <div className="out-info">
          <div>
            {p.out.how === 'zha' ? '炸胡，手牌已公开' : `${p.out.how === 'zimo' ? '自摸' : '点炮胡'} ${p.out.fan} 番 ${p.out.items.map((i) => i.name).join('、')}`}
          </div>
          <div className="out-hand">
            {p.out.hand.map((t, i) => (
              <Tile key={i} tile={t} size="sm" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ResultPanel({ view, game, send, onClose }: { view: RoomView; game: GameView; send: Props['send']; onClose: () => void }) {
  const r = game.result!;
  const name = (s: number) => view.members[s]!.name;
  const grouped = new Map<string, LedgerEntry[]>();
  for (const e of r.ledger) grouped.set(e.kind, [...(grouped.get(e.kind) ?? []), e]);
  const iReady = view.nextReady[view.mySeat];
  return (
    <div className="overlay" data-testid="result">
      <div className="panel result">
        <h2>第 {game.roundNo} 局结算 · {END_REASON[r.reason] ?? r.reason}</h2>
        <table className="score-table">
          <thead>
            <tr>
              <th>玩家</th>
              <th>本局</th>
              <th>累计</th>
            </tr>
          </thead>
          <tbody>
            {view.members.map((m, s) => (
              <tr key={s}>
                <td>{m.name}</td>
                <td className={r.deltas[s]! < 0 ? 'neg' : 'pos'}>{signed(r.deltas[s]!)}</td>
                <td>{game.scores[s]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="ledger">
          {r.wins.map((w, i) => (
            <li key={`w${i}`}>
              {name(w.seat)} {w.how === 'zimo' ? '自摸' : `胡 ${name(w.from!)} 的牌`}：{w.fan} 番（{w.items.map((x) => x.name).join('、')}）
            </li>
          ))}
          {r.zha.map((s) => (
            <li key={`z${s}`}>
              {name(s)} 炸胡：
              {(grouped.get('zha') ?? [])
                .filter((e) => e.from === s)
                .map((e) => `${name(e.to)} ${signed(e.amount)}`)
                .join('，')}
              （共扣 {(grouped.get('zha') ?? []).filter((e) => e.from === s).reduce((a, e) => a + e.amount, 0)}）
            </li>
          ))}
          {r.huaZhu.length > 0 && <li>花猪：{r.huaZhu.map(name).join('、')}</li>}
          {r.reason === 'wall' && <li>听牌：{r.ting.length ? r.ting.map((t) => `${name(t.seat)}(${t.fan}番)`).join('、') : '无人'}</li>}
          {[...grouped.entries()]
            .filter(([k]) => k !== 'zha' && !k.startsWith('hu-'))
            .map(([k, es]) => (
              <li key={k}>
                {LEDGER_LABEL[k] ?? k}：{es.map((e) => `${name(e.from)}→${name(e.to)} ${e.amount}`).join('；')}
              </li>
            ))}
          <li>
            下一局庄家：{name(r.nextDealer)}（{r.nextStreak > 0 ? `连庄 ${r.nextStreak}` : '换庄'}）
          </li>
        </ul>
        <p className="muted">
          {view.dissolveAt ? <>无人进入下一局，牌桌将在 <Countdown until={view.dissolveAt} /> 后解散。</> : null}
          已确认：{view.members.filter((_, s) => view.nextReady[s]).map((m) => m.name).join('、') || '无'}
        </p>
        <div className="row">
          <button className="primary" disabled={iReady} onClick={() => send({ t: 'next' })} data-testid="next-round">
            {iReady ? '等待其他玩家…' : '进入下一局'}
          </button>
          <button onClick={onClose}>查看牌桌</button>
        </div>
      </div>
    </div>
  );
}

export function Table({ view, game, fx, act, send, online }: Props) {
  const me = view.mySeat;
  const mine = game.players[me]!;
  const sorted = useMemo(() => [...game.hand].sort((a, b) => a - b), [game.hand]);
  const drawnIdx = useMemo(() => (game.drawn === null ? -1 : sorted.lastIndexOf(game.drawn)), [sorted, game.drawn]);
  const [sel, setSel] = useState<number[]>([]);
  const [showScore, setShowScore] = useState(true);
  const [showResult, setShowResult] = useState(true);
  const [banner, setBanner] = useState<{ seat: number; text: string; key: number } | null>(null);

  useEffect(() => setSel([]), [game.hand.join(','), game.phase]);
  useEffect(() => {
    if (game.phase === 'ended') setShowResult(true);
  }, [game.roundNo, game.phase]);

  // 动画/提示只来自服务器已广播的公开事件。
  useEffect(() => {
    for (const ev of fx.events) {
      let text: string | null = null;
      let seat = -1;
      if (ev.k === 'peng') [text, seat] = ['碰', ev.seat];
      else if (ev.k === 'gang') [text, seat] = ['杠', ev.seat];
      else if (ev.k === 'hu') [text, seat] = [ev.how === 'zimo' ? '自摸' : '胡', ev.seat];
      else if (ev.k === 'zha') [text, seat] = ['炸胡', ev.seat];
      if (text) setBanner({ seat, text, key: fx.seq });
    }
    const t = setTimeout(() => setBanner(null), 1600);
    return () => clearTimeout(t);
  }, [fx.seq]);

  const playing = game.phase === 'play';
  const toggle = (i: number, max: number) =>
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : max === 1 ? [i] : s.length >= max ? s : [...s, i]));
  const discard = (i: number) => act({ a: 'discard', tile: sorted[i]! });

  const turnName = game.phase === 'play' ? view.members[game.turn]!.name : '';

  return (
    <div className="table-root" data-testid="table">
      <div className="status-bar">
        <span data-testid="round-info">
          第 {game.roundNo} 局{game.streak > 0 ? ` · 连庄 ${game.streak} (×${game.mult})` : ''}
        </span>
        <span data-testid="wall-count">牌墙 {game.wallCount}</span>
        {playing && <span data-testid="turn-name">轮到：{turnName}</span>}
        {!online && <span className="warn">连接中断，正在重连…</span>}
        <button className="small" onClick={() => setShowScore((v) => !v)} data-testid="toggle-score">
          {showScore ? '隐藏计分表' : '显示计分表'}
        </button>
      </div>

      <div className="felt">
        {[0, 1, 2, 3].map((s) => (
          <Seat key={s} seat={s} view={view} game={game} banner={banner && banner.seat === s ? banner.text : null} />
        ))}
        <div className="center">
          {game.phase === 'swapDir' && <p>换三张：由庄家决定方向</p>}
          {game.phase === 'swapPick' && game.swapDir && <p>{DIR_LABEL[game.swapDir]}</p>}
          {game.phase === 'que' && <p>请选择定缺门</p>}
          {playing && game.claim && (
            <div className="claim-tile" data-testid="claim-tile">
              <Tile tile={game.claim.tile} size="md" fresh />
            </div>
          )}
        </div>
        {showScore && (
          <aside className="scoreboard" data-testid="scoreboard">
            <h3>计分表</h3>
            <table className="score-table">
              <tbody>
                {view.members.map((m, s) => (
                  <tr key={s}>
                    <td>{m.name}</td>
                    <td className={game.scores[s]! < 0 ? 'neg' : ''} data-testid={`score-${s}`}>
                      {game.scores[s]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {game.history.length > 0 && (
              <details>
                <summary>历史 {game.history.length} 局</summary>
                {game.history.map((h) => (
                  <div key={h.no} className="hist">
                    #{h.no} {h.deltas.map(signed).join(' / ')}
                  </div>
                ))}
              </details>
            )}
          </aside>
        )}
      </div>

      <div className="mine">
        {game.phase === 'swapDir' && (
          <div className="choose">
            {game.dealer === me ? (
              (['cw', 'ccw', 'opp', 'none'] as SwapDir[]).map((d) => (
                <button key={d} className="primary" onClick={() => act({ a: 'swapDir', dir: d })} data-testid={`swap-${d}`}>
                  {DIR_LABEL[d]}
                </button>
              ))
            ) : (
              <span className="muted">等待庄家选择换牌方式…</span>
            )}
          </div>
        )}
        {game.phase === 'swapPick' && (
          <div className="choose">
            {mine.swapDone ? (
              <span className="muted">已提交，等待其他玩家…</span>
            ) : (
              <button
                className="primary"
                disabled={sel.length !== 3}
                onClick={() => act({ a: 'swapPick', tiles: sel.map((i) => sorted[i]!) })}
                data-testid="swap-confirm"
              >
                确认换出这 3 张（需同一花色）
              </button>
            )}
          </div>
        )}
        {game.phase === 'que' && (
          <div className="choose">
            {mine.que !== null ? (
              <span className="muted">已选缺{suitName(mine.que)}，等待其他玩家…</span>
            ) : (
              [0, 1, 2].map((s) => (
                <button key={s} className="primary" onClick={() => act({ a: 'que', suit: s })} data-testid={`que-${s}`}>
                  缺{suitName(s)}
                </button>
              ))
            )}
          </div>
        )}

        <div className="hand" data-testid="hand">
          {sorted.map((t, i) => (
            <Tile
              key={`${t}-${i}`}
              tile={t}
              size="lg"
              selected={sel.includes(i)}
              drawn={i === drawnIdx}
              testId={`hand-${i}`}
              onClick={() => {
                if (game.phase === 'swapPick') toggle(i, 3);
                else if (playing) {
                  if (sel[0] === i) discard(i);
                  else toggle(i, 1);
                }
              }}
            />
          ))}
          <Melds melds={mine.melds} size="md" />
        </div>

        <div className="actions">
          <button className="act peng" onClick={() => act({ a: 'peng' })} data-testid="btn-peng">碰</button>
          <button
            className="act gang"
            onClick={() => act(playing && sel.length === 1 ? { a: 'gang', tile: sorted[sel[0]!]! } : { a: 'gang' })}
            data-testid="btn-gang"
          >
            杠
          </button>
          <button className="act hu" onClick={() => act({ a: 'hu' })} data-testid="btn-hu">胡</button>
          <button
            className="act discard"
            disabled={sel.length !== 1 || !playing}
            onClick={() => discard(sel[0]!)}
            data-testid="btn-discard"
          >
            出牌
          </button>
        </div>
      </div>

      {game.phase === 'ended' && game.result && showResult && (
        <ResultPanel view={view} game={game} send={send} onClose={() => setShowResult(false)} />
      )}
      {game.phase === 'ended' && game.result && !showResult && (
        <button className="floating" onClick={() => setShowResult(true)}>
          查看结算
        </button>
      )}
    </div>
  );
}
