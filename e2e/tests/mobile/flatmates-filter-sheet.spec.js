import { test, expect } from '@playwright/test';
import { API } from '../../helpers/liveAuth.js';

// Both browse sheets share FilterGroup, so each must satisfy the chrome contract.
async function withConsent(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
}

// Scope to the open drawer because the desktop filter grid stays in the DOM.
const sheet = (page) => page.locator('.filter-panel');

// Structural rather than pixel-based: a screenshot diff would fail on the section names, which are different by design.
const sectionShape = (page) =>
  sheet(page).locator('.filter-group').evaluateAll((groups) =>
    groups.map((g) => ({
      icon: !!g.querySelector('.fg-header svg'),
      toggle: !!g.querySelector('button.fg-header[aria-expanded]'),
      summary: !!g.querySelector('.fg-summary'),
      chevron: !!g.querySelector('.fg-chev'),
      body: !!g.querySelector('.fg-body .fg-body-inner'),
    })),
  );

// `.filter-fab` rather than role+name: the two accessible names differ and change once a filter is set.
async function openFilters(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const fab = page.locator('.filter-fab');
  await fab.waitFor({ state: 'visible', timeout: 30_000 });
  await fab.click();
  await expect(page.getByRole('button', { name: /close filters/i })).toBeVisible();
}

const openListingsFilters = (page) => openFilters(page, '/listings');
const openFlatmatesFilters = (page) => openFilters(page, '/flatmates');

// Found by its `.rng-wrap` control, not its header text, whose accessible name changes as the value does.
const budgetGroup = (page) =>
  sheet(page).locator('.filter-group', { has: page.locator('.rng-wrap') });

const cardIds = (page) =>
  page.locator('[data-sf-id]').evaluateAll((els) => els.map((e) => e.dataset.sfId));

// `change` is what `useCommitOnRelease` commits on, so it must re-filter.
async function setThumb(page, name, value) {
  await sheet(page).getByRole('slider', { name }).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForTimeout(400);
}

test.describe('Flatmates filter sheet', () => {
  test('draws its sections with the same chrome as the /listings sheet', async ({ page }) => {
    await withConsent(page);

    // `/listings` proves the chrome contract is satisfiable before flatmates is checked.
    await openListingsFilters(page);
    const listings = await sectionShape(page);
    expect(listings.length).toBeGreaterThan(2);
    expect(listings.every((s) => s.icon && s.toggle && s.summary && s.chevron && s.body)).toBe(true);

    await openFlatmatesFilters(page);
    const flatmates = await sectionShape(page);
    expect(flatmates.length).toBeGreaterThan(2);
    expect(flatmates.every((s) => s.icon && s.toggle && s.summary && s.chevron && s.body)).toBe(true);
  });

  test('the sheet reads Any when untouched, collapses, pins its actions, and reports and clears a budget', async ({ page }) => {
    await withConsent(page);
    await openFlatmatesFilters(page);

    await test.step('every untouched section reads "Any" rather than nothing at all', async () => {
      // Also guards the i18n seam: `FilterGroup` is shared, so a page-scoped key would render as "listings.any".
      const summaries = await sheet(page).locator('.fg-summary').allInnerTexts();
      expect(summaries.length).toBeGreaterThan(2);
      expect(summaries.every((s) => s.trim() === 'Any')).toBe(true);
      // "Any" is the absence of a filter, so none of them may wear the teal set-value tint.
      await expect(sheet(page).locator('.fg-summary.active')).toHaveCount(0);
    });

    await test.step('a section collapses and reopens from its header', async () => {
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

    const actions = page.getByTestId('filter-drawer-actions');
    const show = actions.getByRole('button', { name: /^(Show \d+ results?|No matches)$/ });

    await test.step('Clear and Show stay pinned while the sheet scrolls, as on /listings', async () => {
      await expect(actions.getByRole('button', { name: 'Clear', exact: true })).toBeInViewport();
      await expect(show).toBeInViewport();

      const body = sheet(page).locator('.filter-scroll');
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(sheet(page).locator('.sf-filter-sheet > *').last()).toBeInViewport();
      await expect(show).toBeInViewport();
    });

    const summary = budgetGroup(page).locator('.fg-summary');

    await test.step('the budget header reports the range once one is chosen', async () => {
      await expect(summary).toHaveText('Any');

      await setThumb(page, /budget maximum/i, 12000);

      await expect(summary).not.toHaveText('Any');
      await expect(summary).toContainText('12,000');
      // Teal tint: the header has to look set, not merely read set.
      await expect(summary).toHaveClass(/active/);
    });

    await test.step('Clear resets it and Show closes the sheet', async () => {
      await actions.getByRole('button', { name: 'Clear', exact: true }).click();
      await expect(summary).toHaveText('Any');

      await show.click();
      await expect(sheet(page)).not.toHaveClass(/open/);
    });
  });

  test('the budget filter has a floor, and a post priced below it drops out', async ({ page }) => {
    const feed = await fetch(`${API}/flatmates/feed?tab=team-up&size=100`).then((r) => r.json());
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

    await expect.poll(() => cardIds(page), { timeout: 15_000 }).not.toContain(`s:${cheap.id}`);
    expect(await cardIds(page)).toContain(`s:${dear.id}`);
  });

});
