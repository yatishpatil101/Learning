/**
 * The society ops console — claims, residents, candidates and merges — against the live API.
 *
 * This is the first live coverage the console has ever had, and the reason is worth stating: until
 * `87f2d07` and the two commits after it, all five of its queues read `localStorage`. A "live" spec
 * would have signed in against a real backend, opened a real screen, and then asserted against the
 * test runner's own browser storage — green forever, and proving nothing about the server. There
 * was no honest live spec to write. Now every queue is a route, so there is.
 *
 * ## Nothing here seeds storage
 *
 * No `addInitScript`, no `localStorage.setItem`, no `seedStorage`. Every row asserted below either
 * comes from `R__zz_dev_demo_data.sql` or is created over the API by the test that needs it. A
 * converted spec that still writes storage is worse than no spec: it passes when the server is
 * wrong, which is the one failure it exists to catch.
 *
 * ## What is read and what is created
 *
 * The seeded rows are read, never decided:
 *
 * - **Kumar Palaash** has a `pending` claim, which is what puts a row in the claims queue.
 * - **Sunview Heights** (`sunview-heights-wakad`) is the seeded community candidate, three days old
 *   and unverified.
 * - **Greenfield Residency** is the seeded *verified* community society — the control that proves
 *   the candidates queue filters on the verification stamp rather than on `source`.
 *
 * Everything that decides something creates its own subject first, by minting a society over
 * `POST /societies`. That is the drift rule from the phase doc, and it bites harder here than
 * elsewhere: there is exactly one seeded candidate, so a spec that verified it would empty the
 * queue for every spec after it — and would pass alone, pass first, and fail in a full run.
 *
 * ## Why the merge assertions are the longest block
 *
 * Merging is the one action on this console whose input is two rows differing by a typo. Getting it
 * wrong is not a hypothetical, which is why the server refuses chains in both directions and why
 * the merge is a pointer that can be undone. Those refusals are the behaviour most worth pinning:
 * a merge that silently collapsed a chain would look identical on screen and be unrecoverable.
 *
 * Fixtures: `docs/system/fixture-registry.md` → the `society` rows.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** The seeded society whose claim is still with ops. */
const CLAIMED_PENDING = 'Kumar Palaash';
/** The seeded community candidate: minted by a member, never confirmed. */
const SEEDED_CANDIDATE = 'Sunview Heights';
/** The seeded community society that ops already confirmed — it must NOT be in the queue. */
const SEEDED_VERIFIED = 'Greenfield Residency';

/**
 * Open one tab of the console and wait for its table, not its heading.
 *
 * `PageHeader` renders before any queue answers, so asserting on the title proves only that the
 * route resolved. The tab is a URL parameter (`useTabParam`), so this is a navigation rather than a
 * click — which also means a failure names the tab it was on.
 */
async function openTab(page, tab) {
  await page.goto(`/admin/societies?tab=${tab}`);
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible({ timeout: 20000 });
}

/**
 * Every row is in the DOM twice — `Table` renders an `sm:hidden` stacked card per row *before* the
 * `hidden sm:block` table. Unscoped locators match double and every count is wrong. Scope to the
 * table.
 */
const rows = (page) => page.locator('table tbody tr');

/**
 * The row whose *Society* column is this name — not merely a row mentioning it.
 *
 * A plain name filter was enough until the candidates table grew a "Possible
 * duplicates" column, which puts other societies' names inside a row. A queue holding a typo pair
 * now has each row carrying the other's name, so a name filter matches two rows and every count
 * assertion below is off by exactly the thing the column exists to surface. Scoped to the first
 * cell, which is the society the row is *about*.
 */
const named = (page, name) =>
  rows(page).filter({ has: page.locator('td:first-child').filter({ hasText: name }) });


/** Mint a community society over the API and return its slug. */
async function mintSociety(name, { mobile }) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name, localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 }),
  });
  expect(res.status, `mint ${name}`).toBeLessThan(300);
  return (await res.json()).slug;
}

/** A name no other run will collide with — the same trick as `uniqueMobile`, for societies. */
const uniqueName = (label) => `${label} ${String(Date.now()).slice(-7)}`;

