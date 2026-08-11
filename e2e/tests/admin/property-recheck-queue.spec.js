/**
 * Admin → Properties → Re-check Queue (Q14).
 *
 * The stays-live half of the re-moderation split: when an owner edits price, furnishing or
 * possession on an already-approved listing, the listing KEEPS earning and is queued for a human
 * to re-check instead of dropping out of search. That trade is only honest if the queue is
 * actually shown to somebody, so these tests assert the queue is reachable, states what changed,
 * states how long it has waited, and empties when the moderator acts.
 *
 * Every assertion here is unconditional. There is no `if (count > 0)` guard, deliberately: a
 * re-check queue that renders nothing would satisfy a guarded spec perfectly, and "the screen was
 * blank so the test passed" is the exact failure this file exists to rule out. The seed below
 * therefore *creates* the row it then insists on finding.
 */
import { test, expect } from '@playwright/test';
import { trackErrors } from '../../helpers/console.js';
import { appReady } from '../../helpers/app.js';

const BASE = 'http://localhost:5173';

const FIELDS = 'price, furnishing';
const WAITED_HOURS = 76; // > the 72h breach threshold, so the overdue styling is exercised too

/**
 * Queue a re-check on a real seeded listing.
 *
 * Mutates the DB in place rather than writing a listing of its own: a hand-rolled row would drift
 * from the shape the app actually stores, and the whole point is to prove the queue finds listings
 * the product produces. Navigating + `appReady` first is mandatory — the mock store seeds itself
 * from db.json asynchronously, and writing before that lands is overwritten a tick later.
 */
async function seedRecheck(page, { hoursAgo = WAITED_HOURS, fields = FIELDS } = {}) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await appReady(page);
  return page.evaluate(([h, f]) => {
    const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
    // Must be approved and un-archived: a queued re-check on anything else is a contradiction —
    // the listing would not be live, and the "stays live" bargain would not apply.
    const hit = db.listings.find((l) => l.status === 'approved' && !l.archived);
    hit.recheckPending = true;
    hit.recheckReason = f;
    hit.recheckRequestedAt = new Date(Date.now() - h * 3600000).toISOString();
    localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    return { id: hit.id, title: hit.title };
  }, [hoursAgo, fields]);
}

async function goToRecheckQueue(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
  await page.goto(`${BASE}/admin/properties`);
  await appReady(page);
  await page.getByRole('tab', { name: /Re-check Queue/ }).click();
  await page.waitForTimeout(400);
}

/** The card carrying a given listing title. */
const cardFor = (page, title) => page.locator('.list-card').filter({ hasText: title });

// ═══════════════════════════════════════════════════════
// ─── THE QUEUE IS REACHABLE AND POPULATED ───
// ═══════════════════════════════════════════════════════

test.describe('Re-check queue — visibility', () => {
  test('a queued re-check appears in the tab, which counts it', async ({ page }) => {
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);

    // The count in the tab label is the announcement: an admin who never opens this tab still sees
    // that something is waiting. A bare "Re-check Queue" would hide a backlog behind a click.
    await expect(page.getByRole('tab', { name: /Re-check Queue \(\d+\)/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('recheck-banner')).toContainText('still live');
    await expect(cardFor(page, seeded.title)).toBeVisible();
  });

  test('the row names the changed fields and how long it has waited', async ({ page }) => {
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);

    const card = cardFor(page, seeded.title);
    await expect(card.getByTestId('recheck-fields')).toHaveText(FIELDS);
    // 76h → "3d". Asserting the rendered span, not merely that a span exists: an age that silently
    // renders empty is indistinguishable from a drained queue.
    await expect(card.getByTestId('recheck-age')).toHaveText('waiting 3d');
    await expect(card.getByTestId('recheck-age')).toContainText('waiting');
  });

  test('the strip is visible on other tabs too, because the listing is still live there', async ({ page }) => {
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);
    await page.getByRole('tab', { name: 'All Listings' }).click();
    await page.waitForTimeout(400);
    // "All Listings" paginates, and the seeded row need not be on page one — search for it rather
    // than assume, or the assertion below would fail for a reason that has nothing to do with the
    // strip. (Searching is also the honest reproduction: this is how an admin would reach it.)
    await page.getByPlaceholder(/Search title, owner, locality/).first().fill(seeded.title);
    await page.waitForTimeout(400);

    // On "All Listings" this row looks like any other approved listing. Without the strip there is
    // no way to tell an un-reviewed price change from a verified one.
    await expect(cardFor(page, seeded.title).getByTestId('recheck-strip')).toBeVisible();
  });

  test('loads without JS errors', async ({ page }) => {
    const errors = trackErrors(page);
    await seedRecheck(page);
    await goToRecheckQueue(page);
    expect(errors).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════
// ─── DRAINING IT ───
// ═══════════════════════════════════════════════════════

test.describe('Re-check queue — moderator actions', () => {
  test('passing a re-check removes the row and leaves the listing live', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);

    await expect(cardFor(page, seeded.title)).toBeVisible();
    await cardFor(page, seeded.title).getByTestId('recheck-pass').click();

    // Gone from the queue…
    await expect(cardFor(page, seeded.title)).toHaveCount(0);
    // …and the queue is genuinely empty rather than merely re-rendered.
    await expect(page.getByText('No listings match your filters')).toBeVisible();

    // Still approved: "checked it, all fine" must not take the listing down. Reading the store
    // rather than the screen, because the distinction between "cleared" and "removed from search"
    // is invisible on a tab that shows neither.
    const after = await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      const l = db.listings.find((p) => p.id === id);
      return { status: l.status, pending: !!l.recheckPending, reason: l.recheckReason, at: l.recheckRequestedAt };
    }, seeded.id);
    expect(after.status).toBe('approved');
    expect(after.pending).toBe(false);
    expect(after.reason).toBe('');
    expect(after.at).toBe('');
  });

  test('failing a re-check takes the listing down with a reason', async ({ page }) => {
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);

    await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
    await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
    await page.getByLabel('Reason for rejection').fill('Price does not match the documents');
    await page.getByRole('button', { name: /Reject listing/i }).click();

    await expect(cardFor(page, seeded.title)).toHaveCount(0);
    const after = await page.evaluate((id) => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5'));
      const l = db.listings.find((p) => p.id === id);
      return { status: l.status, pending: !!l.recheckPending };
    }, seeded.id);
    expect(after.status).toBe('rejected');
    expect(after.pending).toBe(false);
  });

  test('a rejection reason is required', async ({ page }) => {
    const seeded = await seedRecheck(page);
    await goToRecheckQueue(page);

    await cardFor(page, seeded.title).getByTestId('recheck-fail').click();
    await page.getByRole('button', { name: /Reject listing/i }).click();

    // The listing must survive an empty-reason submit — a takedown with no recorded cause is
    // unappealable, and the owner is owed the reason.
    await expect(page.getByRole('heading', { name: /Re-check failed/i })).toBeVisible();
    const status = await page.evaluate((id) => JSON.parse(localStorage.getItem('puneNestDB_v5')).listings.find((p) => p.id === id).status, seeded.id);
    expect(status).toBe('approved');
  });
});
