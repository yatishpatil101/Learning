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
 * Fixtures: ACTORS.admin (9000000000), ACTORS.buyer (9700000001).
 */
import { test, expect } from '@playwright/test';
import { API, authHeaders } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';

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
