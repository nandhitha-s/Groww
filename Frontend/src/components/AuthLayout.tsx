import type { ReactNode } from 'react';
import { MarketingPanel } from './MarketingPanel';
import styles from './AuthLayout.module.css';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.panelColumn}>
        <MarketingPanel />
      </div>
      <div className={styles.formColumn}>
        <div className={`${styles.formInner} anim-fade-in-up`}>{children}</div>
      </div>
    </div>
  );
}
