import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deleteWatchlist, getWatchlist, removeStock, reorderStocks } from '../api/watchlists';
import { AppHeader } from '../components/layout/AppHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { DropdownMenu } from '../components/DropdownMenu';
import { EmptyState, WatchlistDetailEmptyIllustration } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { StockList } from '../components/watchlists/StockList';
import { StockRowSkeleton } from '../components/watchlists/StockRowSkeleton';
import { AddStockDialog } from '../components/dialogs/AddStockDialog';
import { RenameWatchlistDialog } from '../components/dialogs/RenameWatchlistDialog';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { useToast } from '../context/toast-context';
import type { WatchlistDetail, WatchlistStock } from '../types/watchlist';
import styles from './WatchlistDetailPage.module.css';

const REMOVE_ANIMATION_MS = 260;

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

  const load = useCallback(async () => {
    if (!watchlistId) return;
    setNotFound(false);
    setLoadError(false);
    setDetail(null);
    try {
      const data = await getWatchlist(watchlistId);
      setDetail(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(true);
      }
    }
  }, [watchlistId]);

  useEffect(() => {
    load();
  }, [load]);

  function handleAdded(stock: WatchlistStock) {
    setDetail((current) => (current ? { ...current, stocks: [...current.stocks, stock] } : current));
    setNewlyAddedId(stock.id);
    setTimeout(() => setNewlyAddedId(null), 400);
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
            onReorder={handleReorder}
            onRemove={handleRemove}
            removingSymbol={removingSymbol}
            reordering={reordering}
            newlyAddedId={newlyAddedId}
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
