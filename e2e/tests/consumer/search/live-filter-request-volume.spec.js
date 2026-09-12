import { test, expect } from '../../../fixtures/live.js';

/* A range reports every step of a drag and each one became a `GET /properties` (239 per gesture);
 * `useCommitOnRelease` lifts the value on release. Desktop sidebar only — the drawer shares it. */

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const maxThumb = (page) => filters(page).getByRole('slider', { name: /budget range maximum/i });
const maxLabel = (page) => filters(page).getByRole('button', { name: /budget range maximum/i });

/** Count `GET /properties` searches from now on; returns a live counter and a reset. */
function countSearches(page) {
  const state = { n: 0 };
  page.on('request', (req) => {
    if (req.method() === 'GET' && /\/properties(\?|$)/.test(req.url())) state.n += 1;
  });
  return state;
}

test.describe('Filter sliders fetch once per gesture', () => {
  test('dragging the budget thumb issues one search, on release', async ({ page }) => {
    await page.goto('/listings?deal=buy');
    await expect(maxThumb(page)).toBeVisible();
    // Let the page's own first search finish so it can't be miscounted as the drag's.
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches = countSearches(page);
    const before = await maxLabel(page).innerText();

    // The range input is `pointer-events: none` except for the thumb pseudo-element, so the press
    // has to land on the thumb itself — which sits at the right edge while the max is unfiltered.
    const box = await maxThumb(page).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.45, y, { steps: 25 });

    // The control is still live: the figure under the thumb has followed it.
    await expect(maxLabel(page)).not.toHaveText(before);
    // ...but nothing has been asked of the server yet.
    expect(searches.n, 'searches issued while still dragging').toBe(0);

    await page.mouse.up();

    // Releasing commits, and commits exactly once.
    await expect.poll(() => searches.n, { message: 'searches issued on release' }).toBe(1);
    await page.waitForTimeout(600);
    expect(searches.n, 'no follow-up search after the gesture').toBe(1);
  });

  test('the near-a-place radius slider also commits on release, and its readouts stay live', async ({ page }) => {
    // A place must be picked before the radius control is rendered at all; the shared deep-link
    // contract seeds one without going through the autocomplete.
    await page.goto('/listings?deal=buy&near=18.5590,73.7868&nearlabel=Baner&nearr=10&nearmode=km');
    const radius = filters(page).getByRole('slider', { name: /search radius/i });
    const readout = filters(page).getByRole('spinbutton', { name: /search radius value/i });
    await expect(radius).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches = countSearches(page);
    const box = await radius.boundingBox();
    const y = box.y + box.height / 2;
    // A plain 1..25 range: the thumb sits proportionally along the track, no pointer-events tricks.
    await page.mouse.move(box.x + box.width * ((10 - 1) / 24), y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, y, { steps: 20 });

    /* The big number is a SEPARATE input bound to the same radius; it must follow the thumb or the
       control freezes at 10 while the thumb moves to 23. */
    await expect(readout).not.toHaveValue('10');
    expect(searches.n, 'searches issued while still dragging').toBe(0);

    await page.mouse.up();
    await expect.poll(() => searches.n, { message: 'searches issued on release' }).toBe(1);
  });

  test('arrow-key stepping still searches — commit is not pointer-only', async ({ page }) => {
    /* Commit hangs off the native `change` event, not pointer gestures, so keyboard and AT slider
       adjusts still reach the server — a `pointerup` commit would strand both. */
    await page.goto('/listings?deal=buy');
    const thumb = maxThumb(page);
    await expect(thumb).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches = countSearches(page);
    await thumb.focus();
    await thumb.press('ArrowLeft');

    await expect.poll(() => searches.n, { message: 'searches issued after one arrow step' }).toBe(1);
  });

  test('holding an arrow key crosses the range in one search, not one per step', async ({ page }) => {
    /* A range fires `change` on every keyboard step, so auto-repeat is a second route to the
       request storm. Twelve steps stand in for a held key: only the last may be searched for. */
    await page.goto('/listings?deal=buy');
    const thumb = maxThumb(page);
    await expect(thumb).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches = countSearches(page);
    await thumb.focus();
    for (let i = 0; i < 12; i += 1) await thumb.press('ArrowLeft', { delay: 30 });

    await expect.poll(() => searches.n, { message: 'searches issued across 12 steps' }).toBe(1);
    await page.waitForTimeout(600);
    expect(searches.n, 'a late straggler arrived after the run settled').toBe(1);
  });
});

/** Revisiting a sort reuses cached results rather than issuing another search request. */
/* The controls bar renders twice (phone and tablet-up) and Tailwind hides one, so a bare
   `getByLabel` is a strict-mode violation; `:visible` picks the one in play. */
const sortTrigger = (page) => page.locator('button[aria-label="Sort listings"]:visible');

async function sortBy(page, label) {
  await sortTrigger(page).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test.describe('A search already answered is not asked again', () => {
  test('returning to the previous sort costs no request, and a new one still does', async ({ page }) => {
    await page.goto('/listings?deal=buy');
    await expect(sortTrigger(page)).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});

    const searches = countSearches(page);

    // Away: a query the cache has never held.
    await sortBy(page, 'Newest First');
    await expect.poll(() => searches.n, { message: 'searches for the new sort' }).toBe(1);
    await expect(sortTrigger(page)).toHaveText(/Newest First/);

    // Back: the same query as the first paint, which is still remembered.
    await sortBy(page, 'Relevance');
    await expect(sortTrigger(page)).toHaveText(/Relevance/);
    await page.waitForTimeout(800);
    expect(searches.n, 'going back re-asked a question already answered').toBe(1);

    /* Vacuity guard: "0 new requests" is equally consistent with searching switched off entirely,
       so a third, unseen sort must still reach the server. */
    await sortBy(page, 'Price: Low to High');
    await expect.poll(() => searches.n, { message: 'searches for an unseen sort' }).toBe(2);
  });
});