test('the console loads every queue from the server, with no console errors', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openTab(page, 'claims');

  /* The seeded pending claim. Scoped to the society name rather than counted, because
     `live-society-residency.spec.js` files claims of its own and an absolute count would depend on
     which file sorted first. */
  await expect(rows(page).filter({ hasText: CLAIMED_PENDING })).toHaveCount(1);

  /* The disclosure banner must be absent. It renders only when a queue failed to load, and its
     absence is the assertion that all five reads answered — an empty table on an ops screen reads
     as "nothing to do", so a silent failure here is the expensive kind. */
  await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('a claim carries the registration number the claimant actually typed', async ({ page, login }) => {
  /* The number is a column again, not a sentence smuggled into the note. Before V109 the hub
     concatenated `Registration no. …` onto the free-text note, which cost the reviewer the
     claimant's own words and made the number unsearchable. */
  const mobile = uniqueMobile();
  const slug = await mintSociety(uniqueName('Claimtest Heights'), { mobile });
  const headers = await authHeaders(mobile);
  const filed = await fetch(`${API}/societies/${slug}/claim`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Anita Deshpande',
      role: 'Chairperson',
      note: 'Committee elected in March; happy to send the AGM minutes.',
      registrationNo: 'PNA/9911/2015',
    }),
  });
  expect(filed.status).toBeLessThan(300);

  await login.asAdmin();
  await openTab(page, 'claims');

  const row = rows(page).filter({ hasText: 'Anita Deshpande' });
  await expect(row).toHaveCount(1);
  // Both, and separately: the number in its own line, and the note still in the claimant's words.
  await expect(row).toContainText('PNA/9911/2015');
  await expect(row).toContainText('AGM minutes');
});

test('the candidates queue holds the unverified community society and not the verified one', async ({ page, login }) => {
  await login.asAdmin();
  await openTab(page, 'candidates');

  await expect(named(page, SEEDED_CANDIDATE)).toHaveCount(1);
  /* The control. Both rows are `source = 'community'`; only one carries a verification stamp. A
     queue that filtered on `source` alone would show both, and an operator would keep re-verifying
     a society that was confirmed eleven days ago. */
  await expect(named(page, SEEDED_VERIFIED)).toHaveCount(0);
});

test('a candidate with no recorded provenance claims none', async ({ page, login }) => {
  /* `mint_origin` (V108) is a different axis from `source`, and it is null on every society minted
     before it existed — including the seeded candidate. The chip used to be a two-branch ternary,
     which rendered a confident "From a listing" on exactly those rows: the operator was being told
     where the building came from by a component that did not know. */
  await login.asAdmin();
  await openTab(page, 'candidates');

  const row = named(page, SEEDED_CANDIDATE);
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText('From a listing');
  await expect(row).not.toContainText('Searcher demand');
});

test('verifying a candidate takes it off the queue and keeps its paperwork flags alone', async ({ page, login }) => {
  const name = uniqueName('Verifytest Residency');
  const slug = await mintSociety(name, { mobile: uniqueMobile() });

  await login.asAdmin();
  await openTab(page, 'candidates');

  const row = named(page, name);
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText(/verified — now a first-class society/i)).toBeVisible();
  await expect(named(page, name)).toHaveCount(0);

  /* Verification says we believe the society exists. It must not say its registration is done or
     its conveyance deed is executed — those describe the building's legal paperwork, which nobody
     here has seen, and the old browser-side promotion set both. */
  const res = await fetch(`${API}/societies/${slug}`);
  const society = await res.json();
  expect(society.registration).toBe(false);
  expect(society.conveyance).toBe(false);
  expect(society.verifiedAt).not.toBeNull();
});

test('a second operator is told who verified a society rather than overwriting them', async ({ page, login }) => {
  const name = uniqueName('Racetest Towers');
  const slug = await mintSociety(name, { mobile: uniqueMobile() });
  const headers = await authHeaders(ACTORS.admin);
  const first = await fetch(`${API}/admin/society-candidates/${slug}/verify`, { method: 'POST', headers });
  expect(first.status).toBeLessThan(300);

  /* The row is gone from the queue, so this is the API's answer rather than a second click. The
     409 matters because the record of *who* confirmed a society is the only thing that says who to
     ask about it later — silently overwriting it would lose that. */
  const second = await fetch(`${API}/admin/society-candidates/${slug}/verify`, { method: 'POST', headers });
  expect(second.status).toBe(409);

  await login.asAdmin();
  await openTab(page, 'candidates');
  await expect(named(page, name)).toHaveCount(0);
});

