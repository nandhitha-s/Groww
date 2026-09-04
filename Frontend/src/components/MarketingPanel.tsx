import { BrandMark } from './BrandMark';
import { InsightCard } from './InsightCard';
import styles from './MarketingPanel.module.css';

export function MarketingPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.glow} aria-hidden="true" data-glow="one" />
      <div className={`${styles.glow} ${styles.glowTwo}`} aria-hidden="true" />

      <div className={`${styles.content} anim-fade-in-up`}>
        <BrandMark onDark />

        <div className={styles.headline}>
          <span className={styles.headlineLine}>Know what changed.</span>
          <span className={`${styles.headlineLine} ${styles.headlineAccent}`}>
            Know what matters.
          </span>
        </div>

        <p className={styles.supporting}>
          Your market watchlist, upgraded with meaningful change detection so you can focus on
          what deserves your attention.
        </p>
      </div>

      <div className={styles.cards}>
        <InsightCard
          title="NOVA"
          caption="since you last checked"
          badge="+5.2%"
          tone="positive"
          staggerIndex={1}
        />
        <InsightCard
          title="Unusual volume"
          caption="3.2x average for this stock"
          badge="Signal"
          tone="neutral"
          staggerIndex={2}
        />
        <InsightCard
          title="New 52-week high"
          caption="Breaking its prior range"
          badge="High attention"
          tone="neutral"
          staggerIndex={3}
        />
      </div>

      <p className={`${styles.footer} anim-fade-in`}>Illustrative preview -- sample data only.</p>
    </div>
  );
}
