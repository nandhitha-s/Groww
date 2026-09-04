import styles from './BrandMark.module.css';

export function BrandMark({
  size = 36,
  onDark = false,
  wordmark = true,
}: {
  size?: number;
  onDark?: boolean;
  wordmark?: boolean;
}) {
  return (
    <span className={styles.brand}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        className={styles.badge}
        role="img"
        aria-label="Smart Market Watchlist"
      >
        <path
          d="M8 27 L16 21 L22 25 L31 11"
          stroke="white"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="31" cy="11" r="6" fill="white" opacity="0.22" />
        <circle cx="31" cy="11" r="3" fill="white" />
      </svg>
      {wordmark && (
        <span
          className={`${styles.wordmark} ${onDark ? styles.wordmarkOnDark : ''}`}
          style={{ fontSize: size * 0.5 }}
        >
          Smart Market Watchlist
        </span>
      )}
    </span>
  );
}
