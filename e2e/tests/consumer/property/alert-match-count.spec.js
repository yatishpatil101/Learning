import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

const PUNE = 'Rent · Pune';
const WAKAD = 'Rent · Wakad';
const TWO_BED = '2 BHK · Wakad';
const MUTED = 'Muted · Wakad';
const TESTVILLE = 'Rent · Testville';
const FLATMATE = 'Flatmate · Wakad';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function flatmateTotal(query) {
  const res = await api('GET', `/flatmates/feed?${query}&size=1`, { Accept: 'application/json' });
  expect(res.status).toBe(200);
  return res.body.totalElements;
}

const listings = (label, filters) => ({
  kind: 'listings',
  name: label,
  query: 'Pune',
  filters: { ...filters, label },
  alertFrequency: 'daily',
  channel: 'whatsapp',
});

async function alerting(...rows) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const created = [];
  for (const row of rows) {
    const res = await api('POST', '/me/saved-searches', headers, row);
    expect(res.status, `creating the "${row.name}" alert`).toBe(201);
    created.push(res.body);
  }
  return { mobile, created };
}

async function openDashboard(page) {
  await page.goto('/dashboard');
  const strip = page.getByTestId('alert-matches');
  await expect(strip, 'the retention strip never rendered').toBeVisible();
  return strip;
}

function stripRow(strip, label) {
  return strip.getByRole('link').filter({ hasText: label });
}

async function countOn(strip, label) {
  const row = stripRow(strip, label);
  await expect(row, `one strip row for "${label}"`).toHaveCount(1);
  const text = await row.innerText();
  const m = text.match(/(\d+) homes? match(?:es)? right now/);
  expect(m, `strip row for "${label}" did not read like a count: ${JSON.stringify(text)}`).not.toBeNull();
  return Number(m[1]);
}

async function openAlertsPanel(page) {
  await page.goto('/dashboard#alerts');
  await expect(page.getByText('Property & Flatmate Alerts')).toBeVisible();
}

function alertPanelRow(page, label) {
  return page.locator('[data-testid="dashboard-alert-row"]', { hasText: label });
}

async function countInAlertPanel(page, label) {
  const row = alertPanelRow(page, label).first();
  await expect(row, `an alerts-panel row for "${label}"`).toBeVisible();
  const text = await row.getByTestId('dashboard-alert-match-count').innerText();
  const m = text.match(/(\d+) matches/);
  expect(m, `alerts-panel row for "${label}" did not read like a count: ${JSON.stringify(text)}`).not.toBeNull();
  return Number(m[1]);
}

test('both surfaces report the count the server put on the record', async ({ page }) => {
  const { mobile, created } = await alerting(listings(WAKAD, { deal: 'rent', localities: ['wakad'] }));
  const fromServer = created[0].matchCount;
  expect(fromServer, 'the seed catalogue has no approved rent listings in Wakad').toBeGreaterThan(0);

  await signedInAs(page, mobile);
  // Equal to each other is the regression this exists for; equal to `fromServer` is what makes it a
  // test of the seam rather than of two screens agreeing on the same wrong number.
  expect(await countOn(await openDashboard(page), WAKAD)).toBe(fromServer);
  await openAlertsPanel(page);
  expect(await countInAlertPanel(page, WAKAD)).toBe(fromServer);
});

test('the count tracks the criteria, not the size of the page the browser happened to fetch', async ({ page }) => {
  const { mobile } = await alerting(
    listings(PUNE, { deal: 'rent', localities: [] }),
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    listings(TWO_BED, { deal: 'rent', localities: ['wakad'], bhk: [2] }),
  );

  await signedInAs(page, mobile);
  const strip = await openDashboard(page);
  const city = await countOn(strip, PUNE);
  const locality = await countOn(strip, WAKAD);
  const twoBed = await countOn(strip, TWO_BED);
  // Strictly decreasing, not merely non-increasing. Three numbers that fall as the criteria tighten
  // cannot all be "however many listings came back", which is one number.
  expect(city).toBeGreaterThan(locality);
  expect(locality).toBeGreaterThan(twoBed);
  expect(twoBed, 'the narrowest alert matches nothing, so the chain proves less than it looks').toBeGreaterThan(0);
});

