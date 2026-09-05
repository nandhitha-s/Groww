# Smart Market Watchlist

> **Know what changed. Know what matters.**

A watchlist app that doesn't just show you prices — it tells you what's
actually worth your attention since the last time you looked, and is honest
when nothing is.

**Live demo:** https://smartmarketapplication.vercel.app

---

## The problem

Every stock-tracking app shows you a wall of numbers. None of them answer the
one question that actually matters: *"did anything I should care about
happen since I last checked?"*

**Product principle (non-negotiable throughout this build):** the app never
fabricates an answer to that question. If nothing crossed a real,
configured threshold, it says so plainly — *"You're all caught up. No
meaningful changes since your last check."* — instead of manufacturing false
urgency.

## What's built

- **Authentication** — cookie-based sessions (Argon2 password hashing,
  HttpOnly/Secure cookies, no JWTs, no third-party auth).
- **Watchlists** — create/rename/delete, add/remove/reorder real stocks
  across multiple lists.
- **Real market data** — live quotes and historical OHLCV candles from Yahoo
  Finance (NSE/BSE), with a provider abstraction so the source can be swapped
  without touching any route or UI code.
- **Meaningful Change Engine** — deterministic, rule-based detection of two
  signal types per stock, compared against *your own* last-seen baseline:
  - `PRICE_CHANGE` — price moved beyond your configured threshold since you
    last looked.
  - `VOLUME_SPIKE` — trading volume is unusually high vs. its average.

  Severity (`MEDIUM`/`HIGH`) is a simple, transparent multiple of the
  threshold — never an opaque score. Every one of these is persisted as a
  `ChangeEvent` and is the one thing shown as "meaningful."
- **Market Signals** — a second, deliberately *separate* concept: ephemeral,
  current-quote-only conditions (e.g. `NEAR_DAY_LOW` — trading within 1% of
  today's low) that are useful context but are **never** confused with a
  personalized meaningful change, and are **never** persisted as a
  `ChangeEvent`.
- **Smart Dashboard** — in priority order: a summary, "Needs your attention"
  (real meaningful changes), "Market Signals," "Market Activity" (plain
  current quotes for your tracked stocks, capped and deduplicated), and your
  watchlists.
- **Stock Detail** — real current price vs. today's market movement (from
  the live quote) shown *distinctly* from "since you last checked" (from a
  `ChangeEvent`); a real price history chart (1D/1W/1M/3M/1Y) with a labeled,
  hover-tooltip axis, built with zero charting dependencies; a watchlist
  sidebar; and an Insights tab that always has something useful — real
  meaningful changes when they exist, plus an always-on real "past week"
  summary (change %, week high/low, average volume) so it's never empty.
- **Changes / Activity** — a full, filterable, paginated history of every
  meaningful change ever detected for you, grouped by Today/Yesterday/
  Earlier, with a lightweight "mark as read" acknowledgement.


## Architecture

```
Browser (React SPA, Vercel)
    │  fetch, same-origin via Vercel rewrite (/api/* -> backend)
    ▼
FastAPI backend (Render)
    │
    ├─ SQLAlchemy ORM  ──────────►  PostgreSQL (Supabase)
    │                                 users, watchlists, stocks,
    │                                 market_snapshots, user_stock_states,
    │                                 change_events, user_sessions, ...
    │
    └─ MarketDataProvider interface ──►  yfinance  ──►  Yahoo Finance
                                          (NSE/BSE, no API key needed)
```

Two ideas the whole backend is built around, kept strictly separate:

- **`MarketSnapshot`** — an append-only log of "what did the market look
  like at this instant." Never edited, never thinned out.
- **`UserStockState`** — "what did *this user* last actually see" — exactly
  one row per (user, stock), updated only by an explicit "seen" action, never
  as a side effect of merely fetching a quote. This is what the change engine
  compares every new observation against.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router 7, CSS Modules (no UI framework) |
| Backend | FastAPI, SQLAlchemy 2, Pydantic v2, Alembic migrations |
| Database | PostgreSQL (Supabase-hosted) |
| Market data | `yfinance` (free, no API key, no broker account, real NSE/BSE data) |
| Auth | Argon2 password hashing, HttpOnly/Secure session cookies |
| Testing | pytest (backend), Vitest + Testing Library (frontend) |
| Hosting | Vercel (frontend, static + edge rewrite), Render (backend) |

