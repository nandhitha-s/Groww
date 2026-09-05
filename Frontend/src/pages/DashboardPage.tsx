import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/Button';
import { EmptyState, WatchlistsEmptyIllustration } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { ChangeCard } from '../components/changes/ChangeCard';
import { MarketSignalCard } from '../components/changes/MarketSignalCard';
import { DashboardWatchlistCard } from '../components/dashboard/DashboardWatchlistCard';
import { MarketActivityList, type MarketActivityItem } from '../components/dashboard/MarketActivityList';
import { useAuth } from '../context/auth-context';
import { getQuote } from '../api/marketData';
import { getWatchlist, getWatchlists, recordWatchlistSeen } from '../api/watchlists';
import { getChanges } from '../api/changes';
import { sortChangesByPriority } from '../utils/changePriority';
import type { ChangeEventSummary, MarketSignalSummary } from '../types/marketState';
import type { ChangeEventListItem } from '../types/changes';
import type { WatchlistStock, WatchlistSummary } from '../types/watchlist';
import styles from './DashboardPage.module.css';

const MAX_ATTENTION_ITEMS = 5;
const MAX_SIGNAL_ITEMS = 5;
// Step 3: bounded regardless of how many stocks the user actually tracks --
// this is what keeps Market Activity to "the smallest reasonable number of
// existing API calls" rather than one quote request per tracked stock.
const MARKET_ACTIVITY_LIMIT = 8;

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

interface DashboardData {
  watchlists: WatchlistSummary[];
  // Persisted, unacknowledged changes (GET /api/changes) -- the source of
  // truth for everything shown on this page (summary tiles, "Needs your
  // attention", per-watchlist counts). Unlike the ephemeral per-call
  // `changesByWatchlist` below, this survives a page reload: a change stays
  // visible here until the user acknowledges it, not just until the next
  // "seen" comparison finds nothing new.
  unacknowledgedChanges: ChangeEventListItem[];
  // The ephemeral result of this load's own "seen" comparison -- kept only
  // as an optional preload for the stock detail page's nav state (Phase 8),
  // never used for anything shown directly on this page.
  changesByWatchlist: Record<string, ChangeEventSummary[]>;
  signalsByWatchlist: Record<string, MarketSignalSummary[]>;
  unavailableCount: number;
  marketActivity: MarketActivityItem[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Guards against React StrictMode's dev-only double-invoke of this effect:
  // each recordWatchlistSeen call both reads AND overwrites the user's
  // baseline, so a second, independent load() firing right behind the first
  // would legitimately find nothing new (the first call already consumed
  // the change) and its setData would clobber the first call's real result.
  // Reset to false on failure so the "Try again" retry can still run.
  const loadInFlightOrDoneRef = useRef(false);

  const load = useCallback(async () => {
    if (loadInFlightOrDoneRef.current) return;
    loadInFlightOrDoneRef.current = true;
    setLoadError(false);
    setData(null);
    try {
      const watchlists = await getWatchlists();

      // One "seen" call per non-empty watchlist -- this is the same
      // per-watchlist operation the detail page already performs when a
      // user opens it; the dashboard just performs it for every watchlist
      // up front. Never one call per stock (that stays server-side, inside
      // each of these calls). Each watchlist's result is isolated: a
      // failure for one never blocks the others or the page as a whole.
      // Alongside it, one getWatchlist per non-empty watchlist -- the only
      // way to learn which actual stocks exist (Phase 10's Market Activity
      // needs symbols, not just per-watchlist counts/changes) -- fetched in
      // parallel with the "seen" calls, not after them.
      const nonEmpty = watchlists.filter((w) => w.stock_count > 0);
      const [seenResults, detailResults] = await Promise.all([
        Promise.allSettled(nonEmpty.map((w) => recordWatchlistSeen(w.id))),
        Promise.allSettled(nonEmpty.map((w) => getWatchlist(w.id))),
      ]);

      const changesByWatchlist: Record<string, ChangeEventSummary[]> = {};
      const signalsByWatchlist: Record<string, MarketSignalSummary[]> = {};
      let unavailableCount = 0;
      seenResults.forEach((result, index) => {
        const watchlistId = nonEmpty[index].id;
        if (result.status === 'fulfilled') {
          changesByWatchlist[watchlistId] = result.value.changes;
          // Phase 6C: the same response already carries `market_signals` --
          // previously read here only as `.changes`, silently dropping this
          // field. Kept in its own map, never merged into changesByWatchlist,
          // since a signal is never a meaningful change (Step 6).
          signalsByWatchlist[watchlistId] = result.value.market_signals;
          unavailableCount += result.value.failed;
        }
        // A rejected result (that watchlist's "seen" call failed outright)
        // contributes no changes and no failed-quote count -- never
        // fabricated, never treated as a whole-page error.
      });

      // Market Activity (Step 8): dedupe stocks across watchlists by
      // symbol (a stock in two watchlists shows once), capped at
      // MARKET_ACTIVITY_LIMIT -- never one quote request per tracked stock.
      const seenSymbols = new Set<string>();
      const candidateStocks: WatchlistStock[] = [];
      for (const result of detailResults) {
        if (result.status !== 'fulfilled') continue;
        for (const stock of result.value.stocks) {
          if (seenSymbols.has(stock.symbol)) continue;
          seenSymbols.add(stock.symbol);
          candidateStocks.push(stock);
          if (candidateStocks.length >= MARKET_ACTIVITY_LIMIT) break;
        }
        if (candidateStocks.length >= MARKET_ACTIVITY_LIMIT) break;
      }

      const quoteResults = await Promise.allSettled(candidateStocks.map((s) => getQuote(s.symbol)));
      const marketActivity: MarketActivityItem[] = [];
      quoteResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          marketActivity.push({
            symbol: candidateStocks[index].symbol,
            price: result.value.price,
            changePercent: result.value.change_percent,
          });
        }
        // A failed quote is simply skipped (Step 10) -- never fabricated,
        // never blocks the rest of the dashboard.
      });

      // Persisted history (Step: dashboard consistency with the Changes
      // tab) -- fetched after the "seen" calls above so a change detected
      // in this very load is already committed and included. A failure here
      // is never allowed to block the rest of the dashboard -- it just means
      // "Needs your attention" falls back to nothing from history.
      let unacknowledgedChanges: ChangeEventListItem[] = [];
      if (watchlists.length > 0) {
        try {
          const changesResult = await getChanges({ limit: 100 });
          unacknowledgedChanges = changesResult.items.filter((item) => item.acknowledged_at === null);
        } catch {
          // Fall back to an empty list -- see comment above.
        }
      }

      setData({
        watchlists,
        unacknowledgedChanges,
        changesByWatchlist,
        signalsByWatchlist,
        unavailableCount,
        marketActivity,
      });
    } catch {
      setLoadError(true);
      loadInFlightOrDoneRef.current = false;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loadError) {
    return (
      <div className={styles.page}>
        <AppHeader />
        <PageContainer maxWidth={840}>
          <ErrorState
            heading="Something went wrong"
            subtitle="We couldn't load your dashboard. Check your connection and try again."
            onRetry={load}
          />
        </PageContainer>
      </div>
    );
  }

