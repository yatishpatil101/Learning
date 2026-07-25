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
| `npm test` | Full suite, list + HTML + JUnit reporters. |
| `npm run test:headed` | Same, with a visible browser. |
| `npm run test:mobile` | Only the `mobile-*` specs (Pixel 7 viewport). |
| `npm run test:list` | List every test without running. |
| `npm run report` | Open the last HTML report. |

## Layout

```
e2e/
  playwright.config.js   baseURL (BASE_URL env, default :5173) + webServer + reporters
  fixtures/base.js       import { test, expect } from here — adds `login` + `consoleErrors`
  helpers/
    auth.js              loginAsBuyer/Owner/Tenant (seeded) + loginAsAdmin/Staff/Manager (UI)
    seed.js              localStorage seeding (USERS, seedUser, seedStorage, STORAGE_KEYS)
    console.js           IGNORE noise filter + trackErrors(page)
    datePicker.helper.js pickDate(page, selector, iso) for the themed calendar
  tests/*.spec.js        the specs
  COVERAGE.md            route/feature → spec traceability matrix (the audit)
```

## Writing a new spec

```js
import { test, expect } from '../fixtures/base.js';

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
