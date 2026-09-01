/**
 * Live coverage for the admin content API — the seam behind the CMS console.
 *
 * The console at `/admin/content` used to read and write `localStorage` through `mockApi`, with
 * field names that were its own invention: banners had a `sub`, a `cta` and a `theme`; FAQs used
 * `q` / `a` / `cat`; announcements had an `audience`. None of those exist server-side. Flipping the
 * page onto `adminContentService` means the editor now speaks the API's vocabulary, and these tests
 * pin the parts of that vocabulary the page depends on.
 *
 * What is worth asserting here rather than in the backend suite: the backend already has
 * `AdminContentEndpointsTest` covering every type's lifecycle against MockMvc inside a rolled-back
 * transaction. What it cannot cover is the running server — that the routes are actually mapped
 * where the frontend thinks they are, that the role gate holds against a real token, and that a
 * created row survives the commit and comes back on the next request. That is what this adds.
 *
 * These tests write real rows and do not clean up. That is deliberate and matches
 * `live-demand-signals.spec.js`: the CMS tables seed empty, the rows are archived at the end so no
 * public surface renders them, and a leftover row makes a failure diagnosable afterwards. Every
 * assertion is a delta or a lookup by this run's own id, never a count of the whole table.
 *
 * ## The split with `tests/admin/live-content-desk.spec.js`
 *
 * This file owns the seam and the two Reviews-tab console decisions below. Its sibling owns the
 * desk around them — the four-tab shell, the banners counter, the FAQs tab, the create form and the
 * route guards — which had no live coverage until `admin/content.spec.js` was converted. Neither
 * re-asserts the other; the sibling's header states the division from its side.
 *
 * Fixtures: ACTORS.admin (9000000000), ACTORS.buyer (9700000001).
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** Stamped into every row this file creates, so a leftover is traceable to a run. */
const RUN = `live-cms-${Date.now()}`;

test.describe('admin content API', () => {
  test('a banner round-trips through create, patch, archive and restore', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    const created = await request.post(`${API}/admin/content/banners`, {
      headers,
      data: { image: `https://cdn.example/${RUN}.png`, headline: RUN, link: '/listings', position: 7 },
    });
    expect(created.status()).toBe(201);
    const banner = await created.json();
    expect(banner.id).toBeTruthy();
    expect(banner.type).toBe('banners');
    expect(banner.archived).toBe(false);
    expect(banner.headline).toBe(RUN);
    expect(banner.position).toBe(7);

    // PATCH is a merge: the fields we do not send must survive. The console relies on this — its
    // edit modal posts the whole form back, but its Active toggle sends one field on its own.
    const patched = await request.patch(`${API}/admin/content/banners/${banner.id}`, {
      headers,
      data: { position: 2 },
    });
    expect(patched.status()).toBe(200);
    const after = await patched.json();
    expect(after.position).toBe(2);
    expect(after.headline).toBe(RUN);
    expect(after.image).toBe(banner.image);

    // The list the console reads includes archived rows — that is what its Archived tab shows.
    const archived = await request.post(`${API}/admin/content/banners/${banner.id}/archive`, { headers });
    expect(archived.status()).toBe(200);
    expect((await archived.json()).archived).toBe(true);

    const list = await request.get(`${API}/admin/content/banners`, { headers });
    expect(list.status()).toBe(200);
    const rows = await list.json();
    const mine = rows.find((r) => r.id === banner.id);
    expect(mine, 'the archived row is still on the ops list').toBeTruthy();
    expect(mine.archived).toBe(true);

    const restored = await request.post(`${API}/admin/content/banners/${banner.id}/restore`, { headers });
    expect(restored.status()).toBe(200);
    expect((await restored.json()).archived).toBe(false);

    // Leave the shelf tidy: a live banner would render on the consumer home page.
    await request.post(`${API}/admin/content/banners/${banner.id}/archive`, { headers });
  });

  test('an announcement severity outside the column constraint is a 400, not a 500', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    // `critical` is what ContentItemWrite used to advertise; the announcements_severity_check
    // constraint has never accepted it. Before the fix this reached the column and blew up.
    const bad = await request.post(`${API}/admin/content/announcements`, {
      headers,
      data: { title: `${RUN} bad`, severity: 'critical' },
    });
    expect(bad.status()).toBe(400);

    const good = await request.post(`${API}/admin/content/announcements`, {
      headers,
      data: { title: `${RUN} ok`, body: 'Scheduled maintenance', severity: 'success', active: true },
    });
    expect(good.status()).toBe(201);
    const ann = await good.json();
    expect(ann.severity).toBe('success');
    expect(ann.active).toBe(true);

    // The patch path is guarded too — a create-only check would be half a guard.
    const badPatch = await request.patch(`${API}/admin/content/announcements/${ann.id}`, {
      headers,
      data: { severity: 'critical' },
    });
    expect(badPatch.status()).toBe(400);

    await request.post(`${API}/admin/content/announcements/${ann.id}/archive`, { headers });
  });

  test('each type refuses to be created without its one required field', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    for (const type of ['announcements', 'services', 'faqs', 'banners']) {
      const res = await request.post(`${API}/admin/content/${type}`, { headers, data: {} });
      expect(res.status(), `${type} with an empty body`).toBe(400);
    }
  });

  test('an unknown type is a 404 rather than falling through to some other table', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const res = await request.get(`${API}/admin/content/testimonials`, { headers });
    expect(res.status()).toBe(404);
  });

  test('authoring is closed to signed-in consumers and to the public', async ({ request }) => {
    const buyer = await authHeaders(ACTORS.buyer, { request });
    const asBuyer = await request.get(`${API}/admin/content/faqs`, { headers: buyer });
    expect([401, 403]).toContain(asBuyer.status());

    const anon = await request.get(`${API}/admin/content/faqs`);
    expect([401, 403]).toContain(anon.status());
  });
});

