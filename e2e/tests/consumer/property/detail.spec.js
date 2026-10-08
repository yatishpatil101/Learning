import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/** p5124 has a null bhk, mapped to a falsy bhkNum 0 so the heading drops the BHK prefix, never "null BHK Plot".
 * Absences are asserted only after an exact-heading match, since a page that failed to render passes them too. */

const NO_BHK_LISTING = 'p5124';   // Open Plot, Wagholi, buy — `bhk` is NULL in Postgres

test.describe('Property detail (live)', () => {
  test('a listing with no BHK renders a clean heading, with no orphan unit and no placeholder', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto(`/property/${NO_BHK_LISTING}`, { waitUntil: 'domcontentloaded' });

    const h1 = page.getByRole('heading', { level: 1 });

    /* Exact match, not a substring: `toContainText('Plot')` would pass on "null BHK Plot for Sale in Wagholi",
       the very bug, and the absences below mean nothing without a positive anchor. */
    await expect(h1, 'the detail heading never rendered').toHaveText('Plot for Sale in Wagholi');

    /* An orphan "BHK" means the ternary's falsy branch was dropped; scoped to the heading because "BHK"
       legitimately appears elsewhere on the page (similar listings, filters). */
    await expect(h1, 'a unit with no number in front of it').not.toContainText('BHK');
    // The two shapes a missing guard prints. `String(undefined)` and `String(null)` are what reach
    // the DOM when a template interpolates an absent field directly.
    await expect(h1).not.toContainText('undefined');
    await expect(h1).not.toContainText('null');
    // `bhkNum` is 0 for this row, not absent. A truthiness check drops it; a `!= null` check would
    // print this instead, which is the near-miss worth naming.
    await expect(h1).not.toContainText('0 BHK');

    /* The same derived title feeds the breadcrumb and gallery, so a throw while composing it white-screens
       the route rather than degrading; a clean console proves it did not. */
    expect(errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e)))
      .toEqual([]);
  });
});
