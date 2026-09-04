import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError } from '../../api/client';
import { renameWatchlist } from '../../api/watchlists';
import { useToast } from '../../context/toast-context';
import type { WatchlistSummary } from '../../types/watchlist';
import { Button } from '../Button';
import { Dialog } from '../Dialog';
import { TextField } from '../TextField';

interface RenameWatchlistDialogProps {
  onClose: () => void;
  watchlistId: string;
  currentName: string;
  onRenamed: (watchlist: WatchlistSummary) => void;
}

/** Mount only while it should be visible, e.g. `{open && <RenameWatchlistDialog .../>}`. */
export function RenameWatchlistDialog({
  onClose,
  watchlistId,
  currentName,
  onRenamed,
}: RenameWatchlistDialogProps) {
  const [name, setName] = useState(currentName);
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
      const watchlist = await renameWatchlist(watchlistId, trimmed);
      onRenamed(watchlist);
      showToast('Watchlist renamed');
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
    <Dialog onClose={onClose} title="Rename watchlist">
      <p className="text-body" style={{ margin: '0 0 22px' }}>
        Update the name of this watchlist.
      </p>
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Watchlist name"
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
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
