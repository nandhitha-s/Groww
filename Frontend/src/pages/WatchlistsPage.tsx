import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { deleteWatchlist, getWatchlists } from '../api/watchlists';
import { AppHeader } from '../components/layout/AppHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/Button';
import { EmptyState, WatchlistsEmptyIllustration } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { WatchlistCard } from '../components/watchlists/WatchlistCard';
import { WatchlistCardSkeleton } from '../components/watchlists/WatchlistCardSkeleton';
import { WatchlistGrid } from '../components/watchlists/WatchlistGrid';
import { CreateWatchlistDialog } from '../components/dialogs/CreateWatchlistDialog';
import { RenameWatchlistDialog } from '../components/dialogs/RenameWatchlistDialog';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { useToast } from '../context/toast-context';
import type { WatchlistSummary } from '../types/watchlist';
import styles from './WatchlistsPage.module.css';

export function WatchlistsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [watchlists, setWatchlists] = useState<WatchlistSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<WatchlistSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WatchlistSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setWatchlists(null);
    try {
      const data = await getWatchlists();
      setWatchlists(data);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleCreated(watchlist: WatchlistSummary) {
    setWatchlists((current) => [watchlist, ...(current ?? [])]);
  }

  function handleRenamed(updated: WatchlistSummary) {
    setWatchlists((current) =>
      (current ?? [])
        .map((w) => (w.id === updated.id ? updated : w))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    );
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWatchlist(deleteTarget.id);
      setWatchlists((current) => (current ?? []).filter((w) => w.id !== deleteTarget.id));
      showToast('Watchlist deleted');
      setDeleteTarget(null);
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : 'Something went wrong. Please try again.',
        'error',
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`${styles.page} anim-fade-in-up`}>
      <AppHeader />

      {loadError ? (
        <PageContainer>
          <ErrorState
            heading="Something went wrong"
            subtitle="We couldn't load your watchlists. Check your connection and try again."
            onRetry={load}
          />
        </PageContainer>
      ) : watchlists !== null && watchlists.length === 0 ? (
        <PageContainer maxWidth={720}>
          <EmptyState
            illustration={<WatchlistsEmptyIllustration />}
            heading="Build your first watchlist"
            subtitle="Organize the stocks you care about. We'll help you understand what changes when market data is connected."
            action={
              <Button style={{ width: 'auto' }} onClick={() => setCreateOpen(true)}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                  />
                </svg>
                Create Watchlist
              </Button>
            }
          />
        </PageContainer>
      ) : (
        <PageContainer>
          <div className={styles.headerRow}>
            <div className={styles.glow} aria-hidden="true" />
            <div>
              <h1 className={`${styles.heading} text-h1`}>My Watchlists</h1>
              <p className={`${styles.subtitle} text-body-large`}>
                Organize the stocks you want to keep an eye on.
              </p>
            </div>
            <Button className={styles.newButton} onClick={() => setCreateOpen(true)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                />
              </svg>
              New Watchlist
            </Button>
          </div>

          <WatchlistGrid>
            {watchlists === null
              ? Array.from({ length: 6 }, (_, i) => <WatchlistCardSkeleton key={i} />)
              : watchlists.map((watchlist, index) => (
                  <WatchlistCard
                    key={watchlist.id}
                    watchlist={watchlist}
                    staggerIndex={index}
                    onOpen={() => navigate(`/watchlists/${watchlist.id}`)}
                    onRename={() => setRenameTarget(watchlist)}
                    onDelete={() => setDeleteTarget(watchlist)}
                  />
                ))}
          </WatchlistGrid>
        </PageContainer>
      )}

      {createOpen && (
        <CreateWatchlistDialog onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
      )}

      {renameTarget && (
        <RenameWatchlistDialog
          onClose={() => setRenameTarget(null)}
          watchlistId={renameTarget.id}
          currentName={renameTarget.name}
          onRenamed={(updated) => {
            handleRenamed(updated);
            setRenameTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          onClose={() => setDeleteTarget(null)}
          title={`Delete ${deleteTarget.name}?`}
          description="This watchlist and its stock relationships will be removed. The stocks themselves will not be deleted."
          confirmLabel="Delete watchlist"
          onConfirm={handleConfirmDelete}
          submitting={deleting}
        />
      )}
    </div>
  );
}
