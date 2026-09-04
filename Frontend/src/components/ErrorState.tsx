import { Button } from './Button';
import styles from './ErrorState.module.css';

interface ErrorStateProps {
  heading: string;
  subtitle: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorState({ heading, subtitle, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.iconCircle} aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M12 9v4" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
          <circle cx="12" cy="16.3" r="1.1" fill="currentColor" />
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <h2 className={`${styles.heading} text-h2`}>{heading}</h2>
      <p className={`${styles.subtitle} text-body`}>{subtitle}</p>
      {onRetry && (
        <Button variant="secondary" style={{ width: 'auto' }} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
