import { expect, test } from '../../fixtures/live.js';
import { signedInAsNew } from '../../helpers/liveAuth.js';

/** LIVE: follows must reach the server. The mock spec passes against a localStorage array, so this asserts
 * provenance: the request happened and the state surviving a reload came from the server, read and write. */

/** Responses are recorded rather than awaited with `waitForResponse`, which discards anything its predicate
 * rejects, so an unexpected status would surface as a bare timeout naming nothing. */
function watchApiCalls(page) {
  const calls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) calls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  return {
    calls,
    seen: (re) => calls.filter((c) => re.test(c)),
    describe: () => `API calls seen: ${calls.join(' | ') || 'none'}`,
  };
}

test.describe('LIVE — society follows', () => {
  test('a follow on the directory is written to the server and read back from it', async ({ page }) => {
    const { seen, describe } = watchApiCalls(page);
    await signedInAsNew(page);

    await page.goto('/societies');

    /* Located by its follow button, not name: any unfollowed society proves the same thing. */
    const loose = page.locator('.glass.rounded-2xl')
      .filter({ has: page.getByRole('button', { name: 'Follow', exact: true }) }).first();
    await expect(loose).toBeVisible({ timeout: 30000 });
    const name = (await loose.getByRole('link').first().innerText()).trim();

    /* Re-addressed by name before the click: "first card still offering Follow" stops matching the
       instant the click lands, so the original locator would then point at the *next* card. */
    const card = page.locator('.glass.rounded-2xl')
      .filter({ has: page.getByRole('link', { name, exact: true }) }).first();
    await card.getByRole('button', { name: 'Follow', exact: true }).click();

    // The badge is optimistic, so it is not evidence. The request is.
    await expect
      .poll(() => seen(/PUT \/api\/me\/societies\/[^/]+\/follow$/), { timeout: 20000, message: describe() })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^204 PUT \/api\/me\/societies\/[^/]+\/follow$/)]));

    /* A reload drops all in-memory state, so the badge can only return via `GET /me/societies/following`. */
    await page.reload();
    await expect
      .poll(() => seen(/GET \/api\/me\/societies\/following$/), { timeout: 20000, message: describe() })
      .toEqual(expect.arrayContaining(['200 GET /api/me/societies/following']));
    await expect(card.getByRole('button', { name: 'Following', exact: true })).toBeVisible({ timeout: 20000 });

    /* Two different surfaces, one server fact. The panel does not have a page of societies to read
       `followedByMe` from; this is the assertion that it and the directory agree. */
    await page.goto('/dashboard#alerts');
    await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible({ timeout: 30000 });

    // And the unfollow reaches the server too, rather than only clearing the browser's copy.
    await page.getByRole('button', { name: `Unfollow ${name}` }).click();
    await expect
      .poll(() => seen(/DELETE \/api\/me\/societies\/[^/]+\/follow$/), { timeout: 20000, message: describe() })
      .toEqual(expect.arrayContaining([expect.stringMatching(/^204 DELETE \/api\/me\/societies\/[^/]+\/follow$/)]));

    await page.goto('/societies');
    await expect(card.getByRole('button', { name: 'Follow', exact: true })).toBeVisible({ timeout: 30000 });
  });

  test('the follow list is a page envelope, not a bare array', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto('/dashboard');

    /* Paged because one user's taps are a rate, not a bound. Asserted on the wire: the envelope names the
       current page `page`, not Spring's `number`, which a provider fallback can hide. */
    const body = await page.evaluate(async () => {
      const tokens = JSON.parse(localStorage.getItem('draazyTokens') || sessionStorage.getItem('draazyTokens') || 'null');
      const res = await fetch('/api/me/societies/following?size=5', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      return { status: res.status, json: await res.json() };
    });

    expect(body.status).toBe(200);
    expect(body.json).toHaveProperty('page');
    expect(body.json).toHaveProperty('size');
    expect(body.json).toHaveProperty('totalElements');
    expect(Array.isArray(body.json.content)).toBe(true);
  });

  test('an anonymous visitor is not asked which societies they follow', async ({ page }) => {
    const { seen, describe } = watchApiCalls(page);

    await page.goto('/societies');
    await expect(page.getByRole('button', { name: 'Follow', exact: true }).first())
      .toBeVisible({ timeout: 30000 });

    /* The set is caller-scoped, so a signed-out request is a guaranteed 401 on every directory load: noise
       in the logs that hides real ones, and a round trip spent proving what the browser already knew. */
    expect(seen(/\/api\/me\/societies\/following$/), describe()).toEqual([]);
  });
});