test('a locality nobody has listed in counts zero rather than falling back to everything', async ({ page }) => {
  const { mobile, created } = await alerting(
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    listings(TESTVILLE, { deal: 'rent', localities: ['testville'] }),
  );
  expect(created[1].matchCount, 'the server is the one deciding this, and it decided zero').toBe(0);

  await signedInAs(page, mobile);
  // The anchor: the inbox loaded and rendered the alert that does match. Without it, "no row for
  // Testville" is also what a blank page looks like.
  await openAlertsPanel(page);
  expect(await countInAlertPanel(page, WAKAD)).toBe(created[0].matchCount);
  expect(await countInAlertPanel(page, TESTVILLE)).toBe(0);
});

test('an alert the user switched off is hidden by both surfaces, though the server still counts it', async ({ page }) => {
  const { mobile, created } = await alerting(
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    { ...listings(MUTED, { deal: 'rent', localities: ['wakad'] }), alertFrequency: 'off' },
  );
  const [live, muted] = created;

  expect(muted.alertFrequency).toBe('off');
  expect(muted.matchCount).toBe(live.matchCount);
  expect(muted.matchCount).toBeGreaterThan(0);

  await signedInAs(page, mobile);
  const strip = await openDashboard(page);
  expect(await countOn(strip, WAKAD)).toBe(live.matchCount);
  await expect(stripRow(strip, MUTED)).toHaveCount(0);

  await openAlertsPanel(page);
  expect(await countInAlertPanel(page, WAKAD)).toBe(live.matchCount);
  expect(await countInAlertPanel(page, MUTED)).toBe(muted.matchCount);
});

test('a flatmates alert is counted from flatmate posts, not the listings catalogue', async ({ page }) => {
  const expectedFlatmates = await flatmateTotal('tab=team-up&locality=Wakad&maxBudget=20000');
  expect(expectedFlatmates, 'the flatmate feed fixture must have matching public posts').toBeGreaterThan(0);
  const listingFallback = await api('GET',
    '/properties?deal=rent&locality=d227-no-such-locality&size=1',
    { Accept: 'application/json' });
  expect(listingFallback.status).toBe(200);
  expect(listingFallback.body.totalElements).toBe(0);

  const { mobile, created } = await alerting(
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    {
      kind: 'flatmates',
      name: FLATMATE,
      criteria: { tab: 'team-up', locality: 'Wakad', budget: 20000 },
      filters: { deal: 'rent', localities: ['d227-no-such-locality'], label: FLATMATE },
      alertFrequency: 'daily',
    },
  );
  expect(created[0].matchCount).toBeGreaterThan(0);
  expect(created[1].matchCount, 'a flatmate alert did not use the flatmate feed count')
    .toBe(expectedFlatmates);
  expect(created[1].matchCount).not.toBe(listingFallback.body.totalElements);

  await signedInAs(page, mobile);
  const strip = await openDashboard(page);
  expect(await countOn(strip, FLATMATE)).toBe(expectedFlatmates);

  await openAlertsPanel(page);
  expect(await countInAlertPanel(page, WAKAD)).toBe(created[0].matchCount);
  expect(await countInAlertPanel(page, FLATMATE)).toBe(expectedFlatmates);
});

test('a flatmates alert cannot be saved in a listings alert’s shape', async () => {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/saved-searches', headers, {
    kind: 'flatmates',
    name: FLATMATE,
    query: 'Wakad',
    filters: { deal: 'rent', localities: ['wakad'] },
  });

  expect(res.status, 'a flatmates alert with no criteria was accepted').toBe(422);
  expect(res.body.error).toBe('validation_failed');
  expect(res.body.fields.map((f) => f.field)).toContain('criteriaSuppliedForFlatmates');
});