test('merging a duplicate takes it off the queue without deleting it, and undoes cleanly', async ({ page, login }) => {
  /* The duplicate is minted here; the survivor is a catalogue society. That is no longer a
     workaround — the picker searches `GET /societies?q=` and would find a society minted a second
     ago just as well — but it is kept, because a catalogue name is what an operator merging a typo
     into a real building actually types. */
  const dupe = uniqueName('Mergetest Blue Ridge Tower');
  const dupeSlug = await mintSociety(dupe, { mobile: uniqueMobile() });

  await login.asAdmin();
  await openTab(page, 'candidates');

  await named(page, dupe).getByRole('button', { name: 'Merge' }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge society' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search societies…').fill('Blue Ridge Towers');
  await dialog.getByRole('button', { name: /Blue Ridge Towers/ }).first().click();
  await dialog.getByRole('button', { name: 'Merge', exact: true }).click();

  await expect(page.getByText(/now read on the survivor/i)).toBeVisible();
  // Off the queue, and onto the record of merges below it.
  await expect(named(page, dupe)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Merged duplicates' })).toBeVisible();

  /* Nothing was deleted. The duplicate's row is still there — the merge is a pointer, which is the
     whole reason the undo below can exist at all. */
  const still = await fetch(`${API}/societies/${dupeSlug}`);
  expect(still.status).toBe(200);

  // And the undo. Keyed by the society that was merged away, not by the survivor: a survivor can
  // have absorbed several, so "undo the merge on this society" would be ambiguous.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByText(/stands on its own again/i)).toBeVisible();
  await expect(named(page, dupe)).toHaveCount(1);
});

test('the server refuses a chain rather than collapsing it, and names the merge to undo first', async ({ login }) => {
  await login.asAdmin();
  const headers = await authHeaders(ACTORS.admin);
  const json = { ...headers, 'content-type': 'application/json' };

  const a = await mintSociety(uniqueName('Chaintest A'), { mobile: uniqueMobile() });
  const b = await mintSociety(uniqueName('Chaintest B'), { mobile: uniqueMobile() });
  const c = await mintSociety(uniqueName('Chaintest C'), { mobile: uniqueMobile() });

  const first = await fetch(`${API}/admin/society-merges`, {
    method: 'POST', headers: json, body: JSON.stringify({ from: a, into: b }),
  });
  expect(first.status).toBe(201);

  /* B is now a live survivor, so merging it away would strand A. Refused rather than re-pointed:
     collapsing the chain is the one outcome that cannot be undone, because once A is silently
     moved from B to C nothing records that an operator chose B. */
  const chained = await fetch(`${API}/admin/society-merges`, {
    method: 'POST', headers: json, body: JSON.stringify({ from: b, into: c }),
  });
  expect(chained.status).toBe(409);
  expect(await chained.text()).toContain(a);

  // And the other direction: merging into something already merged away.
  const backwards = await fetch(`${API}/admin/society-merges`, {
    method: 'POST', headers: json, body: JSON.stringify({ from: c, into: a }),
  });
  expect(backwards.status).toBe(409);

  // Self-merge is a validation failure, not a conflict: nothing is in the way, the request is void.
  const self = await fetch(`${API}/admin/society-merges`, {
    method: 'POST', headers: json, body: JSON.stringify({ from: c, into: c }),
  });
  expect(self.status).toBe(422);

  await fetch(`${API}/admin/society-merges/${a}`, { method: 'DELETE', headers });
});

// ─── The duplicate hint (D252) ───

/* This column was computed in the browser from `data/societies.js` — 28 curated societies compiled
 * into the bundle. Every candidate in this queue is a member-added society, and not one of those
 * was in that file, so the answer for the pairs that matter was always "No obvious match". An
 * operator reads that as "no duplicate exists" and verifies the second copy into a permanent one,
 * at which point listings, follows, reviews and residency claims start accumulating against both
 * slugs and only a hand merge can separate them.
 *
 * The two tests below are the before and the after of exactly that failure, which is why both mint
 * their subjects rather than reading the seed: a hint about a seeded society could have come from
 * the bundled catalogue and would prove nothing.
 */

test('the duplicate column finds a second copy the bundled catalogue never held', async ({ page, login }) => {
  /* A typo pair, which is the shape this queue actually produces. Neither name is a substring of
     the other, so the row locators below cannot match each other's row — and both carry the same
     run stamp, so a re-run does not inherit the last one's societies as extra matches. */
  const stamp = String(Date.now()).slice(-7);
  const original = `Quollhaven Ridge ${stamp}`;
  const typo = `Quollhaven Rydge ${stamp}`;
  await mintSociety(original, { mobile: uniqueMobile() });
  await mintSociety(typo, { mobile: uniqueMobile() });

  await login.asAdmin();
  await openTab(page, 'candidates');

  const row = named(page, typo);
  await expect(row).toHaveCount(1);
  /* The hint is fetched now rather than computed in the same tick as the render, so the column has
     three states and "Checking…" is one of them. Waiting for the chip is what distinguishes the
     served answer from the old one; asserting `not.toContainText('No obvious match')` immediately
     would pass against a column that had not started. */
  await expect(row.getByText(original)).toBeVisible({ timeout: 20000 });
  await expect(row).not.toContainText('No obvious match');

  /* And the chip is the shortcut it exists to be: one click puts the operator in the merge dialog
     with this pair already chosen. That is the whole value of the hint — the difference between an
     operator merging the duplicate and verifying it because merging looked like work. */
  await row.getByRole('button', { name: original }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge society' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(typo);
});

test('a society that resembles nothing says so, rather than saying nothing', async ({ page, login }) => {
  /* The other half of the contract, and the one that has to survive the column being asynchronous.
     "Checking…" settling into "No obvious match" is a real answer; "Checking…" that never settles —
     which is what a failed fetch would leave behind if the page did not record the failure — is an
     operator staring at a spinner deciding whether to verify. */
  const name = `Ynthracite Bqorvald ${String(Date.now()).slice(-7)}`;
  await mintSociety(name, { mobile: uniqueMobile() });

  await login.asAdmin();
  await openTab(page, 'candidates');

  const row = named(page, name);
  await expect(row).toHaveCount(1);
  await expect(row.getByText('No obvious match')).toBeVisible({ timeout: 20000 });
});

test('the duplicate endpoint refuses a slug that names no society', async ({ login }) => {
  /* A stale queue is the realistic caller: the operator's tab has been open since before somebody
     else merged the row away. Answering an empty list would render as "nothing resembles this" for
     a society that no longer stands on its own — the most reassuring possible face for a stale
     screen. */
  await login.asAdmin();
  const headers = await authHeaders(ACTORS.admin);
  const res = await fetch(`${API}/admin/society-candidates/no-such-society-d252/duplicates`, { headers });
  expect(res.status).toBe(404);
});

test('a duplicate check that fails says so, instead of saying "No obvious match"', async ({ page, login }) => {
  /* The three-state column had a fourth thing that could be true and no way to say it: a request
     that did not answer recorded `[]`, which is the same shape as "the catalogue holds nothing like
     this", and rendered the same sentence. So the one case where the operator most needs to look
     twice — the check never ran — wore the message that tells them they need not. The console
     warning behind it is not something anybody working a queue of eighty rows will see. */
  const name = `Failcheck Manor ${String(Date.now()).slice(-7)}`;
  await mintSociety(name, { mobile: uniqueMobile() });

  await page.route('**/admin/society-candidates/*/duplicates*', (route) => route.abort('failed'));

  await login.asAdmin();
  await openTab(page, 'candidates');

  const row = named(page, name);
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Could not check')).toBeVisible({ timeout: 20000 });
  await expect(row).not.toContainText('No obvious match');
});

test('the duplicate endpoint refuses a hint count outside its range rather than quietly changing it', async ({ login }) => {
  /* The same rule `?days=0` follows on the analytics reports. `Math.max(1, limit)` stood here and
     answered a request nobody made: zero got one back, and a thousand got six, with nothing in the
     response saying the number had been changed. This is not a scan bound — the limit is applied
     after scoring, so a large one cannot enlarge the work — it is a bound on what the column can
     become, and a caller is told when it is exceeded. */
  await login.asAdmin();
  const headers = await authHeaders(ACTORS.admin);
  const slug = await mintSociety(uniqueName('Limitcheck Villa'), { mobile: uniqueMobile() });

  for (const bad of ['0', '-1', '26', '1000']) {
    const res = await fetch(`${API}/admin/society-candidates/${slug}/duplicates?limit=${bad}`, { headers });
    expect(res.status, `limit=${bad}`).toBe(400);
  }

  const ok = await fetch(`${API}/admin/society-candidates/${slug}/duplicates?limit=25`, { headers });
  expect(ok.status).toBe(200);
});

test('the duplicate hints are staff-only', async ({ login }) => {
  await login.asAdmin();
  const staffHeaders = await authHeaders(ACTORS.admin);
  const slug = await mintSociety(uniqueName('Guardtest Court'), { mobile: uniqueMobile() });

  const allowed = await fetch(`${API}/admin/society-candidates/${slug}/duplicates`, { headers: staffHeaders });
  expect(allowed.status).toBe(200);

  // The scan reads the whole catalogue and is reachable by slug. Left open it is a list of every
  // society whose name resembles anything the caller can mint — cheap enumeration of the catalogue
  // by somebody who should be reading `GET /societies` with its filters and its page.
  const anon = await fetch(`${API}/admin/society-candidates/${slug}/duplicates`);
  expect(anon.status).toBe(401);
});

test('a community details proposal names its society rather than title-casing its slug', async ({ page, login }) => {
  /* The queue row's society name used to be resolved out of the bundled catalogue, for the same
     reason and with the same result as the duplicate column: 28 curated societies, none of them
     member-added, so a proposal filed against a society added last week fell through to
     `titleCase(slug)`. `SocietyProposalResponse` carries `societyName` and `localitySlug` now.
  
     The subject is verified first, deliberately. A proposal against a society still in the
     candidates queue renders on that society's own row, whose name comes from the queue — the
     assertion would pass without the server sending a name at all. Verified, it becomes an orphan
     suggestion in the block above the table, which has nothing but the proposal to name it. */
  const mobile = uniqueMobile();
  const name = `Proposaltest D'Souza Grange ${String(Date.now()).slice(-7)}`;
  const slug = await mintSociety(name, { mobile });
  const headers = await authHeaders(mobile);

  const filed = await fetch(`${API}/societies/${slug}/proposals`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'details', builder: 'Quollhaven Constructions', buildYear: 2019 }),
  });
  expect(filed.status, 'file a details proposal').toBeLessThan(300);

  await login.asAdmin();
  const staff = await authHeaders(ACTORS.admin);
  const verified = await fetch(`${API}/admin/society-candidates/${slug}/verify`, { method: 'POST', headers: staff });
  expect(verified.status, 'verify the subject').toBeLessThan(300);

  await openTab(page, 'candidates');

  /* The apostrophe is the assertion. A slug cannot hold one, so the fallback can only ever produce
     "Proposaltest D Souza Grange …" — the two strings are distinguishable in exactly the way a
     reconstruction differs from the real name, and every society whose name carries punctuation, a
     numeral or a lowercase particle differs from its slug the same way. The fallback string is
     computed from the slug the server actually issued rather than assumed, so this stays a real
     negative if the mint ever changes how it slugifies. */
  const fallback = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(fallback)).toHaveCount(0);
});

