import { DotsMenuIcon, DropdownMenu } from '../DropdownMenu';
import { IconButton } from '../IconButton';
import { formatRelativeTime } from '../../utils/relativeTime';
import type { WatchlistSummary } from '../../types/watchlist';
import styles from './WatchlistCard.module.css';

interface WatchlistCardProps {
  watchlist: WatchlistSummary;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  staggerIndex?: number;
}

export function WatchlistCard({
  watchlist,
  onOpen,
  onRename,
  onDelete,
  staggerIndex = 0,
}: WatchlistCardProps) {
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
      <div className={styles.topRow}>
        <span className={styles.name}>{watchlist.name}</span>
        <span onClick={(event) => event.stopPropagation()}>
          <DropdownMenu
            items={[
              { label: 'Rename', onSelect: onRename },
              { label: 'Delete', onSelect: onDelete, danger: true },
            ]}
            renderTrigger={(triggerProps) => (
              <IconButton
                {...triggerProps}
                variant="ghost"
                aria-label={`Open ${watchlist.name} menu`}
              >
                <DotsMenuIcon />
              </IconButton>
            )}
          />
        </span>
      </div>

      <p className={`${styles.count} text-body-small`} style={{ margin: 0 }}>
        {watchlist.stock_count} {watchlist.stock_count === 1 ? 'stock' : 'stocks'}
      </p>

      <div className={styles.footer}>
        <span className="text-caption">{formatRelativeTime(watchlist.updated_at)}</span>
        <span className={styles.arrow} aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
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
