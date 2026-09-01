import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/**
 * Property detail — the heading composed around a listing that has no BHK.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT A PORT. The mock spec this retires seeded two listings with
 * `type: undefined` and `createdAt: undefined` and asserted the page survived them. Neither state is
 * reachable against the real API: `properties.property_type` is `text NOT NULL` (V3) and
 * `created_at` is `timestamptz NOT NULL DEFAULT now()` (V1). Ported literally, those tests would be
 * unfalsifiable — passing forever because the database cannot produce the input they guard against.
 * The seam is real, though; only the field was wrong. `bhk` IS nullable, `p5124` is the seeded row
 * that holds a null, and the heading is composed out of it:
 *
 *   `${p.bhkNum ? p.bhkNum + ' BHK ' : ''}${typeLabel} for ${isRent ? 'Rent' : 'Sale'} in ${p.locality}`
 *
 * so this is the same defect class the mock was reaching for, aimed at a value the server can
 * actually send. `propertyMapper` turns an absent `bhk` into `bhkNum: 0` — deliberately falsy, so
 * the prefix drops out entirely rather than printing "0 BHK".
 *
 * WHY p5124 SPECIFICALLY. It is the only approved listing in the seed with a null `bhk` (an Open
 * Plot in Wagholi — land has no bedrooms). A plot is also the case where getting this wrong is most
 * visible: "2 BHK Plot" would be nonsense, and "undefined BHK Plot" or "null BHK Plot" is the shape
 * a missing guard actually produces.
 *
 * THE ANCHOR MATTERS. Every "must not appear" assertion here is gated behind an exact-match check on
 * the full heading text, because a page that failed to render at all satisfies "does not contain
 * undefined" perfectly. The absences are only evidence once something positive is on the screen.
 */

const NO_BHK_LISTING = 'p5124';   // Open Plot, Wagholi, buy — `bhk` is NULL in Postgres

test.describe('Property detail (live)', () => {
  test('a listing with no BHK renders a clean heading, with no orphan unit and no placeholder', async ({ page }) => {
    const errors = trackErrors(page);

    await page.goto(`/property/${NO_BHK_LISTING}`, { waitUntil: 'domcontentloaded' });

    const h1 = page.getByRole('heading', { level: 1 });

    /* The positive anchor, and an exact match rather than a substring: the composition is the thing
       under test, so asserting the whole string is what makes every absence below meaningful. A
       `toContainText('Plot')` would pass on "null BHK Plot for Sale in Wagholi" — the exact bug. */
    await expect(h1, 'the detail heading never rendered').toHaveText('Plot for Sale in Wagholi');

    /* Now the absences, each naming a distinct way the guard can fail.

       "BHK" is the orphan-unit case: dropping the ternary's falsy branch and always emitting the
       prefix leaves the unit with no number in front of it. Scoped to the heading, because "BHK"
       legitimately appears elsewhere on the page (similar listings, filters). */
    await expect(h1, 'a unit with no number in front of it').not.toContainText('BHK');
    // The two shapes a missing guard prints. `String(undefined)` and `String(null)` are what reach
    // the DOM when a template interpolates an absent field directly.
    await expect(h1).not.toContainText('undefined');
    await expect(h1).not.toContainText('null');
    // `bhkNum` is 0 for this row, not absent. A truthiness check drops it; a `!= null` check would
    // print this instead, which is the near-miss worth naming.
    await expect(h1).not.toContainText('0 BHK');

    /* The heading is the breadcrumb's and the gallery's label too (`Property.jsx` passes the same
       derived `title` to both), so a throw during composition white-screens the route rather than
       degrading — which is why an unguarded `.toLowerCase()` on one of these fields was a page-level
       outage and not a cosmetic bug. A clean console is how that stays proven. */
    expect(errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e)))
      .toEqual([]);
  });
});
