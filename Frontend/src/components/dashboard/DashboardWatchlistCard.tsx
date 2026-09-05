import styles from './DashboardWatchlistCard.module.css';

interface DashboardWatchlistCardProps {
  name: string;
  stockCount: number;
  changeCount: number;
  onOpen: () => void;
  staggerIndex?: number;
}

/**
 * A compact, clickable summary of one watchlist for the dashboard's
 * overview section (Step 8) -- name, stock count, and how many meaningful
 * changes it currently has. Deliberately simpler than the full
 * WatchlistCard (Step 8's example is just three facts + navigation; rename/
 * delete stay on the watchlist overview page, not duplicated here).
 */
export function DashboardWatchlistCard({
  name,
  stockCount,
  changeCount,
  onOpen,
  staggerIndex = 0,
}: DashboardWatchlistCardProps) {
  return (
    <div
      className={`${styles.card} anim-stagger-item`}
      style={{ '--stagger-index': staggerIndex } as React.CSSProperties}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className={styles.info}>
        <span className={styles.name}>{name}</span>
        <span className={`${styles.count} text-body-small`}>
          {stockCount} {stockCount === 1 ? 'stock' : 'stocks'}
        </span>
      </div>
      <div className={styles.changeInfo}>
        <span className={`${styles.changeCount} ${changeCount > 0 ? styles.hasChanges : ''}`}>
          {changeCount > 0 ? `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}` : 'No major changes'}
        </span>
        <span className={styles.arrow} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}
