import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  illustration: ReactNode;
  heading: string;
  subtitle: string;
  action?: ReactNode;
  float?: boolean;
}

export function EmptyState({ illustration, heading, subtitle, action, float = true }: EmptyStateProps) {
  return (
    <div className={styles.wrapper}>
      <div className={`${styles.illustration} ${float ? 'anim-float' : ''}`}>{illustration}</div>
      <h2 className={`${styles.heading} text-h2`}>{heading}</h2>
      <p className={`${styles.subtitle} text-body`}>{subtitle}</p>
      {action}
    </div>
  );
}

export function WatchlistsEmptyIllustration() {
  return (
    <svg width="150" height="110" viewBox="0 0 150 110" fill="none" aria-hidden="true">
      <rect x="6" y="18" width="58" height="70" rx="12" fill="#EEEDFB" stroke="#D9D7F5" strokeWidth="1.5" />
      <rect x="46" y="6" width="58" height="70" rx="12" fill="#fff" stroke="#E5E5F0" strokeWidth="1.5" />
      <path
        d="M58 52 L70 42 L80 47 L96 30"
        stroke="#4F46E5"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="96" cy="30" r="3.2" fill="#0EAB6F" />
      <rect x="94" y="52" width="50" height="46" rx="12" fill="#fff" stroke="#E5E5F0" strokeWidth="1.5" />
      <path
        d="M104 82 L112 74 L120 79 L134 66"
        stroke="#A5A0F2"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M18 34l2.4 5.1 5.6.6-4.2 3.8 1.1 5.5L18 46l-4.9 3-1.1-5.5-4.2-3.8 5.6-.6z"
        fill="#F6C453"
      />
    </svg>
  );
}

export function WatchlistDetailEmptyIllustration() {
  return (
    <svg width="120" height="90" viewBox="0 0 120 90" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="108" height="70" rx="14" fill="#F1F1F9" />
      <path
        d="M22 58 L36 46 L48 52 L70 30"
        stroke="#A5A0F2"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="70" cy="30" r="3" fill="#0EAB6F" />
      <rect x="22" y="63" width="18" height="6" rx="3" fill="#E0DFF7" />
      <rect x="46" y="63" width="18" height="6" rx="3" fill="#E0DFF7" />
    </svg>
  );
}
