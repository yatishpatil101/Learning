/**
 * The moderation queue, against the live API.
 *
 * **Replaces both `admin/reports.spec.js` (13 tests) and `admin/reports-full.spec.js` (42).** Fifty-
 * five tests became twenty, and the twenty cover more. It is worth saying exactly what was
 * dropped, because "we deleted 35 tests" is otherwise indistinguishable from losing coverage.
 *
 * ## Dropped: assertions that could not fail
 *
 * Seventeen of the fifty-five asserted nothing a broken page would violate.
 *
 * - `pagination shows when more than 10 reports` ended, literally, `expect(true).toBeTruthy();`.
 * - `escalation badge visible for repeated targets` ended `expect(count).toBeGreaterThanOrEqual(0);`
 *   — true of every locator that has ever existed, including one for an element that does not.
 * - `only open reports have checkboxes` asserted that the table had rows, and carried a comment
 *   admitting it: "We just verify no JS errors occur". It was named after a rule it never checked.
 * - Eleven more were wrapped in `if (await x.isVisible({ timeout: 1000 }).catch(() => false))`,
 *   which is a construction that reports success when the feature is missing. That is worse than no
 *   test: it occupies the slot where a real one would go and reports green from an empty page.
 *
 * All of those behaviours are covered below, unguarded. They can be checked here and could not be
 * checked there because the mock's queue could be empty; the seed guarantees seven rows, so the
 * conditional has nothing left to protect.
 *
 * ## Dropped: assertions about things that do not exist
 *
 * Three tested inventions, and would have failed honestly the first time they ran live.
 *
 * - `closed reports show Reopen button` — `canTriage` gates on `status ∈ {open, reviewing}`, so a
 *   decided report renders "Decided" and never a Reopen. The mock had no such gate. Replaced by the
 *   test that asserts the "Decided" copy is what actually renders.
 * - `resolved status badge has green styling`, whose comment read "REP5004 in seed data has status
 *   'resolved'". `resolved` has never been a wire status — the server records that decision as
 *   `dismissed`, which is why `act()` trusts the response over the requested value.
 * - `deep link ?open=REP5000` — mock id format. Live ids are UUIDs, so the deep link was never
 *   exercised against a shape it will meet. Rewritten against a seeded UUID.
 *
 * ## Added: the queue's actual verb
 *
 * Neither mock spec ever decided a report. Fifty-five tests over a moderation tool, none of which
 * moderated anything. The last test here files its own report over the API and dismisses it.
 *
 * ## Added: the tab that was missing
 *
 * Writing the KPI reconciliation below turned up a live gap rather than a test gap. Flatmate
 * reports go over the wire as `targetType: 'post'`, which `toViewModel` maps to `kind: 'share'` —
 * and the queue had two tabs, filtering `kind === 'listing' ? … : kind === 'user'`. Those rows
 * rendered in **neither**. The queue grew a third tab, the seed grew two `post` rows, and the tile
 * arithmetic below is what would have caught it: `open + closed` counted them and
 * `listings + users` could not.
 *
 * ## Why the property counts are not asserted absolutely
 *
 * `tests/live-property-integration.spec.js` files a real report through the report modal, so the
 * number of open property reports in a full run is "the seven seeded ones, plus however many other
 * specs filed". Asserting `Open reports = 2` would pass alone, pass in a run where this file sorts
 * first, and fail the day someone renames a directory. So the property-side assertions are scoped
 * to the seeded targets, and the tiles are checked for *internal consistency* — that the five
 * numbers agree with each other and with the rows on screen, which is the invariant that actually
 * breaks when a predicate is wrong.
 *
 * The user- and post-side counts *are* absolute, because nothing else in the suite reports a person
 * or a flatmate post. If that changes, these are the assertions that will say so.
 *
 * Fixtures: `docs/system/fixture-registry.md` → the `report` row.
 */
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

/**
 * Open the queue and wait for the first row.
 *
 * The row is the signal, not the heading: `PageHeader` renders before `GET /reports` answers, so
 * asserting on the title proves only that the route resolved.
 */
