import { test, expect } from '@playwright/test';

/* The predicate is EQUALITY, not `!= 'agent'`: a listing that never recorded who posted it is
   dropped rather than admitted, because a blank column cannot back a claim about the owner. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const countLine = (page) => page.locator('p:has-text("Showing")').first();

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so a one-shot
   read can catch the pre-filter paint and pass by luck. Always poll. */
const expectShowing = async (page, total) => {
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(new RegExp(`Showing ${total} propert`, 'i'));
};

const facetRequest = (page) => page.waitForRequest((r) => r.url().includes('/properties?'), { timeout: 15000 });

test('owner-only narrows a rent search, and sends the facet', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=rent&owneronly=1`);

  expect(new URL((await sent).url()).searchParams.get('postedByOwner')).toBe('true');

  /* 24 of the 26 approved rentals are the owner's own; p5163 and p5170 are an agent's. Pinning the
     total proves those two are the *only* exclusions. */
  await expectShowing(page, 24);

  /* Silence is excluded, not disclosed: if the predicate ever becomes a negation, the rows that
     state nothing come back and this count rises rather than a caveat appearing. */
  await expect(countLine(page)).not.toContainText(/state this/i);
});

test('owner-only narrows a buy search too, on the same key', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=buy&owneronly=1`);

  expect(new URL((await sent).url()).searchParams.get('postedByOwner')).toBe('true');
  // 30 of the 33 approved sales; p5147 and p5149 are a developer's, p5161 an agent's.
  await expectShowing(page, 30);
});

test('unticked asks nothing, rather than asking for a broker', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=rent`);

  // Absent rather than `postedByOwner=false`, which the server cannot distinguish from absent
  // anyway: the URL should not carry a parameter that changes nothing.
  expect(new URL((await sent).url()).searchParams.has('postedByOwner')).toBe(false);
  await expectShowing(page, 26);
});

test('the facet is honoured on both deals, and the chip clears it', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&owneronly=1`);
  await expectShowing(page, 24);

  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=buy&owneronly=1`);
  expect(new URL((await sent).url()).searchParams.get('postedByOwner')).toBe('true');
  await expectShowing(page, 30);

  // Addressed by its full accessible name, because the panel's own toggle carries the same visible
  // words as the chip-row remove control.
  await page.getByRole('button', { name: 'Remove filter Owner only' }).click();
  await expectShowing(page, 33);
  await expect.poll(() => new URL(page.url()).searchParams.has('owneronly')).toBe(false);
});

test('the toggle is on the panel for both deals', async ({ page }) => {
  for (const deal of ['rent', 'buy']) {
    await page.goto(`${BASE}/listings?deal=${deal}`);
    await page.getByRole('button', { name: /filters/i }).first().click().catch(() => {});
    await expect(page.getByRole('button', { name: /posted by/i }).first()).toBeVisible();
  }
});