/**
 * Review moderation — the fourth tab on the same console, and the last thing on it that was still
 * browser-side.
 *
 * Reviews are not a CMS type: nobody on staff writes one, and the only decision the console makes
 * about a review is whether it stays up. So it does not go through `/admin/content/{type}` at all —
 * it is `GET /admin/reviews` and `PATCH /reviews/{id}/status`, a different pair of routes with a
 * different shape, which is why it gets its own describe rather than a fifth case above.
 *
 * ## Why a page test and not only an API one
 *
 * The API half already has `ReviewModerationEndpointsTest`. What could not be tested until now is
 * that the *console* asks for it: the tab read `db.reviews` out of `localStorage`, so on a live
 * build it rendered a hand-seeded list that had nothing to do with the reviews real users had
 * written, and approving one wrote to the browser. It looked completely normal. That is the failure
 * this file exists to make impossible, and only a page test can see it.
 *
 * ## Archive and Restore are asserted absent
 *
 * They were deleted with the browser store. `archived` was a flag localStorage invented; against
 * the live table it would have been a second, weaker "taken down" that the rating aggregate does
 * not honour — a review hidden from this table while still pulling the society's average down. The
 * absence assertion is what stops it drifting back, and it is paired with a positive one so it
 * cannot pass because the tab failed to render at all.
 *
 * Fixtures: ACTORS.admin, ACTORS.buyer. The seeded queue has exactly one row; the test creates its
 * own rather than depending on that.
 */
