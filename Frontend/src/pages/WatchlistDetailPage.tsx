import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getQuote } from '../api/marketData';
import {
  deleteWatchlist,
  getWatchlist,
  recordWatchlistSeen,
  removeStock,
  reorderStocks,
} from '../api/watchlists';
import { AppHeader } from '../components/layout/AppHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { DropdownMenu } from '../components/DropdownMenu';
import { EmptyState, WatchlistDetailEmptyIllustration } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { MeaningfulChanges } from '../components/watchlists/MeaningfulChanges';
import { StockList } from '../components/watchlists/StockList';
import { StockRowSkeleton } from '../components/watchlists/StockRowSkeleton';
import { AddStockDialog } from '../components/dialogs/AddStockDialog';
import { RenameWatchlistDialog } from '../components/dialogs/RenameWatchlistDialog';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { useToast } from '../context/toast-context';
import type { QuoteState } from '../types/marketData';
import type { ChangeEventSummary } from '../types/marketState';
import type { WatchlistDetail, WatchlistStock } from '../types/watchlist';
import styles from './WatchlistDetailPage.module.css';

const REMOVE_ANIMATION_MS = 260;

function quoteErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'Not found';
    if (err.status === 429) return 'Rate limited';
    if (err.status === 502 || err.status === 503) return 'Unavailable';
    if (err.status === 422) return 'Invalid request';
  }
  return 'Unavailable';
}

