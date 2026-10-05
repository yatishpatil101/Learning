/* Moderation queue against the live API; property-side counts are scoped to seeded targets because other specs file real reports,
 * and tab counts and status chips are checked for internal consistency. Fixtures: `docs/system/fixture-registry.md` (`report` row). */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** p5002 — the listing carrying three of the seven seeded reports. */
const REPORTED_PROPERTY = '51897b51-f1a2-56ce-9687-2be847ff4dee';
/** Rahul — reported twice, and deliberately never triaged: `suspend_account` would archive him. */
const REPORTED_USER = 'f1c70000-0000-4000-8000-000000000001';
/** The Wakad shared room — one of the two seeded `post` reports, for the flatmates tab. */
const REPORTED_ROOM = 'f1c7000b-0000-4000-8000-000000000002';
/** The seeded `open` report on p5002, for the deep link. */
const SEEDED_OPEN_REPORT = 'f1c70004-0000-4000-8000-000000000001';

/* Open the queue and wait for the first row. The row is the signal, not the heading: `PageHeader`
   renders before `GET /reports` answers, so the title proves only that the route resolved. */
async function openReports(page, query = '') {
  await page.goto(`/admin/reports${query}`);
  await expect(rows(page).first()).toBeVisible({ timeout: 20000 });
}

const rows = (page) => page.getByTestId('queue-row');
const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

