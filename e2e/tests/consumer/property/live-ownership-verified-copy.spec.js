import { test, expect } from '@playwright/test';

/* D190 — the Ownership Verified card must describe the check PuneNest actually performs.
 *
 * The buy-side copy used to read "Matched against the Index II registration record for this
 * property", which claimed a search of the land registry. Nothing in the product has ever done
 * that: ops accept documents an owner supplies — a registration record, a tax receipt, the owner's
 * government ID and photographs of the site — and record what they sighted. On a page where a
 * buyer is deciding whether to pay an advance, the difference between "we read your deed" and "we
 * searched the registry" is the difference between a check and a guarantee.
 *
 * So this asserts both halves: the honest description is shown, and the registry claim is gone.
 * A copy revert would pass a "badge renders" test and fail this one, which is the point. */

const VERIFIED_SALE = 'p5013';   // 1 BHK Flat in Baner (buy), approved, ownership_verified = true
const UNVERIFIED_SALE = 'p5008'; // 2 BHK Penthouse in Baner (buy), approved, ownership_verified = false

async function verificationTabText(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab').first().waitFor({ state: 'visible', timeout: 15000 });

  const tabs = page.getByRole('tab');
  for (let i = 0; i < await tabs.count(); i++) {
    await tabs.nth(i).click();
    /* The read below goes through `innerText()`, which does not retry, so this wait is load-bearing.
       The tab reporting itself selected is the panel swap it was really waiting for. */
    await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in')
      .forEach((el) => el.classList.add('visible')));
    const text = await page.locator('body').innerText();
    if (/trust score/i.test(text)) return text;
  }
  throw new Error(`Verification section never rendered for ${id}`);
}

test('the ownership check is described as a document check, not a registry search', async ({ page }) => {
  const text = await verificationTabText(page, VERIFIED_SALE);

  expect(text).toMatch(/ownership documents/i);
  expect(text).toMatch(/government id/i);
  expect(text).toMatch(/verify the title independently/i);

  // The overpromise, in both the wording and the specific claim it made.
  expect(text).not.toMatch(/matched against the index ii registration record/i);
  expect(text).not.toMatch(/registration record for this property/i);
});

test('an unverified listing says so rather than borrowing the verified copy', async ({ page }) => {
  const text = await verificationTabText(page, UNVERIFIED_SALE);

  expect(text).toMatch(/pending verification/i);
  expect(text).not.toMatch(/verify the title independently/i);
});
