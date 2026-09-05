import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ApiError } from '../../api/client';
import { searchStocks } from '../../api/marketData';
import { addStock } from '../../api/watchlists';
import { useDebounce } from '../../hooks/useDebounce';
import { useToast } from '../../context/toast-context';
import type { StockSearchResult } from '../../types/marketData';
import type { WatchlistStock } from '../../types/watchlist';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { Skeleton } from '../Skeleton';
import { Spinner } from '../Spinner';
import styles from './AddStockDialog.module.css';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 350;

type SearchStatus = 'idle' | 'loading' | 'success' | 'error';

interface AddStockDialogProps {
  onClose: () => void;
  watchlistId: string;
  watchlistName: string;
  onAdded: (stock: WatchlistStock) => void;
}

/** Mount only while it should be visible, e.g. `{open && <AddStockDialog .../>}`. */
export function AddStockDialog({
  onClose,
  watchlistId,
  watchlistName,
  onAdded,
}: AddStockDialogProps) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [adding, setAdding] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const { showToast } = useToast();
  const listboxId = useId();

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      requestIdRef.current += 1;
      setStatus('idle');
      setResults([]);
      setSearchError(null);
      setActiveIndex(-1);
      return;
    }

    const requestId = ++requestIdRef.current;
    setStatus('loading');
    setSearchError(null);

    searchStocks(trimmed)
      .then((data) => {
        if (requestIdRef.current !== requestId) return;
        setResults(data);
        setStatus('success');
        setActiveIndex(data.length > 0 ? 0 : -1);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setResults([]);
        setStatus('error');
        setSearchError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      });
  }, [debouncedQuery]);

  async function handleSelect(result: StockSearchResult) {
    if (adding) return;
    // Keyed by instrument_key, not symbol: two results can share the same
    // normalized symbol (e.g. TCS listed on both NSE and BSE), and only the
    // row actually clicked should show as adding.
    setAdding(result.instrument_key);
    setAddError(null);
    try {
      const stock = await addStock(watchlistId, result.symbol);
      onAdded(stock);
      showToast(`${stock.symbol} added to ${watchlistName}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setAddError('This stock is already in the watchlist.');
      } else {
        setAddError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
      setAdding(null);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (status !== 'success' || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = results[activeIndex];
      if (active) handleSelect(active);
    }
  }

  const trimmedQuery = query.trim();
  const showHint = trimmedQuery.length > 0 && trimmedQuery.length < MIN_QUERY_LENGTH;

  return (
    <Dialog onClose={onClose} title="Add stock">
      <p className="text-body" style={{ margin: '0 0 18px' }}>
        Search for a stock by symbol or company name.
      </p>

      <div className={styles.field}>
        <label htmlFor="stock-search-input" className="text-label">
          Search
        </label>
        <input
          id="stock-search-input"
          className={styles.input}
          role="combobox"
          aria-expanded={status === 'success' && results.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `stock-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          placeholder="e.g. reliance"
          value={query}
          autoComplete="off"
          autoFocus
          disabled={Boolean(adding)}
          onChange={(event) => {
            setQuery(event.target.value);
            setAddError(null);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className={styles.results}>
        {showHint && <p className={`${styles.message} text-caption`}>Keep typing to search…</p>}

        {!showHint && status === 'loading' && (
          <div className={styles.resultSkeletons} aria-hidden="true">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width={64} height={13} />
                <Skeleton width={150} height={11} style={{ marginTop: 6 }} />
              </div>
            ))}
          </div>
        )}

        {!showHint && status === 'error' && (
          <p className={`${styles.message} ${styles.messageError} text-caption`} role="alert">
            {searchError}
          </p>
        )}

        {!showHint && status === 'success' && results.length === 0 && (
          <p className={`${styles.message} text-caption`}>No stocks found for &ldquo;{trimmedQuery}&rdquo;.</p>
        )}

        {!showHint && status === 'success' && results.length > 0 && (
          <ul id={listboxId} role="listbox" aria-label="Search results" className={styles.listbox}>
            {results.map((result, index) => (
              <li
                key={result.instrument_key}
                id={`stock-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`${styles.option} ${index === activeIndex ? styles.optionActive : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(result)}
              >
                <div className={styles.optionInfo}>
                  <span className={styles.optionSymbol}>{result.symbol}</span>
                  <span className={styles.optionCompany}>{result.company_name}</span>
                </div>
                <span className={styles.optionMeta}>
                  {adding === result.instrument_key ? <Spinner /> : <span className={styles.optionExchange}>{result.exchange}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {addError && (
          <p className={`${styles.message} ${styles.messageError} text-caption anim-error`} role="alert">
            {addError}
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <Button type="button" variant="secondary" onClick={onClose} disabled={Boolean(adding)}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