/** The project's `Select`: a `button[aria-haspopup=listbox]` over `button[role=option]`s. */
async function pick(page, filterLabel, optionText) {
  await page.getByRole('button', { name: filterLabel }).click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

/** Status chips read "<label> <count>". */
const statusChip = (page, label) => page.getByRole('group', { name: 'Status' })
  .getByRole('button', { name: new RegExp(`^${label} \\d`) });
const chipCount = async (page, label) => Number((await statusChip(page, label).innerText()).replace(/[^\d]/g, ''));
const tabCount = async (page, key) => Number((await page.getByTestId(`tab-count-${key}`).innerText()).replace(/[^\d]/g, ''));

test('the queue renders its rows and counts, and the tabs switch by click and by deep link', async ({ page, login, consoleErrors }) => {
  test.slow();
  await login.asAdmin();
  await test.step('the queue loads with the seeded reports and no console errors', async () => {
    await openReports(page);

    await expect(page.getByRole('heading', { name: 'Reports & Moderation' })).toBeVisible();
    await expect(page.getByText('Review reported properties, users and posts, moderate reviews, and take action.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

    /* Three seeded reports on p5002. Scoped to the target rather than the tab, so another spec filing
       a report on a different listing cannot move this number. */
    await expect(rows(page).filter({ hasText: REPORTED_PROPERTY })).toHaveCount(3);

    /* A CP1252 round-trip turns the queue's em-dashes and curly quotes into Latin-1 runs. Needles are
       built from code points so this file need not be exempted from `noMojibakeOrBom`. */
    const body = await page.locator('body').innerText();
    for (const lead of [0x00e2, 0x00c3, 0x00c2]) {
      expect(body, `mojibake starting U+${lead.toString(16)}`).not.toContain(String.fromCharCode(lead, 0x20ac));
    }

    expect(consoleErrors).toHaveLength(0);
  });
  await test.step('the tab counts and status chips agree with each other and with the rows on screen', async () => {
    await openReports(page);

    /* The status chips partition the tab, so they must total its "All" chip — which also fails if a
       status is on the wire with no chip to show it. The tab pill counts what is still undecided. */
    const all = await chipCount(page, 'All');
    const open = await chipCount(page, 'Open');
    const reviewing = await chipCount(page, 'Being reviewed');
    const actioned = await chipCount(page, 'Action taken');
    const dismissed = await chipCount(page, 'Dismissed');
    expect(open + reviewing + actioned + dismissed).toBe(all);
    expect(await tabCount(page, 'listings')).toBe(open + reviewing);

    /* Absolute, because nothing else in the suite reports a person or a post. */
    await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(0);
    for (const [key, name] of [['users', 'Users & owners'], ['posts', 'Flatmate posts']]) {
      await tab(page, name).click();
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
      await expect(statusChip(page, 'All')).toHaveText('All 2');
      expect(await tabCount(page, key)).toBe(await chipCount(page, 'Open') + await chipCount(page, 'Being reviewed'));
    }
    await tab(page, 'Users & owners').click();
    await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);
  });
  await test.step('each tab switches the queue and states what its enforcement does', async () => {
    await openReports(page);

    await tab(page, 'Users & owners').click();
    await expect(tab(page, 'Users & owners')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('users-note')).toContainText('Suspend blocks the account');

    await tab(page, 'Flatmate posts').click();
    await expect(page.getByTestId('posts-note')).toContainText('its author is not suspended');

    await tab(page, 'Properties').click();
    await expect(page.getByTestId('listings-note')).toContainText('Take down hides the listing');
  });
  await test.step('listings is the default tab, and ?tab= deep links to the other two', async () => {
    await openReports(page);
    await expect(tab(page, 'Properties')).toHaveAttribute('aria-selected', 'true');

    await openReports(page, '?tab=users');
    await expect(tab(page, 'Users & owners')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);

    await openReports(page, '?tab=posts');
    await expect(tab(page, 'Flatmate posts')).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(2);
  });
});

test('every report row reads in its own vocabulary, escalates at three, and withholds the reporter', async ({ page, login }) => {
  test.slow();
  await login.asAdmin();
  await test.step('a flatmate post report is reachable, and reads in the post vocabulary', async () => {
  /* Every flatmate report is filed as `targetType: 'post'` → `kind: 'share'`, which the two-branch tab
     predicate matched in neither — filed and stored correctly, invisible to whoever must action it. */
    await openReports(page, '?tab=posts');

    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).filter({ hasText: REPORTED_ROOM })).toHaveCount(1);

    /* `filled` is legal for a post and for nothing else, so this label cannot be produced by either
       other vocabulary — it proves the row is being labelled as a post and not as a listing. */
    await expect(rows(page).filter({ hasText: 'Already filled / no longer available' })).toHaveCount(1);

    /* `broker` is also in the listing vocabulary with other wording; `reasonLabel` takes the target type. */
    await expect(rows(page).filter({ hasText: 'Broker or agent, not a genuine seeker' })).toHaveCount(1);
    await expect(page.getByText('Posted by a broker / not the owner')).toHaveCount(0);

    /* A post is content: the enforcement is to take the post down, not to suspend its author. */
    await expect(rows(page).filter({ hasText: 'Take down' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);

    // A non-listing report (a post) gets Take down, never Suspend.
    await rows(page).filter({ hasText: REPORTED_ROOM }).getByRole('button', { name: 'View details' }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Take down' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });
  await test.step('a property report renders the reason the reporter chose, in words', async () => {
    await openReports(page);

    const onP5002 = rows(page).filter({ hasText: REPORTED_PROPERTY });

    /* Moderators see labels, not wire codes, and `reasonLabel` indexes by target type. */
    await expect(onP5002.filter({ hasText: 'Fake photos or misleading info' })).toHaveCount(1);
    await expect(onP5002.filter({ hasText: 'Overpriced / incorrect price' })).toHaveCount(1);
    await expect(onP5002.filter({ hasText: 'Posted by a broker / not the owner' })).toHaveCount(1);

    /* The reporter's own words come down on `details` and are what a moderator actually reads. */
    await expect(onP5002.filter({ hasText: 'The same photos appear on another listing in Kothrud' })).toHaveCount(1);
  });
  await test.step('the reporter is withheld on every row', async () => {
    await openReports(page);

    /* `ReportResponse` omits `reporterId` so ops can't retaliate; "Withheld", not "Anonymous", as it is known. */
    const count = await rows(page).count();
    await expect(rows(page).filter({ hasText: 'Withheld' })).toHaveCount(count);
    await expect(page.getByText('Anonymous')).toHaveCount(0);
  });
  await test.step('a user report renders the owner vocabulary, not the listing one', async () => {
    await openReports(page, '?tab=users');

    const onRahul = rows(page).filter({ hasText: REPORTED_USER });
    await expect(onRahul.filter({ hasText: 'Asked for brokerage / advance payment' })).toHaveCount(1);
    await expect(onRahul.filter({ hasText: 'Abusive or harassing behaviour' })).toHaveCount(1);
  });
  await test.step('the escalation badge fires on the thrice-reported target and not the twice-reported one', async () => {
    await openReports(page);

    /* Threshold is three. p5002 has three, Rahul two — so this is one assertion and one refutation,
       which together pin the boundary. The mock version asserted `>= 0`. */
    const badge = rows(page).filter({ hasText: REPORTED_PROPERTY }).first()
      .locator('[title="3 reports on this target"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('3x');

    await tab(page, 'Users & owners').click();
    await expect(rows(page).locator('[title$="reports on this target"]')).toHaveCount(0);
  });
});

test('the queue filters by status, reason and search, and clears them again', async ({ page, login }) => {
  test.slow();
  await login.asAdmin();
  await test.step('the status filter narrows to the seeded statuses', async () => {
    await openReports(page);

    await statusChip(page, 'Being reviewed').click();
    const reviewing = rows(page).filter({ hasText: REPORTED_PROPERTY });
    await expect(reviewing).toHaveCount(1);
    await expect(reviewing).toContainText('Overpriced / incorrect price');

    await statusChip(page, 'Dismissed').click();
    const dismissed = rows(page).filter({ hasText: REPORTED_PROPERTY });
    await expect(dismissed).toHaveCount(1);
    await expect(dismissed).toContainText('Posted by a broker / not the owner');
  });
  await test.step('the reason filter offers the vocabulary that belongs to the tab', async () => {
    await openReports(page);

    /* A hand-written filter list drifting from the server's four per-target vocabularies empties the
       queue silently — it reads as "no such complaints" rather than as a broken filter. */
    await page.getByRole('button', { name: 'Filter by reason' }).click();
    await expect(page.getByRole('option', { name: 'Posted by a broker / not the owner' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Already sold or rented out' })).toBeVisible();
    // Owner-only reasons are meaningless about a listing, and the server refuses the pairing.
    await expect(page.getByRole('option', { name: 'Fake or impersonated profile' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: /inaccurate|offensive/i })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await tab(page, 'Users & owners').click();
    await page.getByRole('button', { name: 'Filter by reason' }).click();
    await expect(page.getByRole('option', { name: 'Asked for brokerage / advance payment' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Posted by a broker / not the owner' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await tab(page, 'Flatmate posts').click();
    await page.getByRole('button', { name: 'Filter by reason' }).click();
    await expect(page.getByRole('option', { name: 'Already filled / no longer available' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Broker or agent, not a genuine seeker' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Asked for brokerage / advance payment' })).toHaveCount(0);
  });
  await test.step('a reason that cannot exist in the other tab is cleared when the tab changes', async () => {
    await openReports(page);

    await pick(page, 'Filter by reason', 'Posted by a broker / not the owner');
    await expect(rows(page)).toHaveCount(1);

    /* `broker` isn't an owner code; filtering users by it gives an empty queue that reads as "no reports". */
    await tab(page, 'Users & owners').click();
    await expect(page.getByRole('button', { name: 'Filter by reason' })).toContainText('All reasons');
    await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);
  });
  await test.step("search narrows the queue by the reporter\'s own words", async () => {
    await openReports(page);

    await page.getByLabel('Search reports').fill('Kothrud');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Fake photos or misleading info');

    await page.getByLabel('Search reports').fill('nothing matches this at all');
    await expect(page.getByText('No reports match these filters.')).toBeVisible();
    await expect(rows(page).filter({ hasText: REPORTED_PROPERTY })).toHaveCount(0);
  });
  await test.step('clear all filters restores the full queue', async () => {
    await openReports(page);
    const before = await rows(page).count();

    await statusChip(page, 'Dismissed').click();
    await expect(rows(page)).toHaveCount(1);

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(rows(page)).toHaveCount(before);
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
  });
});

test('triage controls, bulk selection, the detail drawer and the ?open= deep link', async ({ page, login }) => {
  test.slow();
  await login.asAdmin();
  await test.step('an open report offers triage and a decided one says so', async () => {
    await openReports(page);

    await statusChip(page, 'Open').click();
    const open = rows(page).filter({ hasText: REPORTED_PROPERTY }).first();
    await expect(open.getByRole('button', { name: 'Take down' })).toBeVisible();
    await expect(open.getByRole('button', { name: 'Resolve' })).toBeVisible();
    await expect(open.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    /* Terminal is terminal: `canTriage` gates on `open`/`reviewing`, so decided reports have no buttons. */
    await statusChip(page, 'Dismissed').click();
    const decided = rows(page).filter({ hasText: REPORTED_PROPERTY }).first();
    await expect(decided.getByText('Decided')).toBeVisible();
    await expect(decided.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  });
  await test.step('only open reports carry a selection checkbox', async () => {
    await openReports(page);

    /* Selectable and triageable are deliberately different sets: bulk triage sends a blind PATCH per id
       with one shared note, so sweeping in a `reviewing` row loses an in-progress investigation. */
    await expect(rows(page).filter({ hasText: 'Take down' })).toHaveCount(2);
    const boxes = rows(page).locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(1);

    await boxes.first().check();
    await expect(page.getByText('1 selected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bulk Resolve' })).toBeVisible();
    await page.getByRole('button', { name: 'Deselect all' }).click();
    await expect(page.getByText('1 selected')).toHaveCount(0);
  });
  await test.step('the detail drawer shows the report and closes', async () => {
    await openReports(page);

    await rows(page).filter({ hasText: REPORTED_PROPERTY }).first()
      .getByRole('button', { name: 'View details' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Reason', { exact: true })).toBeVisible();
    await expect(drawer.getByText('Reported by', { exact: true })).toBeVisible();
    // Same withholding as the column — it was fixed in one place and missed in the other once.
    await expect(drawer.getByText('Withheld')).toBeVisible();
    await expect(drawer.getByText(/Escalated \(3 reports\)/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
  await test.step('?open=<uuid> deep links straight to one report', async () => {
    /* The mock version used `?open=REP5000`, so it never met the id shape it will actually be handed.
       The match is string-for-string against `report.id`, which live is a UUID. */
    await openReports(page, `?open=${SEEDED_OPEN_REPORT}`);
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(SEEDED_OPEN_REPORT);
    await expect(drawer).toContainText('Fake photos or misleading info');
  });
});

/* Declared last because it mutates: files its own report, as triaging a seeded one is not undoable. */
test('a moderator can decide a report, and the decision sticks', async ({ page, login }) => {
  const reporter = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const headers = await authHeaders(reporter);

  /* Any listing except p5002 — reporting that one would push its count to four and move the
     escalation badge the tests above pin at three. */
  const listing = await fetch(`${API}/properties?size=10`).then((r) => r.json());
  const targetId = (listing.items || listing.content || []).map((p) => p.id)
    .find((id) => id && id !== REPORTED_PROPERTY);
  expect(targetId, 'no listing available to report').toBeTruthy();

  const filed = await fetch(`${API}/reports`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      targetType: 'property',
      targetId,
      reason: 'sold',
      details: 'E2E triage probe — this listing is already rented out.',
    }),
  });
  // One read: `text()` and `json()` both consume the stream, so reading it for the failure message
  // would leave nothing to parse on success.
  const body = await filed.text();
  expect(filed.status, body).toBe(201);
  const { id } = JSON.parse(body);

  await login.asAdmin();
  await openReports(page, `?open=${id}`);

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Already sold or rented out');
  await drawer.getByRole('button', { name: 'Dismiss' }).click();

  /* `act` writes back the server's `updated.status`, not the requested one; here they agree. */
  await expect(drawer.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  await expect(drawer.getByText(/decided report cannot be reopened|Decided/)).toBeVisible();

  /* And it is not merely optimistic local state: reload, and the server still says dismissed. */
  await openReports(page, `?open=${id}`);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});
