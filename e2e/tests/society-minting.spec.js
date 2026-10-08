// @ts-check
// Community society minting; the catalogue assertions are made by a second, anonymous caller. Edge cases are in SocietyMintTest.
import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile } from '../helpers/liveAuth.js';
import { isolatedPin, pickGoogleSociety } from '../helpers/places.js';

/** A new signed-in account over HTTP: `signedInAsNew` needs a page, and `uniqueMobile()` can repeat within a
 * millisecond, which would sign in as the previous test's author. */
async function newAccount() {
  for (let i = 0; i < 5; i += 1) {
    const mobile = uniqueMobile();
    try {
      await apiLogin(mobile, { api: API });
      return mobile;
    } catch {
      await new Promise((r) => setTimeout(r, 2));
    }
  }
  throw new Error('could not mint a fresh account');
}

/** A name nothing in the seed can collide with — the duplicate guard matches on the name. */
const freshName = (label) => `Zz Live ${label} ${Date.now().toString(36)}`;

test.describe('society minting', () => {
  test('a minted society reaches the catalogue for everybody else', async ({ request }) => {
    const mobile = await newAccount();
    const name = freshName('Mint');

    const res = await request.post(`${API}/societies`, {
      headers: await authHeaders(mobile),
      data: { name, placeId: `e2e-mint-${name}`.replace(/[^A-Za-z0-9_-]/g, '-'), localityLabel: 'Wakad', localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 },
    });
    expect(res.status()).toBe(201);
    const minted = await res.json();
    expect(minted.name).toBe(name);
    expect(minted.source).toBe('community');
    // Society responses carry no verification state.
    expect(minted).not.toHaveProperty('verifiedAt');
    expect(minted.localitySlug).toBe('wakad');

    // The assertion the old behaviour could never pass: a caller who is not the author, and is not
    // signed in at all, can open it.
    const anon = await request.get(`${API}/societies/${minted.slug}`);
    expect(anon.status()).toBe(200);
    expect((await anon.json()).name).toBe(name);

    // And find it by searching, which is how anybody other than the author would ever reach it.
    const found = await request.get(`${API}/societies`, { params: { q: name, size: 20 } });
    expect(found.status()).toBe(200);
    const slugs = (await found.json()).content.map((s) => s.slug);
    expect(slugs).toContain(minted.slug);
  });

  /** Needs a browser: `mintOrigin` separates "wants a flat here" from "selling one" and the server defaults an absent value to `listing`,
   * so a finder that forgets `demand` silently files demand as supply; only picking a Google suggestion proves the page sends it. */
  test('the Society Finder files its mint as searcher demand, not as a listing', async ({ page, request }) => {
    const mobile = await newAccount();
    await signedInAs(page, mobile);
    const name = freshName('Demand');

    await page.goto('/societies');
    await pickGoogleSociety(page, name, { keepsValue: false, keyboard: true, ...isolatedPin() });
    // Read back from outside the browser: the row's provenance is the assertion, and it lives on
    // the server or nowhere.
    await expect.poll(async () => {
      const found = await request.get(`${API}/societies`, { params: { q: name, size: 20 } });
      return (await found.json()).content.find((s) => s.name === name)?.mintOrigin ?? null;
    }, { message: 'the finder mint never reached the catalogue, or reached it without a provenance' })
      .toBe('demand');
  });
});
