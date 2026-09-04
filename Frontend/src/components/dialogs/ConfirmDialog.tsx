import { Button } from '../Button';
import { Dialog } from '../Dialog';

interface ConfirmDialogProps {
  onClose: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  submitting?: boolean;
}

/** Mount only while it should be visible, e.g. `{open && <ConfirmDialog .../>}`. */
export function ConfirmDialog({
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
  submitting = false,
}: ConfirmDialogProps) {
  return (
    <Dialog onClose={onClose} title={title}>
      <p className="text-body" style={{ margin: '0 0 24px' }}>
        {description}
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={submitting}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
