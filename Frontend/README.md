# Smart Market Watchlist — Frontend

React + TypeScript (Vite) frontend. This phase covers the visual design
system, cookie-based authentication UI (Login/Register/Logout), and route
protection wired to the existing FastAPI backend. It does not implement
watchlists or market data yet.

## Prerequisites

- Node.js 20+
- The backend running locally (see `../Backend/README.md`), listening on
  `http://127.0.0.1:8000`

## Setup

```bash
cd Frontend
npm install
npm run dev
```

This starts the Vite dev server at `http://localhost:5173`. Requests to
`/api/*` are proxied to `http://127.0.0.1:8000` (configured in
`vite.config.ts`), so the browser sees everything as same-origin -- no CORS
configuration is needed on the backend, and the backend's `HttpOnly` session
cookie works exactly as it does when calling the API directly.

Start the backend first (from `Backend/`):

```bash
uvicorn app.main:app --reload
```

## Scripts

| Command           | Purpose                                  |
|--------------------|-------------------------------------------|
| `npm run dev`      | Start the Vite dev server                 |
| `npm run build`    | Type-check (`tsc -b`) and build for production |
| `npm run lint`     | Run `oxlint`                              |
| `npm run preview`  | Preview a production build locally        |

## Design system

All design tokens live in `src/styles/tokens.css` as CSS custom properties --
components never hardcode raw colors, spacing, radii, or shadows.

- **Color**: indigo/blue primary (`--color-primary-*`) with a deep-indigo
  secondary shade, a fintech-green accent, semantic success/danger colors,
  white/light-neutral surfaces, dark-navy primary text, muted-slate secondary
  text, and very light borders.
- **Typography** (`src/styles/typography.css`): `Fraunces` (serif/display,
  used for headlines) paired with `Inter` (sans, used for UI/body text).
  Reusable classes -- `.text-display`, `.text-h1`, `.text-h2`, `.text-h3`,
  `.text-body`, `.text-body-strong`, `.text-caption`, `.text-label`,
  `.text-number` (tabular figures for financial numbers) -- so no component
  hand-rolls a font stack.
- **Motion** (`src/styles/animations.css`): shared keyframes (`fade-in-up`,
  `fade-in`, `slide-fade-in`, `spin`, `shimmer`) and utility classes
  (`.anim-fade-in-up`, `.anim-fade-in`, `.anim-stagger-item`, `.anim-error`).
  A single global `@media (prefers-reduced-motion: reduce)` block collapses
  all animation/transition durations to near-zero, so motion is always
  respected regardless of which component triggered it.
- Components are styled with CSS Modules (`Component.module.css`) scoped
  per-component; no CSS framework and no animation library were added.

## Brand

Original mark: a small indigo-gradient badge with an abstract ascending
"signal" line ending in a highlighted pulse dot (`BrandMark.tsx`) --
deliberately distinct from any third-party fintech logo. Product
positioning: **"Know what changed. Know what matters."**

The Login/Register marketing panel includes three small demo "insight" cards
(`InsightCard.tsx`) that preview the app's actual differentiator -- e.g. "NOVA
+5.2% since you last checked," "Unusual volume," "New 52-week high" -- using
a fictitious ticker and labeled "Illustrative preview -- sample data only,"
since these are demo values, not real market data.

## Authentication

- `src/api/auth.ts` -- thin `fetch` wrappers for
  `/api/auth/{register,login,logout,me}`, always sending
  `credentials: 'include'`.
- `src/context/auth-context.ts` + `src/context/AuthContext.tsx` -- the
  `AuthProvider`/`useAuth()` context. On mount it calls `GET /api/auth/me`
  once to determine `status`: `loading` -> `authenticated` | `unauthenticated`.
- `src/components/ProtectedRoute.tsx` -- redirects to `/login` while
  unauthenticated, shows a full-page spinner while the initial session check
  is in flight, otherwise renders its children.
- Login/Register pages redirect an already-authenticated user straight to
  `/`.
- No new auth behavior was added on top of the backend: no social login, no
  "forgot password," no client-side password hashing -- exactly the four
  existing endpoints, driving the UI.

## Responsive behavior

- **Desktop** (>=1024px): two-column layout, marketing panel ~44% width.
- **Tablet** (640px-1023px): same two-column layout, panel narrowed to ~36%.
- **Mobile** (<640px): layout stacks vertically; the marketing panel becomes
  a compact hero (brand mark + headline + supporting line only -- the demo
  insight cards and footer are hidden) instead of a full-height column.

## Accessibility

- Every input has a real `<label htmlFor>` pointing at its `id`
  (`TextField.tsx`, id generated via `useId()` when not provided explicitly).
- Field errors use `role="alert"` and are linked via `aria-describedby`;
  invalid fields set `aria-invalid`.
- Visible focus rings on every interactive element via `:focus-visible` (see
  `src/styles/global.css`) -- never suppressed.
- Buttons expose `aria-busy` while loading; loading spinners carry
  `role="status"`.
- All animations respect `prefers-reduced-motion: reduce` globally.

## Verification performed

- `npx tsc -b --noEmit` -- passes with no errors.
- `npm run lint` (oxlint) -- passes with no warnings.
- Manually driven with Playwright against the running dev server (backend +
  Vite proxy): register, wrong-password login (generic error shown),
  successful login, `/` protected page rendering the session's user and a
  working logout, logout redirecting back to `/login`, desktop (1440px) and
  mobile (390px) viewports, and a `prefers-reduced-motion: reduce` emulated
  pass -- no console errors, no layout breakage, nothing left permanently
  invisible when motion is reduced. Test users created during verification
  were deleted from the database afterward.