async function openReports(page, query = '') {
  await page.goto(`/admin/reports${query}`);
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
}

/**
 * Every row is in the DOM twice — `Table` renders an `sm:hidden` stacked card per row *before* the
 * `hidden sm:block` table. Unscoped locators therefore match double and every count is wrong. Scope
 * to the table.
 */
const rows = (page) => page.locator('table tbody tr');

/** The project's `Select`: a `button[aria-haspopup=listbox]` over `button[role=option]`s. */
async function pick(page, filterLabel, optionText) {
  await page.getByRole('button', { name: filterLabel }).click();
  await page.getByRole('option', { name: optionText, exact: true }).click();
}

/** Read a KPI tile's number by its label. */
async function tile(page, label) {
  const value = page.locator('.pn-card', { hasText: label }).first().locator('.text-2xl');
  return Number((await value.innerText()).replace(/[^\d]/g, ''));
}

test('the queue loads with the seeded reports and no console errors', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openReports(page);

  await expect(page.getByRole('heading', { name: 'Reports & Moderation' })).toBeVisible();
  await expect(page.getByText('Review reported properties, users and flatmate posts, and take action.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeVisible();

  /* Three seeded reports on p5002. Scoped to the target rather than the tab, so another spec filing
     a report on a different listing cannot move this number. */
  await expect(rows(page).filter({ hasText: REPORTED_PROPERTY })).toHaveCount(3);

  /* Inherited from the retired mock spec, which is the only reason this assertion exists: the queue
     renders seeded prose containing em-dashes and curly quotes, and a CP1252 round-trip somewhere in
     the pipeline turns each of those into a run of two or three Latin-1 letters and a currency sign.
     The needles are built from code points rather than typed literally so this file does not itself
     have to be exempted from the repo-wide encoding guard (`SourceTreeHygieneTest.noMojibakeOrBom`)
     — the old spec was, and an exempt file is one the guard has stopped protecting. Writing this
     comment with a literal example is what made the guard fail on this very file. */
  const body = await page.locator('body').innerText();
  for (const lead of [0x00e2, 0x00c3, 0x00c2]) {
    expect(body, `mojibake starting U+${lead.toString(16)}`).not.toContain(String.fromCharCode(lead, 0x20ac));
  }

  expect(consoleErrors).toHaveLength(0);
});

test('the five KPI tiles agree with each other and with the rows on screen', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  const open = await tile(page, 'Open reports');
  const listings = await tile(page, 'Reported properties');
  const users = await tile(page, 'Reported users');
  const posts = await tile(page, 'Reported posts');
  const closed = await tile(page, 'Closed');

  /* `open` and `closed` partition the queue; so do `listings`, `users` and `posts`. Both partitions
     must total the same thing. This is the assertion that catches the predicate bugs that actually
     happen — `closed` counting `reviewing` as both open and closed, a tab predicate drifting from
     the tile's. The mock pair asserted only that four tiles were visible.

     It also fails if a target type is on the wire with no tab to show it, which is exactly how the
     `post` gap surfaced: `open + closed` counted the flatmate reports, `listings + users` could
     not, and no screen anywhere admitted the difference. */
  expect(open + closed).toBe(listings + users + posts);

  /* Absolute, because nothing else in the suite reports a person or a post. */
  expect(users).toBe(2);
  expect(posts).toBe(2);
  await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(0);
  await page.getByRole('button', { name: /^Reported users & owners/ }).click();
  await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);
});

test('the property, user and post tiles switch tabs', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  await page.getByText('Reported users', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'User / Owner' })).toBeVisible();

  await page.getByText('Reported posts', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Flatmate post' })).toBeVisible();

  await page.getByText('Reported properties', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Property' })).toBeVisible();
});

