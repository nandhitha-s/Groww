import { Link } from 'react-router-dom';
import { changeDirection, formatCurrency, formatPercent } from '../../utils/formatNumber';
import styles from './MarketActivityList.module.css';

export interface MarketActivityItem {
  symbol: string;
  price: string;
  /** Current-vs-previous-close movement (Step 6) -- straight from the
   * quote's own `change_percent`, never recalculated here. `null` when the
   * backend didn't provide a previous close; the price still shows, no
   * percentage is invented. This is NEVER a meaningful-change signal. */
  changePercent: string | null;
}

/**
 * Phase 10: plain current-quote context for stocks that did NOT necessarily
 * cross a meaningful-change threshold -- deliberately the least visually
 * prominent section on the dashboard (Step 15), never styled with a
 * severity badge, never a link to /changes, never able to be confused with
 * "Needs your attention" (Step 4).
 */
export function MarketActivityList({ items }: { items: MarketActivityItem[] }) {
  if (items.length === 0) return null;

  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const direction = changeDirection(item.changePercent);
        const directionClass = direction === 'up' ? styles.up : direction === 'down' ? styles.down : styles.flat;
        return (
          <li key={item.symbol}>
            <Link to={`/stocks/${item.symbol}`} className={styles.row}>
              <span className={styles.symbol}>{item.symbol}</span>
              <span className={styles.price}>{formatCurrency(item.price)}</span>
              {item.changePercent !== null && (
                <span className={`${styles.percent} ${directionClass}`}>{formatPercent(item.changePercent)}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
