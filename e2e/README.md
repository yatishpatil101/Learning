# PuneNest E2E

Playwright end-to-end tests for the PuneNest React app (`../frontend`).

## Quick start

```bash
npm install
npx playwright install chromium   # one-time browser download
npm test                          # runs the whole suite (auto-starts the dev server)
```

`playwright.config.js` starts the frontend dev server for you (`npm --prefix ../frontend run dev`
on **port 5173**) and reuses one you already have running. To point at a different
instance (e.g. a deployed preview) and skip the auto-start:

```bash
BASE_URL=https://preview.example.com npm test
```

## Scripts

| Command | What it does |
|---|---|
| `npm test` | All three projects, list + HTML + JUnit reporters. |
| `npm run test:headed` | Same, with a visible browser. |
| `npm run test:desktop` | Desktop Chrome only — everything except `tests/mobile/`. |
| `npm run test:mobile` | Pixel 7 — `tests/mobile/` plus the cross-viewport specs. |
| `npm run test:mobile-small` | 360×640 low-end Android — `tests/mobile/` only. |
| `npm run test:list` | List every test without running. |
| `npm run check:coverage` | Verify every spec path cited in `COVERAGE.md` still exists. |
| `npm run report` | Open the last HTML report. |

To run one area, point at its folder: `npx playwright test tests/consumer/flatmates`.

## Viewport projects

Specs are routed to projects by **folder**, not by filename or tag:

- `tests/mobile/**` → the `mobile` and `mobile-small` projects only.
- everything else → `chromium` (desktop) only.
- the `CROSS_VIEWPORT` list in `playwright.config.js` opts a desktop spec into
  the mobile project as well. Add a spec there only when it asserts something
  genuinely viewport-dependent — it doubles that spec's runtime.

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
    console.js           IGNORE noise filter + trackErrors(page)
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
- Keep environmental console noise in `helpers/console.js` `IGNORE`, not per-spec.

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
