import { test, expect } from '@playwright/test';

/* The fee claim holds always; the deal-direct claim only when the owner posted. Both directions are
 * asserted — withdrawing the claim everywhere deletes the brand promise. */

const AGENT_RENT = 'p5170'; // 4 BHK Villa in Bavdhan (rent), re-attributed to an agent by the seed
const OWNER_RENT = 'p5000'; // approved rent listing that the owner posted themselves

const DIRECT = /deal direct|directly with (the )?owner/i;

async function bodyText(page, slug) {
  await page.goto(`/property/${slug}`, { waitUntil: 'networkidle' });
  await page.locator('.tag-strip').first().waitFor({ state: 'visible', timeout: 15000 });
  // Read-more prose and the owner card both sit behind reveal animations that never fire headless.
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in')
    .forEach((el) => el.classList.add('visible')));
  return page.locator('body').innerText();
}

test("an agent's listing keeps the fee promise and drops the deal-direct one", async ({ page }) => {
  const text = await bodyText(page, AGENT_RENT);

  expect(text).toMatch(/zero brokerage|no brokerage/i);
  expect(text).not.toMatch(DIRECT);
});

test("an owner's listing still makes the full claim", async ({ page }) => {
  const text = await bodyText(page, OWNER_RENT);

  expect(text).toMatch(DIRECT);
});
