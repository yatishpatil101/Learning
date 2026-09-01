import { test, expect } from '@playwright/test';
import { pickDate } from '../../../helpers/datePicker.helper.js';

/* Tab-aware filter controls: a filter must only appear on the tab it actually
   narrows, because a control that silently does nothing erodes trust.

   Rewritten for the two-tab intent model (see flatmates/model.js). The page no
   longer splits by supply record type (Flatmates / Rooms / Groups) but by the
   seeker's question — "is there an address yet?" — so the contract guarded here
   is now stated in those terms:

     Move-in  — BOTH tabs. A room has an available-from date and so does a
                seeker, so the filter narrows either feed.
     Sharing  — Team up only. Flat size is a question about people.
     Washroom — Move in now only. An attached bathroom is a question about a place.

   The previous version asserted the old three-tab contract. Because legacy
   `?view=rooms|groups|flatmates` still resolve as *aliases*, those specs kept
   loading a real page and then asserting against the wrong tab — a silent-wrong
   failure rather than a 404. Alias resolution itself is covered in
   flatmates-discovery.spec.js; this file drives the tabs through the UI. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const visibleLabel = (page, text) => page.locator('label:visible', { hasText: text });
const MOVE_IN_TAB = /Move in now/i;
const TEAM_UP_TAB = /Team up/i;

/* The desktop advanced-filter grid is collapsed by default — 308px of always-open
   controls put the first result card at y=881 on a 1440x820 laptop, i.e. a search
   page showing no stock. Every test here is about which controls the grid holds,
   so each one opens it first. It stays open once toggled, and is already open
   whenever a filter is active, so a user never hides their own narrowing. */
const openFilters = async (page) => {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
};

/** Land on /flatmates, switch tab the way a user would, and reveal the filters. */
const openTab = async (page, name) => {
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
};

test('Move in now shows Move-in and hides the people-only Sharing filter', async ({ page }) => {
  await openTab(page, MOVE_IN_TAB);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
});

test('Team up shows Sharing alongside Move-in', async ({ page }) => {
  await openTab(page, TEAM_UP_TAB);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);
  // Move-in is deliberately NOT tab-specific — a seeker states a date too.
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
});

test('switching Team up to Move in now drops the people-only Sharing filter', async ({ page }) => {
  await openTab(page, TEAM_UP_TAB);
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(1);

  await page.getByRole('button', { name: MOVE_IN_TAB }).first().click();
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  // Sharing is a people question, so it leaves with the people tab; Move-in stays.
  // The panel stays open across a tab switch — asserted implicitly by these counts.
  await expect(visibleLabel(page, 'Sharing')).toHaveCount(0);
  await expect(visibleLabel(page, 'Move-in')).toHaveCount(1);
});

/* Lifestyle is a cross-tab filter driven by the `tags` field — the real
   flatmate dealbreakers (non-smoker, veg, pet-friendly). It must be present on
   every tab and actually narrow the result set. */
test('Lifestyle filter appears on both tabs', async ({ page }) => {
  for (const tab of [MOVE_IN_TAB, TEAM_UP_TAB]) {
    await openTab(page, tab);
    await expect(visibleLabel(page, 'Lifestyle')).toHaveCount(1);
  }
});

test('selecting a Lifestyle habit narrows the results', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
  const before = await page.locator('.sf-card').count();

  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  /* Filtering is synchronous, so the card list is rebuilt in the same React commit as the
     `aria-pressed` flip above -- but `.count()` does not retry, so the shrink is asserted with a
     retrying matcher first and only then read as a number for the sharper claims below. */
  await expect(page.locator('.sf-card')).not.toHaveCount(before);
  const after = await page.locator('.sf-card').count();

  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

/* Move-in is a two-value control: an "Immediate" chip and a "By date" calendar
   picker (no dropdown). "Immediate" shows only now-available posts; picking a
   date widens that to everything available on or before it. */
test('Move-in "Immediate" chip shows only immediately-available posts', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);
  const before = await page.locator('.sf-card').count();

  const immediate = page.getByRole('button', { name: 'Immediate', exact: true });
  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sf-card')).not.toHaveCount(before);
  const after = await page.locator('.sf-card').count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);

  // Toggling it off restores the full set.
  await immediate.click();
  await expect(immediate).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sf-card')).toHaveCount(before);
});

test('Move-in "By date" widens results beyond Immediate', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  await openFilters(page);

  await page.getByRole('button', { name: 'Immediate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const immediateCount = await page.locator('.sf-card').count();

  // A date ~20 days out includes now + within-15-day posts, so the set grows.
  const d = new Date();
  d.setDate(d.getDate() + 20);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await pickDate(page, '[aria-label="Move-in by date"]:visible', iso);
  /* Picking a date releases the Immediate chip -- an assertion the test already makes further down.
     Hoisting it here is what makes the non-retrying `.count()` on the next line safe. */
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'false');

  const dateCount = await page.locator('.sf-card').count();
  expect(dateCount).toBeGreaterThan(immediateCount);
  // Selecting a date releases the Immediate chip (mutually exclusive).
  await expect(page.getByRole('button', { name: 'Immediate', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

/* The collapse itself. Two properties matter and they pull against each other:
   a plain visitor must see stock without scrolling, and nobody must ever have a
   narrowed list with the reason for it hidden. */
test('the desktop filter panel starts collapsed so inventory clears the fold', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await expect(page.getByRole('button', { name: /^Filters/ })).toHaveAttribute('aria-expanded', 'false');

  /* The regression this guards: the grid used to sit permanently open, putting
     the first card at y=881 on a 1440x820 laptop — a search page showing no
     stock at all. Measured 881 -> 521. Asserted against the viewport rather than
     a fixed number so a longer Hindi/Marathi hero cannot silently reintroduce it. */
  const card = await page.locator('.sf-card').first().boundingBox();
  expect(card.y, `first result card must peek above the fold (y=${Math.round(card.y)}, viewport=820)`).toBeLessThan(820);
});

test('a narrowing deep link opens the panel, so the filter is never hidden', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 820 });
  // ?loc= is read by useFlatmateDiscovery's initFromUrl, so this lands filtered.
  await page.goto(`${BASE}/flatmates?loc=Baner`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  const toggle = page.getByRole('button', { name: /^Filters/ });
  await expect(toggle, 'a pre-applied filter must reveal itself').toHaveAttribute('aria-expanded', 'true');
  // ...and says how many are on, so the narrowing is legible at a glance.
  await expect(toggle).toContainText('1');
  await expect(visibleLabel(page, 'Locality')).toHaveCount(1);
});