test('the residents queue spans societies, and says which desk each request is on', async ({ page, login }) => {
  /* Unfiltered on purpose, and unlike its three neighbours. A residency is the one decision on this
     console that is routinely revisited: a flat changes hands, and rejecting the outgoing resident
     is how the incoming one gets verified. Asking only for `pending` would hide exactly the row an
     operator came for — and the server has no already-decided 409 here for the same reason. */
  await login.asAdmin();
  await openTab(page, 'residents');
  await expect(rows(page).first()).toBeVisible({ timeout: 20000 });

  /* Both seeded societies at once. This is the assertion the route exists for: the queue it
     replaced was addressed by slug, so "who is waiting anywhere" meant one request per society to
     find the handful with anything pending — work that grows with the catalogue rather than with
     the backlog. */
  await expect(rows(page).filter({ hasText: 'Blue Ridge Towers' }).first()).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Kumar Palaash' }).first()).toBeVisible();

  /* And the half of the routing rule a single society cannot show. Blue Ridge has an approved
     claim, so its requests sit with the committee; Kumar Palaash's claim is still with ops, so its
     requests are ops' own. "assigned_to is always committee" passes every assertion one claimed
     society can make. */
  await expect(rows(page).filter({ hasText: 'Blue Ridge Towers' }).first()).toContainText('Committee');
  await expect(rows(page).filter({ hasText: 'Kumar Palaash' }).first()).toContainText('Ops');
});
