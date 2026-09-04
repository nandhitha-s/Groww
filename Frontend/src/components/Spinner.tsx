import styles from './Spinner.module.css';

export function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      className={`${styles.spinner} ${dark ? styles['spinner--dark'] : ''}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className={styles.fullPage} role="status" aria-live="polite">
      <Spinner dark />
      <span className="text-caption">{label}</span>
    </div>
  );
}
