import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getHistory, getQuote } from '../api/marketData';
import { getWatchlist, getWatchlists, recordWatchlistSeen } from '../api/watchlists';
import { AppHeader } from '../components/layout/AppHeader';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { ChangeCard } from '../components/changes/ChangeCard';
import { PriceChart } from '../components/stockDetail/PriceChart';
import { MobileWatchlistStrip, WatchlistSidebar } from '../components/stockDetail/WatchlistSidebar';
import { sortChangesByPriority } from '../utils/changePriority';
import {
  changeDirection,
  formatCompactVolume,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
} from '../utils/formatNumber';
import { formatTimeOfDay } from '../utils/relativeTime';
import type { HistoricalCandle, HistoricalResponse, HistoryPeriod, QuoteResponse } from '../types/marketData';
import type { ChangeEventSummary } from '../types/marketState';
import type { WatchlistStock } from '../types/watchlist';
import styles from './StockDetailPage.module.css';

type QuoteFetchState =
  | { status: 'loading' }
  | { status: 'success'; data: QuoteResponse }
  | { status: 'error'; message: string };

type HistoryFetchState =
  | { status: 'loading' }
  | { status: 'success'; data: HistoricalResponse }
  | { status: 'error' };

interface StockNavState {
  watchlistId?: string;
  changes?: ChangeEventSummary[];
}

const PERIODS: HistoryPeriod[] = ['1D', '1W', '1M', '3M', '1Y'];
const DEFAULT_PERIOD: HistoryPeriod = '1M';

interface WeeklySummary {
  changePercent: number | null;
  weekHigh: number;
  weekLow: number;
  avgVolume: number;
}

/** Pure, honest summary of a week's real candles -- open-to-close % change,
 * the week's high/low, and average volume. Never fabricated: an empty
 * candle list (nothing returned by the provider) yields no summary at all,
 * never a placeholder. */
function computeWeeklySummary(candles: HistoricalCandle[]): WeeklySummary | null {
  if (candles.length === 0) return null;

  const weekOpen = Number(candles[0].open);
  const weekClose = Number(candles[candles.length - 1].close);
  const changePercent = weekOpen !== 0 ? ((weekClose - weekOpen) / weekOpen) * 100 : null;
  const weekHigh = Math.max(...candles.map((c) => Number(c.high)));
  const weekLow = Math.min(...candles.map((c) => Number(c.low)));
  const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;

  return { changePercent, weekHigh, weekLow, avgVolume };
}

function quoteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Rate limited. Try again shortly.';
    if (err.status === 502 || err.status === 503) return 'Quote temporarily unavailable.';
    if (err.status === 422) return 'Invalid request.';
  }
  return 'Unable to load the current quote.';
}

