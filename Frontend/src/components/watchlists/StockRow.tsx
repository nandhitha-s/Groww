import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { DragHandleIcon } from './DragHandle';
import { Skeleton } from '../Skeleton';
import type { ChangeEventSummary } from '../../types/marketState';
import type { QuoteState } from '../../types/marketData';
import type { WatchlistStock } from '../../types/watchlist';
import { changeDirection, formatCompactVolume, formatCurrency, formatPercent, formatSignedCurrency } from '../../utils/formatNumber';
import { formatTimeOfDay } from '../../utils/relativeTime';
import styles from './StockRow.module.css';

interface StockRowProps {
  stock: WatchlistStock;
  quote?: QuoteState;
  onRemove: () => void;
  removing?: boolean;
  disabled?: boolean;
  isNew?: boolean;
  /** When provided (with the containing watchlist's id), the symbol/company
   * block links through to that stock's detail page, carrying the already-
   * fetched watchlist id and meaningful changes along so the detail page
   * never has to re-request or re-record them (Phase 8). */
  watchlistId?: string;
  changes?: ChangeEventSummary[];
}

export function StockRow({
  stock,
  quote,
  onRemove,
  removing = false,
  disabled = false,
  isNew = false,
  watchlistId,
  changes,
}: StockRowProps) {
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

      {watchlistId ? (
        <Link
          to={`/stocks/${stock.symbol}`}
          state={{ watchlistId, changes: changes ?? [] }}
          className={styles.info}
        >
          <div className={styles.symbol}>{stock.symbol}</div>
          {stock.company_name && <div className={styles.company}>{stock.company_name}</div>}
        </Link>
      ) : (
        <div className={styles.info}>
          <div className={styles.symbol}>{stock.symbol}</div>
          {stock.company_name && <div className={styles.company}>{stock.company_name}</div>}
        </div>
      )}

      {stock.exchange && <span className={styles.exchangeTag}>{stock.exchange}</span>}

      <QuoteCell quote={quote} />

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

function QuoteCell({ quote }: { quote?: QuoteState }) {
  if (!quote) return null;

  if (quote.status === 'loading') {
    return (
      <div className={styles.quoteCell} aria-hidden="true">
        <Skeleton width={76} height={16} />
        <Skeleton width={92} height={12} style={{ marginTop: 4 }} />
      </div>
    );
  }

  if (quote.status === 'error') {
    return (
      <div className={styles.quoteCell}>
        <span className={`${styles.quoteError} text-caption`}>{quote.message}</span>
      </div>
    );
  }

  const { data } = quote;
  const direction = changeDirection(data.change);
  const directionClass =
    direction === 'up' ? styles.up : direction === 'down' ? styles.down : styles.flat;

  const metaParts: string[] = [`As of ${formatTimeOfDay(data.timestamp)}`];
  if (data.day_high !== null) metaParts.push(`H ${formatCurrency(data.day_high)}`);
  if (data.day_low !== null) metaParts.push(`L ${formatCurrency(data.day_low)}`);
  if (data.volume !== null) metaParts.push(`Vol ${formatCompactVolume(data.volume)}`);

  return (
    <div className={styles.quoteCell}>
      <div className={styles.priceRow}>
        <span className={`${styles.price} text-number`}>{formatCurrency(data.price)}</span>
        {data.is_delayed && <span className={styles.delayedTag}>Delayed</span>}
      </div>
      {data.change !== null && (
        <div className={`${styles.changeRow} ${directionClass}`}>
          {formatSignedCurrency(data.change)}
          {data.change_percent !== null && ` (${formatPercent(data.change_percent)})`}
        </div>
      )}
      {metaParts.length > 0 && <div className={styles.quoteMeta}>{metaParts.join(' · ')}</div>}
    </div>
  );
}
