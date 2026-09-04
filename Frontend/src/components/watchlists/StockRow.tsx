import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';
import { DragHandleIcon } from './DragHandle';
import type { WatchlistStock } from '../../types/watchlist';
import styles from './StockRow.module.css';

interface StockRowProps {
  stock: WatchlistStock;
  onRemove: () => void;
  removing?: boolean;
  disabled?: boolean;
  isNew?: boolean;
}

export function StockRow({ stock, onRemove, removing = false, disabled = false, isNew = false }: StockRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stock.id,
    disabled: disabled || removing,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
  };

  const rowClasses = [
    styles.row,
    isDragging ? styles.dragging : '',
    removing ? styles.removing : '',
    isNew ? 'anim-row-in' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={setNodeRef} style={style} className={rowClasses}>
      <button
        className={styles.grip}
        aria-label={`Drag ${stock.symbol} to reorder`}
        disabled={disabled || removing}
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>

      <div className={styles.info}>
        <div className={styles.symbol}>{stock.symbol}</div>
        {stock.company_name && <div className={styles.company}>{stock.company_name}</div>}
      </div>

      {stock.exchange && <span className={styles.exchangeTag}>{stock.exchange}</span>}

      <button
        className={styles.removeButton}
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${stock.symbol} from this watchlist`}
      >
        Remove
      </button>
      <button
        className={styles.removeIconButton}
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${stock.symbol} from this watchlist`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
