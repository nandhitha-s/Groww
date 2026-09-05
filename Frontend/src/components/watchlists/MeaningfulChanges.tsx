import { Link } from 'react-router-dom';
import { ChangeCard } from '../changes/ChangeCard';
import type { ChangeEventSummary } from '../../types/marketState';
import styles from './MeaningfulChanges.module.css';

interface MeaningfulChangesProps {
  changes: ChangeEventSummary[];
  watchlistId?: string;
}

/**
 * Displays the meaningful changes the backend detected while recording the
 * current market state as seen (Phase 6A). Renders nothing at all when
 * there are none -- a first visit, or a visit with nothing meaningful to
 * report, should feel like a completely normal watchlist (Steps 4/15).
 *
 * The per-change card itself (symbol, severity, title, description) is the
 * shared `ChangeCard` component (Phase 7), also used by the dashboard's
 * "Needs your attention" section -- one single presentation of what a
 * meaningful change looks like.
 */
export function MeaningfulChanges({ changes, watchlistId }: MeaningfulChangesProps) {
  if (changes.length === 0) return null;

  return (
    <div className={`${styles.wrapper} anim-fade-in-up`}>
      <div className={styles.summaryRow}>
        <p className={`${styles.summary} text-body-strong`}>
          {changes.length} meaningful {changes.length === 1 ? 'change' : 'changes'} since you last checked
        </p>
        <Link to="/changes" className={styles.viewAllLink}>
          View changes →
        </Link>
      </div>
      <ul className={styles.list}>
        {changes.map((change, index) => (
          <ChangeCard
            key={`${change.stock_id}-${change.type}-${index}`}
            change={change}
            linkTo={watchlistId ? `/stocks/${change.symbol}` : undefined}
            linkState={watchlistId ? { watchlistId, changes } : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
