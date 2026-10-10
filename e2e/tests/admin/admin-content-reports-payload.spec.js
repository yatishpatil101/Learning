import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const CANDIDATE_KEYS = new Set(['slug', 'name', 'localitySlug', 'mintOrigin', 'createdAt']);
const DIRECTORY_KEYS = new Set(['slug', 'name', 'builder', 'localitySlug', 'year', 'maintenancePerSqft']);
const LOCALITY_KEYS = new Set(['slug', 'name', 'lat', 'lng', 'archived', 'liveListings']);
const REVIEW_ROW_KEYS = new Set(['id', 'targetType', 'targetId', 'author', 'rating', 'body', 'createdAt', 'status']);

function recordGets(page) {
  const seen = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().includes('/api/')) return;
    const url = new URL(r.url());
    seen.push(url.pathname + url.search);
  });
  return {
    withPath: (path) => seen.filter((k) => k.split('?')[0] === path),
    all: () => [...seen],
    reset: () => { seen.length = 0; },
  };
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status, path).toBe(200);
  return res.json();
}

const unexpected = (row, allowed) => Object.keys(row).filter((k) => !allowed.has(k));

test('the society queue pages on the server with slim rows, and the directory reads its own endpoint', async ({ page, login, consoleErrors }) => {
  await test.step('API rows carry only what the screens render', async () => {
    const queue = await getJson('/admin/society-candidates?size=10');
    for (const row of queue.content) expect(unexpected(row, CANDIDATE_KEYS), row.slug).toEqual([]);
    expect(queue.content.length).toBeLessThanOrEqual(10);

    const directory = await getJson('/admin/societies?size=10');
    expect(directory.content.length).toBeGreaterThan(0);
    for (const row of directory.content) expect(unexpected(row, DIRECTORY_KEYS), row.slug).toEqual([]);
  });

  await test.step('the candidate tab reads one small page, scans only what is shown, and never the public list', async () => {
    await login.asAdmin();
    const gets = recordGets(page);
    await page.goto('/admin/societies');
    await expect(page.getByRole('tab', { name: /candidates/i })).toBeVisible();
    await page.waitForTimeout(1500);

    const reads = gets.withPath('/api/admin/society-candidates');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatch(/size=10(&|$)/);
    expect(gets.all().filter((k) => /[?&]size=(50|100|200)(&|$)/.test(k))).toEqual([]);
    expect(gets.withPath('/api/societies')).toEqual([]);
    const scans = gets.all().filter((k) => /\/duplicates/.test(k));
    expect(scans.length).toBeLessThanOrEqual(10);
    expect(consoleErrors).toHaveLength(0);
  });

  await test.step('the directory tab uses /admin/societies, not the public list', async () => {
    const gets = recordGets(page);
    await page.goto('/admin/societies?tab=directory');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
    expect(gets.withPath('/api/admin/societies').length).toBeGreaterThan(0);
    expect(gets.withPath('/api/societies')).toEqual([]);
  });
});

test('the localities console reads the slim admin list', async ({ page, login, consoleErrors }) => {
  const rows = await getJson('/admin/localities');
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(unexpected(row, LOCALITY_KEYS), row.slug).toEqual([]);

  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin/localities');
  await expect(page.getByRole('table').locator('tbody tr').first()).toBeVisible();
  await expect.poll(() => gets.withPath('/api/admin/localities').length).toBe(1);
  expect(gets.withPath('/api/localities')).toEqual([]);
  expect(consoleErrors).toHaveLength(0);
});

test('the content desk loads live FAQs without translations, in one read', async ({ page, login, consoleErrors }) => {
  const live = await getJson('/admin/content/faqs?archived=false');
  for (const row of live) {
    expect(row.archived, row.id).toBeFalsy();
    expect(row, row.id).not.toHaveProperty('translations');
    expect(row, row.id).not.toHaveProperty('createdAt');
  }

  await login.asAdmin();
  const gets = recordGets(page);
  await page.goto('/admin/content');
  await expect(page.getByRole('button', { name: 'Add FAQ' })).toBeVisible();

  await expect.poll(() => gets.all().filter((k) => k.startsWith('/api/admin/content/')).length).toBe(1);
  const reads = gets.all().filter((k) => k.startsWith('/api/admin/content/'));
  expect(reads[0]).toContain('/faqs');
  expect(reads[0]).toContain('archived=false');
  expect(reads[0]).not.toContain('translations');
  expect(consoleErrors).toHaveLength(0);
});

test('reports page on the server with counts once, and review moderation uses slim paged rows', async ({ page, login, consoleErrors }) => {
  await test.step('API: a page, whole-set counts, and the repeat tally', async () => {
    const body = await getJson('/reports?targetType=property&size=10&counts=true');
    expect(body.content.length).toBeLessThanOrEqual(10);
    expect(body.counts).toHaveProperty(['undecided.property']);
    expect(body.counts).toHaveProperty(['status.all']);
    for (const row of body.content) expect(row.targetReportCount, row.id).toBeGreaterThanOrEqual(1);

    const reviews = await getJson('/admin/reviews?size=10&counts=true');
    expect(reviews.counts).toHaveProperty('all');
    for (const row of reviews.content) expect(unexpected(row, REVIEW_ROW_KEYS), row.id).toEqual([]);
  });

  await test.step('the screen reads one 10-row page, flips without recounting, and never loads 100 rows', async () => {
    await login.asAdmin();
    const gets = recordGets(page);
    await page.goto('/admin/reports');
    await expect(page.getByTestId('queue-range').first()).toBeVisible();
    await page.waitForTimeout(800);

    const first = gets.withPath('/api/reports');
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('counts=true');
    expect(first[0]).toMatch(/size=10(&|$)/);
    expect(gets.all().filter((k) => /[?&]size=(50|100|200)(&|$)/.test(k))).toEqual([]);

    const next = page.getByRole('button', { name: 'Next page' }).first();
    if (await next.isEnabled()) {
      gets.reset();
      await next.click();
      await expect.poll(() => gets.withPath('/api/reports').length).toBe(1);
      expect(gets.withPath('/api/reports')[0]).not.toContain('counts=true');
    }
  });

  await test.step('the reviews tab reads a 10-row page with status counts', async () => {
    const gets = recordGets(page);
    await page.getByRole('tab', { name: /reviews/i }).click();
    await expect(page.getByTestId('reviews-note')).toBeVisible();
    await page.waitForTimeout(800);
    const reads = gets.withPath('/api/admin/reviews');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('counts=true');
    expect(reads[0]).toMatch(/size=10(&|$)/);
    expect(consoleErrors).toHaveLength(0);
  });
});
