import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { createWatchlist } from '../../api/watchlists';
import { useToast } from '../../context/toast-context';
import type { WatchlistSummary } from '../../types/watchlist';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextField } from '../TextField';

interface CreateWatchlistDialogProps {
  onClose: () => void;
  onCreated: (watchlist: WatchlistSummary) => void;
}

/** Mount only while it should be visible, e.g. `{open && <CreateWatchlistDialog .../>}`. */
export function CreateWatchlistDialog({ onClose, onCreated }: CreateWatchlistDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name for your watchlist.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const watchlist = await createWatchlist(trimmed);
      onCreated(watchlist);
      showToast('Watchlist created');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('A watchlist with this name already exists.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onClose={onClose} title="Create watchlist">
      <p className="text-body" style={{ margin: '0 0 22px' }}>
        Give your watchlist a name so you can easily find it later.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Watchlist name"
          placeholder="Technology"
          value={name}
          maxLength={255}
          disabled={submitting}
          error={error ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create watchlist
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
