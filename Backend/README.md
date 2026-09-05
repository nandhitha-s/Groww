# Smart Market Watchlist — Backend

Backend/database foundation (Phase 1), secure backend authentication
(Phase 2), watchlist management (Phase 3), and a market-data provider
layer backed by Yahoo Finance via `yfinance` (Phase 4A) for the Smart
Market Watchlist application. This covers configuration, the database
connection layer, SQLAlchemy models, Alembic migrations, a health-check
API, cookie/session-based authentication, a full watchlist CRUD API, and
read-only stock search/quote/history endpoints. It intentionally does not
include change detection, news, background jobs, or trading/order APIs —
those are later steps.

## Prerequisites

- **Python 3.12** (not newer) — the optional, non-default `fyers-apiv3`
  dependency's own dependency `aiohttp` has no prebuilt wheel yet for very
  new Python versions (e.g. 3.14), and building it from source requires a
  C++ toolchain. Use a 3.12 interpreter for the virtual environment below.
- A PostgreSQL database hosted on Supabase (or any PostgreSQL 14+ instance)
- The project's Supabase **connection pooler** string, not the direct
  connection string (see "Supabase connection notes" below)
- Nothing else for market data — the active provider (Yahoo Finance via
  `yfinance`) needs no account, API key, or credentials of any kind.

## Virtual environment setup

```bash
cd Backend
py -3.12 -m venv .venv   # use a Python 3.12 interpreter specifically
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate
```

## Installing dependencies

```bash
pip install -r requirements.txt
```

## Environment variables

Copy `.env.example` to `.env` and fill in the real value:

```bash
cp .env.example .env
```

| Variable                  | Description                                                          | Default          |
|---------------------------|-----------------------------------------------------------------------|------------------|
| `DATABASE_URL`            | PostgreSQL connection string, psycopg3 driver (see below)             | *(required)*     |
| `SESSION_EXPIRE_MINUTES`  | How long a session (and its cookie) stays valid                       | `10080` (7 days) |
| `COOKIE_NAME`              | Name of the authentication cookie                                     | `session_token`  |
| `COOKIE_SECURE`           | Send the cookie only over HTTPS (`true`/`false`)                      | `true`           |
| `COOKIE_SAMESITE`         | Cookie `SameSite` policy: `lax`, `strict`, or `none`                   | `lax`            |

Format:

```
postgresql+psycopg://<user>:<password>@<host>:5432/<database>
```

### Supabase connection notes

Supabase's **direct connection** host (`db.<project-ref>.supabase.co`) only
publishes an IPv6 (AAAA) DNS record unless the IPv4 add-on is purchased. Many
networks cannot reach it. Use the **Session pooler** connection string instead
(Supabase Dashboard → Project Settings → Database → Connection String →
"Session pooler"), which looks like:

