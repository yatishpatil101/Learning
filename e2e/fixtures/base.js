// Shared test base. New specs should import { test, expect } from here instead
// of '@playwright/test' to pick up the project conventions:
//
//   import { test, expect } from '../fixtures/base.js';
//
// Fixtures provided:
//   - consoleErrors : string[] auto-collecting real console/page errors.
//   - login         : { asBuyer, asOwner, asTenant, asAdmin, asStaff, asManager }
//                     bound to the current page.
//
// baseURL comes from playwright.config.js (BASE_URL env, default :5173), so
// specs use relative paths: await page.goto('/listings').

import { test as base, expect } from '@playwright/test';
import { trackErrors } from '../helpers/console.js';
import * as auth from '../helpers/auth.js';

export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(errors);
  },
  login: async ({ page }, use) => {
    await use({
      asBuyer: (over, opts) => auth.loginAsBuyer(page, over, opts),
      asOwner: (over, opts) => auth.loginAsOwner(page, over, opts),
      asTenant: (over, opts) => auth.loginAsTenant(page, over, opts),
      asAdmin: () => auth.loginAsAdmin(page),
      asStaff: (team) => auth.loginAsStaff(page, team),
      asManager: (label) => auth.loginAsManager(page, label),
    });
  },
});

export { expect };