export function WatchlistDetailPage() {
  const { watchlistId } = useParams<{ watchlistId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [detail, setDetail] = useState<WatchlistDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [addStockOpen, setAddStockOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [removingSymbol, setRemovingSymbol] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);
  const [newlyAddedId, setNewlyAddedId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [changes, setChanges] = useState<ChangeEventSummary[]>([]);

  // Phase 5B/6A: "seen" bookkeeping, kept as refs since neither should ever
  // trigger a re-render on its own.
  // - seenRecordedForRef: which watchlist's *initial* load we've already
  //   triggered a recording for, so re-renders/unrelated state changes
  //   (remove, reorder, drag-and-drop) never fire it again. Keyed by
  //   watchlist id rather than a plain boolean so navigating away and back
  //   to the same watchlist correctly records it again as a fresh visit.
  // - seenInFlightRef: prevents two "seen" requests from overlapping (e.g.
  //   a slow initial recording still in flight when the user hits refresh).
  // - currentWatchlistIdRef: always the watchlist actually on screen right
  //   now (unlike `watchlistId`, which a stale async closure would still
  //   see as whatever it was when that closure was created) -- read only
  //   when a "seen" response comes back, so a slow response for a watchlist
  //   the user has since navigated away from can never paint stale
  //   meaningful changes onto the one now being viewed (Step 13).
  const seenRecordedForRef = useRef<string | null>(null);
  const seenInFlightRef = useRef(false);
  const currentWatchlistIdRef = useRef<string | undefined>(watchlistId);

  useEffect(() => {
    currentWatchlistIdRef.current = watchlistId;
  }, [watchlistId]);

  const triggerRecordSeen = useCallback(async (id: string) => {
    if (seenInFlightRef.current) return;
    seenInFlightRef.current = true;
    try {
      const result = await recordWatchlistSeen(id);
      if (currentWatchlistIdRef.current === id) {
        setChanges(result.changes);
      }
    } catch {
      // Deliberately silent (never break the watchlist UI over this): the
      // user already sees their real quotes regardless of whether this
      // internal bookkeeping call succeeded. The next legitimate view or
      // refresh will simply try again. Existing meaningful changes (if any)
      // are left as-is -- never cleared, never fabricated.
    } finally {
      seenInFlightRef.current = false;
    }
  }, []);

  const load = useCallback(async () => {
    if (!watchlistId) return;
    setNotFound(false);
    setLoadError(false);
    setDetail(null);
    setChanges([]);
    try {
      const data = await getWatchlist(watchlistId);
      setDetail(data);
      const symbols = data.stocks.map((s) => s.symbol);
      if (symbols.length > 0) {
        // Never block the watchlist render on this -- quotes are fetched
        // and displayed immediately; only once that fetch settles (with at
        // least one real, successfully-displayed quote) do we record the
        // state as seen, and only once per watchlist per visit.
        fetchQuotesFor(symbols).then((successCount) => {
          if (successCount > 0 && seenRecordedForRef.current !== watchlistId) {
            seenRecordedForRef.current = watchlistId;
            triggerRecordSeen(watchlistId);
          }
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    }
  }, [watchlistId, triggerRecordSeen]);

  useEffect(() => {
    load();
  }, [load]);

  /** Fetches quotes for the given symbols concurrently. Each symbol's
   * success/failure is applied independently, so one provider error (e.g.
   * a 503) never blocks the others from displaying. Returns how many of
   * them actually resolved to a real, displayed quote. */
  async function fetchQuotesFor(symbols: string[]): Promise<number> {
    if (symbols.length === 0) return 0;
    setQuotes((current) => {
      const next = { ...current };
      for (const symbol of symbols) next[symbol] = { status: 'loading' };
      return next;
    });

    const outcomes = await Promise.allSettled(
      symbols.map(async (symbol) => {
        try {
          const data = await getQuote(symbol);
          setQuotes((current) => ({ ...current, [symbol]: { status: 'success', data } }));
          return true;
        } catch (err) {
          setQuotes((current) => ({
            ...current,
            [symbol]: { status: 'error', message: quoteErrorMessage(err) },
          }));
          return false;
        }
      }),
    );

    return outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value).length;
  }

  async function handleRefresh() {
    if (!detail || refreshing) return;
    setRefreshing(true);
    const successCount = await fetchQuotesFor(detail.stocks.map((s) => s.symbol));
    setRefreshing(false);
    // A manual refresh is its own explicit "the user is now seeing this
    // (possibly new) market state" moment -- record it again regardless of
    // the initial-load guard above (Step 9).
    if (successCount > 0) {
      triggerRecordSeen(detail.id);
    }
  }

  function handleAdded(stock: WatchlistStock) {
    setDetail((current) => (current ? { ...current, stocks: [...current.stocks, stock] } : current));
    setNewlyAddedId(stock.id);
    setTimeout(() => setNewlyAddedId(null), 400);
    fetchQuotesFor([stock.symbol]);
  }

  async function handleRemove(symbol: string) {
    if (!watchlistId) return;
    setRemovingSymbol(symbol);
    try {
      await removeStock(watchlistId, symbol);
      setTimeout(() => {
        setDetail((current) =>
          current ? { ...current, stocks: current.stocks.filter((s) => s.symbol !== symbol) } : current,
        );
        setQuotes((current) => {
          if (!(symbol in current)) return current;
          const rest = { ...current };
          delete rest[symbol];
          return rest;
        });
        setRemovingSymbol(null);
        showToast(`${symbol} removed`);
      }, REMOVE_ANIMATION_MS);
    } catch (err) {
      setRemovingSymbol(null);
      showToast(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        'error',
      );
    }
  }

  async function handleReorder(newOrder: WatchlistStock[]) {
    if (!detail) return;
    const previousStocks = detail.stocks;
    setDetail({ ...detail, stocks: newOrder });
    setReordering(true);
    try {
      const updated = await reorderStocks(detail.id, newOrder.map((s) => s.id));
      setDetail(updated);
    } catch (err) {
      setDetail((current) => (current ? { ...current, stocks: previousStocks } : current));
      showToast(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        'error',
      );
    } finally {
      setReordering(false);
    }
  }

  async function handleConfirmDelete() {
    if (!detail) return;
    setDeleting(true);
    try {
      await deleteWatchlist(detail.id);
      showToast('Watchlist deleted');
      navigate('/watchlists', { replace: true });
    } catch (err) {
      setDeleting(false);
      showToast(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        'error',
      );
    }
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <AppHeader />
        <PageContainer maxWidth={720}>
          <ErrorState
            heading="Watchlist not found"
            subtitle="This watchlist may have been deleted, or you may not have access to it."
            onRetry={() => navigate('/watchlists')}
            retryLabel="My Watchlists"
          />
        </PageContainer>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.page}>
        <AppHeader />
        <PageContainer maxWidth={720}>
          <ErrorState
            heading="Something went wrong"
            subtitle="We couldn't load this watchlist. Check your connection and try again."
            onRetry={load}
          />
        </PageContainer>
      </div>
    );
  }

  return (
    <div className={`${styles.page} anim-fade-in-up`}>
      <AppHeader />
      <PageContainer maxWidth={760}>
        <Link to="/watchlists" className={styles.backLink}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          My Watchlists
        </Link>

        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>{detail ? detail.name : 'Loading…'}</h1>
            <p className={`${styles.subtitle} text-body-small`}>
              {detail
                ? `${detail.stocks.length} ${detail.stocks.length === 1 ? 'stock' : 'stocks'}`
                : ' '}
            </p>
          </div>
          {detail && (
            <div className={styles.actions}>
              {detail.stocks.length > 0 && (
                <>
                  <IconButton
                    aria-label="Refresh quotes"
                    onClick={handleRefresh}
                    disabled={refreshing}
                    aria-busy={refreshing}
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                      className={refreshing ? styles.spinningIcon : undefined}
                    >
                      <path
                        d="M20 11A8 8 0 1 0 18.6 15.5M20 11V5M20 11h-6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </IconButton>
                  <Button className={styles.addButton} onClick={() => setAddStockOpen(true)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path
                        d="M12 5v14M5 12h14"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                      />
                    </svg>
                    Add Stock
                  </Button>
                </>
              )}
              <DropdownMenu
                items={[
                  { label: 'Rename', onSelect: () => setRenameOpen(true) },
                  { label: 'Delete', onSelect: () => setDeleteOpen(true), danger: true },
                ]}
                renderTrigger={(triggerProps) => (
                  <IconButton {...triggerProps} aria-label={`Open ${detail.name} watchlist menu`}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
                      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
                    </svg>
                  </IconButton>
                )}
              />
            </div>
          )}
        </div>

        <MeaningfulChanges changes={changes} watchlistId={detail?.id} />

        {detail === null ? (
          <div>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ marginTop: i === 0 ? 0 : 10 }}>
                <StockRowSkeleton />
              </div>
            ))}
          </div>
        ) : detail.stocks.length === 0 ? (
          <EmptyState
            float={false}
            illustration={<WatchlistDetailEmptyIllustration />}
            heading="No stocks yet"
            subtitle={`Add the stocks you want to track in ${detail.name}.`}
            action={
              <Button style={{ width: 'auto' }} onClick={() => setAddStockOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                  />
                </svg>
                Add Stock
              </Button>
            }
          />
        ) : (
          <StockList
            stocks={detail.stocks}
            quotes={quotes}
            onReorder={handleReorder}
            onRemove={handleRemove}
            removingSymbol={removingSymbol}
            reordering={reordering}
            newlyAddedId={newlyAddedId}
            watchlistId={detail.id}
            changes={changes}
          />
        )}
      </PageContainer>

      {detail && addStockOpen && (
        <AddStockDialog
          onClose={() => setAddStockOpen(false)}
          watchlistId={detail.id}
          watchlistName={detail.name}
          onAdded={handleAdded}
        />
      )}
      {detail && renameOpen && (
        <RenameWatchlistDialog
          onClose={() => setRenameOpen(false)}
          watchlistId={detail.id}
          currentName={detail.name}
          onRenamed={(updated) => {
            setDetail((current) =>
              current ? { ...current, name: updated.name, updated_at: updated.updated_at } : current,
            );
            setRenameOpen(false);
          }}
        />
      )}
      {detail && deleteOpen && (
        <ConfirmDialog
          onClose={() => setDeleteOpen(false)}
          title={`Delete ${detail.name}?`}
          description="This watchlist and its stock relationships will be removed. The stocks themselves will not be deleted."
          confirmLabel="Delete watchlist"
          onConfirm={handleConfirmDelete}
          submitting={deleting}
        />
      )}
    </div>
  );
}
