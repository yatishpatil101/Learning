# PuneNest E2E

Playwright end-to-end tests for the PuneNest React app (`../frontend`).

## Quick start

```bash
npm install
npx playwright install chromium   # one-time browser download
npm run test:nobackend            # safe, fast, no server needed — start here
```

`npm test` runs the **real** suite: ~1,900 specs against a running backend and Postgres. Read
"Two configs" below before you run it, because it resets a database.

`playwright.config.js` starts the frontend dev server for you (`npm --prefix ../frontend run dev`
on **port 5173**). To point at a different instance (e.g. a deployed preview) and skip the
auto-start:

```bash
BASE_URL=https://preview.example.com npm run test:nobackend
```

## Two configs

Until the mock provider was deleted there were two suites, and the default was the mock one — it
had to pass with no backend running, because that is how the UI was developed and demoed. There is
one data provider now, so a suite that avoids the server is not a safer default, it is one that
cannot assert anything about the product. The files swapped names.

| Config | What it is |
|---|---|
| `playwright.config.js` (**default**) | The whole suite, against the live API. `chromium`, `mobile` (Pixel 7) and `mobile-small` (360×640). |
| `playwright.nobackend.config.js` | Three specs whose subject *is* the absence of a server: `consumer/connectivity` (fault-injected HTTP and offline transitions), `contact-identity-masking` and `consumer/services/rent-agreement` (client-side identity and draft rules that never cross the wire). One `chromium` project. |

> **`npm test` resets a database.** `globalSetup` drops and reseeds `E2E_DB_NAME`, which defaults
> to the shared `punenest_e2e` lane, so a bare run wipes whichever database a concurrent session is
> using. This was tolerable while the live config was opt-in; as the default it is a footgun worth
> naming. Prefer the lane scripts — `run-live-flatmates.ps1`, `run-live-admin.ps1`,
> `run-live-services.ps1` — which pin the port, the database and the app URL together. If you run
> specs directly alongside another lane, set `E2E_DB_NAME` yourself.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | All three live projects, list + HTML + JUnit reporters. Resets the database. |
| `npm run test:headed` | Same, with a visible browser. |
| `npm run test:desktop` | Desktop Chrome only. |
| `npm run test:mobile` | Pixel 7 — `tests/mobile/**` plus the cross-viewport specs. |
| `npm run test:mobile-small` | 360×640 — `tests/mobile/**` only. |
| `npm run test:nobackend` | The three no-server specs. Needs nothing running, destroys nothing. |
| `npm run test:list` | List every test without running. |
| `npm run check:coverage` | Verify every spec path cited in `COVERAGE.md` still exists. |
| `npm run report` | Open the last HTML report. |

To run one area, point at its folder: `npx playwright test tests/consumer/flatmates`.

## Viewport projects

Specs are routed to projects by **folder**, not by filename or tag: `tests/mobile/**` is phone-only,
everything else is desktop-only unless a config opts it into a second viewport.

- **Default config** — `chromium` runs everything except `tests/mobile/**`; `mobile` runs
  `tests/mobile/**` plus an explicit cross-viewport `testMatch` list; `mobile-small` runs
  `tests/mobile/**` at 360×640.
- **No-backend config** — one `chromium` project. Its `CROSS_VIEWPORT` list and `mobile` project
  are gone: every entry had been *moved* to the live config as its spec converted, exactly as the
  rule required, and the list emptied itself. `testMatch: []` matches nothing, so that project was
  running zero specs and reporting a clean result for them.

Adding a spec to the live config's cross-viewport list doubles its runtime, so do it only when the
spec asserts something genuinely viewport-dependent — and when such a spec moves, **move** its
entry rather than deleting it, since a stale path matches nothing and reports nothing.

Two things that make a cross-viewport spec fail on a phone against *correct* code:

- **Collapsed chrome.** Footer columns are accordions that start closed below `sm`.
  Expand before clicking (see `revealFooterLink()` in `platform/help/i18n-urls.spec.js`).
- **Unpainted tap targets.** `.tap-extend` controls are drawn under 44px on purpose
  and restore the touch floor with a transparent `::before`. `boundingBox()` measures
  the painted box; measure the pseudo-element instead.

## Layout

