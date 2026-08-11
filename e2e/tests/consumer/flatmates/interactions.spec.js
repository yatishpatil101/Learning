import { test, expect } from '@playwright/test';
import { approveFlatmates, switchToTeamUp, postAsSolo } from '../../../helpers/app.js';
import { trackErrors } from '../../../helpers/console.js';

/* Regression coverage for flatmates interaction bugs:
   1. A user's own live request must NOT also render as an interactable seeker card
      (own post was leaking into the grid via a broken reference-equality filter).
   2. The room "Message owner" button must flip to a sent state (room interest used
      to call the flatmate handler with the wrong argument shape and silently no-op).
   3. The report (flag) button on room and group cards opens the shared platform
      Report modal and a submitted report shows a confirmation toast.
   4. The sort control is the shared Select pill and actually reorders posts. */

const BASE = 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile: m, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  }, mobile);
}

test('own live request is not listed as an interactable seeker card', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Post request/i }).click();

  /* Approve it (D72 holds a new post for review). This test is about the own-post
     filter, and a pending post is hidden from the grid for a different reason —
     without the approval it would pass without exercising the filter at all. */
  await approveFlatmates(page, 'posts');
  await switchToTeamUp(page);
  await expect(page.getByText('Your live request')).toBeVisible({ timeout: 10000 });
  // The banner shows our name, but no grid card (.sf-card) should.
  await expect(page.locator('.sf-card', { hasText: 'Share Tester' })).toHaveCount(0);
});

test('room "Message owner" flips to a sent state', async ({ page }) => {
  const errors = trackErrors(page);
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);

  const msgBtn = page.getByRole('button', { name: /Message owner/i }).first();
  await msgBtn.waitFor({ state: 'visible', timeout: 10000 });
  await msgBtn.click();

  await expect(page.getByRole('button', { name: /Interest sent/i }).first()).toBeVisible({ timeout: 5000 });
  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('reporting a room opens the shared Report modal and confirms', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);

  const flag = page.locator('.report-btn').first();
  await flag.waitFor({ state: 'visible', timeout: 10000 });
  await flag.click();

  // The shared platform ReportModal (also used on property pages) opens.
  await expect(page.getByRole('dialog', { name: /Report this post/i })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /Spam or duplicate post/i }).click();
  await page.getByRole('button', { name: /Submit report/i }).click();
  await expect(page.getByText(/our team will review this post/i)).toBeVisible({ timeout: 5000 });
});

test('reporting a group opens the shared Report modal and confirms', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=groups`);

  const flag = page.locator('.report-btn').first();
  await flag.waitFor({ state: 'visible', timeout: 10000 });
  await flag.click();

  await expect(page.getByRole('dialog', { name: /Report this post/i })).toBeVisible({ timeout: 5000 });
  await page.getByRole('button', { name: /Inappropriate or offensive content/i }).click();
  await page.getByRole('button', { name: /Submit report/i }).click();
  await expect(page.getByText(/our team will review this post/i)).toBeVisible({ timeout: 5000 });
});

test('sort pill reorders rooms by budget low-to-high', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);

  // The standard Select sort pill (same component as the listings page).
  const sortPill = page.getByRole('button', { name: 'Sort posts' });
  await sortPill.waitFor({ state: 'visible', timeout: 10000 });
  await sortPill.click();
  await page.getByRole('option', { name: 'Budget: Low to High' }).click();
  await expect(sortPill).toContainText('Budget: Low to High');

  // Read the "Your share / mo" figures off the cards in DOM order; they must be
  // non-decreasing once sorted ascending.
  const prices = await page.locator('.sf-card .gradient-text').allInnerTexts();
  const nums = prices.map((t) => parseInt(t.replace(/[^0-9]/g, ''), 10)).filter((n) => !Number.isNaN(n));
  expect(nums.length).toBeGreaterThan(1);
  const sorted = [...nums].sort((a, b) => a - b);
  expect(nums).toEqual(sorted);
});

test('posting a request surfaces match pills on other flatmate cards', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  // Budget + locality that overlap seeded Baner seekers, so the band model scores a match.
  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Post request/i }).click();

  await approveFlatmates(page, 'posts'); // held for review by D72; match scoring is the subject here
  await switchToTeamUp(page);
  await expect(page.getByText('Your live request')).toBeVisible({ timeout: 10000 });
  // At least one other card now carries a match pill tied to the posted request.
  const pill = page.locator('.sf-match').first();
  await expect(pill).toBeVisible({ timeout: 5000 });
  await expect(pill).toContainText(/match/i);
});

test('empty state offers a way to act and to clear filters', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });

  // Narrow to nothing via the live search box.
  await page.getByPlaceholder(/Try: girl in baner/i).fill('zzznotarealmatch');
  await expect(page.locator('.sf-card')).toHaveCount(0);

  // The empty state is actionable, not a dead end. Its CTA is now the same unified
  // "Post" that the toolbar carries — the per-tab post buttons were removed.
  await expect(page.getByRole('button', { name: /^Post$/ }).first()).toBeVisible();
  const clear = page.getByRole('button', { name: /Clear filters/i });
  await expect(clear).toBeVisible();
  await clear.click();

  // Clearing brings the flatmates back.
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 5000 });
});

test('duplicate-post guard routes a returning poster to edit their live request', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Post request/i }).click();
  await approveFlatmates(page, 'posts'); // held for review by D72; the duplicate guard is the subject here
  await switchToTeamUp(page);
  await expect(page.getByText('Your live request')).toBeVisible({ timeout: 10000 });

  // Trying to start a brand-new post while one is already live must not create a
  // duplicate — it should open the existing request in edit mode, with a nudge.
  // The guard lives in openPostModal(), which is reached via the chooser's
  // "still looking → just me" branch, not by the Post button alone.
  await postAsSolo(page);
  await expect(page.getByText(/already have a live request/i)).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: /Update request/i })).toBeVisible({ timeout: 5000 });
  await expect(page.locator('input[placeholder="₹ e.g. 15000"]')).toHaveValue('16000');
});

test('mobile filter drawer holds the filter controls behind a Filters button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 10000 });

  // On mobile the filter strip collapses behind a single Filters trigger.
  const openBtn = page.getByRole('button', { name: 'Open filters' });
  await expect(openBtn).toBeVisible();
  await expect(page.locator('.filter-panel')).not.toHaveClass(/open/);

  await openBtn.click();
  await expect(page.locator('.filter-panel')).toHaveClass(/open/);

  // The sort control lives inside the drawer on mobile and still works.
  const sortPill = page.getByRole('button', { name: 'Sort posts' });
  await sortPill.click();
  await page.getByRole('option', { name: 'Budget: Low to High' }).click();
  await expect(sortPill).toContainText('Budget: Low to High');

  await page.getByRole('button', { name: 'Show results' }).click();
  await expect(page.locator('.filter-panel')).not.toHaveClass(/open/);
});