test('listings is the default tab, and ?tab= deep links to the other two', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);
  await expect(page.getByRole('columnheader', { name: 'Property' })).toBeVisible();

  await openReports(page, '?tab=users');
  await expect(page.getByRole('columnheader', { name: 'User / Owner' })).toBeVisible();
  await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);

  await openReports(page, '?tab=posts');
  await expect(page.getByRole('columnheader', { name: 'Flatmate post' })).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
});

/**
 * The tab that did not exist.
 *
 * Every flatmate report — room, group or seeker — is filed as `targetType: 'post'`, which
 * `toViewModel` maps to `kind: 'share'`. The queue asked `kind === 'listing' ? … : kind === 'user'`,
 * so those rows matched neither branch and appeared in **no tab at all**. Filed correctly, stored
 * correctly, and invisible to the people whose job was to action them.
 *
 * It was hidden by a second bug rather than by luck: Flatmates.jsx used to send `kind='user'` with
 * the post vocabulary, so the reports showed up mislabelled under "Reported users". Correcting the
 * wire mapping is what made them vanish — the ordinary way a latent gap becomes visible.
 */
test('a flatmate post report is reachable, and reads in the post vocabulary', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page, '?tab=posts');

  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).filter({ hasText: REPORTED_ROOM })).toHaveCount(1);

  /* `filled` is legal for a post and for nothing else, so this label cannot be produced by either
     other vocabulary — it proves the row is being labelled as a post and not as a listing. */
  await expect(rows(page).filter({ hasText: 'Already filled / no longer available' })).toHaveCount(1);

  /* `broker` is shared with the listing vocabulary under *different wording*. The listing wording
     is "Posted by a broker / not the owner", which is about the person who owns the flat; a
     flatmate post is somebody looking for a housemate. Getting the right one here is the whole
     reason `reasonLabel` takes a target type. */
  await expect(rows(page).filter({ hasText: 'Broker or agent, not a genuine seeker' })).toHaveCount(1);
  await expect(page.getByText('Posted by a broker / not the owner')).toHaveCount(0);

  /* A post is content: the enforcement is to take the post down, not to suspend its author. */
  await expect(rows(page).filter({ hasText: 'Take down' })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
});

test('a property report renders the reason the reporter chose, in words', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  const onP5002 = rows(page).filter({ hasText: REPORTED_PROPERTY });

  /* Labels, not codes. The wire carries `fake`/`pricing`/`broker`; a moderator must never be shown
     those. And they are the *listing* vocabulary's wording specifically — `reasonLabel` indexes by
     target type, so a `spam` report on a flatmate post does not read "duplicate listing". */
  await expect(onP5002.filter({ hasText: 'Fake photos or misleading info' })).toHaveCount(1);
  await expect(onP5002.filter({ hasText: 'Overpriced / incorrect price' })).toHaveCount(1);
  await expect(onP5002.filter({ hasText: 'Posted by a broker / not the owner' })).toHaveCount(1);

  /* The reporter's own words come down on `details` and are what a moderator actually reads.
     Scoped to the table because the stacked card renders the same sentence. */
  await expect(onP5002.filter({ hasText: 'The same photos appear on another listing in Kothrud' })).toHaveCount(1);
});

test('the reporter is withheld on every row', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  /* `ReportResponse` omits `reporterId` on purpose — naming the reporter to all of ops is how a
     complaint becomes a reprisal. "Withheld" and not "Anonymous": the platform knows exactly who
     filed this, and an unattributable complaint is an easier one to wave away. */
  const count = await rows(page).count();
  await expect(rows(page).filter({ hasText: 'Withheld' })).toHaveCount(count);
  await expect(page.getByText('Anonymous')).toHaveCount(0);
});

test('a user report renders the owner vocabulary, not the listing one', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page, '?tab=users');

  const onRahul = rows(page).filter({ hasText: REPORTED_USER });
  await expect(onRahul.filter({ hasText: 'Asked for brokerage / advance payment' })).toHaveCount(1);
  await expect(onRahul.filter({ hasText: 'Abusive or harassing behaviour' })).toHaveCount(1);
});

