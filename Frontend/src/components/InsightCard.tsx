import type { CSSProperties } from 'react';
import styles from './InsightCard.module.css';

interface InsightCardProps {
  title: string;
  caption: string;
  badge: string;
  tone: 'positive' | 'negative' | 'neutral';
  staggerIndex?: number;
}

const badgeClassByTone = {
  positive: styles.badgePositive,
  negative: styles.badgeNegative,
  neutral: styles.badgeNeutral,
};

export function InsightCard({ title, caption, badge, tone, staggerIndex = 0 }: InsightCardProps) {
  return (
    <div
      className={`${styles.card} anim-stagger-item`}
      style={{ '--stagger-index': staggerIndex } as CSSProperties}
    >
      <span className={styles.left}>
        <span className={styles.title}>{title}</span>
        <span className={styles.caption}>{caption}</span>
      </span>
      <span className={`${styles.badge} ${badgeClassByTone[tone]}`}>{badge}</span>
    </div>
  );
}
