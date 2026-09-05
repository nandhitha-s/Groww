import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/Button';
import { EmptyState, WatchlistsEmptyIllustration } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { ChangeCard } from '../components/changes/ChangeCard';
import { acknowledgeChange, getChanges } from '../api/changes';
import type { ChangeEventListItem } from '../types/changes';
import styles from './ChangesPage.module.css';

type Filter = 'ALL' | 'HIGH' | 'PRICE' | 'VOLUME';
type GroupKey = 'Today' | 'Yesterday' | 'Earlier';

const INITIAL_LIMIT = 50;
const LOAD_MORE_STEP = 50;
const GROUP_ORDER: GroupKey[] = ['Today', 'Yesterday', 'Earlier'];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'HIGH', label: 'High Impact' },
  { value: 'PRICE', label: 'Price' },
  { value: 'VOLUME', label: 'Volume' },
];

function matchesFilter(item: ChangeEventListItem, filter: Filter): boolean {
  if (filter === 'HIGH') return item.severity === 'HIGH';
  if (filter === 'PRICE') return item.type === 'PRICE_CHANGE';
  if (filter === 'VOLUME') return item.type === 'VOLUME_SPIKE';
  return true;
}

/** Simple TODAY / YESTERDAY / EARLIER grouping using the browser's local
 * time (Step 8) -- detected_at itself stays the timezone-aware backend
 * value, this only affects which bucket a card is displayed under. */
function groupLabel(iso: string): GroupKey {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return 'Earlier';
}

export function ChangesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ChangeEventListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (targetLimit: number, isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoadError(false);
      setItems(null);
    }
    try {
      const result = await getChanges({ limit: targetLimit });
      setItems(result.items);
    } catch {
      if (!isLoadMore) setLoadError(true);
      // A failed "load more" leaves the already-visible list exactly as-is
      // -- never wipes real, already-loaded changes over a transient error.
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    load(INITIAL_LIMIT);
  }, [load]);

  function handleLoadMore() {
    const next = limit + LOAD_MORE_STEP;
    setLimit(next);
    load(next, true);
  }

  async function handleAcknowledge(id: string) {
    try {
      const updated = await acknowledgeChange(id);
      setItems((current) => current?.map((item) => (item.id === id ? updated : item)) ?? current);
    } catch {
      // Silent, matching the rest of the app's convention: this is internal
      // bookkeeping, never worth breaking the page over.
    }
  }

  const filtered = items === null ? null : items.filter((item) => matchesFilter(item, filter));

  const groups = useMemo(() => {
    if (!filtered) return null;
    const buckets = new Map<GroupKey, ChangeEventListItem[]>();
    for (const item of filtered) {
      const key = groupLabel(item.detected_at);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    return GROUP_ORDER.map((key) => ({ key, items: buckets.get(key) ?? [] })).filter(
      (group) => group.items.length > 0,
    );
  }, [filtered]);

  return (
    <div className={`${styles.page} anim-fade-in-up`}>
      <AppHeader />
      <PageContainer maxWidth={880}>
        <div className={styles.headerBlock}>
          <h1 className="text-h1">Changes</h1>
          <p className="text-body-large">Meaningful changes across your watchlists</p>
        </div>

        <div className={styles.filterRow}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              className={`${styles.filterPill} ${filter === f.value ? styles.filterPillActive : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loadError ? (
          <ErrorState
            heading="Couldn't load changes"
            subtitle="Check your connection and try again."
            onRetry={() => load(limit)}
          />
        ) : items === null ? (
          <ChangesSkeleton />
        ) : items.length === 0 ? (
          <EmptyState
            illustration={<WatchlistsEmptyIllustration />}
            heading="You're all caught up"
            subtitle="No meaningful changes have been detected yet."
            action={
              <Button style={{ width: 'auto' }} onClick={() => navigate('/watchlists')}>
                Go to Watchlists
              </Button>
            }
          />
        ) : groups && groups.length === 0 ? (
          <div className={styles.noMatch}>
            <p className="text-body">No changes match this filter.</p>
            <button type="button" className={styles.clearFilterButton} onClick={() => setFilter('ALL')}>
              Clear filter
            </button>
          </div>
        ) : (
          <>
            {groups!.map((group) => (
              <section key={group.key} className={styles.section}>
                <h2 className={`${styles.groupHeading} text-label`}>{group.key.toUpperCase()}</h2>
                <ul className={styles.list}>
                  {group.items.map((item) => (
                    <ChangeCard
                      key={item.id}
                      change={item}
                      linkTo={`/stocks/${item.symbol}`}
                      linkState={item.watchlist_id ? { watchlistId: item.watchlist_id } : undefined}
                      acknowledged={item.acknowledged_at !== null}
                      onAcknowledge={() => handleAcknowledge(item.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {items.length === limit && (
              <div className={styles.loadMoreRow}>
                <Button variant="secondary" style={{ width: 'auto' }} loading={loadingMore} onClick={handleLoadMore}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </PageContainer>
    </div>
  );
}

function ChangesSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton width={90} height={16} style={{ marginBottom: 14 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Skeleton width="100%" height={92} radius={14} />
        <Skeleton width="100%" height={92} radius={14} />
        <Skeleton width="100%" height={92} radius={14} />
      </div>
    </div>
  );
}
