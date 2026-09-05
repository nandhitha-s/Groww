import { Link } from 'react-router-dom';
import { Skeleton } from '../Skeleton';
import type { ChangeEventSummary } from '../../types/marketState';
import type { WatchlistStock } from '../../types/watchlist';
import styles from './WatchlistSidebar.module.css';

interface WatchlistSidebarProps {
  loading: boolean;
  watchlistName: string | null;
  watchlistId?: string;
  stocks: WatchlistStock[];
  activeSymbol: string;
  changes: ChangeEventSummary[];
}

function severityDotClass(symbol: string, changes: ChangeEventSummary[]): string | null {
  const symbolChanges = changes.filter((c) => c.symbol === symbol);
  if (symbolChanges.some((c) => c.severity === 'HIGH')) return styles.dotHigh;
  if (symbolChanges.length > 0) return styles.dotMedium;
  return null;
}

/**
 * The stock detail page's left sidebar (Phase 8, Step 4): the same
 * watchlist data already loaded for this page (never a separate watchlist
 * implementation, never a new quote per row -- kept lightweight by design).
 * A small dot reuses the same ChangeEvent data already fetched for the
 * "Meaningful Change" panel, so a sibling stock's detected change is visible
 * at a glance without any extra request.
 */
export function WatchlistSidebar({
  loading,
  watchlistName,
  watchlistId,
  stocks,
  activeSymbol,
  changes,
}: WatchlistSidebarProps) {
  if (loading) {
    return (
      <aside className={styles.sidebar} aria-hidden="true">
        <Skeleton width={100} height={14} style={{ marginBottom: 14 }} />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} width="100%" height={52} radius={10} style={{ marginBottom: 8 }} />
        ))}
      </aside>
    );
  }

  if (stocks.length === 0) {
    return (
      <aside className={styles.sidebar}>
        <p className={styles.emptyNote}>
          <Link to="/watchlists">Open a watchlist</Link> to browse its stocks here.
        </p>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      {watchlistName && <p className={styles.watchlistName}>{watchlistName}</p>}
      <nav aria-label="Watchlist stocks">
        {stocks.map((stock) => {
          const isActive = stock.symbol === activeSymbol;
          const dotClass = severityDotClass(stock.symbol, changes);
          return (
            <Link
              key={stock.id}
              to={`/stocks/${stock.symbol}`}
              state={{ watchlistId, changes }}
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className={styles.itemInfo}>
                <span className={styles.itemSymbol}>{stock.symbol}</span>
                {stock.company_name && <span className={styles.itemCompany}>{stock.company_name}</span>}
              </span>
              {dotClass && <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/** The same watchlist stock list, as a compact horizontally-scrollable strip
 * for narrow viewports where the persistent sidebar is hidden (Step 17). */
export function MobileWatchlistStrip({
  stocks,
  activeSymbol,
  watchlistId,
  changes,
}: {
  stocks: WatchlistStock[];
  activeSymbol: string;
  watchlistId?: string;
  changes: ChangeEventSummary[];
}) {
  if (stocks.length === 0) return null;

  return (
    <div className={styles.mobileStrip}>
      {stocks.map((stock) => {
        const isActive = stock.symbol === activeSymbol;
        const dotClass = severityDotClass(stock.symbol, changes);
        return (
          <Link
            key={stock.id}
            to={`/stocks/${stock.symbol}`}
            state={{ watchlistId, changes }}
            className={`${styles.chip} ${isActive ? styles.chipActive : ''}`}
            aria-current={isActive ? 'page' : undefined}
          >
            {stock.symbol}
            {dotClass && <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />}
          </Link>
        );
      })}
    </div>
  );
}