test('the escalation badge fires on the thrice-reported target and not the twice-reported one', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  /* Threshold is three. p5002 has three, Rahul two — so this is one assertion and one refutation,
     which together pin the boundary. The mock version asserted `>= 0`. */
  const badge = rows(page).filter({ hasText: REPORTED_PROPERTY }).first()
    .locator('[title="3 reports on this target"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('3x');

  await page.getByRole('button', { name: /^Reported users & owners/ }).click();
  await expect(rows(page).locator('[title$="reports on this target"]')).toHaveCount(0);
});

test('the status filter narrows to the seeded statuses', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  await pick(page, 'Filter by status', 'Being reviewed');
  const reviewing = rows(page).filter({ hasText: REPORTED_PROPERTY });
  await expect(reviewing).toHaveCount(1);
  await expect(reviewing).toContainText('Overpriced / incorrect price');

  await pick(page, 'Filter by status', 'Dismissed');
  const dismissed = rows(page).filter({ hasText: REPORTED_PROPERTY });
  await expect(dismissed).toHaveCount(1);
  await expect(dismissed).toContainText('Posted by a broker / not the owner');
});

test('the reason filter offers the vocabulary that belongs to the tab', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  /* The regression this test exists for: the filter used to carry a hand-written list containing
     `inaccurate` and `offensive`, which are in none of the server's four per-target vocabularies —
     so picking either always emptied the queue and read as "no such complaints". It also omitted
     nine codes reports do carry, `broker` among them, which on an Indian rental marketplace is one
     of the commonest complaints filed and was not filterable at all. */
  await page.getByRole('button', { name: 'Filter by reason' }).click();
  await expect(page.getByRole('option', { name: 'Posted by a broker / not the owner' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Already sold or rented out' })).toBeVisible();
  // Owner-only reasons are meaningless about a listing, and the server refuses the pairing.
  await expect(page.getByRole('option', { name: 'Fake or impersonated profile' })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /inaccurate|offensive/i })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Reported users & owners/ }).click();
  await page.getByRole('button', { name: 'Filter by reason' }).click();
  await expect(page.getByRole('option', { name: 'Asked for brokerage / advance payment' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Posted by a broker / not the owner' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /^Reported flatmate posts/ }).click();
  await page.getByRole('button', { name: 'Filter by reason' }).click();
  await expect(page.getByRole('option', { name: 'Already filled / no longer available' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Broker or agent, not a genuine seeker' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Asked for brokerage / advance payment' })).toHaveCount(0);
});

test('a reason that cannot exist in the other tab is cleared when the tab changes', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  await pick(page, 'Filter by reason', 'Posted by a broker / not the owner');
  await expect(rows(page)).toHaveCount(1);

  /* `broker` is not in the owner vocabulary. Left standing it would filter the users tab by a code
     no row there can carry, and an empty queue reads as "no reports" rather than "you are filtering
     by something impossible here". */
  await page.getByRole('button', { name: /^Reported users & owners/ }).click();
  await expect(page.getByRole('button', { name: 'Filter by reason' })).toContainText('All reasons');
  await expect(rows(page).filter({ hasText: REPORTED_USER })).toHaveCount(2);
});

test('search narrows the queue by the reporter\'s own words', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  await page.getByPlaceholder('Search reports…').fill('Kothrud');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Fake photos or misleading info');

  /* The mock version filled the box and then asserted only that the result counter was visible.
     Asserted on the empty copy rather than a row count of zero: `Table` keeps one `tr` to hold the
     empty state, so "no rows" and "one row saying there are none" look identical to a counter. The
     copy is rendered twice as well — once in the `sm:hidden` card list — so it is read out of the
     table, where `.first()` would have picked the mobile one and found it hidden. */
  await page.getByPlaceholder('Search reports…').fill('nothing matches this at all');
  await expect(page.locator('table').getByText('No reports match — all clear!')).toBeVisible();
  await expect(rows(page).filter({ hasText: REPORTED_PROPERTY })).toHaveCount(0);
});