test.describe('admin review moderation', () => {
  test('the queue is served by GET /admin/reviews and carries the status no public read does', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    const res = await request.get(`${API}/admin/reviews`, { headers, params: { size: 50 } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.content)).toBe(true);
    expect(body.totalElements).toBeGreaterThan(0);

    /* `status` is present here and nowhere else. Every public review read filters on
       `status = 'published'`, so publishing it there would add a field whose value is a constant —
       and a constant field invites a client to branch on something that can never vary. */
    for (const r of body.content) {
      expect(r.status, `review ${r.id}`).toBeTruthy();
      expect(r.targetType).toBeTruthy();
      expect(r.targetId).toBeTruthy();
    }

    const [sample] = body.content;
    const publicRead = await request.get(
      `${API}/properties/${sample.targetId}/reviews`,
    );
    if (publicRead.ok() && sample.targetType === 'property') {
      const rows = await publicRead.json();
      const mirrored = rows.find((r) => r.id === sample.id);
      if (mirrored) expect(mirrored.status).toBeUndefined();
    }
  });

  test('the queue is closed to consumers and to the public', async ({ request }) => {
    const buyer = await authHeaders(ACTORS.buyer, { request });
    expect([401, 403]).toContain((await request.get(`${API}/admin/reviews`, { headers: buyer })).status());
    expect([401, 403]).toContain((await request.get(`${API}/admin/reviews`)).status());
  });

  test('pending is an intake state, not a verdict the route will accept', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const body = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 1 } })).json();
    const [row] = body.content;
    expect(row).toBeTruthy();

    /* There is no route back to "undecided" once a human has looked, and the refusal is the
       server's rather than the console's — the two buttons are the whole vocabulary because the
       API's is. */
    const res = await request.patch(`${API}/reviews/${row.id}/status`, {
      headers,
      data: { status: 'pending' },
    });
    expect(res.status()).toBe(400);
  });

  test('the console reads the live queue, and Archive is gone rather than hidden', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    /* A page rather than `size: 1`, and a search rather than `[0]`. `author` is legitimately
       nullable - `ReviewService.nameOf` returns null for a review whose author id is null, and
       `ReviewResponse` is NON_NULL, so the field is simply absent on an authorless row. Pinning the
       newest row of a queue this whole suite writes to therefore crashed here rather than failing:
       `getByText(undefined)` throws inside Playwright's locator builder. What this test needs is
       any row that carries the field it is about to assert on. Ten, because the table paginates at
       ten and a row further down would not be on the page the assertions look at. */
    const body = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 10 } })).json();
    const row = body.content.find((r) => r.author && r.targetType && r.targetId);
    expect(row, 'the e2e seed must contain at least one review with a named author').toBeTruthy();

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/content?tab=reviews');
    await appReady(page);

    await expect(page.getByText('Moderate user reviews')).toBeVisible();

    /* The author name is the proof the row came from the server. The old tab rendered `db.reviews`,
       whose names are fixture inventions — so naming *this* run's author is what distinguishes a
       live read from a localStorage one that happens to look plausible. */
    const table = page.getByRole('table');
    await expect(table.getByText(row.author, { exact: true }).first()).toBeVisible();

    // And the target, which the mapper composes from `targetType` + `targetId`. A moderator who
    // cannot see what is being reviewed cannot judge whether the review is fair.
    await expect(table.getByText(`${row.targetType[0].toUpperCase()}${row.targetType.slice(1)}: ${row.targetId}`, { exact: true }).first()).toBeVisible();

    /* The positive that makes the negative meaningful: the actions column rendered. A row whose
       decision buttons were missing would satisfy `toHaveCount(0)` on Archive for the wrong
       reason. */
    await expect(page.getByRole('button', { name: /^(Approve|Reject)$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
    await expect(page.getByText('Archived reviews')).toHaveCount(0);
  });

  test('rejecting from the console reaches Postgres, and the review leaves the public read', async ({ page, request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const queue = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 50 } })).json();
    const target = queue.content.find((r) => r.status === 'published' && r.targetType === 'property');
    expect(target, 'the e2e seed must contain a published property review').toBeTruthy();

    const publicBefore = await (await request.get(`${API}/properties/${target.targetId}/reviews`)).json();
    expect(publicBefore.some((r) => r.id === target.id)).toBe(true);

    await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
    await page.goto('/admin/content?tab=reviews');
    await appReady(page);

    /* Author *and* target. The author alone stopped being a key the moment the seed grew a second
       review by the same person — `filter({ hasText: author })` then resolves to four rows and the
       click is ambiguous, which Playwright reports as a strict-mode violation rather than as the
       fixture change it actually is. The pair is unique by database constraint
       (`idx_reviews_author_target` forbids one author two reviews on one target), so it cannot
       come loose the way a `.first()` would — silently, by drifting onto whichever row happens to
       sort first. The count assertion states that reasoning where a failure will show it. */
    const rowKey = `${target.targetType[0].toUpperCase()}${target.targetType.slice(1)}: ${target.targetId}`;
    const row = page.getByRole('row').filter({ hasText: target.author }).filter({ hasText: rowKey });
    await expect(row).toHaveCount(1);
    await row.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByRole('alert')).toContainText('Rejected');

    /* A reload, because the in-place state update proves only that the browser believes it. The
       write is not optimistic — the row is not touched until the PATCH resolves — but "the button
       waited" and "the row changed in Postgres" are still different claims, and only the second one
       matters to the author whose review came down. */
    await page.reload();
    await appReady(page);
    await expect(page.getByRole('row').filter({ hasText: target.author }).filter({ hasText: rowKey }))
      .toContainText(/Rejected/i);

    /* And the half that archiving could never have done: the review is out of the public read, so
       it is out of the aggregate too. Hiding it from the console alone would have left the rating
       it produced standing. */
    const publicAfter = await (await request.get(`${API}/properties/${target.targetId}/reviews`)).json();
    expect(publicAfter.some((r) => r.id === target.id)).toBe(false);

    // Put it back, because the seeded row is shared and the next spec to read it should find the
    // state it was seeded in.
    const restored = await request.patch(`${API}/reviews/${target.id}/status`, {
      headers,
      data: { status: 'published', reason: 'e2e teardown' },
    });
    expect(restored.status()).toBeLessThan(300);
  });
});
