import { test, expect } from '@playwright/test';
import { SEEKER, seed, openProperty, propertyListing, publishListing } from '../helpers/app.js';

/* The property detail page renders whatever the DB holds, including records from
   older seeds, partial RERA imports and hand-written fixtures. Missing optional
   fields must degrade to a label — an unguarded `.toLowerCase()` on one of them
   used to throw during render and white-screen the entire route, which is a far
   worse failure than a listing that reads "Property". */

const listen = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

test.describe('Property detail resilience', () => {
  test('renders a listing that is missing its type', async ({ page }) => {
    const errors = listen(page);
    await seed(page, { user: SEEKER });
    await publishListing(page, propertyListing({ id: 'P-notype', type: undefined }));
    await openProperty(page, 'P-notype');

    // Assert on the page heading, not the breadcrumb: the breadcrumb is
    // deliberately `hidden sm:flex` (mobile uses the "Back to results" pill
    // instead), so a locality-text check only passes on desktop.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The generic fallback stands in for the missing type, and "undefined" must
    // never reach the user-facing title.
    await expect(page.getByText(/undefined/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('renders a listing that is missing its posted date', async ({ page }) => {
    const errors = listen(page);
    await seed(page, { user: SEEKER });
    await publishListing(page, propertyListing({ id: 'P-nodate', createdAt: undefined }));
    await openProperty(page, 'P-nodate');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('timeAgo always returns a string, whatever it is handed', async ({ page }) => {
    await seed(page, { user: SEEKER });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // The root cause: timeAgo() passed unparseable input straight back out, so a
    // null createdAt returned null and every caller doing .toLowerCase() threw.
    const types = await page.evaluate(async () => {
      const { timeAgo } = await import('/src/lib/format.js');
      return [undefined, null, '', 'Just now', 0, new Date().toISOString()]
        .map((v) => typeof timeAgo(v));
    });
    expect(types.every((t) => t === 'string')).toBe(true);
  });
});