test('clear all filters restores the full queue', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);
  const before = await rows(page).count();

  await pick(page, 'Filter by status', 'Dismissed');
  await expect(rows(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(rows(page)).toHaveCount(before);
  await expect(page.getByRole('button', { name: 'Clear all filters' })).toHaveCount(0);
});

test('an open report offers triage and a decided one says so', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  await pick(page, 'Filter by status', 'Open');
  const open = rows(page).filter({ hasText: REPORTED_PROPERTY }).first();
  await expect(open.getByRole('button', { name: 'Take down' })).toBeVisible();
  await expect(open.getByRole('button', { name: 'Resolve' })).toBeVisible();
  await expect(open.getByRole('button', { name: 'Dismiss' })).toBeVisible();

  /* Terminal is terminal, server-side: `canTriage` gates on `open`/`reviewing`, so a decided report
     renders a note and no buttons. The mock spec asserted a Reopen button here, which the live page
     cannot render under any state. */
  await pick(page, 'Filter by status', 'Dismissed');
  const decided = rows(page).filter({ hasText: REPORTED_PROPERTY }).first();
  await expect(decided.getByText('Decided')).toBeVisible();
  await expect(decided.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});

test('only open reports carry a selection checkbox', async ({ page, login }) => {
  await login.asAdmin();
  await openReports(page);

  /* Selectable and triageable are deliberately *not* the same set, and this is the assertion that
     pins the gap. `canTriage` admits `open` and `reviewing`, so two of the three property reports
     offer buttons; the checkbox renders only for `open`, so one does. That is not an oversight —
     bulk triage sends a blind PATCH per id with a single shared note, and sweeping a report someone
     is already working through into a batch decision is how a queue loses an in-progress
     investigation. Individual triage on a `reviewing` row is a considered act; bulk is not. */
  await expect(rows(page).filter({ hasText: 'Take down' })).toHaveCount(2);
  const boxes = rows(page).locator('input[type="checkbox"]');
  await expect(boxes).toHaveCount(1);

  await boxes.first().check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bulk Resolve' })).toBeVisible();
  await page.getByRole('button', { name: 'Deselect all' }).click();
  await expect(page.getByText('1 selected')).toHaveCount(0);
});

test('the detail drawer shows the report and closes', async ({ page, login }) => {
  await login.asAdmin();
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

test('?open=<uuid> deep links straight to one report', async ({ page, login }) => {
  await login.asAdmin();

  /* The mock version used `?open=REP5000`, so it never met the id shape it will actually be handed.
     The match is string-for-string against `report.id`, which live is a UUID. */
  await openReports(page, `?open=${SEEDED_OPEN_REPORT}`);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(SEEDED_OPEN_REPORT);
  await expect(drawer).toContainText('Fake photos or misleading info');
});

/**
 * Declared last, deliberately.
 *
 * `workers: 1` and files run in declaration order, so anything mutating belongs at the end. This
 * test files its *own* report rather than triaging a seeded one, for two reasons: the seeded rows
 * back the counts every test above depends on, and triage is not undoable — `hide_content` flags
 * the listing and `suspend_account` archives the account, both for the remainder of the run.
 *
 * Dismiss, therefore, and not Take down: `act(id, 'dismissed')` passes no enforcement, so the
 * server's verb is `none` and nothing outside the report row changes.
 *
 * The `window.prompt` for the internal note is left to Playwright's default dismissal, which
 * returns `null` — `note || actionTaken` covers it, and the `if (note)` branch that would fire is
 * `lib/mockApi.addInternalNote`, a second note store that dies at P5c and should not be exercised
 * by a live spec.
 */
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

  /* The server's answer is authoritative — `act` writes back `updated.status`, not the requested
     one, which is why asking for `resolved` shows `dismissed`. Here they agree; what is being
     asserted is that the row moved and the triage controls went with it. */
  await expect(drawer.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  await expect(drawer.getByText(/decided report cannot be reopened|Decided/)).toBeVisible();

  /* And it is not merely optimistic local state: reload, and the server still says dismissed. */
  await openReports(page, `?open=${id}`);
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
});
