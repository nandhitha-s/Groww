import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../BrandMark';
import { DropdownMenu } from '../DropdownMenu';
import { IconButton } from '../IconButton';
import { useAuth } from '../../context/auth-context';
import styles from './AppHeader.module.css';

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Watchlists', path: '/watchlists' },
];

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 4);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  function isActive(path: string) {
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const initial = user?.name?.trim().charAt(0).toUpperCase() || '?';

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ''}`}>
      <Link to="/dashboard" aria-label="Smart Market Watchlist home">
        <BrandMark size={32} />
      </Link>

      <nav className={styles.nav} aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`${styles.navLink} ${isActive(item.path) ? styles.active : ''}`}
            aria-current={isActive(item.path) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className={styles.actions}>
        <IconButton aria-label="Search (coming soon)" className={styles.desktopOnly} disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </IconButton>
        <IconButton aria-label="Notifications (coming soon)" className={styles.desktopOnly} disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 10a6 6 0 1112 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <path d="M10 19a2 2 0 004 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </IconButton>

        <span className={styles.desktopOnly}>
          <DropdownMenu
            items={[{ label: 'Log out', onSelect: handleLogout }]}
            renderTrigger={(triggerProps) => (
              <button
                {...triggerProps}
                className={styles.avatar}
                aria-label={`Account menu for ${user?.name ?? 'your account'}`}
              >
                {initial}
              </button>
            )}
          />
        </span>

        <span className={styles.mobileOnly}>
          <DropdownMenu
            items={[
              ...NAV_ITEMS.map((item) => ({ label: item.label, onSelect: () => navigate(item.path) })),
              { label: 'Log out', onSelect: handleLogout },
            ]}
            renderTrigger={(triggerProps) => (
              <IconButton {...triggerProps} aria-label="Open menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 7h16M4 12h16M4 17h16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </IconButton>
            )}
          />
        </span>
      </div>
    </header>
  );
}