No charting library, no CSS framework, no state-management library, no ORM
beyond SQLAlchemy itself — kept intentionally small.

## Project structure

```
Groww/
├── Backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, routers, CORS
│   │   ├── config.py          Settings (DB, session, cookie) via env vars
│   │   ├── database.py        engine, session factory, get_db
│   │   ├── enums.py           ChangeEventType/Severity, MarketSignalType, ...
│   │   ├── models/            one SQLAlchemy model per file
│   │   ├── api/                auth / watchlists / market_data / changes routes
│   │   ├── providers/          MarketDataProvider interface + yfinance/FYERS impls
│   │   ├── schemas/            Pydantic request/response models
│   │   └── services/           business logic (change_engine, market_signals, ...)
│   ├── alembic/                 migrations
│   ├── tests/                    174+ pytest test functions
│   ├── Procfile, render.yaml     deployment config
│   └── requirements.txt
└── Frontend/
    ├── src/
    │   ├── pages/               DashboardPage, WatchlistsPage, WatchlistDetailPage,
    │   │                        StockDetailPage, ChangesPage, Login/Register
    │   ├── components/           ChangeCard, MarketSignalCard, PriceChart,
    │   │                        WatchlistSidebar, dashboard/, dialogs/, layout/
    │   ├── api/                  thin fetch wrappers per backend resource
    │   ├── types/                TypeScript mirrors of every backend schema
    │   ├── context/               AuthContext, ToastContext
    │   └── styles/                design tokens, typography, animations
    ├── vercel.json                SPA rewrite + API proxy to the backend
    └── package.json
```

## Instructions to Run

### Option A — just use the live demo (fastest)

No setup needed: open **https://smartmarketapplication.vercel.app**, click
**Register**, create any account (name/email/password — nothing is
pre-seeded, so a fresh account starts with no watchlists), then add a few
real NSE/BSE stocks (e.g. `RELIANCE`, `TATATECH`, `WIPRO`, `TCS`) to a
watchlist from the Watchlists page. Everything after that — quotes, changes,
signals — is real, live data.

> Render's free tier cold-starts after inactivity, so the very first
> request after a period of no traffic can take ~30-50s to respond — this is
> a hosting-tier characteristic, not an app bug. A page refresh a moment
> later will be fast.

### Option B — run it locally