export function StockDetailPage() {
  const { symbol = '' } = useParams<{ symbol: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = (location.state ?? null) as StockNavState | null;

  const [quote, setQuote] = useState<QuoteFetchState>({ status: 'loading' });
  const [notFound, setNotFound] = useState(false);
  const [history, setHistory] = useState<HistoryFetchState>({ status: 'loading' });
  const [period, setPeriod] = useState<HistoryPeriod>(DEFAULT_PERIOD);
  const [tab, setTab] = useState<'overview' | 'chart' | 'insights'>('overview');

  const [sidebarWatchlistId, setSidebarWatchlistId] = useState<string | undefined>(navState?.watchlistId);
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [sidebarName, setSidebarName] = useState<string | null>(null);
  const [sidebarStocks, setSidebarStocks] = useState<WatchlistStock[]>([]);

  const [changes, setChanges] = useState<ChangeEventSummary[] | null>(navState?.changes ?? null);
  const changesFetchedForRef = useRef<string | null>(null);

  // Every navigation into this page (sidebar click, dashboard/watchlist
  // click, or a direct URL) carries its own location.state -- re-sync from
  // it every time so switching stocks never shows a stale, previous
  // stock's meaningful changes for even a frame.
  useEffect(() => {
    setChanges(navState?.changes ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const loadQuote = useCallback(async () => {
    setQuote({ status: 'loading' });
    setNotFound(false);
    try {
      const data = await getQuote(symbol);
      setQuote({ status: 'success', data });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
        return;
      }
      setQuote({ status: 'error', message: quoteErrorMessage(err) });
    }
  }, [symbol]);

  useEffect(() => {
    loadQuote();
  }, [loadQuote]);

  const loadHistory = useCallback(async () => {
    setHistory({ status: 'loading' });
    try {
      const data = await getHistory(symbol, period);
      setHistory({ status: 'success', data });
    } catch {
      setHistory({ status: 'error' });
    }
  }, [symbol, period]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Resolve which watchlist backs the sidebar: whichever watchlist the user
  // navigated from (carried via location.state), or -- for a direct URL
  // visit -- the user's first watchlist. Only re-runs when the incoming
  // watchlist id actually changes, never on a same-watchlist stock switch.
  useEffect(() => {
    let cancelled = false;
    async function resolveSidebar() {
      setSidebarLoading(true);
      try {
        const id = navState?.watchlistId ?? (await getWatchlists())[0]?.id;
        if (!id) {
          if (!cancelled) {
            setSidebarStocks([]);
            setSidebarName(null);
            setSidebarWatchlistId(undefined);
          }
          return;
        }
        const detail = await getWatchlist(id);
        if (!cancelled) {
          setSidebarWatchlistId(detail.id);
          setSidebarName(detail.name);
          setSidebarStocks(detail.stocks);
        }
      } catch {
        if (!cancelled) {
          setSidebarStocks([]);
          setSidebarName(null);
        }
      } finally {
        if (!cancelled) setSidebarLoading(false);
      }
    }
    resolveSidebar();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navState?.watchlistId]);

  // Fallback: only when we arrived WITHOUT a already-fetched changes list
  // (a direct URL visit or a refresh) do we record this watchlist as seen
  // ourselves -- exactly once per resolved watchlist, guarded against
  // StrictMode's dev-only double-invoke. When changes arrive via
  // navigation state instead (the normal path, from a page that already
  // called this), we never call it again here -- doing so would silently
  // consume/hide the very change the user just clicked through to see.
  useEffect(() => {
    if (changes !== null) return;
    if (!sidebarWatchlistId) return;
    if (changesFetchedForRef.current === sidebarWatchlistId) return;
    changesFetchedForRef.current = sidebarWatchlistId;
    let cancelled = false;
    recordWatchlistSeen(sidebarWatchlistId)
      .then((result) => {
        if (!cancelled) setChanges(result.changes);
      })
      .catch(() => {
        if (!cancelled) setChanges([]);
      });
    return () => {
      cancelled = true;
    };
  }, [changes, sidebarWatchlistId]);

  const stockChanges = useMemo(
    () => sortChangesByPriority((changes ?? []).filter((c) => c.symbol === symbol)),
    [changes, symbol],
  );

  const sidebarMatch = sidebarStocks.find((s) => s.symbol === symbol);
  const backHref = sidebarWatchlistId ? `/watchlists/${sidebarWatchlistId}` : '/watchlists';

  if (notFound) {
    return (
      <div className={styles.page}>
        <AppHeader />
        <div className={styles.notFoundWrap}>
          <ErrorState
            heading="Stock not found"
            subtitle={`We couldn't find "${symbol}". It may not exist or isn't supported yet.`}
            onRetry={() => navigate(backHref)}
            retryLabel="Back to Watchlists"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader />
      <div className={styles.body}>
        <WatchlistSidebar
          loading={sidebarLoading}
          watchlistName={sidebarName}
          watchlistId={sidebarWatchlistId}
          stocks={sidebarStocks}
          activeSymbol={symbol}
          changes={changes ?? []}
        />

        <main className={styles.main}>
          <Link to={backHref} className={styles.backLink}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Back to Watchlist
          </Link>

          <MobileWatchlistStrip
            stocks={sidebarStocks}
            activeSymbol={symbol}
            watchlistId={sidebarWatchlistId}
            changes={changes ?? []}
          />

          <StockHeader symbol={symbol} sidebarMatch={sidebarMatch} quote={quote} onRetryQuote={loadQuote} />

          <div className={styles.tabs} role="tablist">
            {(['overview', 'chart', 'insights'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'overview' ? 'Overview' : t === 'chart' ? 'Chart' : 'Insights'}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <>
              <SinceYouLastChecked changes={changes} stockChanges={stockChanges} />
              <PriceStats quote={quote} />
            </>
          )}

          {tab === 'chart' && (
            <div className={styles.chartCard}>
              <div className={styles.timeframeRow}>
                {PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.timeframeButton} ${period === p ? styles.timeframeButtonActive : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {history.status === 'loading' && <Skeleton width="100%" height={300} radius={12} />}
              {history.status === 'error' && (
                <ErrorState
                  heading="Unable to load price history"
                  subtitle="Check your connection and try again."
                  onRetry={loadHistory}
                />
              )}
              {history.status === 'success' && <PriceChart candles={history.data.candles} />}
            </div>
          )}

          {tab === 'insights' && (
            <div className={styles.section}>
              <p className={`${styles.insightsNote} text-body-small`}>
                Insights shows the meaningful changes detected for this stock, plus a quick summary of the
                past week's activity -- there's no separate analysis yet.
              </p>
              {changes === null ? (
                <ChangeSkeleton />
              ) : stockChanges.length === 0 ? (
                <div className={styles.caughtUpNote}>Nothing meaningful detected for {symbol} yet.</div>
              ) : (
                <ul className={styles.changeList}>
                  {stockChanges.map((change, index) => (
                    <ChangeCard key={`${change.stock_id}-${change.type}-${index}`} change={change} />
                  ))}
                </ul>
              )}

              <PastWeekSummary symbol={symbol} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function StockHeader({
  symbol,
  sidebarMatch,
  quote,
  onRetryQuote,
}: {
  symbol: string;
  sidebarMatch: WatchlistStock | undefined;
  quote: QuoteFetchState;
  onRetryQuote: () => void;
}) {
  return (
    <div className={styles.headerRow}>
      <div>
        <div className={styles.identity}>
          <span className={styles.symbol}>{symbol}</span>
          {sidebarMatch?.exchange && <span className={styles.exchangeTag}>{sidebarMatch.exchange}</span>}
        </div>
        {sidebarMatch?.company_name && <p className={`${styles.companyName} text-body`}>{sidebarMatch.company_name}</p>}
      </div>

      <div className={styles.priceBlock}>
        {quote.status === 'loading' && (
          <>
            <Skeleton width={160} height={36} style={{ marginLeft: 'auto' }} />
            <Skeleton width={100} height={18} style={{ marginTop: 8, marginLeft: 'auto' }} />
          </>
        )}
        {quote.status === 'error' && (
          <p className={styles.quoteErrorNote}>
            {quote.message}
            <button type="button" onClick={onRetryQuote}>
              Retry
            </button>
          </p>
        )}
        {quote.status === 'success' && (
          <>
            <span className={styles.price}>
              {formatCurrency(quote.data.price)}
              {quote.data.is_delayed && <span className={styles.delayedTag}>Delayed</span>}
            </span>
            {quote.data.change !== null && (
              <div
                className={`${styles.todayChange} ${
                  changeDirection(quote.data.change) === 'up'
                    ? styles.up
                    : changeDirection(quote.data.change) === 'down'
                      ? styles.down
                      : styles.flat
                }`}
              >
                {formatSignedCurrency(quote.data.change)}
                {quote.data.change_percent !== null && ` (${formatPercent(quote.data.change_percent)})`}
                <span className="text-caption"> today</span>
              </div>
            )}
            <p className={`${styles.asOf} text-caption`}>As of {formatTimeOfDay(quote.data.timestamp)}</p>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeSkeleton() {
  return (
    <div className={styles.changeSkeletonCard}>
      <Skeleton width={120} height={16} style={{ marginBottom: 10 }} />
      <Skeleton width="70%" height={14} style={{ marginBottom: 8 }} />
      <Skeleton width="90%" height={12} />
    </div>
  );
}

function SinceYouLastChecked({
  changes,
  stockChanges,
}: {
  changes: ChangeEventSummary[] | null;
  stockChanges: ChangeEventSummary[];
}) {
  if (changes === null) {
    return (
      <div className={styles.section}>
        <ChangeSkeleton />
      </div>
    );
  }

  if (stockChanges.length === 0) return null;

  return (
    <div className={`${styles.sinceChecked} anim-fade-in-up`}>
      <p className={styles.sinceCheckedLabel}>Since you last checked</p>
      <ul className={styles.changeList}>
        {stockChanges.map((change, index) => (
          <ChangeCard key={`${change.stock_id}-${change.type}-${index}`} change={change} />
        ))}
      </ul>
    </div>
  );
}

type WeeklySummaryState =
  | { status: 'loading' }
  | { status: 'success'; summary: WeeklySummary }
  | { status: 'unavailable' };

/**
 * A quick "what's this stock done lately" reference for the Insights tab,
 * so it never feels empty just because nothing crossed a meaningful-change
 * threshold. Deliberately independent of the Chart tab's own timeframe
 * selector -- always the real last 7 days, fetched via the same existing
 * getHistory API (period="1W"), lazily (only mounts while the Insights tab
 * is open) and only once per symbol. Never a ChangeEvent, never counted as
 * a meaningful change -- purely descriptive, real historical data.
 */
function PastWeekSummary({ symbol }: { symbol: string }) {
  const [state, setState] = useState<WeeklySummaryState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getHistory(symbol, '1W')
      .then((data) => {
        if (cancelled) return;
        const summary = computeWeeklySummary(data.candles);
        setState(summary ? { status: 'success', summary } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (state.status === 'loading') {
    return (
      <div className={styles.statsCard} style={{ marginTop: 'var(--space-4)' }}>
        <Skeleton width={90} height={14} style={{ marginBottom: 10 }} />
        <Skeleton width="100%" height={16} style={{ marginBottom: 6 }} />
        <Skeleton width="100%" height={16} style={{ marginBottom: 6 }} />
        <Skeleton width="100%" height={16} />
      </div>
    );
  }

  // Never block the rest of Insights over this secondary context, and
  // never invent a summary when the provider returned no real candles.
  if (state.status === 'unavailable') return null;

  const { summary } = state;
  const direction = summary.changePercent === null ? 'flat' : summary.changePercent >= 0 ? 'up' : 'down';
  const directionClass = direction === 'up' ? styles.up : direction === 'down' ? styles.down : styles.flat;

  return (
    <div className={styles.statsCard} style={{ marginTop: 'var(--space-4)' }}>
      <p className={`${styles.statsHeading} text-label`}>Past Week</p>
      {summary.changePercent !== null && (
        <div className={styles.statRow}>
          <span className={styles.statLabel}>Change</span>
          <span className={`${styles.statValue} ${directionClass}`}>{formatPercent(summary.changePercent)}</span>
        </div>
      )}
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Week High</span>
        <span className={styles.statValue}>{formatCurrency(summary.weekHigh)}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Week Low</span>
        <span className={styles.statValue}>{formatCurrency(summary.weekLow)}</span>
      </div>
      <div className={styles.statRow}>
        <span className={styles.statLabel}>Avg Volume</span>
        <span className={styles.statValue}>{formatCompactVolume(summary.avgVolume)}</span>
      </div>
    </div>
  );
}

function PriceStats({ quote }: { quote: QuoteFetchState }) {
  if (quote.status !== 'success') return null;
  const { data } = quote;

  const hasAnalysis = data.day_low !== null || data.day_high !== null;
  const hasStats = data.previous_close !== null || data.volume !== null || data.day_high !== null || data.day_low !== null;

  if (!hasAnalysis && !hasStats) return null;

  return (
    <div className={styles.statsGrid}>
      {hasAnalysis && (
        <div className={styles.statsCard}>
          <p className={`${styles.statsHeading} text-label`}>Price Analysis</p>
          {data.day_low !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Day Low</span>
              <span className={styles.statValue}>{formatCurrency(data.day_low)}</span>
            </div>
          )}
          {data.day_high !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Day High</span>
              <span className={styles.statValue}>{formatCurrency(data.day_high)}</span>
            </div>
          )}
        </div>
      )}

      {hasStats && (
        <div className={styles.statsCard}>
          <p className={`${styles.statsHeading} text-label`}>Price Stats</p>
          {data.previous_close !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Previous Close</span>
              <span className={styles.statValue}>{formatCurrency(data.previous_close)}</span>
            </div>
          )}
          {data.volume !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Volume</span>
              <span className={styles.statValue}>{formatCompactVolume(data.volume)}</span>
            </div>
          )}
          {data.day_high !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Day High</span>
              <span className={styles.statValue}>{formatCurrency(data.day_high)}</span>
            </div>
          )}
          {data.day_low !== null && (
            <div className={styles.statRow}>
              <span className={styles.statLabel}>Day Low</span>
              <span className={styles.statValue}>{formatCurrency(data.day_low)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
