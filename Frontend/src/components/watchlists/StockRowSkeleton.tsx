import { Skeleton } from '../Skeleton';
import styles from './StockRow.module.css';

export function StockRowSkeleton() {
  return (
    <div className={styles.row} aria-hidden="true">
      <Skeleton width={16} height={20} />
      <div className={styles.info} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton width={70} height={15} />
        <Skeleton width={150} height={11} />
      </div>
      <Skeleton width={56} height={18} radius={6} />
    </div>
  );
}
