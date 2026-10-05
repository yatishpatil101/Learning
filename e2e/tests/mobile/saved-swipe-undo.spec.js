import { test, expect } from '../../fixtures/live.js';

// Rahul's saved list is seeded server-side, so this spec reads the count rather than writing one.
const SAVED_COUNT = 2;

async function openBuyTab(page) {
  await page.goto('/saved');
  await page.getByRole('button', { name: /^Buy\b/ }).click();
}

// Dismiss the global cookie-consent dialog so it never overlays a card.
async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
    localStorage.setItem('dz_draaz_nudge', '2');
  });
}

// What the *server* still holds, read the way a second tab would see it.
async function savedOnServer(context) {
  const probe = await context.newPage();
  try {
    await openBuyTab(probe);
    const cards = probe.getByTestId('saved-card');
    await expect(cards.first()).toBeVisible({ timeout: 20000 });
    return await cards.count();
  } finally {
    await probe.close();
  }
}

// Use real pointer input because `useSwipeDismiss` depends on pointer capture.
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
    await openBuyTab(page);
    const cards = page.getByTestId('saved-card');
    // Both cards are back and nothing was ever written.
    await expect(cards).toHaveCount(SAVED_COUNT);

    await swipeLeft(cards.first());

    // The card is replaced by an undo row, not deleted: the store is untouched for
    // the whole window, which is what makes the undo a real restore and not a redraw.
    const undo = page.getByRole('button', { name: /Undo removing/i });
    await expect(undo).toBeVisible();
    await expect(cards).toHaveCount(SAVED_COUNT - 1);
    expect(await savedOnServer(context), 'nothing is written during the window').toBe(SAVED_COUNT);

    await undo.click();

    await expect(cards).toHaveCount(SAVED_COUNT);
    await expect(undo).toHaveCount(0);
    expect(await savedOnServer(context), 'undo leaves the server as it found it').toBe(SAVED_COUNT);

    await test.step('the keyboard remove button opens the same undo window as the swipe', async () => {
      // No gesture at all — the per-card trash button, which is what a keyboard or
      // switch user reaches. It must stage, not commit.
      await page.getByRole('button', { name: 'Remove from saved' }).first().click();

      const staged = page.getByRole('button', { name: /Undo removing/i });
      await expect(staged).toBeVisible();
      expect(await savedOnServer(context)).toBe(SAVED_COUNT);

      await staged.click();
      await expect(cards).toHaveCount(SAVED_COUNT);
      expect(await savedOnServer(context)).toBe(SAVED_COUNT);
    });
  });

  test('the undo control is announced, focused and names the card it undoes', async ({ page }) => {
    await openBuyTab(page);
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

    // Move focus after card removal so undo is not a whole document of tabbing away.
    await expect(undo).toBeFocused();

    // Named: "Undo" alone does not say what is being undone.
    const token = (title.match(/[A-Za-z0-9]{3,}/) || [''])[0];
    await expect(undo).toHaveAttribute('aria-label', new RegExp(`^Undo removing\\b.*${token}`, 'i'));

    // Enter works because it is a real button, not a gesture target.
    await page.keyboard.press('Enter');
    await expect(cards).toHaveCount(SAVED_COUNT);
  });
});
