import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { addStock } from '../../api/watchlists';
import { useToast } from '../../context/toast-context';
import type { WatchlistStock } from '../../types/watchlist';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextField } from '../TextField';

const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,20}$/;

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
  const [symbol, setSymbol] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      setError('Enter a stock symbol.');
      return;
    }
    if (!SYMBOL_PATTERN.test(normalized)) {
      setError('Use 1-20 characters: letters, numbers, "." or "-".');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const stock = await addStock(watchlistId, normalized);
      onAdded(stock);
      showToast(`${stock.symbol} added to ${watchlistName}`);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('This stock is already in the watchlist.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onClose={onClose} title="Add stock">
      <p className="text-body" style={{ margin: '0 0 22px' }}>
        Enter the stock symbol you want to add.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Stock symbol"
          placeholder="NVDA"
          value={symbol}
          maxLength={20}
          disabled={submitting}
          error={error ?? undefined}
          autoComplete="off"
          autoCapitalize="characters"
          onChange={(event) => {
            setSymbol(event.target.value);
            setError(null);
          }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Add stock
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
