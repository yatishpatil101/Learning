/** Live seam coverage for admin content and Reviews; rule-level behaviour is in AdminContentEndpointsTest and
 * ReviewModerationQueueTest. Assertions use this run's own ids, never a table count. */
import { test, expect } from '@playwright/test';
import { API, authHeaders, signIn } from '../helpers/liveAuth.js';
import { ACTORS } from '../fixtures/live.js';
import { appReady } from '../helpers/app.js';

/** Stamped into every row this file creates, so a leftover is traceable to a run. */
const RUN = `live-cms-${Date.now()}`;

test.describe('admin content API', () => {
  test('an FAQ round-trips through create, patch, archive and restore', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    const created = await request.post(`${API}/admin/content/faqs`, {
      headers,
      data: { question: RUN, answer: 'Round trip answer', category: 'e2e' },
    });
    expect(created.status()).toBe(201);
    const faq = await created.json();
    expect(faq.id).toBeTruthy();
    expect(faq.type).toBe('faqs');
    expect(faq.archived).toBe(false);
    expect(faq.question).toBe(RUN);

    // PATCH is a merge: the fields we do not send must survive.
    const patched = await request.patch(`${API}/admin/content/faqs/${faq.id}`, {
      headers,
      data: { category: 'e2e-2' },
    });
    expect(patched.status()).toBe(200);
    const after = await patched.json();
    expect(after.category).toBe('e2e-2');
    expect(after.question).toBe(RUN);
    expect(after.answer).toBe(faq.answer);

    // The list the console reads includes archived rows — that is what its Archived view shows.
    const archived = await request.post(`${API}/admin/content/faqs/${faq.id}/archive`, { headers });
    expect(archived.status()).toBe(200);
    expect((await archived.json()).archived).toBe(true);

    const list = await request.get(`${API}/admin/content/faqs`, { headers });
    expect(list.status()).toBe(200);
    const rows = await list.json();
    const mine = rows.find((r) => r.id === faq.id);
    expect(mine, 'the archived row is still on the ops list').toBeTruthy();
    expect(mine.archived).toBe(true);

    const restored = await request.post(`${API}/admin/content/faqs/${faq.id}/restore`, { headers });
    expect(restored.status()).toBe(200);
    expect((await restored.json()).archived).toBe(false);

    // Leave the shelf tidy: a live FAQ would render on the public help page.
    await request.post(`${API}/admin/content/faqs/${faq.id}/archive`, { headers });
  });
  test('authoring is closed to signed-in consumers and to the public', async ({ request }) => {
    const buyer = await authHeaders(ACTORS.buyer, { request });
    const asBuyer = await request.get(`${API}/admin/content/faqs`, { headers: buyer });
    expect([401, 403]).toContain(asBuyer.status());

    const anon = await request.get(`${API}/admin/content/faqs`);
    expect([401, 403]).toContain(anon.status());

    expect([401, 403]).toContain((await request.get(`${API}/admin/reviews`, { headers: buyer })).status());
    expect([401, 403]).toContain((await request.get(`${API}/admin/reviews`)).status());
  });

  test('banners, announcements and services have no write side', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });

    for (const type of ['banners', 'announcements', 'services']) {
      const res = await request.post(`${API}/admin/content/${type}`, { headers, data: { title: `${RUN} ${type}` } });
      expect(res.status(), `POST /admin/content/${type}`).toBe(404);
    }
  });
});
test.describe('admin review moderation', () => {
  test('pending is an intake state, not a verdict the route will accept', async ({ request }) => {
    const headers = await authHeaders(ACTORS.admin, { request });
    const body = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 1 } })).json();
    const [row] = body.content;
    expect(row).toBeTruthy();

    const res = await request.patch(`${API}/reviews/${row.id}/status`, {
      headers,
      data: { status: 'pending' },
    });
    expect(res.status()).toBe(400);
  });

  test('the console reads the live queue, with Archive gone rather than hidden, and a rejection reaches Postgres and the public read', async ({ page, request }) => {
    await test.step('the console reads the live queue, and Archive is gone rather than hidden', async () => {
      const headers = await authHeaders(ACTORS.admin, { request });
      /* `author` is absent on authorless rows, so search the first page (ten rows) for one that has it, not `[0]`:
         `getByText(undefined)` throws. */
      const body = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 10 } })).json();
      const row = body.content.find((r) => r.author && r.targetType && r.targetId);
      expect(row, 'the e2e seed must contain at least one review with a named author').toBeTruthy();

      await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
      await page.goto('/admin/reports?tab=reviews');
      await appReady(page);

      await expect(page.getByTestId('reviews-note')).toBeVisible();

      /* The author name proves the row came from the server, not from a plausible-looking localStorage fixture. */
      const table = page.locator('#queue-panel');
      await expect(table.getByText(row.author, { exact: true }).first()).toBeVisible();

      // And the target, which the mapper composes from `targetType` + `targetId`. A moderator who
      // cannot see what is being reviewed cannot judge whether the review is fair.
      await expect(table.getByText(`${row.targetType[0].toUpperCase()}${row.targetType.slice(1)}: ${row.targetId}`, { exact: true }).first()).toBeVisible();

      /* Positive control: without the actions column, `toHaveCount(0)` on Archive would pass vacuously. */
      await expect(page.getByRole('button', { name: /^(Approve|Reject)$/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
      await expect(page.getByText('Archived reviews')).toHaveCount(0);
    });
    await test.step('rejecting from the console reaches Postgres, and the review leaves the public read', async () => {
      const headers = await authHeaders(ACTORS.admin, { request });
      const queue = await (await request.get(`${API}/admin/reviews`, { headers, params: { size: 50 } })).json();
      const target = queue.content.find((r) => r.status === 'published' && r.targetType === 'property');
      expect(target, 'the e2e seed must contain a published property review').toBeTruthy();

      const publicBefore = await (await request.get(`${API}/properties/${target.targetId}/reviews`)).json();
      expect(publicBefore.content.some((r) => r.id === target.id)).toBe(true);

      await signIn(page, ACTORS.admin, { screen: 'staff', role: 'admin' });
      await page.goto('/admin/reports?tab=reviews');
      await appReady(page);

      /* Author and target together: the pair is unique by `idx_reviews_author_target`, while author alone can
         match several rows (strict-mode violation) and `.first()` would drift. */
      const rowKey = `${target.targetType[0].toUpperCase()}${target.targetType.slice(1)}: ${target.targetId}`;
      await page.getByLabel('Search reviews').fill(target.targetId);
      const row = page.getByTestId('queue-row').filter({ hasText: target.author }).filter({ hasText: rowKey });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: 'Reject' }).click();
      await expect(page.getByRole('alert')).toContainText('Rejected');

      /* Reload: the in-place update only proves the browser's belief, not that Postgres changed. */
      await page.reload();
      await appReady(page);
      await page.getByLabel('Search reviews').fill(target.targetId);
      await expect(page.getByTestId('queue-row').filter({ hasText: target.author }).filter({ hasText: rowKey }))
        .toContainText(/Rejected/i);

      /* Archived reviews leave the public read, so the aggregate rating must drop them too. */
      const publicAfter = await (await request.get(`${API}/properties/${target.targetId}/reviews`)).json();
      expect(publicAfter.content.some((r) => r.id === target.id)).toBe(false);

      // Put it back, because the seeded row is shared and the next spec to read it should find the
      // state it was seeded in.
      const restored = await request.patch(`${API}/reviews/${target.id}/status`, {
        headers,
        data: { status: 'published', reason: 'e2e teardown' },
      });
      expect(restored.status()).toBeLessThan(300);
    });
  });

});