**Prerequisites:** Python 3.12, Node.js 18+, and a PostgreSQL database (the
project was built against a free [Supabase](https://supabase.com) Postgres
instance — create one and grab its connection string, or point
`DATABASE_URL` at any Postgres 14+ instance you already have).

#### 1. Backend

```bash
cd Backend
py -3.12 -m venv .venv && .venv\Scripts\activate      # Windows
# python3.12 -m venv .venv && source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
cp .env.example .env   # then fill in DATABASE_URL (a Supabase Postgres connection string)
alembic upgrade head
uvicorn app.main:app --reload
```

Runs at `http://127.0.0.1:8000`. Verify it came up: `GET /health` and
`GET /health/db` should both return `200`.

#### 2. Frontend

```bash
cd Frontend
npm install
npm run dev
```

Runs at `http://localhost:5173`. `vite.config.ts` proxies `/api/*` to the
backend so the browser sees everything as same-origin — no CORS
configuration needed for local dev, and the session cookie works exactly as
in production.

#### 3. Try it

1. Open `http://localhost:5173`, click **Register**, create any account.
2. Go to **Watchlists** → create one → add a few real symbols (e.g.
   `RELIANCE`, `TATATECH`, `WIPRO`).
3. Open **Dashboard** — this triggers a real quote fetch per stock and
   records your first baseline (nothing to compare against yet, so
   "Needs your attention" correctly shows "You're all caught up" on this
   very first load).
4. Reload the Dashboard later (after the market has moved, or after
   adjusting a stock's stored baseline — see `Backend/tests/` for how the
   change engine's thresholds work) to see real `PRICE_CHANGE`/
   `VOLUME_SPIKE` entries appear under **Needs your attention**, and check
   **Changes** to see the full persisted history.
5. Try the **profile menu → Switch to dark mode** toggle in the header, and
   the **Insights** tab on any stock's detail page (`/stocks/{SYMBOL}`).

## Environment variables (backend)

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (psycopg3 driver) | *required* |
| `SESSION_EXPIRE_MINUTES` | Session/cookie lifetime | `10080` (7 days) |
| `COOKIE_NAME` | Auth cookie name | `session_token` |
| `COOKIE_SECURE` | HTTPS-only cookie | `true` |
| `COOKIE_SAMESITE` | Cookie `SameSite` policy | `lax` |

`yfinance` needs no key/account. `FYERS_APP_ID`/`FYERS_ACCESS_TOKEN` are
optional and unused by default (see "Market data provider" below).

## API overview

All routes below require the session cookie except `/api/auth/register`,
`/api/auth/login`, and `/health*`.

| Resource | Routes |
|---|---|
| Auth | `POST /api/auth/{register,login,logout}`, `GET /api/auth/me` |
| Watchlists | `GET/POST /api/watchlists`, `GET/PATCH/DELETE /api/watchlists/{id}`, `POST/DELETE .../stocks[/{symbol}]`, `PATCH .../stocks/reorder` |
| Market state | `POST /api/watchlists/{id}/market-state/seen` — records the real current quote for every stock in the watchlist, runs the Meaningful Change Engine and Market Signals against it, and returns both `changes` (persisted) and `market_signals` (ephemeral) in one response |
| Market data | `GET /api/market-data/search`, `GET /api/market-data/quote/{symbol}`, `GET /api/market-data/history/{symbol}?period=` |
| Changes | `GET /api/changes` (filter by `severity`/`type`/`stock_id`, `limit`), `POST /api/changes/{id}/acknowledge` |

Full request/response shapes, status codes, and security notes are
documented inline in each router and service module.

## Market data provider

Route handlers never call a provider library directly:

```
Routes -> MarketDataService -> MarketDataProvider (interface) -> YFinanceProvider -> Yahoo Finance
```

`yfinance` was chosen over several alternatives (Alpha Vantage, Twelve Data,
Marketstack, Finnhub, FYERS, ...) because it's the only option that is
simultaneously free, needs no API key/broker account/OAuth/daily token
refresh, and has verified real NSE + BSE coverage for both current quotes
and historical candles. The trade-off: it wraps Yahoo's unofficial
endpoints (no formal SLA), and quotes are typically ~15 minutes delayed
(marked `is_delayed: true` — never claimed as real-time). A second,
FYERS-based provider exists in the codebase implementing the same interface,
kept dormant since it requires a live broker account and daily interactive
login.

## Testing

```bash
# Backend
cd Backend && pytest

# Frontend
cd Frontend && npm test        # Vitest
npx tsc -b                     # type-check
npm run lint                   # oxlint
```

- Backend: 174+ test functions across auth, watchlists, market data, the
  change engine, market signals, snapshots, and the changes API — run
  against the real Supabase database inside a rollback-only transaction
  (`SAVEPOINT`) per test, so nothing is ever left behind.
- Frontend: 128 tests (Vitest + Testing Library) covering every page's
  loading/error/empty states, filtering, navigation, and the meaningful-
  change vs. market-signal vs. market-activity distinction.
- Every meaningful change and market signal shown in tests/manual
  verification is produced by the *real* detection pipeline against a real
  (or realistically faked-at-the-provider-boundary, in automated tests)
  quote — never a hardcoded "demo" event baked into the app itself.

## Deployment

- **Frontend** → Vercel. `Frontend/vercel.json` provides the SPA fallback
  (so refreshing any client-side route works) and rewrites `/api/*` to the
  backend, so the browser only ever talks to one origin — the session
  cookie needs no `SameSite=None`/cross-site changes.
- **Backend** → Render (`Backend/render.yaml` + `Procfile` — deploy via
  Render's "Blueprint" option pointed at this repo, then set `DATABASE_URL`
  as a secret in the dashboard).
- **Database** → Supabase (PostgreSQL), reachable from anywhere via its
  session pooler connection string.

## Known limitations

- Yahoo Finance quotes are delayed (not real-time) and depend on an
  unofficial, unversioned endpoint.
- Market Activity's "most relevant" stock selection is simple list order,
  not usage-weighted.
- No mobile app — responsive web only.
- Render's free tier cold-starts after inactivity (a demo consideration,
  not a design flaw).
