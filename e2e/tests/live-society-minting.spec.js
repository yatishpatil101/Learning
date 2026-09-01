// @ts-check
/**
 * Community society minting, live.
 *
 * Four screens invite somebody to add a society PuneNest does not have — the lister who cannot find
 * their building, the searcher who wants alerting when a flat comes up in it. Every one of those
 * mints wrote to the adding browser's `localStorage`, so the society existed for exactly one human
 * being: nobody else could find it, follow it or list a flat in it, which is the only reason anybody
 * adds one. Following it then 404'd against a server that had never heard of the slug, so the app
 * carries a special case that holds such follows locally and waits for ops to promote them — and
 * ops never could, because the "Candidates" queue read the *operator's* own browser and was
 * permanently empty. Not one member-added society had ever been confirmed.
 *
 * API-level rather than through the UI, because what is being proven is that the row reaches a
 * shared catalogue: the assertions that matter are made by a *second* caller, and an anonymous one.
 */
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

/** The candidate the seed leaves waiting on ops. */
const SEEDED_CANDIDATE = 'sunview-heights-wakad';

/** The seeded society ops already confirmed. */
const SEEDED_VERIFIED = 'greenfield-residency-baner';

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

  test('adding a society that already exists hands back the one that exists', async ({ request }) => {
    const author = await newAccount();
    const name = freshName('Dup');

    const first = await request.post(`${API}/societies`, {
      headers: await authHeaders(author),
      data: { name, localityLabel: 'Baner' },
    });
    expect(first.status()).toBe(201);
    const original = await first.json();

    // A different person, different spacing, different case — and no locality at all, which is the
    // case a slug-only guard waves straight through, because the slug folds the locality in.
    const other = await newAccount();
    const second = await request.post(`${API}/societies`, {
      headers: await authHeaders(other),
      data: { name: `  ${name.toUpperCase()}  ` },
    });
    // 200, not 201 and not an error: they asked for a society by name and there is one.
    expect(second.status()).toBe(200);
    expect((await second.json()).id).toBe(original.id);
  });

  test('a name that cannot become a web address is refused', async ({ request }) => {
    const mobile = await newAccount();
    const res = await request.post(`${API}/societies`, {
      headers: await authHeaders(mobile),
      data: { name: '!!! ???' },
    });
    // A society at `/society/` is one nobody — including its author — could ever open.
    expect(res.status()).toBe(422);
  });

  test('minting needs an account', async ({ request }) => {
    const res = await request.post(`${API}/societies`, { data: { name: freshName('Anon') } });
    expect(res.status()).toBe(401);
  });

  test('the ops queue holds candidates and nothing else', async ({ request }) => {
    const res = await request.get(`${API}/admin/society-candidates`, {
      headers: await authHeaders('9000000000'),
      params: { size: 100 },
    });
    expect(res.status()).toBe(200);
    const rows = (await res.json()).content;

    // Every row is a member-added society still waiting. An operator asked to confirm 320 MahaRERA
    // imports is an operator who stops reading the queue.
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.source).toBe('community');
      expect(row.verifiedAt).toBeNull();
    }

    const slugs = rows.map((s) => s.slug);
    expect(slugs).toContain(SEEDED_CANDIDATE);
    expect(slugs).not.toContain(SEEDED_VERIFIED);
  });

  test('the queue is staff-only', async ({ request }) => {
    const mobile = await newAccount();
    const res = await request.get(`${API}/admin/society-candidates`, {
      headers: await authHeaders(mobile),
    });
    expect(res.status()).toBe(403);
  });

  test('verifying stamps the society, dequeues it, and cannot be done twice', async ({ request }) => {
    // Mint a fresh one rather than verifying the seeded candidate: the seed is shared, and a spec
    // that consumes a fixture leaves the next run testing a different world.
    const author = await newAccount();
    const name = freshName('Verify');
    const created = await request.post(`${API}/societies`, {
      headers: await authHeaders(author),
      data: { name, localityLabel: 'Wakad' },
    });
    expect(created.status()).toBe(201);
    const { slug } = await created.json();

    const staff = await authHeaders('9000000000');
    const verified = await request.post(`${API}/admin/society-candidates/${slug}/verify`, {
      headers: staff,
    });
    expect(verified.status()).toBe(200);
    const row = await verified.json();
    expect(row.verifiedAt).not.toBeNull();
    // Confirming that a society exists is not a claim about its paperwork. The browser code this
    // replaces set both, which told every buyer reading the hub that its conveyance deed was done.
    expect(row.registration).toBe(false);
    expect(row.conveyance).toBe(false);

    const queue = await request.get(`${API}/admin/society-candidates`, {
      headers: staff,
      params: { size: 100 },
    });
    expect((await queue.json()).content.map((s) => s.slug)).not.toContain(slug);

    // The second operator clearing the same queue is told, rather than silently overwriting the
    // record of who verified it first — which is the only thing that says who to ask later.
    const again = await request.post(`${API}/admin/society-candidates/${slug}/verify`, {
      headers: staff,
    });
    expect(again.status()).toBe(409);
  });

  test('a MahaRERA society is not a candidate and cannot be verified', async ({ request }) => {
    const staff = await authHeaders('9000000000');
    const res = await request.post(`${API}/admin/society-candidates/aditya-shagun-kothrud/verify`, {
      headers: staff,
    });
    expect(res.status()).toBe(422);
  });

  test('verifying an unknown society is a 404', async ({ request }) => {
    const res = await request.post(
      `${API}/admin/society-candidates/no-such-society-${Date.now().toString(36)}/verify`,
      { headers: await authHeaders('9000000000') },
    );
    expect(res.status()).toBe(404);
  });

  test('an unrecognised locality is dropped rather than stored', async ({ request }) => {
    const mobile = await newAccount();
    const res = await request.post(`${API}/societies`, {
      headers: await authHeaders(mobile),
      data: { name: freshName('Nowhere'), localitySlug: 'atlantis-by-the-mula' },
    });
    // `locality_slug` is a foreign key. An invented area must not 500 a correctly-filled form —
    // an unplaced society is a state the schema already allows.
    expect(res.status()).toBe(201);
    expect((await res.json()).localitySlug).toBeNull();
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
