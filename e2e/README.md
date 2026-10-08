# Draazy E2E

Playwright end-to-end tests for the Draazy React app (`../frontend`).

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

## Fast runs: `run-fast.ps1`

The serial suite takes ~45 minutes, which is the wrong price for checking a one-file fix. The
runner has two modes, and the second one stays the gate before a commit.

| Command | What it runs |
|---|---|
| `.\run-fast.ps1` | Only the specs related to the working-tree changes vs `HEAD` (`-Base <ref>` to change it). |
| `.\run-fast.ps1 -Files frontend/src/pages/admin/AdminFinance.jsx` | The same, for files you name. Use it when the tree holds another session's changes. |
| `.\run-fast.ps1 -Spec tests/consumer/property/alerts.spec.js` | Exactly the named specs. |
| `.\run-fast.ps1 -Failed` | Only the tests that failed in the last run (by `file:line`, like Playwright's `--last-failed`). |
| `.\run-fast.ps1 -Full` | **The whole suite** (both configs), split across `-Shards 4` isolated lanes. Run it before committing. |
| `.\run-fast.ps1 -DryRun` | Print the selection and test count, start nothing. |
| `.\run-fast.ps1 -Stop` | Stop the shard JVMs. |

**Selection** (`scripts/related-specs.mjs`) follows the frontend import graph from a changed file
up to the `App.jsx` routes it reaches, then picks the specs that visit those routes. A backend
change follows every class that names it (across modules, and through the interface Spring injects)
to the controllers it reaches, then maps their paths to the specs and to the frontend functions that
call them. Anything shared (`App.jsx`, layouts, contexts, `common`/`security`, migrations, seeds, config,
the sign-in page) selects the whole suite. The canary always runs. Run it alone to see why each spec
was chosen: `node scripts/related-specs.mjs <path>...`. The selector misses click-through
navigation and calls made by reflection or events, which is why `-Full` is the commit gate.

**Shards.** Shard *i* has its own backend on `:811i`, app on `:521i`, database `draazy_e2e_sh<i>`
(created on first use, reset by `globalSetup` each run) and storage dir. They never touch the lane
ports or databases a concurrent session uses. Spec files are dealt to shards by the time they took
last run (`.shards/durations.json`, updated after every run), longest first, to whichever shard has
the least work. Playwright's own `--shard` splits by test count, and one shard of wizard specs then
takes hours longer than the rest. The backend is built once into `backend/target-shard`
and rebuilt only when anything under `backend/src/main` or `pom.xml` changes (path, size or time). JVMs stay up between runs, so later
runs skip the boot, and a JVM on an old build is restarted automatically. Each shard runs with one
worker, just as the serial suite does, so specs that share seeded fixtures are never run
concurrently against the same database. With more than one shard, each test runs about 1.45x slower,
so the default test and `expect` timeouts are doubled (`E2E_TIMEOUT_SCALE=2`). Without that, some
60-second tests that pass serially time out. Timeouts a spec sets itself are unchanged.

A run passes only when no test fails, no error is raised outside a test, every Playwright process
exits 0, **and** every test listed beforehand is reported exactly once (compared by identity, not
count), so a shard that dies in setup shows as `MISSING`, not as a pass. Missing tests go into
`last-failed.txt`, so `-Failed` reruns them too. The no-backend specs get their own dev server on
`:5210`. Output goes to
`.shards/` (git-ignored): `html/` (merged report, `npx playwright show-report .shards\html`),
`report.json`, per-shard logs `shard-<i>.log`, and `last-failed.txt`. JVM logs are in
`%TEMP%\draazy-shard-<i>.log`.

## Two configs

Until the mock provider was deleted there were two suites, and the default was the mock one — it
had to pass with no backend running, because that is how the UI was developed and demoed. There is
one data provider now, so a suite that avoids the server is not a safer default, it is one that
cannot assert anything about the product. The files swapped names.

| Config | What it is |
|---|---|
| `playwright.config.js` (**default**) | The whole suite, against the live API. `chromium`, `mobile` (Pixel 7) and `mobile-small` (360×640). |
| `playwright.nobackend.config.js` | Four specs whose subject *is* the absence of a server: `consumer/connectivity` (fault-injected HTTP and offline transitions), `contact-identity-masking`, `consumer/services/rent-agreement` and `consumer/services/rent-agreement-validation` (client-side identity and draft rules that never cross the wire). One `chromium` project. |

> **`npm test` resets a database.** `globalSetup` drops and reseeds `E2E_DB_NAME`, which defaults
> to the shared `draazy_e2e` lane, so a bare run wipes whichever database a concurrent session is
> using. This was tolerable while the live config was opt-in; as the default it is a footgun worth
> naming. Prefer the lane scripts — `run-live-flatmates.ps1`, `run-live-admin.ps1`,
> `run-live-services.ps1` — which pin the port, the database and the app URL together. If you run
> specs directly alongside another lane, set `E2E_DB_NAME` yourself.

## Backend prerequisites

1. **Postgres up**, with the database created once: `psql -U postgres -c "create database draazy_e2e"`.
   It is deliberately not `draazy` (a run would wipe hand-made work) and not `draazy_test` (the Java
   suite requires that one to stay empty). See [`docs/system/profiles.md`](../docs/system/profiles.md) §2.
2. **`DRAAZY_DEV_MACHINE` set in the environment the backend is launched from.** `LocalProfileGuard`
   requires it as positive proof the JVM is on a developer's machine rather than a container that
   inherited `local` from a copied environment file. It is in no committed file on purpose:

   ```powershell
   [Environment]::SetEnvironmentVariable('DRAAZY_DEV_MACHINE', '1', 'User')
   ```

   Without it the backend refuses to start and the suite fails with a login timeout that names
   nothing — check the backend console first.
3. **Backend on :8081 under both profiles**, `e2e` last so its datasource wins:

   ```bash
   cd backend; ./mvnw spring-boot:run "-Dspring-boot.run.profiles=local,e2e" "-Dspring-boot.run.arguments=--server.port=8081"
   ```

   `local` binds the mock OTP sender (without it the backend boots the SMS sender, which throws, and
   no login can succeed); `e2e` points the datasource at `draazy_e2e` and fixes the OTP to a
   constant, so `helpers/liveAuth.js` types a literal rather than scraping the backend log. Only the
   digits are predictable — the code is still single-use, expiring, and a wrong one is still refused.

## Scripts

| Command | What it does |
|---|---|
| `npm test` | All three live projects, list + HTML + JUnit reporters. Resets the database. |
| `npm run test:headed` | Same, with a visible browser. |
| `npm run test:desktop` | Desktop Chrome only. |
| `npm run test:mobile` | Pixel 7 — the two width-sensitive `tests/mobile` specs plus the cross-viewport specs. |
| `npm run test:mobile-small` | 360×640 — all of `tests/mobile/**`. |
| `npm run test:nobackend` | The four no-server specs. Needs nothing running, destroys nothing. |
| `npm run test:list` | List every test without running. |
| `npm run check:coverage` | Verify every spec path cited in `COVERAGE.md` still exists and every spec is cited. |
| `npm run report` | Open the last HTML report. |

To run one area, point at its folder: `npx playwright test tests/consumer/flatmates`.

## Viewport projects

Specs are routed to projects by **folder**, not by filename or tag: `tests/mobile/**` is phone-only,
everything else is desktop-only unless a config opts it into a second viewport.

- **Default config** — `chromium` runs everything except `tests/mobile/**`; `mobile-small` runs all of
  `tests/mobile/**` at 360×640. `mobile` (Pixel 7) runs only `tests/mobile/home-featured-first` and
  `home-flatmates-tile`, whose fold and wrapping checks differ at 412×915, plus an explicit
  cross-viewport `testMatch` list (`referral-rewards`, `help/centre`, `help/help-urls`, `platform/i18n`).
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
      flatmates/         /flatmates
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
routes it to a viewport project. Name it for the feature (`alerts-card.spec.js`); every spec runs
against the live API, so a `live-` prefix is rejected by `playwright.config.js`. Import depth follows
the nesting (`../../../` from `tests/consumer/flatmates/`).

```js
import { test, expect } from '../../../fixtures/base.js';

test('owner can open the listing wizard', async ({ page, login, consoleErrors }) => {
  await login.asOwner({ }, { identityVerified: true });   // seeds localStorage before load
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
- **`NativeSelect` is not a `<select>`.** It renders a themed `.dz-dropdown`, so
  `selectOption()` never resolves. Click `.dz-dropdown__trigger`, then a
  `[role="option"]` in `.dz-dropdown__menu--portal`.
- **`Table` renders twice.** A desktop `<table>` *and* a `.dz-card` stack for
  phones, one hidden by CSS. Scope assertions to `getByRole('table')` on desktop,
  or strict mode trips on the duplicate.
- **`draazyDB_v5` cannot be seeded before boot.** mockApi migrates and merges it
  at module load, so a partial object written in `addInitScript` leaves the app
  with no settings and a blank page. Load once, mutate the real DB in `evaluate()`,
  then navigate. Per-user keys (`dzTenancies:<mobile>`) *are* safe to pre-seed.
