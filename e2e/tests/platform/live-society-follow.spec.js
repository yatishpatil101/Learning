import { expect, test } from '../../fixtures/live.js';
import { signedInAsNew } from '../../helpers/liveAuth.js';

/**
 * LIVE — society follows reach the server (D227).
 *
 * Following used to be `pnFollowedSocieties`, a localStorage array that five separate surfaces read
 * synchronously. The server's idempotent `PUT`/`DELETE` routes and its per-row `followedByMe` had
 * been shipped and had never been called once, so the follower count the hub renders — computed by
 * the server from `society_follows` — counted nobody.
 *
 * The mock spec at `consumer/society/follows` asserts the behaviour: five surfaces agree, a follow
 * survives, signing out clears it. Every one of those assertions passes against a localStorage
 * array, which is why they cannot be the whole test. This file asserts the **provenance**: the
 * request happened, and the state that survives a reload came back from the server rather than from
 * the browser that wrote it.
 *
 * `GET /me/societies/following` is the piece that had to be built. `followedByMe` on a page of
 * societies could have carried the directory alone, but the dashboard tile, the panel and the
 * finder ask "which ones do I follow?" with no page of societies to hang the question on. That is
 * why the five surfaces were ported together and why this spec checks the read as well as the write.
 */

/**
 * Record every API response the page receives, and return the log plus a filter over it.
 *
 * Recorded rather than awaited with `waitForResponse`: that has to be registered before the request
 * and silently discards anything its predicate rejects, so a response with an unexpected status is
 * indistinguishable from one that never came — both surface as a bare timeout naming neither.
 */
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

    /* A card offering to follow. Located by the button rather than by name because the seeded
       catalogue's first row is not a fixture anything else asserts on \u2014 any unfollowed society
       proves the same thing. */
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

    /* The read that did not exist. A reload throws away every scrap of in-memory state, so the only
       way the badge can come back is `GET /me/societies/following` \u2014 which is precisely the call
       that used to be a localStorage read, and precisely why following on a laptop did not follow
       on a phone. */
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

    /* One user's taps is a rate, not a bound (api-standards \u00a75.1), so the route is paged. Asserted
       on the wire because the envelope names the current page `page`, not Spring's raw `number`,
       and providers have read the wrong one behind a fallback that hid it. */
    const body = await page.evaluate(async () => {
      const tokens = JSON.parse(localStorage.getItem('puneNestTokens') || sessionStorage.getItem('puneNestTokens') || 'null');
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

    /* The set is caller-scoped, so there is nothing to ask for. A signed-out request would be a
       guaranteed 401 on every directory load — noise in the logs that hides the real ones, and a
       round trip spent proving what the browser already knew. */
    expect(seen(/\/api\/me\/societies\/following$/), describe()).toEqual([]);
  });
});
