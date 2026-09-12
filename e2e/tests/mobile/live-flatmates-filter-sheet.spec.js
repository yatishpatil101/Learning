import { test, expect } from '@playwright/test';
import { API } from '../../helpers/liveAuth.js';

/* Both browse sheets render `components/ui/FilterGroup`, so the first test holds each of them to one
 * chrome contract independently. Mobile-only: the desktop filter row does not collapse. */

/** Cookie bar overlaps bottom-anchored chrome; pre-seed consent like the other mobile specs do. */
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the bar just stays up */ }
  });
}

/** Scoped to the open drawer: /flatmates also keeps the desktop filter grid in the DOM, so an
 *  unscoped slider lookup resolves to two elements and fails strict mode. */
const sheet = (page) => page.locator('.filter-panel');

/**
 * The shape of every section in the open sheet. Structural rather than pixel-based: a screenshot
 * diff would fail on the section names, which are different by design.
 */
const sectionShape = (page) =>
  sheet(page).locator('.filter-group').evaluateAll((groups) =>
    groups.map((g) => ({
      icon: !!g.querySelector('.fg-header svg'),
      // The button is what makes a collapsed section openable at all.
      toggle: !!g.querySelector('button.fg-header[aria-expanded]'),
      summary: !!g.querySelector('.fg-summary'),
      chevron: !!g.querySelector('.fg-chev'),
      body: !!g.querySelector('.fg-body .fg-body-inner'),
    })),
  );

/* `.filter-fab` rather than role+name: the two accessible names differ and change once a filter is
   set. The long timeout is real — on /listings the pill only exists once the catalogue answers. */
async function openFilters(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const fab = page.locator('.filter-fab');
  await fab.waitFor({ state: 'visible', timeout: 30_000 });
  await fab.click();
  await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
}

const openListingsFilters = (page) => openFilters(page, '/listings');
const openFlatmatesFilters = (page) => openFilters(page, '/flatmates');

/* Found by its `.rng-wrap` control, not its header text, whose accessible name changes as the value
   does. The `has:` locator must be rooted at `page` — Playwright re-queries it per candidate. */
const budgetGroup = (page) =>
  sheet(page).locator('.filter-group', { has: page.locator('.rng-wrap') });

/** Card ids currently rendered, e.g. ['s:...', 'r:...']. */
const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

/**
 * Move one thumb of the sheet's budget slider. The prototype setter plus `input` is the React
 * escape; the `change` on top is what `useCommitOnRelease` commits on, so it must re-filter.
 */
async function setThumb(page, name, value) {
  await sheet(page).getByRole('slider', { name }).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  // Past the 120ms commit window, then let the filter memos settle.
  await page.waitForTimeout(400);
}

test.describe('Flatmates filter sheet', () => {
  test('draws its sections with the same chrome as the /listings sheet', async ({ page }) => {
    await withConsent(page);

    /* /listings first, as the reference: it proves the chrome contract is satisfiable, so a
       flatmates sheet that fails it has genuinely forked. */
    await openListingsFilters(page);
    const listings = await sectionShape(page);
    expect(listings.length).toBeGreaterThan(2);
    expect(listings.every((s) => s.icon && s.toggle && s.summary && s.chevron && s.body)).toBe(true);

    await openFlatmatesFilters(page);
    const flatmates = await sectionShape(page);
    expect(flatmates.length).toBeGreaterThan(2);
    expect(flatmates.every((s) => s.icon && s.toggle && s.summary && s.chevron && s.body)).toBe(true);
  });

  test('every untouched section reads "Any" rather than nothing at all', async ({ page }) => {
    await withConsent(page);
    await openFlatmatesFilters(page);

    /* A blank read-out is indistinguishable from one that failed to render. Also guards the i18n
       seam: `FilterGroup` is shared, so a page-scoped key would render as "listings.any". */
    const summaries = await sheet(page).locator('.fg-summary').allInnerTexts();
    expect(summaries.length).toBeGreaterThan(2);
    expect(summaries.every((s) => s.trim() === 'Any')).toBe(true);
    // "Any" is the absence of a filter, so none of them may wear the teal set-value tint.
    await expect(sheet(page).locator('.fg-summary.active')).toHaveCount(0);
  });

  test('a section collapses and reopens from its header', async ({ page }) => {
    await withConsent(page);
    await openFlatmatesFilters(page);

    const group = budgetGroup(page);
    const header = group.locator('button.fg-header');
    const slider = sheet(page).getByRole('slider', { name: /budget maximum/i });

    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(slider).toBeVisible();

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(group).toHaveClass(/collapsed/);

    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(slider).toBeVisible();
  });

  test('the budget header reports the range once one is chosen', async ({ page }) => {
    await withConsent(page);
    await openFlatmatesFilters(page);

    const summary = budgetGroup(page).locator('.fg-summary');
    await expect(summary).toHaveText('Any');

    await setThumb(page, /budget maximum/i, 12000);

    await expect(summary).not.toHaveText('Any');
    await expect(summary).toContainText('12,000');
    // Teal tint: the header has to look set, not merely read set.
    await expect(summary).toHaveClass(/active/);
  });

  test('the budget filter has a floor, and a post priced below it drops out', async ({ page }) => {
    /* Both posts are read off the live feed and asserted present at the default range first —
       otherwise `not.toContain` is satisfied by a card that never rendered. */
    const feed = await fetch(`${API}/flatmates/posts?size=100`).then((r) => r.json());
    const priced = feed.content
      .filter((p) => Number.isFinite(p.budget) && p.budget > 0 && p.budget <= 40000)
      .sort((a, b) => a.budget - b.budget);
    const cheap = priced[0];
    const dear = priced[priced.length - 1];
    expect(cheap, 'the seed has no priced seeker posts').toBeTruthy();
    // The slider steps in ₹1,000, so the floor has to land on a multiple of 1000 that sits
    // strictly above one post and at or below the other.
    const floor = Math.ceil((cheap.budget + 1) / 1000) * 1000;
    expect(dear.budget, 'the seed no longer spans a ₹1,000 budget gap').toBeGreaterThanOrEqual(floor);

    await withConsent(page);
    await page.goto('/flatmates?view=team-up', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 30_000 });

    const before = await cardIds(page);
    expect(before).toContain(`s:${cheap.id}`);
    expect(before).toContain(`s:${dear.id}`);

    await page.locator('.filter-fab').click();
    await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
    await setThumb(page, /budget minimum/i, floor);
    await page.getByRole('button', { name: /close filters/i }).click();

    const after = await cardIds(page);
    expect(after).not.toContain(`s:${cheap.id}`);
    expect(after).toContain(`s:${dear.id}`);
  });
});
