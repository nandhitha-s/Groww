import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import styles from './DropdownMenu.module.css';

export interface DropdownMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  icon?: ReactNode;
}

interface DropdownMenuTriggerProps {
  onClick: (event: React.MouseEvent) => void;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
}

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  renderTrigger: (props: DropdownMenuTriggerProps) => ReactNode;
}

export function DropdownMenu({ items, renderTrigger }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      {renderTrigger({
        onClick: (event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        },
        'aria-haspopup': 'menu',
        'aria-expanded': open,
      })}

      {open && (
        <div className={`${styles.menu} anim-menu-in`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              className={`${styles.item} ${item.danger ? styles.danger : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DotsMenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}
