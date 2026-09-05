import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../BrandMark';
import { DropdownMenu } from '../DropdownMenu';
import { IconButton } from '../IconButton';
import { useAuth } from '../../context/auth-context';
import { useTheme } from '../../context/theme-context';
import styles from './AppHeader.module.css';

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2.5M12 19.5V22M4.22 4.22l1.77 1.77M18 18l1.78 1.78M2 12h2.5M19.5 12H22M4.22 19.78L6 18M18 6l1.78-1.78"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 14.5A8.5 8.5 0 119.5 4a6.5 6.5 0 0010.5 10.5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_ITEMS = [
  { label: 'Dashboard', path: '/dashboard' },
  { label: 'Watchlists', path: '/watchlists' },
  { label: 'Changes', path: '/changes' },
];

export function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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

  const themeMenuItem = {
    label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
    onSelect: toggleTheme,
    icon: theme === 'dark' ? <SunIcon /> : <MoonIcon />,
  };

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
            items={[themeMenuItem, { label: 'Log out', onSelect: handleLogout }]}
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
              themeMenuItem,
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
