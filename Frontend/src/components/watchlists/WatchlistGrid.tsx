import type { ReactNode } from 'react';
import styles from './WatchlistGrid.module.css';

export function WatchlistGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
