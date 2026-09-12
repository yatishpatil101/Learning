import { test, expect } from '../../fixtures/live.js';

/* Swipe-to-remove on /saved, and the undo window that makes it safe (D99).
 *
 * Behaviour verified from: pages/consumer/Saved.jsx (`SwipeCard`, `stageRemove`,
 * `undoRemove`, `UndoRow`, `UNDO_WINDOW_MS = 5000`), lib/useSwipeDismiss.js
 * (mobile-only, `THRESHOLD = 72`, axis 'x') and en/compare-saved.json
 * (`saved.removedTitle`, `saved.undo`, `saved.undoAria`).
 *
 * The point of the row is that the gesture is easy to fire by accident on a list
 * the user curated by hand, so the removal must not commit immediately — and the
 * escape hatch must not be gesture-only, or the people who cannot swipe get the
 * destructive half of the feature and none of the safety net. Both halves are
 * asserted here: that undo restores real state, and that the same window opens
 * from the keyboard-reachable button.
 */

/* Rahul's saved list is seeded server-side, so this spec reads the count rather than writing one.
   It used to seed `dzSavedProps:<mobile>` into localStorage, which is the *mock* store — against
   the API that key is written by nothing and read by nothing, so the seeding was a no-op and the
   list would have been empty.

   Two, not three: Rahul has three saved rows but /saved tabs by deal, and p5021 and p5023 are the
   two `buy` ones that share the default tab. The number has to be at least two for the assertions
   below to mean anything — "the other card is still there" needs another card. */
const SAVED_COUNT = 2;

// Dismiss the global cookie-consent dialog so it never overlays a card.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

/* What the *server* still holds, read the way a second tab would see it.

   The property under test is that the undo window stages rather than commits, and on the mock that
   could be checked by peeking at a localStorage array. There is no such array now, and reading the
   list through the same tab would tell us only what that tab is rendering. A second page in the
   same context carries the same session and fetches fresh, so it answers the question that actually
   matters: if the user opened Saved somewhere else right now, would the card still be there. */
async function savedOnServer(context) {
  const probe = await context.newPage();
  try {
    await probe.goto('/saved');
    const cards = probe.getByTestId('saved-card');
    await expect(cards.first()).toBeVisible({ timeout: 20000 });
    return await cards.count();
  } finally {
    await probe.close();
  }
}

/* Drag the card left past `THRESHOLD`. Deliberately a real pointer sequence rather
   than a synthetic event: `useSwipeDismiss` only arms on a genuine pointerdown that
   passes the phone media query, and takes pointer capture on the first qualifying
   move, so a dispatched event would prove nothing about the gesture users make.

   The grab point is clamped into the band between the sticky top bar and the bottom
   nav rather than taken as the card's midpoint. On a 360x640 phone a saved card is
   taller than that band, so its midpoint lands off-screen or under the fixed bar —
   `page.mouse` then delivers the pointerdown to the bar (or to nothing at all), the
   gesture never arms, and the card silently stays put. */
const TOP_BAR = 96;
const BOTTOM_NAV = 72;

async function swipeLeft(card) {
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  const { height: vh } = card.page().viewportSize();
  const top = Math.max(box.y, TOP_BAR);
  const bottom = Math.min(box.y + box.height, vh - BOTTOM_NAV);
  if (bottom - top < 24) throw new Error(`no grabbable strip on the card: ${top}..${bottom} in a ${vh}px viewport`);
  const y = (top + bottom) / 2;
  const from = box.x + box.width - 12;
  await card.page().mouse.move(from, y);
  await card.page().mouse.down();
  // Several steps: the hook ignores the first `SLOP` pixels, then tracks the drag.
  await card.page().mouse.move(from - 30, y, { steps: 4 });
  await card.page().mouse.move(from - 120, y, { steps: 8 });
  await card.page().mouse.up();
}

test.describe('Saved — swipe to remove, with undo', () => {
  test.beforeEach(async ({ page, login }) => {
    await login.asBuyer();
    await seedConsent(page);
  });

  test('a swipe stages the removal and undo puts the card back', async ({ page, context }) => {
    await page.goto('/saved');
    const cards = page.getByTestId('saved-card');
    await expect(cards).toHaveCount(SAVED_COUNT);

    await swipeLeft(cards.first());

    // The card is replaced by an undo row, not deleted: the store is untouched for
    // the whole window, which is what makes the undo a real restore and not a redraw.
    const undo = page.getByRole('button', { name: /Undo removing/i });
    await expect(undo).toBeVisible();
    await expect(cards).toHaveCount(SAVED_COUNT - 1);
    expect(await savedOnServer(context), 'nothing is written during the window').toBe(SAVED_COUNT);

    await undo.click();

    // Both cards are back and nothing was ever written.
    await expect(cards).toHaveCount(SAVED_COUNT);
    await expect(undo).toHaveCount(0);
    expect(await savedOnServer(context), 'undo leaves the server as it found it').toBe(SAVED_COUNT);
  });

  test('the undo control is announced, focused and names the card it undoes', async ({ page }) => {
    await page.goto('/saved');
    const cards = page.getByTestId('saved-card');
    await expect(cards).toHaveCount(SAVED_COUNT);

    // The card's own title, so the assertion below proves the accessible name is
    // specific rather than a bare "Undo".
    const title = (await page.locator('.property-card h3').first().innerText()).trim();

    await swipeLeft(cards.first());

    const undo = page.getByRole('button', { name: /Undo removing/i });
    await expect(undo).toBeVisible();

    // Announced: the placeholder is a live region, so a screen reader hears the
    // removal without the user having to go looking for it.
    await expect(page.locator('[role="status"]').filter({ has: undo })).toHaveCount(1);

    // Focused: the control that caused the removal unmounted with the card, so
    // without the move focus would fall to <body> and the escape hatch would be a
    // full document's worth of tabbing away — inside a five-second window.
    await expect(undo).toBeFocused();

    // Named: "Undo" alone does not say what is being undone. Matched on one word of
    // the card's title rather than the whole string — i18next escapes interpolated
    // values, so punctuation in a title is not byte-identical in the attribute.
    const token = (title.match(/[A-Za-z0-9]{3,}/) || [''])[0];
    await expect(undo).toHaveAttribute('aria-label', new RegExp(`^Undo removing\\b.*${token}`, 'i'));

    // Enter works because it is a real button, not a gesture target.
    await page.keyboard.press('Enter');
    await expect(cards).toHaveCount(SAVED_COUNT);
  });

  test('the keyboard remove button opens the same undo window as the swipe', async ({ page, context }) => {
    await page.goto('/saved');
    const cards = page.getByTestId('saved-card');
    await expect(cards).toHaveCount(SAVED_COUNT);

    // No gesture at all — the per-card trash button, which is what a keyboard or
    // switch user reaches. It must stage, not commit.
    await page.getByRole('button', { name: 'Remove from saved' }).first().click();

    const undo = page.getByRole('button', { name: /Undo removing/i });
    await expect(undo).toBeVisible();
    expect(await savedOnServer(context)).toBe(SAVED_COUNT);

    await undo.click();
    await expect(cards).toHaveCount(SAVED_COUNT);
    expect(await savedOnServer(context)).toBe(SAVED_COUNT);
  });
});
