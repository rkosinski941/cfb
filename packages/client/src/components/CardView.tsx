import type { Card } from '@cfb/shared';
import { suitColor, suitSymbol } from '@cfb/shared';

interface Props {
  card: Card;
  selected?: boolean;
  disabled?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  compact?: boolean;
}

export function CardView({
  card,
  selected,
  disabled,
  dimmed,
  onClick,
  compact,
}: Props) {
  const color = suitColor(card.suit);
  const className = [
    'card',
    color,
    selected ? 'selected' : '',
    disabled ? 'disabled' : '',
    dimmed ? 'dimmed' : '',
    compact ? 'compact' : '',
    onClick && !disabled ? 'clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || !onClick}
      onClick={onClick}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{suitSymbol(card.suit)}</span>
    </button>
  );
}
