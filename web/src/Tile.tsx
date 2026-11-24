import { rankOf, suitOf } from '../../shared/tiles';

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT = ['万', '条', '筒'];
const SUIT_CLASS = ['wan', 'tiao', 'tong'];

interface TileProps {
  tile: number; // -1 = 背面
  size?: 'sm' | 'md' | 'lg';
  selected?: boolean;
  fresh?: boolean;
  drawn?: boolean;
  dim?: boolean;
  onClick?: () => void;
  testId?: string;
}

export function Tile({ tile, size = 'md', selected, fresh, drawn, dim, onClick, testId }: TileProps) {
  const cls = ['tile', `tile-${size}`];
  if (tile < 0) cls.push('back');
  else cls.push(SUIT_CLASS[suitOf(tile)]!);
  if (selected) cls.push('selected');
  if (fresh) cls.push('fresh');
  if (drawn) cls.push('drawn');
  if (dim) cls.push('dim');
  const label = tile < 0 ? '暗牌' : `${rankOf(tile)}${SUIT[suitOf(tile)]}`;
  const inner =
    tile < 0 ? null : (
      <>
        <span className="rank">{suitOf(tile) === 0 ? NUM[rankOf(tile) - 1] : rankOf(tile)}</span>
        <span className="suit">{SUIT[suitOf(tile)]}</span>
      </>
    );
  if (onClick) {
    return (
      <button type="button" className={cls.join(' ')} onClick={onClick} aria-label={label} data-testid={testId} data-tile={tile}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls.join(' ')} aria-label={label} data-tile={tile}>
      {inner}
    </span>
  );
}

export const suitName = (s: number): string => SUIT[s] ?? '?';