  const firstName = user?.name?.trim().split(/\s+/)[0];

  return (
    <div className={`${styles.page} anim-fade-in-up`}>
      <AppHeader />
      <PageContainer maxWidth={840}>
        <div className={styles.headerBlock}>
          <h1 className={`${styles.greeting} text-h1`}>
            {greeting(new Date().getHours())}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className={`${styles.subtitle} text-body-large`}>
            Here&rsquo;s what changed since you last checked.
          </p>
        </div>

        {data === null ? (
          <DashboardSkeleton />
        ) : data.watchlists.length === 0 ? (
          <EmptyState
            illustration={<WatchlistsEmptyIllustration />}
            heading="Build your first watchlist"
            subtitle="Once you're tracking some stocks, this is where you'll see what changed since you last checked."
            action={
              <Button style={{ width: 'auto' }} onClick={() => navigate('/watchlists')}>
                Go to My Watchlists
              </Button>
            }
          />
        ) : (
          <DashboardContent data={data} onOpenWatchlist={(id) => navigate(`/watchlists/${id}`)} />
        )}
      </PageContainer>
    </div>
  );
}

function DashboardContent({
  data,
  onOpenWatchlist,
}: {
  data: DashboardData;
  onOpenWatchlist: (id: string) => void;
}) {
  const totalStocks = data.watchlists.reduce((sum, w) => sum + w.stock_count, 0);
  const allChanges = data.unacknowledgedChanges;
  const highCount = allChanges.filter((c) => c.severity === 'HIGH').length;

  const sortedChanges = sortChangesByPriority(allChanges);
  const topChanges = sortedChanges.slice(0, MAX_ATTENTION_ITEMS);

  // Per-watchlist counts for "Your watchlists" below -- same persisted,
  // unacknowledged source as the summary tiles above, so a card's count
  // never disappears just because this load's own "seen" comparison found
  // nothing new for that watchlist.
  const unacknowledgedCountByWatchlist = data.unacknowledgedChanges.reduce<Record<string, number>>(
    (acc, c) => {
      if (c.watchlist_id) acc[c.watchlist_id] = (acc[c.watchlist_id] ?? 0) + 1;
      return acc;
    },
    {},
  );

  // Market Signals (Phase 6C): ephemeral, current-quote-only conditions --
  // reuses the same priority sort as changes (both have severity/
  // detected_at), but is a wholly separate list: never merged into
  // allChanges/topChanges, never counted in the summary tiles above
  // (Step 10), never given its own persisted "since you last checked" copy.
  const signalsWithWatchlist: (MarketSignalSummary & { watchlistId: string })[] = Object.entries(
    data.signalsByWatchlist,
  ).flatMap(([watchlistId, signals]) => signals.map((signal) => ({ ...signal, watchlistId })));
  const sortedSignals = sortChangesByPriority(signalsWithWatchlist);
  const topSignals = sortedSignals.slice(0, MAX_SIGNAL_ITEMS);

  return (
    <>
      <div className={styles.summaryRow}>
        <div className={styles.summaryTile}>
          <span className={`${styles.summaryValue} text-number`}>{totalStocks}</span>
          <span className={`${styles.summaryLabel} text-label`}>
            {totalStocks === 1 ? 'Stock' : 'Stocks'}
          </span>
        </div>
        {allChanges.length > 0 ? (
          <>
            <div className={styles.summaryTile}>
              <span className={`${styles.summaryValue} text-number`}>{allChanges.length}</span>
              <span className={`${styles.summaryLabel} text-label`}>
                {allChanges.length === 1 ? 'Meaningful Change' : 'Meaningful Changes'}
              </span>
            </div>
            {highCount > 0 && (
              <div className={`${styles.summaryTile} ${styles.summaryTileHigh}`}>
                <span className={`${styles.summaryValue} text-number`}>{highCount}</span>
                <span className={`${styles.summaryLabel} text-label`}>High Impact</span>
              </div>
            )}
          </>
        ) : (
          <div className={styles.summaryTile}>
            <span className={`${styles.summaryValue} text-number`}>&mdash;</span>
            <span className={`${styles.summaryLabel} text-label`}>No Meaningful Changes</span>
          </div>
        )}
      </div>

      {data.unavailableCount > 0 && (
        <p className={`${styles.unavailableNote} text-caption`}>
          {data.unavailableCount} {data.unavailableCount === 1 ? 'stock is' : 'stocks are'} temporarily
          unavailable right now.
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHeadingRow}>
          <h2 className={`${styles.sectionHeading} text-h2`}>Needs your attention</h2>
          {allChanges.length > 0 && (
            <Link to="/changes" className={styles.viewAllLink}>
              View all changes →
            </Link>
          )}
        </div>
        {topChanges.length === 0 ? (
          <div className={styles.caughtUp}>
            <p className="text-body-strong">You&rsquo;re all caught up.</p>
            <p className="text-body">No meaningful changes since your last check.</p>
          </div>
        ) : (
          <ul className={styles.attentionList}>
            {topChanges.map((change) => (
              <ChangeCard
                key={change.id}
                change={change}
                linkTo={`/stocks/${change.symbol}`}
                linkState={{
                  watchlistId: change.watchlist_id ?? undefined,
                  changes: (change.watchlist_id && data.changesByWatchlist[change.watchlist_id]) || [],
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {topSignals.length > 0 && (
        <section className={styles.section}>
          <h2 className={`${styles.sectionHeading} text-h2`}>Market Signals</h2>
          <ul className={styles.attentionList}>
            {topSignals.map((signal, index) => (
              <MarketSignalCard
                key={`${signal.stock_id}-${signal.type}-${index}`}
                signal={signal}
                linkTo={`/stocks/${signal.symbol}`}
                linkState={{ watchlistId: signal.watchlistId }}
              />
            ))}
          </ul>
        </section>
      )}

      {data.marketActivity.length > 0 && (
        <section className={styles.section}>
          <h2 className={`${styles.sectionHeading} text-h2`}>Market Activity</h2>
          <MarketActivityList items={data.marketActivity} />
        </section>
      )}

      <section className={styles.section}>
        <h2 className={`${styles.sectionHeading} text-h2`}>Your watchlists</h2>
        <div>
          {data.watchlists.map((watchlist, index) => (
            <DashboardWatchlistCard
              key={watchlist.id}
              name={watchlist.name}
              stockCount={watchlist.stock_count}
              changeCount={unacknowledgedCountByWatchlist[watchlist.id] ?? 0}
              onOpen={() => onOpenWatchlist(watchlist.id)}
              staggerIndex={index}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className={styles.summaryRow}>
        <Skeleton width={140} height={64} radius={14} />
        <Skeleton width={140} height={64} radius={14} />
        <Skeleton width={140} height={64} radius={14} />
      </div>
      <div className={styles.section}>
        <Skeleton width={180} height={22} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <Skeleton width="100%" height={92} radius={14} />
          <Skeleton width="100%" height={92} radius={14} />
        </div>
      </div>
      <div className={styles.section}>
        <Skeleton width={150} height={22} />
        <Skeleton width="100%" height={148} radius={14} style={{ marginTop: 14 }} />
      </div>
      <div className={styles.section}>
        <Skeleton width={160} height={22} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          <Skeleton width="100%" height={66} radius={14} />
          <Skeleton width="100%" height={66} radius={14} />
          <Skeleton width="100%" height={66} radius={14} />
        </div>
      </div>
    </div>
  );
}
