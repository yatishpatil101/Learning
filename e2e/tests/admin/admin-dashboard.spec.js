// `/admin` — the landing dashboard, against the live API.
import { expect, test, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

// The server's own answer, read straight from the contract endpoint the screen is supposed to use.
async function scorecard(mobile) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/admin/dashboard`, { headers });
  expect(res.status, 'GET /admin/dashboard').toBe(200);
  return (await res.json()).kpis;
}

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

// Every uuid this file puts into the shared catalogue, drained by `afterEach`.
const created = new Set();

// A pending listing under an owner nobody else shares.
async function pendingListing(tag) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, { ...BASE_LISTING, title: `Zztest dashboard ${tag}`, images: await uploadedListingPhotos(headers) });
  expect(res.status, 'POST /me/listings').toBe(201);
  created.add(res.body.id);
  return res.body.id;
}

// Reject instead of delete: pending rows left behind pollute the shared verification queue.
test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reasonCode: 'other',
      reason: 'Zztest cleanup \u2014 synthetic dashboard fixture',
    });
  }
  created.clear();
});

// The label is the stable tile handle; the figure is the value under test.
function tile(page, label) {
  return page.locator('a').filter({ has: page.getByText(label, { exact: true }) }).first();
}

async function tileValue(page, label) {
  const link = tile(page, label);
  await expect(link, `the "${label}" tile is on the page`).toBeVisible();
  return (await link.locator('.text-2xl').innerText()).trim();
}

async function openDashboard(page, login) {
  await login.asAdmin();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test.describe('/admin dashboard — the scorecard is the server\'s', () => {
  test('SLA health shows the rates GET /admin/analytics/sla measured (D291)', async ({ page, login }) => {
    await openDashboard(page, login);
    const res = await fetch(`${API}/admin/analytics/sla`, { headers: await authHeaders(ACTORS.admin) });
    expect(res.status).toBe(200);
    const sla = await res.json();

    const panel = page.getByTestId('sla-health');
    await expect(panel).toBeVisible();
    const approval = panel.locator('.dz-card', { hasText: 'Listing approval' });
    await expect(approval).toContainText(sla.slaRatePct == null ? 'Not recorded' : `${sla.slaRatePct}% within target`);
    await expect(page.getByText(/Smart alerts|Daily ops scorecard/i)).toHaveCount(0);
  });

  test('catalogue tiles render the counts GET /admin/dashboard sent, not a page of them', async ({ page, login }) => {
    await openDashboard(page, login);

    const k = await scorecard(ACTORS.admin);

    // `GET /users` pages at 20, so the seed must exceed one page to prove total counts.
    expect(
      k.totalUsers,
      'the seed must hold more users than one page of /users (20), or "Total Users" stops being a discriminator',
    ).toBeGreaterThan(20);

    expect(await tileValue(page, 'Total Users')).toBe(String(k.totalUsers));
    expect(await tileValue(page, 'Active Listings')).toBe(String(k.activeListings));
    expect(await tileValue(page, 'Pending Verification')).toBe(String(k.pendingModeration));

    // `openReports` proves the dashboard reads the server KPI, not just legacy tiles.
    expect(await tileValue(page, 'Open Reports')).toBe(String(k.openReports));

    // The sub-label catches browser-side counts from capped moderation pages.
    await expect(tile(page, 'Active Listings')).toContainText(`${k.totalListings} total`);
  });

  test('revenue is served to an admin and withheld from staff, from the same endpoint', async ({ page, login }) => {
    // Staff reach the scorecard only through the grantable `analytics` function.
    const { mobile } = await login.scopeStaff('rental', ['analytics']);
    const asAdmin = await scorecard(ACTORS.admin);
    const asStaff = await scorecard(mobile);

    // Staff redaction only means anything if the same endpoint exposes revenue to admins.
    expect(asAdmin.revenue30d, 'an admin is served a revenue figure').not.toBeNull();
    expect(asStaff.revenue30d, 'staff are served null, not zero').toBeNull();

    // Matching non-revenue fields prove this is one redacted field, not a different scope.
    expect(asStaff.totalUsers).toBe(asAdmin.totalUsers);
    expect(asStaff.pendingModeration).toBe(asAdmin.pendingModeration);

    await openDashboard(page, login);
    await expect(tile(page, 'Revenue (last 30 days)')).toBeVisible();
  });

  test('a staffer without the analytics function gets no scorecard sections and lands on the staff portal', async ({ page, login }) => {
    const redacted = await fetch(`${API}/admin/dashboard`, { headers: await authHeaders(STAFF.rental) });
    expect(redacted.status, 'GET /admin/dashboard is open to staff, section by section').toBe(200);
    const sections = await redacted.json();
    for (const gated of ['kpis', 'traffic', 'sla']) {
      expect(sections[gated], `${gated} is absent, not empty, without its permission`).toBeUndefined();
    }

    await login.asStaff('rental');
    await page.goto('/admin');
    await page.waitForURL((u) => new URL(u).pathname === '/staff');
    await expect(page.getByTestId('my-functions')).toBeVisible();
  });

  test('the Flagged tile is the count the server keeps, over a listing the queue has one of', async ({ page, login }) => {
    // Create a fixture so an empty catalogue cannot make both sides agree at zero.
    const admin = await authHeaders(ACTORS.admin);
    const id = await pendingListing(`flag${Date.now().toString(36)}`);
    const flagged = await api('POST', `/properties/${id}/flag`, admin, {
      reason: 'Zztest \u2014 synthetic flagged fixture',
    });
    expect(flagged.status, 'the flag verb did not accept the fixture').toBeLessThan(300);

    // Read after writing because shared catalogue counts move during the suite.
    const summary = await api('GET', '/admin/properties/summary', admin);
    expect(summary.status, 'GET /admin/properties/summary').toBe(200);
    expect(summary.body.flagged, 'the fixture must make the flagged count non-zero').toBeGreaterThan(0);

    await openDashboard(page, login);
    expect(await tileValue(page, 'Flagged Listings')).toBe(String(summary.body.flagged));
    expect(Number(await tileValue(page, 'Pending Verification')), 'Pending Verification is the same non-archived count the summary keeps').toBe(summary.body.pending);
  });

  test('the Flagged tile goes away when the listings section is not served', async ({ page, login }) => {
    await page.route('**/admin/dashboard*', async (route) => {
      const { listings, ...rest } = await (await route.fetch()).json();
      await route.fulfill({ json: rest });
    });

    await openDashboard(page, login);
    await expect(tile(page, 'Pending Verification')).toBeVisible();
    await expect(tile(page, 'Flagged Listings')).toHaveCount(0);
  });

  test('the pending card is the oldest listings in the queue, not the oldest in a page of the newest', async ({ page, login }) => {
    const admin = await authHeaders(ACTORS.admin);
    const facet = 'status=pending&archived=false&page=0&size=5';

    const oldest = await api('GET', `/admin/properties?${facet}&sort=createdAt,asc`, admin);
    const newest = await api('GET', `/admin/properties?${facet}&sort=createdAt,desc`, admin);
    expect(oldest.status, 'GET /admin/properties sorted ascending').toBe(200);
    expect(newest.status, 'GET /admin/properties sorted descending').toBe(200);

    const titles = (res) => res.body.content.map((p) => p.title);

    // The premise, asserted rather than assumed — the same guard the Total Users test carries.
    expect(
      titles(oldest),
      'the queue must hold more than one page of five for oldest-first to be distinguishable from newest-first',
    ).not.toEqual(titles(newest));

    await openDashboard(page, login);

    const card = page.locator('.dz-card').filter({ has: page.getByRole('heading', { name: 'Pending verification' }) });
    await expect(card).toBeVisible();

    // In order, not as a set.
    await expect(card.locator('.text-sm.font-semibold')).toHaveText(titles(oldest));
  });
});
