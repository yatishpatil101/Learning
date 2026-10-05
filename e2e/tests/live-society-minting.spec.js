// @ts-check
// Community society minting; the catalogue assertions are made by a second, anonymous caller. Edge cases are in SocietyMintTest.
import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile } from '../helpers/liveAuth.js';

/**
 * A brand-new signed-in account, over HTTP.
 *
 * `signedInAsNew` wants a page; this spec never opens one. `uniqueMobile()` can repeat inside a
 * millisecond, so the retry is not paranoia — a collision here signs the test in as the *previous*
 * test's author and quietly turns an "a different person adds the same society" assertion into the
 * same person adding it twice.
 */
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
      data: { name, localityLabel: 'Wakad', localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 },
    });
    expect(res.status()).toBe(201);
    const minted = await res.json();
    expect(minted.name).toBe(name);
    expect(minted.source).toBe('community');
    // Unverified on arrival. A row somebody typed in must be distinguishable from one we imported,
    // or the hub cannot caption it honestly.
    expect(minted.verifiedAt).toBeNull();
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

  /**
   * The one assertion in this file that has to go through a browser.
   *
   * `mintOrigin` is what lets ops separate "somebody wants a flat in this building" from "somebody
   * is selling one" — the entire question the Society Finder exists to answer, and one no other
   * field on the row can reconstruct. `SocietyMintService` defaults an absent value to `listing`,
   * so a finder that forgets to send `demand` does not fail: it files every searcher's request on
   * the candidates queue as a listing, which is a confident wrong answer rather than a missing one.
   * That is precisely what was happening — no client sent the field at all.
   *
   * An API-level POST could only assert the server's default back at itself. Driving the real "Add
   * this society" button is the only way to prove the *page* sends it.
   */
  test('the Society Finder files its mint as searcher demand, not as a listing', async ({ page, request }) => {
    const mobile = await newAccount();
    await signedInAs(page, mobile);
    const name = freshName('Demand');

    await page.goto('/societies');
    const box = page.getByPlaceholder(/Search by society/i).first();
    await box.fill(name);
    // The button's accessible name is the whole "Can't find “<name>”? Add it and we'll alert you…"
    // block, so anchor on the query rather than on the word "Add".
    await page.getByRole('button', { name: new RegExp(`find .${name}`, 'i') }).click();

    // Read back from outside the browser: the row's provenance is the assertion, and it lives on
    // the server or nowhere.
    await expect.poll(async () => {
      const found = await request.get(`${API}/societies`, { params: { q: name, size: 20 } });
      return (await found.json()).content.find((s) => s.name === name)?.mintOrigin ?? null;
    }, { message: 'the finder mint never reached the catalogue, or reached it without a provenance' })
      .toBe('demand');
  });
});