```
postgresql+psycopg://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

If your password contains special characters (e.g. `$`, `@`, `%`), percent-encode
them in the URL (e.g. `$` → `%24`).

## Running FastAPI

```bash
uvicorn app.main:app --reload
```

- `GET /health` — confirms the API process is running.
- `GET /health/db` — runs `SELECT 1` against the database and reports connectivity.

See [Authentication](#authentication) below for the `/api/auth/*` endpoints.

## Running Alembic migrations

Apply all migrations to a fresh database:

```bash
alembic upgrade head
```

Roll back everything (drops all tables and enum types cleanly):

```bash
alembic downgrade base
```

## Verifying database connectivity

```bash
python -c "from app.database import SessionLocal; from sqlalchemy import text; \
s = SessionLocal(); print(s.execute(text('SELECT 1')).scalar())"
```

Or hit `GET /health/db` once the server is running.

## Creating a new migration

After changing a model under `app/models/`:

```bash
alembic revision --autogenerate -m "describe the change"
```

Always review the generated migration before applying it — in particular,
check that native Postgres ENUM types added/removed by a change are handled
correctly in both `upgrade()` and `downgrade()` (Alembic does not drop enum
types automatically when a column/table using them is dropped).

Then apply it:

```bash
alembic upgrade head
```

## Authentication

Cookie-based session authentication. There is no separate token endpoint —
the session token lives only in an `HttpOnly` cookie set by the server.

### Endpoints

| Method | Path                 | Description                                                        | Auth required |
|--------|----------------------|----------------------------------------------------------------------|----------------|
| POST   | `/api/auth/register` | Create a user, start a session, set the auth cookie. Returns `201` and the safe user record, or `409` if the email is already registered. | No |
| POST   | `/api/auth/login`    | Verify credentials, start a new session, set the auth cookie. Returns `200` and the safe user record, or `401` with a generic message for any wrong email/password combination. | No |
| POST   | `/api/auth/logout`   | Revoke the current session (if any) and clear the cookie. Always returns `204`, even with no/invalid session. | No |
| GET    | `/api/auth/me`       | Return the current user from the session cookie. Returns `401` if the cookie is missing, unknown, revoked, or expired. | Yes |

Request bodies:

```json
// POST /api/auth/register
{ "name": "Nandhitha", "email": "user@example.com", "password": "secure-password" }

// POST /api/auth/login
{ "email": "user@example.com", "password": "secure-password" }
```

Success responses only ever contain safe fields:

```json
{ "id": "...", "name": "...", "email": "..." }
```

`password_hash` and the raw session token are never included in any response body.

### Protecting future endpoints

```python
from fastapi import Depends
from app.api.deps import get_current_user
from app.models.user import User

@router.get("/something")
def something(current_user: User = Depends(get_current_user)):
    ...
```

All session-lookup logic (reading the cookie, hashing the token, checking
revocation/expiry) lives once in `app/api/deps.py` + `app/services/auth.py` —
route handlers never duplicate it.

### Cookie / session behavior

- The cookie is `HttpOnly` (never readable from JavaScript), `Secure` by
  default (only sent over HTTPS — controlled by `COOKIE_SECURE`), and
  `SameSite=Lax` by default (controlled by `COOKIE_SAMESITE`).
- For local HTTP development, set `COOKIE_SECURE=false` in `.env` so the
  browser will still send the cookie over plain `http://localhost`. Keep it
  `true` in any deployed environment.
- Sessions are stored in the `user_sessions` table as a SHA-256 hash of the
  token (`token_hash`) plus `expires_at` and `revoked_at`. The raw token
  itself is never persisted anywhere — only the client's cookie holds it.
  `GET /api/auth/me` and the `get_current_user` dependency treat a session as
  valid only if it exists, `revoked_at IS NULL`, and `expires_at` is in the
  future.
- A user can have multiple concurrent sessions (e.g. logged in on two
  devices/browsers) — logging in again does not invalidate previous sessions.
- Session lifetime is `SESSION_EXPIRE_MINUTES` (default 7 days), applied both
  to the cookie's `Max-Age` and the session row's `expires_at`.

### Security notes

- Passwords are hashed with **Argon2** (`argon2-cffi`), never a custom
  algorithm, and are never logged or returned in any response.
- Session tokens are generated with `secrets.token_urlsafe(32)` (a CSPRNG,
  256 bits of entropy) — never a UUID, timestamp, or `random`/`random.randint`.
- Only a SHA-256 hash of the session token is stored; a plain fast hash is
  appropriate here (unlike passwords) because the input already has full
  cryptographic entropy.
- Login and `/me` never reveal whether a given email is registered: an
  unknown email and a wrong password both return the same `401 Invalid email
  or password`.
- `/health/db` and the auth routes never leak raw database exceptions or
  credentials to the client or logs.
- Registration is transactional: the user row and its first session are
  created in the same database transaction (via `flush()` + a single
  `commit()`), so a failure partway through leaves nothing committed. A
  concurrent duplicate-registration race is also caught (unique constraint
  violation on `email`) and turned into the same `409` response.

## Watchlist API

All routes require authentication (the same session cookie as `/api/auth/*`)
and are scoped to the current user — a watchlist that exists but belongs to
someone else behaves exactly like one that doesn't exist (`404`), so
ownership is never revealed to an attacker.

| Method | Path                                              | Description |
|--------|---------------------------------------------------|--------------|
| GET    | `/api/watchlists`                                  | List the current user's watchlists (with stock counts), newest-updated first |
| POST   | `/api/watchlists`                                  | Create a watchlist (`{"name": "..."}`) |
| GET    | `/api/watchlists/{watchlist_id}`                   | Get a watchlist with its ordered stocks |
| PATCH  | `/api/watchlists/{watchlist_id}`                   | Rename a watchlist |
| DELETE | `/api/watchlists/{watchlist_id}`                   | Delete a watchlist (its items go with it; the underlying stocks never do) |
| POST   | `/api/watchlists/{watchlist_id}/stocks`             | Add a stock by symbol (`{"symbol": "NVDA"}`) |
| DELETE | `/api/watchlists/{watchlist_id}/stocks/{symbol}`    | Remove a stock from the watchlist |
| PATCH  | `/api/watchlists/{watchlist_id}/stocks/reorder`     | Reorder stocks (`{"stock_ids": [...]}`, must name exactly the watchlist's current stocks) |

A stock added here that doesn't exist yet in the `stocks` table is created as
a placeholder (`symbol` only; `company_name`/`exchange` stay `null`) — no
metadata is fabricated. A later market-data phase is expected to enrich it.

Status codes: `401` unauthenticated, `404` watchlist not found/not owned (or
stock not in the watchlist), `409` duplicate watchlist name or duplicate
stock, `400` a reorder payload that doesn't match the watchlist's current
stocks exactly, `422` request validation (empty/too-long name, malformed
symbol, duplicate IDs in a reorder payload).

## Market data API (Yahoo Finance via `yfinance`)

All routes require authentication. Route handlers never call a provider
library directly:

```
Routes  ->  MarketDataService  ->  MarketDataProvider (interface)  ->  YFinanceProvider  ->  Yahoo Finance
```

`app/providers/market_data.py` defines the provider interface and the
error vocabulary (`ProviderUnavailableError`, `InvalidSymbolError`,
`InvalidQueryError`, `ProviderAuthenticationError`,
`MalformedProviderResponseError`, `RateLimitedError`). `app/providers/yfinance_provider.py`
is the only file that imports `yfinance`; everything above it only ever
sees the provider-independent schemas in `app/schemas/market_data.py`.
Swapping providers later means writing a new class implementing
`MarketDataProvider` and changing one line in `app/services/market_data.py`.

Why `yfinance` (see the Phase 4A provider comparison below for the full
evaluation): it needs **no API key, no broker account, no OAuth login, and
no daily token refresh** — the single biggest practical blocker with the
previously-evaluated FYERS API v3 (see "FYERS (optional, dormant)" below).
It has verified, current, correctly-timezoned NSE and BSE coverage.

| Method | Path | Description |
|--------|------|--------------|
| GET | `/api/market-data/search?q=...` | Search real Yahoo Finance instruments by symbol or company name, filtered to NSE/BSE-listed results. Never creates a `Stock` row. |
| GET | `/api/market-data/quote/{symbol}` | Current quote (price, previous close, day high/low, volume, 3-month average volume, change, change %). |
| GET | `/api/market-data/history/{symbol}` | Historical candles for a fixed `period`: `1D`, `1W`, `1M` (default), `3M`, `1Y`. |

`{symbol}` is our own short symbol (e.g. `RELIANCE`, matching `Stock.symbol`),
never a Yahoo ticker — `YFinanceProvider` resolves it internally by trying
the NSE suffix (`RELIANCE.NS`) first, then the BSE suffix (`RELIANCE.BO`).
A stock found via search always resolves on the first try, since its
`instrument_key` already carries the correct real suffix. An unknown symbol
(neither suffix has data) returns `404`.

**No fabricated data**: if Yahoo Finance doesn't provide a field (e.g.
average volume), the response has `null` there rather than an invented
value; if a response can't be parsed as expected, the API returns `502`
rather than guessing.

Status codes: `401` unauthenticated, `404` unknown symbol, `422` invalid
query/period, `429` provider rate-limited us, `502` provider returned an
unexpected shape, `503` provider unreachable.

### Trade-off, stated plainly

`yfinance` wraps Yahoo Finance's **unofficial, undocumented** endpoints —
there is no formal SLA, no official support channel, and Yahoo could
change or throttle them without notice. Quotes are also flagged
`is_delayed: true` (Yahoo's free data is commonly ~15 minutes delayed for
NSE/BSE, not real-time). This was accepted deliberately: for this project's
stated priorities (free, no broker account, no interactive login, real
NSE/BSE coverage), no alternative satisfied all of them at once, and this
trade is far more practical than requiring every developer running this
backend to hold a live FYERS brokerage account and re-authenticate
interactively every trading day.

### FYERS (optional, dormant)

`app/providers/fyers.py` (a full `FYERSProvider` implementing the same
`MarketDataProvider` interface, using FYERS' public symbol-master CSV for
search and the authenticated `fyersModel` SDK for quotes/history) is kept
in the codebase as a possible future alternative, but is **not** the active
provider and is not wired into `get_market_data_service()`. It needs a
FYERS broker account, an interactive browser login, and a manually
regenerated access token roughly once a trading day — impractical as a
default for this project. `fyers-apiv3` stays in `requirements.txt` and
`FYERS_APP_ID`/`FYERS_ACCESS_TOKEN` stay as optional settings purely so
this class keeps working if someone wants to switch back to it; there is
no OAuth/token-generation plumbing wired into any route.

### Phase 4A provider comparison

Evaluated against this project's priority order (free > no broker account >
no interactive OAuth > no manual token refresh > real NSE/BSE data > current
quotes > historical OHLCV > rate limits > easy Python integration):

| Provider | Free? | API key? | Broker account? | OAuth? | Manual token refresh? | NSE? | BSE? | Current quote? | Historical OHLCV? | Rate limits | Python support | Reliability concerns | Suitability |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **yfinance (selected)** | Yes | No | No | No | No | Yes (verified live) | Yes (verified live) | Yes | Yes | None published/enforced by the library itself; Yahoo may throttle | `yfinance` package, `YFRateLimitError` etc. for clean error mapping | Unofficial/reverse-engineered endpoint, no SLA | Best overall fit for this phase |
| FYERS API v3 | Yes | Yes | **Yes** | **Yes** | **Yes (~daily)** | Yes | Yes | Yes | Yes | Reasonable once authenticated | Official `fyers-apiv3` SDK | Official, but unusable here without a broker account + daily login | Rejected: broker account + daily manual login |
| Alpha Vantage | Yes (free tier) | Yes | No | No | No | Yes | Uncertain | Yes | Yes | 25 requests/**day** on the free tier | Simple REST | Free tier far too restrictive for interactive use | Rejected: rate limit |
| Twelve Data | Yes (free tier) | Yes | No | No | No | Unconfirmed on free tier | Unconfirmed | Yes | Yes | 8 requests/minute, 800/day (free tier) | Simple REST | India/NSE coverage on the free plan could not be confirmed from official pricing docs | Rejected: unconfirmed India coverage |
| Marketstack | Yes (free tier) | Yes | No | No | No | Uncertain | Uncertain | Limited | Yes | 100 requests/**month** free | Simple REST | Free tier far too restrictive | Rejected: rate limit |
| Finnhub | Yes (free tier) | Yes | No | No | No | Uncertain (India often gated behind paid plans) | Uncertain | Yes (US-focused) | Yes (US-focused) | 60 requests/minute | Simple REST | India/NSE support unclear on free tier | Rejected: unconfirmed India coverage |
| Financial Modeling Prep | Yes (free tier) | Yes | No | No | No | Uncertain (India often gated behind paid plans) | Uncertain | Yes (US-focused) | Yes (US-focused) | 250 requests/day (free tier) | Simple REST | India/NSE support unclear on free tier | Rejected: unconfirmed India coverage |

`yfinance` is the only option that is simultaneously free, needs no
account/key/OAuth, has verified real NSE and BSE coverage, and supports
both current quotes and historical OHLCV — see "Trade-off, stated plainly"
above for the one thing it gives up in exchange (no formal SLA).

## Running tests

```bash
pytest
```

Tests exercise the FastAPI app, config loading, and real queries against the
configured `DATABASE_URL` (the hosted Supabase database) — no local
PostgreSQL server is required.

Auth and watchlist tests (`tests/test_auth.py`, `tests/test_watchlists.py`)
run against that same real database but never leave permanent data behind:
each test gets its own database connection wrapped in an outer transaction +
`SAVEPOINT` (see `tests/conftest.py`). The app's `get_db` dependency is
overridden to use that session for the duration of the test, so every
`commit()` issued by service code only releases the `SAVEPOINT` — the outer
transaction is always rolled back at teardown, so nothing is ever
permanently persisted. Tests that need two independently authenticated users
at once (e.g. cross-user ownership checks) use the `client2` fixture, which
shares the same rolled-back session as `client` but keeps its own cookie
jar. Any query that reads back what a test just wrote is scoped to that
specific record (by id, or by the user/email the test itself created) rather
than scanning a whole table — the shared dev database may already contain
other real data (e.g. from manual testing), and an unscoped query would be
fragile against that.

## Security rules for environment variables

- Never commit `.env`. It is excluded via `.gitignore`; only `.env.example`
  (placeholders only) is committed.
- Never hardcode credentials in source code — everything comes from
  `DATABASE_URL` via `app/config.py` (`pydantic-settings`).
- Never log the database URL, password, or raw exception details from a
  failed connection (see `app/main.py`'s `/health/db` handler, which returns a
  generic error rather than the underlying exception).
- Rotate the database password if it is ever exposed (e.g. committed, pasted
  into a shared chat, or logged).
- Never log passwords, password hashes, raw session tokens, or the database
  URL/credentials — see the Security notes under Authentication above.

## Project structure

```
Backend/
├── app/
│   ├── main.py            FastAPI app + /health, /health/db, auth + watchlists routers
│   ├── config.py          pydantic-settings Settings (DB, session, cookie)
│   ├── database.py        engine, session factory, Base, get_db dependency
│   ├── enums.py           ChangeEventType, ChangeEventSeverity, MarketEventType
│   ├── models/            one SQLAlchemy model per file (incl. UserSession)
│   ├── api/
│   │   ├── auth.py        /api/auth/* route handlers (thin)
│   │   ├── watchlists.py  /api/watchlists/* route handlers (thin)
│   │   └── deps.py        get_current_user dependency
│   ├── core/
│   │   └── security.py    Argon2 password hashing, session token gen/hash
│   ├── providers/
│   │   ├── market_data.py       MarketDataProvider interface + error hierarchy
│   │   ├── yfinance_provider.py YFinanceProvider (active, default)
│   │   └── fyers.py             FYERSProvider (optional, dormant -- not wired in)
│   ├── schemas/
│   │   ├── auth.py        RegisterRequest, LoginRequest, UserPublic
│   │   ├── watchlists.py  WatchlistCreate/Update/Summary/Detail/Stock, ...
│   │   └── market_data.py StockSearchResult, QuoteResponse, HistoricalCandle, ...
│   └── services/
│       ├── auth.py         registration/login/session business logic
│       ├── watchlists.py   watchlist/stock CRUD, ownership, reordering
│       └── market_data.py  MarketDataService (routes -> this -> a provider)
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/          initial schema, add_user_sessions, placeholder stocks
├── tests/
│   ├── conftest.py        rollback-only db_session/client(2) fixtures
│   ├── test_auth.py
│   ├── test_watchlists.py
│   ├── test_market_data.py
│   ├── test_health.py
│   ├── test_config.py
│   └── test_database.py
├── .env                   local only, not committed
├── .env.example
├── alembic.ini
├── requirements.txt
└── README.md
```
