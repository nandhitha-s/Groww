import { Link } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { BrandMark } from '../components/BrandMark';
import { useAuth } from '../context/auth-context';
import styles from './HomePage.module.css';

export function HomePage() {
  const { user } = useAuth();

  return (
    <div className={styles.wrapper}>
      <AppHeader />

      <main className={styles.main}>
        <div className={`${styles.card} anim-fade-in-up`}>
          <div className={styles.badgeRow}>
            <BrandMark size={44} wordmark={false} />
          </div>
          <p className="text-caption">Signed in as</p>
          <h1 className={`${styles.name} text-h2`}>{user?.name}</h1>
          <p className="text-body">{user?.email}</p>

          <div className={styles.note}>
            <p className="text-body">
              Your change alerts are coming soon -- this screen just confirms your account and
              session are working.
            </p>
          </div>

          <Link to="/watchlists" className={styles.watchlistsLink}>
            <span className="text-body-strong">My Watchlists</span>
            <span className={styles.watchlistsLinkArrow}>
              View watchlists
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        </div>
      </main>
    </div>
  );
}
