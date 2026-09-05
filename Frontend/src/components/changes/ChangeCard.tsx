import { Link } from 'react-router-dom';
import styles from './ChangeCard.module.css';

/** The fields ChangeCard actually renders -- deliberately looser than any
 * one backend schema (description/old_value/new_value nullable) so both
 * ChangeEventSummary (the "seen" flow's transient result) and
 * ChangeEventListItem (Phase 9's persisted list row) satisfy it as-is. */
interface ChangeCardData {
  stock_id: string;
  symbol: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
}

interface ChangeCardProps {
  change: ChangeCardData;
  /** When provided, the whole card becomes a link (e.g. to that stock's
   * detail page) instead of a plain, non-interactive summary. */
  linkTo?: string;
  linkState?: unknown;
  /** Phase 9: optional "mark as read" affordance, rendered as its own row
   * below the card content (never inside the link, so it never triggers
   * navigation). Omitted entirely -- and so invisible -- everywhere this
   * isn't passed (Dashboard, WatchlistDetail, Stock Detail). */
  acknowledged?: boolean;
  onAcknowledge?: () => void;
}

const SEVERITY_LABEL: Record<string, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  CRITICAL: 'Critical',
};

function severityClass(severity: string): string {
  if (severity === 'HIGH') return styles.severityHigh;
  if (severity === 'MEDIUM') return styles.severityMedium;
  return styles.severityNeutral;
}

/** Purely decorative -- the direction/activity is already spelled out in
 * the backend's own `title` text (e.g. "moved"/"fell"/"volume is ... above
 * average"), so the icon is aria-hidden rather than duplicating that as a
 * second, differently-worded label. */
function ChangeTypeIcon({ direction }: { direction: 'up' | 'down' | 'activity' }) {
  if (direction === 'activity') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20V11M12 20V4M20 20v-6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      </svg>
    );
  }
  if (direction === 'down') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 5v14M5 12l7 7 7-7"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 19V5M5 12l7-7 7 7"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Renders exactly one detected meaningful change (Phase 6A/6B). The single
 * shared presentation for a ChangeEvent, used by both the watchlist detail
 * page (MeaningfulChanges.tsx) and the dashboard's "Needs your attention"
 * section -- one definition of what a change looks like, matching Phase
 * 7 Step 9's "do not create a second definition of meaningful."
 *
 * Every fact shown here (symbol, severity, title, description) comes
 * straight from the backend -- never recalculated or invented. The only
 * thing derived on the frontend is which decorative icon to show, from a
 * simple old/new comparison (not a new numeric fact).
 */
export function ChangeCard({ change, linkTo, linkState, acknowledged, onAcknowledge }: ChangeCardProps) {
  const direction: 'up' | 'down' | 'activity' =
    change.type === 'PRICE_CHANGE' && change.new_value !== null && change.old_value !== null
      ? Number(change.new_value) >= Number(change.old_value)
        ? 'up'
        : 'down'
      : 'activity';
  const directionClass = direction === 'up' ? styles.up : direction === 'down' ? styles.down : '';

  const body = (
    <div className={styles.cardBody}>
      <div className={styles.cardHeader}>
        <span className={styles.symbol}>{change.symbol}</span>
        <span className={`${styles.severityBadge} ${severityClass(change.severity)}`}>
          {SEVERITY_LABEL[change.severity] ?? change.severity}
        </span>
      </div>
      <div className={`${styles.titleRow} ${directionClass}`}>
        <ChangeTypeIcon direction={direction} />
        <span>{change.title}</span>
      </div>
      {change.description && <p className={`${styles.description} text-body-small`}>{change.description}</p>}
    </div>
  );

  return (
    <li className={styles.card}>
      {linkTo ? (
        <Link to={linkTo} state={linkState} className={styles.cardLink}>
          {body}
        </Link>
      ) : (
        body
      )}
      {onAcknowledge && (
        <div className={styles.acknowledgeRow}>
          <button
            type="button"
            className={styles.acknowledgeButton}
            onClick={onAcknowledge}
            disabled={acknowledged}
          >
            {acknowledged ? '✓ Read' : 'Mark as read'}
          </button>
        </div>
      )}
    </li>
  );
}
