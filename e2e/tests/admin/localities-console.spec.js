// LIVE: `/admin/localities` — the curator's screen, not the endpoint behind it.
import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

// Free text no seeded locality can match, so the resolver is forced to leave the column null.
const UNPLACEABLE = 'Zztest Wasti Phata';

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// A listing the catalogue cannot file, under an owner nobody else in the suite shares.
async function unfiledListing(title) {
  const headers = await authHeaders(uniqueMobile());
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING, title, locality: UNPLACEABLE, images: await uploadedListingPhotos(headers),
  });
  expect(created.status).toBe(201);
  expect(created.body.localitySlug ?? null).toBeNull();
  return created.body.id;
}

// The queue as the server sees it, for re-reading a change from outside the browser that made it.
const queueRows = async () => (await api('GET', '/admin/locality-queue', await authHeaders(ACTORS.admin))).body;

// Take a listing this spec left unfiled back out of the shared queue.
async function discard(id) {
  await api('PATCH', `/properties/${id}/status`, await authHeaders(ACTORS.admin),
    { status: 'rejected', reasonCode: 'other', reason: 'Zztest cleanup — synthetic queue fixture' });
}

// These specs run on desktop, so they scope to the table.
const table = (page) => page.getByRole('table');
const row = (page, name) => table(page).locator('tr').filter({ hasText: name });

// KPI tiles and empty state share `.dz-card`, so copy alone is not a stable locator.
const kpi = (page, label) => page.locator('.dz-card', { hasText: label }).first();

// Open the console and wait for the queue response, rather than for the page to settle.
async function openConsole(page, tab = 'pending') {
  // Both reads are waited on, not just the queue.
  const [queueRes, dirRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/admin/locality-queue') && r.request().method() === 'GET'),
    page.waitForResponse((r) => /\/api\/localities(\?|$)/.test(r.url()) && r.request().method() === 'GET'),
    page.goto(`/admin/localities${tab === 'directory' ? '?tab=directory' : ''}`),
  ]);
  expect(queueRes.status()).toBe(200);
  expect(dirRes.status()).toBe(200);
}

test.describe('LIVE: the localities console', () => {
  test("an unplaced listing waits here with its owner's words, with no dismiss or verify, and the areas offered are the ones the server accepts", async ({ page, login, consoleErrors }) => {
    await test.step('a listing the resolver could not place is waiting here, with the words its owner typed', async () => {
      const id = await unfiledListing('Zztest console subject');
      await login.asAdmin();
      await openConsole(page);

      await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible();
      await expect(row(page, 'Zztest console subject')).toContainText(UNPLACEABLE);
      // Not `toContainText('1')`.
      await expect(kpi(page, 'Awaiting a locality')).toContainText(/\d/);
      expect(consoleErrors).toEqual([]);

      // Deliberately NOT also asserting the row is gone.
      await discard(id);
    });
    await test.step('there is no way to mark a row reviewed while leaving it unfiled', async () => {
      const id = await unfiledListing('Zztest no dismiss');
      await openConsole(page);

      // A reviewed listing with no locality would go live invisible with human approval.
      const subject = row(page, 'Zztest no dismiss');
      await expect(subject.getByRole('button', { name: /dismiss/i })).toHaveCount(0);
      await expect(subject.getByRole('button', { name: /verify/i })).toHaveCount(0);

      await discard(id);
    });
    await test.step('the areas offered are the ones the server will accept', async () => {
      const id = await unfiledListing('Zztest options match server');
      await openConsole(page);

      // Console changes must reflect immediately, not wait for bundled locality data.
      const live = await api('GET', '/localities', {});
      const expected = live.body.filter((l) => l.active !== false).map((l) => l.slug).sort();
      expect(expected.length).toBeGreaterThan(0);

      const offered = await row(page, 'Zztest options match server')
        .getByRole('combobox')
        .locator('option')
        .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
      expect(offered.slice().sort()).toEqual(expected);

      await discard(id);
    });
  });

  // Approved listings without locality fail buyers now; pending ones are only at risk.
  test('filing a listing under an area clears it from the queue', async ({ page, login }) => {
    const id = await unfiledListing('Zztest assign from console');
    await login.asAdmin();
    await openConsole(page);

    const subject = row(page, 'Zztest assign from console');
    await subject.getByRole('combobox').selectOption('baner');

    // Waiting on the PATCH rather than on the toast.
    const [assigned] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/locality-queue/') && r.request().method() === 'PATCH'),
      subject.getByRole('button', { name: 'Assign' }).click(),
    ]);
    expect(assigned.status()).toBe(200);

    await expect(page.getByText(/filed under Baner/i).first()).toBeVisible();
    // Gone from the queue is the assertion that matters: a toast with no write behind it would pass
    // a weaker test, and so would a row removed only from client state.
    await expect(subject).toHaveCount(0);

    // Re-read from outside the browser that made the change, which is the half a mock cannot do.
    expect((await queueRows()).listings.map((r) => r.id)).not.toContain(id);

    await discard(id);
  });

  test("the Directory tab lists the server's areas, and the KPI tiles double as tab shortcuts", async ({ page, login }) => {
    await login.asAdmin();
    await test.step('the Directory tab lists the areas listings can be filed under', async () => {
      await openConsole(page, 'directory');

      // The assertion is that rows come from `GET /localities`, not bundled data.
      const catalogue = (await api('GET', '/localities', {})).body;
      expect(catalogue.length).toBeGreaterThan(0);

      const shown = await table(page).locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.cells[0]?.textContent?.trim()));
      expect(shown.length).toBeGreaterThan(0);
      // The first cell stacks the display name over the slug, so this compares both at once — and the
      // slug is the half that matters, since it is what a filing writes and what search keys off.
      expect(shown).toEqual(catalogue.slice(0, shown.length).map((l) => `${l.name}${l.slug}`));

      // And the status column is the server's `active` bit rather than a decoration.
      const first = catalogue[0];
      await expect(row(page, first.name).first()).toContainText(first.active === false ? 'Retired' : 'Live');
    });
    await test.step('KPI tiles double as tab shortcuts', async () => {
      await openConsole(page);

      await kpi(page, 'Localities').click();
      await expect(page).toHaveURL(/tab=directory/);
    });
  });

  // Shared live data cannot guarantee that the queue is empty.
  test('the empty state tracks the server queue, rather than being what an unanswered screen looks like', async ({ page, login }) => {
    await login.asAdmin();

    const baseline = (await queueRows()).listings || [];

    await openConsole(page);
    if (baseline.length === 0) {
      await expect(table(page).getByText(/Nothing awaiting a locality/i)).toBeVisible();
    }

    // Now put a row in the queue. The sentence has to go, or its presence above was worth nothing.
    const id = await unfiledListing('Zztest empty state cycle');
    await openConsole(page);
    await expect(row(page, 'Zztest empty state cycle')).toBeVisible();
    await expect(table(page).getByText(/Nothing awaiting a locality/i)).toHaveCount(0);

    // File it the way a curator would, then confirm the server agrees the queue is empty again
    // before asking the screen — the response is the source of truth, the screen is the claim.
    const filed = await api('PATCH', `/admin/locality-queue/${id}`, await authHeaders(ACTORS.admin),
      { slug: 'baner' });
    expect(filed.status, JSON.stringify(filed.body)).toBe(200);
    expect((await queueRows()).listings || []).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));

    await openConsole(page);
    if (baseline.length === 0) {
      await expect(table(page).getByText(/Nothing awaiting a locality/i)).toBeVisible();
    } else {
      await expect(row(page, 'Zztest empty state cycle')).toHaveCount(0);
    }

    await discard(id);
  });
});
