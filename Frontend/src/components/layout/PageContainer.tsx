import type { ReactNode } from 'react';
import styles from './PageContainer.module.css';

export function PageContainer({
  children,
  maxWidth = 1280,
}: {
  children: ReactNode;
  maxWidth?: number;
}) {
  return (
    <main className={styles.container} style={{ maxWidth }}>
      {children}
    </main>
  );
}
