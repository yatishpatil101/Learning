import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs } from '../../../helpers/liveAuth.js';

/**
 * D227 / register item 33 — the saved-search match count comes off the seam, and both surfaces
 * that show it show the same number.
 *
 * ## The bug
 *
 * Two screens told the user how many listings match a saved alert: the notifications inbox
 * ("N properties match …") and the dashboard retention strip ("N homes match right now"). Both
 * computed N in the browser, each by fetching listings and filtering the result. The fetch returned
 * one page — `PAGE_SIZE = 100`. With 38 demo listings that was accidentally correct; with 101 it
 * would silently become a ceiling rather than a count, and the only guard against that was a
 * `console.warn` the runner throws away.
 *
 * The count now arrives on the saved-search record itself as `matchCount`. Neither surface counts
 * anything any more.
 *
 * ## Why the mock version could not prove this
 *
 * It seeded `dzSavedSearches:<mobile>` into localStorage and then read the number back off the
 * screen, so the mock provider counted, in the browser, over a catalogue the same process held in
 * memory. Every assertion was a statement about one JavaScript function agreeing with itself. The
 * claim being made, though, is about a page-size ceiling in a network fetch — precisely the part
 * the mock does not have. It could not fail for the reason the bug existed.
 *
 * Here the record is created over HTTP, `SavedSearchService` calls `countMatchingNow` for it, and
 * the number is counted by `countVisibleWithFilters` — a `SELECT count(*)` over the whole approved
 * catalogue, which has no page to be truncated by. The browser's only job is to render an integer
 * it was handed, and that is the job these tests check it is still doing.
 *
 * ## What is asserted
 *
 * Never a literal count — that is a property of the seed and would make this a change detector.
 * What is asserted is that the number **is the one the server put on the record, is identical on
 * both screens, moves with the alert's criteria, and is suppressed for the cases that should not
 * count.** The cross-surface equality is the real net: the two screens used to derive it separately
 * and were one edit away from disagreeing.
 *
 * Two of the suppressions say something the mock could not. An alert switched off still has a
 * server-side count — the surfaces are declining to show a number that exists, rather than the
 * server declining to work one out — and a flatmates alert is counted as zero by the server even
 * when its criteria are identical to a listings alert that counts three. Both are asymmetries
 * between what is stored and what is shown, and neither is visible when one process owns both ends.
 *
 * Every absence assertion below is paired with a matching alert that *does* render, in the same
 * account and on the same screen. An inbox that failed to load would otherwise satisfy "no row for
 * this alert" perfectly.
 */

/* Labels are deliberately not prefixes of one another: the row locators match on contained text, so
   "Rent · Wakad" would also select a row labelled "Rent · Wakad 2BHK" and the count read back would
   be whichever of the two the DOM happened to order first. */
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

/* `query` is what the user typed. The server insists a listings alert has one, but does not count
   with it — `countMatching` reads `deal`, `localities` and `bhk` out of the filters blob and
   nothing else. The label goes *into* the blob rather than alongside it because that is where the
   http provider looks (`row.label || filters.label`); a listings alert has no top-level label
   column. */
const listings = (label, filters) => ({
  kind: 'listings',
  name: label,
  query: 'Pune',
  filters: { ...filters, label },
  alertFrequency: 'daily',
  channel: 'whatsapp',
});

/* A throwaway account holding exactly the alerts one test asked for.
 *
 * Minted per test rather than borrowed from the seeded actors for two reasons. Both surfaces window
 * the list before rendering — the strip takes three, the inbox four — so an account that had
 * accumulated alerts from earlier tests could push this test's alert off the bottom and turn a
 * genuine count into an absence. And `docs/system/fixture-registry.md` publishes the seeded actors'
 * saved-search counts as invariants, on a database that lives for the whole run. */
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

async function openInbox(page) {
  await page.goto('/notifications');
}

function inboxRow(page, label) {
  return page.getByText(`match "${label}"`);
}

async function countIn(page, label) {
  const row = inboxRow(page, label).first();
  await expect(row, `an inbox row for "${label}"`).toBeVisible();
  const text = await row.innerText();
  const m = text.match(/(\d+) propert/);
  expect(m, `inbox row for "${label}" did not read like a count: ${JSON.stringify(text)}`).not.toBeNull();
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
  await openInbox(page);
  expect(await countIn(page, WAKAD)).toBe(fromServer);
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
  await openInbox(page);
  // The anchor: the inbox loaded and rendered the alert that does match. Without it, "no row for
  // Testville" is also what a blank page looks like.
  await expect(inboxRow(page, WAKAD)).toHaveCount(1);
  await expect(inboxRow(page, TESTVILLE)).toHaveCount(0);
});

test('an alert the user switched off is hidden by both surfaces, though the server still counts it', async ({ page }) => {
  const { mobile, created } = await alerting(
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    { ...listings(MUTED, { deal: 'rent', localities: ['wakad'] }), alertFrequency: 'off' },
  );
  const [live, muted] = created;

  // Identical criteria, identical answer. Switching an alert off is the surfaces declining to show
  // a number, not the server declining to work one out — which matters because turning the alert
  // back on must not have to wait for anything to be recomputed.
  expect(muted.alertFrequency).toBe('off');
  expect(muted.matchCount).toBe(live.matchCount);
  expect(muted.matchCount).toBeGreaterThan(0);

  await signedInAs(page, mobile);
  const strip = await openDashboard(page);
  expect(await countOn(strip, WAKAD)).toBe(live.matchCount);
  await expect(stripRow(strip, MUTED)).toHaveCount(0);

  await openInbox(page);
  expect(await countIn(page, WAKAD)).toBe(live.matchCount);
  await expect(inboxRow(page, MUTED)).toHaveCount(0);
});

test('a flatmates alert is not counted — this number does not cover rooms', async ({ page }) => {
  const { mobile, created } = await alerting(
    listings(WAKAD, { deal: 'rent', localities: ['wakad'] }),
    {
      kind: 'flatmates',
      name: FLATMATE,
      // Deliberately the same locality and deal as the listings alert above, so the zero that
      // follows can only be about `kind`. Criteria that matched nothing would prove nothing.
      criteria: { localities: ['wakad'], budget: 20000 },
      filters: { deal: 'rent', localities: ['wakad'], label: FLATMATE },
      alertFrequency: 'daily',
    },
  );
  expect(created[0].matchCount).toBeGreaterThan(0);
  expect(created[1].matchCount, 'a rooms alert counted itself against the listings catalogue').toBe(0);

  await signedInAs(page, mobile);
  await openInbox(page);
  await expect(inboxRow(page, WAKAD)).toHaveCount(1);
  await expect(inboxRow(page, FLATMATE)).toHaveCount(0);
});

test('a flatmates alert cannot be saved in a listings alert’s shape', async () => {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/saved-searches', headers, {
    kind: 'flatmates',
    name: FLATMATE,
    query: 'Wakad',
    filters: { deal: 'rent', localities: ['wakad'] },
  });

  // Underwrites the test above. A rooms alert counts zero because it is a different kind of thing,
  // and the server will not accept one wearing a listings alert's clothes — query and filters
  // instead of criteria. Were it accepted, the record would look countable and the zero would start
  // depending on which branch of `countMatching` ran first.
  expect(res.status, 'a flatmates alert with no criteria was accepted').toBe(422);
  expect(res.body.error).toBe('validation_failed');
  expect(res.body.fields.map((f) => f.field)).toContain('criteriaSuppliedForFlatmates');
});