Specs are grouped **audience → feature area**, mirroring `COVERAGE.md`. A spec's
folder is its route into a viewport project, so putting a file in the right place
is a functional decision, not just tidiness.

```
e2e/
  playwright.config.js   baseURL (BASE_URL env, default :5173) + webServer + reporters
  fixtures/base.js       import { test, expect } from here — adds `login` + `consoleErrors`
  helpers/
    app.js               seed(page, {...}) + OWNER/SEEKER/ADMIN + listing factories
    auth.js              loginAsBuyer/Owner/Tenant (seeded) + loginAsAdmin/Staff/Manager (UI)
    seed.js              localStorage seeding (USERS, seedUser, seedStorage, STORAGE_KEYS)
    console.js           trackErrors(page) — a failed request is judged by whose
                         origin it hit, not by wording; IGNORE lists third-party
                         hosts that only complain through the console
    datePicker.helper.js pickDate(page, selector, iso) for the themed calendar
  tests/
    consumer/            the public product — what a buyer, tenant or owner touches
      home/              landing page surfaces
      search/            /listings, filters, map, locality
      property/          /property/:id, contact gate, visits, reels
      flatmates/         /flatmates + PG
      list-property/     the posting wizard
      services/          service landing pages, EMI, rent agreement, plans, referrals
      society/           /societies, /society/:slug
      account/           signed-in surfaces — dashboard, owner hub, saved, messages, rent
    admin/               /admin/** back office
    ops/                 /ops/** service queues
    mobile/              phone-only chrome & ergonomics (routes to the mobile projects)
    platform/            cross-cutting — i18n, flags, settings, legal, redirects, assistant
      auth/              sign-in, OTP, KYC
      help/              help centre
  scripts/               one-off maintenance scripts (see their header comments)
  COVERAGE.md            route/feature → spec traceability matrix (the audit)
```

## Writing a new spec

Put it in the folder that matches its audience and feature area — that is what
routes it to a viewport project. Import depth follows the nesting (`../../../`
from `tests/consumer/flatmates/`).

```js
import { test, expect } from '../../../fixtures/base.js';

test('owner can open the listing wizard', async ({ page, login, consoleErrors }) => {
  await login.asOwner({ }, { aadhaar: true });   // seeds localStorage before load
  await page.goto('/list-property');             // relative — baseURL from config
  await expect(page.getByRole('heading', { name: /list your property/i })).toBeVisible();
  expect(consoleErrors).toEqual([]);             // no real console errors
});
```

Conventions:
- Use **relative** paths (`page.goto('/listings')`); never hardcode a host/port.
- Prefer role/label/testid locators over CSS.
- Assert the **guard** (unauthorized → redirect), an **empty state**, and any
  **maker-checker** transition the flow doc defines — not just the happy path.
- Keep environmental console noise in `helpers/console.js`, not per-spec. Failed
  requests to other people's hosts are already tolerated by origin, so a spec that
  is only noisy offline needs no change; `IGNORE` is for third-party code that
  logs without a URL to attribute. Our own origin returning 404/500 is a real
  failure — do not add a pattern to hide one.

## Four things that fail a spec against correct code

Each of these cost a debugging round; `COVERAGE.md` records the rest.

- **Scroll-reveal sections.** `.reveal` blocks sit at `opacity: 0` until observed,
  so Playwright calls them invisible — and `scrollIntoViewIfNeeded()` deadlocks,
  because scrolling requires visibility. Force the end state instead:
  `page.evaluate(() => document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible')))`.
- **`NativeSelect` is not a `<select>`.** It renders a themed `.pn-dropdown`, so
  `selectOption()` never resolves. Click `.pn-dropdown__trigger`, then a
  `[role="option"]` in `.pn-dropdown__menu--portal`.
- **`Table` renders twice.** A desktop `<table>` *and* a `.pn-card` stack for
  phones, one hidden by CSS. Scope assertions to `getByRole('table')` on desktop,
  or strict mode trips on the duplicate.
- **`puneNestDB_v5` cannot be seeded before boot.** mockApi migrates and merges it
  at module load, so a partial object written in `addInitScript` leaves the app
  with no settings and a blank page. Load once, mutate the real DB in `evaluate()`,
  then navigate. Per-user keys (`pnTenancies:<mobile>`) *are* safe to pre-seed.
