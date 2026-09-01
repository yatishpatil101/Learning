import { test, expect } from '@playwright/test';

/* Filter sliders — manual entry beyond the visual max + honest open-top ceiling.

   Two coupled fixes are covered here:
   1. DualRange lets a user click a value label and type a number ABOVE the visual
      max (commercial rents routinely exceed a residential-friendly ceiling). The
      typed value is accepted, not clamped back to the max.
   2. The Listings matcher treats a slider parked at its default ceiling as
      "and above" (unbounded), so a listing priced above the ceiling is NOT
      silently hidden at the default range. Typing a concrete max below it hides it.

   Seed data guarantees rent listings above the ₹1,00,000 rent ceiling, all of them
   commercial: p5111 (Industrial / Factory, Hadapsar, ₹3,10,000/mo) is the dearest and
   is the one read here. Capping at ₹1,50,000 still leaves p5108 (₹95,000) and p5107
   (₹1,35,000), so the second assertion proves the cap excluded a listing rather than
   emptying the board.

   Assertions are scoped to the DESKTOP sidebar (same pattern as
   type-aware-filters.spec.js). */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const cards = (page) => page.locator('a[href^="/property/"]');
const rentMaxLabel = (page) => filters(page).getByRole('button', { name: /Monthly Rent maximum/ });
const rentMaxInput = (page) => filters(page).getByRole('textbox', { name: 'Monthly Rent maximum value' });

test('Monthly Rent max accepts a manually typed value above the visual ceiling', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent`);

  // Default label reads the ceiling with a "+" (and-above).
  await expect(rentMaxLabel(page)).toHaveText(/₹1,00,000\+/);

  // Click to edit, type a value well above the ₹1,00,000 visual max.
  await rentMaxLabel(page).click();
  const input = rentMaxInput(page);
  await input.fill('250000');
  await input.press('Enter');

  // The typed value is accepted verbatim (no "+", not clamped back to 1,00,000).
  await expect(rentMaxLabel(page)).toHaveText('₹2,50,000');
});

test('A rent listing above the ceiling shows at the default range and hides when capped below it', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&type=commercial`);
  await cards(page).first().waitFor({ timeout: 10000 });

  // Open-top default: the ₹3,10,000 factory is visible even though it exceeds the
  // ₹1,00,000 slider ceiling (the ceiling means "and above").
  const office = page.locator('a[href="/property/p5111"]');
  await expect(office).toBeVisible();

  // Type a concrete max BELOW the office rent — it must now be excluded.
  await rentMaxLabel(page).click();
  const input = rentMaxInput(page);
  await input.fill('150000');
  await input.press('Enter');

  await expect(office).toHaveCount(0);
  // Cheaper commercial rentals remain.
  await expect(cards(page).first()).toBeVisible();
});
