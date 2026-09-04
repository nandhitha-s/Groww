import { Skeleton } from '../Skeleton';
import styles from './WatchlistCard.module.css';

export function WatchlistCardSkeleton() {
  return (
    <div className={styles.card} style={{ cursor: 'default' }} aria-hidden="true">
      <div className={styles.topRow}>
        <Skeleton width={120} height={22} />
        <Skeleton width={20} height={20} radius={6} />
      </div>
      <div style={{ margin: '10px 0 22px' }}>
        <Skeleton width={70} height={13} />
      </div>
      <div className={styles.footer}>
        <Skeleton width={90} height={13} />
      </div>
    </div>
  );
}
