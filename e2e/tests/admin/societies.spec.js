/** Society ops console (candidates and merges) against the live API; each test mints its own candidates over `POST /societies`
 * because the tab lists only the 20 newest, and nothing here seeds storage. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';


/** Opens a console tab by URL param (`useTabParam`) and waits for its heading; navigating, not clicking, names the tab on failure. */
async function openTab(page, tab, search) {
  await page.goto(`/admin/societies?tab=${tab}`);
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible({ timeout: 20000 });
  // The queue pages client-side at ten, and every spec that mints makes it longer.
  if (search) await page.getByPlaceholder('Society or locality').fill(search);
}

const rows = (page) => page.getByTestId('queue-row');

/** The row whose *Society* column is this name; a plain name filter also matches rows listing it under "Similar to".
 * Scoped to the card title, the society the row is about. */
const named = (page, name) =>
  rows(page).filter({ has: page.locator('h3').filter({ hasText: name }) });

/** Mint a community society over the API and return its slug. */
async function mintSociety(name, { mobile, apart = false, mintOrigin }) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name, placeId: `e2e-${name}`.replace(/[^A-Za-z0-9_-]/g, '-'), ...(mintOrigin ? { mintOrigin } : {}), ...(apart ? { localitySlug: 'kharadi', lat: 18.5512, lng: 73.9402 } : { localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 }) }),
  });
  expect(res.status, `mint ${name}`).toBeLessThan(300);
  return (await res.json()).slug;
}

/** A name no other run will collide with — the same trick as `uniqueMobile`, for societies. */
const uniqueName = (label) => `${label} ${String(Date.now()).slice(-7)}`;

test('the desk is exactly Candidates and Directory, loads from the server, and has no console errors', async ({ page, login, consoleErrors }) => {
  const name = uniqueName('Deskcheck Towers');
  await mintSociety(name, { mobile: uniqueMobile() });
  await login.asAdmin();
  await openTab(page, 'candidates', name);

  await expect(page.getByRole('tab')).toHaveText([/^Candidates/, /^Directory/]);
  for (const gone of ['Claims', 'Residents', 'Moderation']) {
    await expect(page.getByRole('tab', { name: new RegExp(`^${gone}`) })).toHaveCount(0);
  }

  // Scoped to the society name rather than counted, because other specs mint candidates of their own.
  await expect(named(page, name)).toHaveCount(1);

  /* The disclosure banner renders only when a queue failed to load, and its absence is the assertion
     that the reads answered — an empty table on an ops screen reads as "nothing to do". */
  await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);

  expect(consoleErrors).toHaveLength(0);
});

test('the retired society desk routes are gone: a removed tab falls back to Candidates, and the verify and claims APIs answer no more', async ({ page, login }) => {
  const slug = await mintSociety(uniqueName('Noverify Towers'), { mobile: uniqueMobile() });
  const headers = await authHeaders(ACTORS.admin);

  const verify = await fetch(`${API}/admin/society-candidates/${slug}/verify`, { method: 'POST', headers });
  expect(verify.status, 'verify left the API').toBeGreaterThanOrEqual(400);
  expect(verify.status).not.toBe(500);

  const claims = await fetch(`${API}/admin/society-claims?status=pending&size=5`, { headers });
  expect(claims.status, 'the claims queue left the API').toBeGreaterThanOrEqual(400);
  expect(claims.status).not.toBe(500);

  const summary = await fetch(`${API}/admin/societies/summary`, { headers });
  expect(summary.status).toBe(200);
  expect(Object.keys(await summary.json())).toEqual(['candidates']);

  await login.asAdmin();
  await openTab(page, 'claims');
  await expect(page.getByRole('tab', { name: /^Candidates/ })).toHaveAttribute('aria-selected', 'true');
});

test('a candidate row offers Merge and no Verify', async ({ page, login }) => {
  const name = uniqueName('Mergeonly Court');
  await mintSociety(name, { mobile: uniqueMobile() });
  await login.asAdmin();
  await openTab(page, 'candidates', name);

  const row = named(page, name);
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('button', { name: 'Merge' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Verify', exact: true })).toHaveCount(0);
});

test('a candidate row names where it came from: a listing, or searcher demand', async ({ page, login }) => {
  const fromListing = uniqueName('Listorigin Plaza');
  const fromDemand = uniqueName('Demandorigin Plaza');
  await mintSociety(fromListing, { mobile: uniqueMobile() });
  await mintSociety(fromDemand, { mobile: uniqueMobile(), mintOrigin: 'demand' });
  await login.asAdmin();

  await openTab(page, 'candidates', fromListing);
  await expect(named(page, fromListing)).toContainText('From a listing');
  await expect(named(page, fromListing)).not.toContainText('Searcher demand');

  await page.getByPlaceholder('Society or locality').fill(fromDemand);
  await expect(named(page, fromDemand)).toContainText('Searcher demand');
  await expect(named(page, fromDemand)).not.toContainText('From a listing');
});

test('merging a duplicate takes it off the queue without deleting it, and undoes cleanly', async ({ page, login }) => {
  /* The duplicate is minted here and the survivor is a catalogue society, as an operator merging a typo into a real building would. */
  const dupe = uniqueName('Mergetest Blue Ridge Tower');
  const dupeSlug = await mintSociety(dupe, { mobile: uniqueMobile() });

  await login.asAdmin();
  await openTab(page, 'candidates', dupe);

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

  /* The duplicate's row survives the merge (it is a pointer), which is what makes the undo below possible. */
  const still = await fetch(`${API}/societies/${dupeSlug}`);
  expect(still.status).toBe(200);

  // And the undo. Keyed by the society that was merged away, not by the survivor: a survivor can
  // have absorbed several, so "undo the merge on this society" would be ambiguous.
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByText(/stands on its own again/i)).toBeVisible();
  await expect(named(page, dupe)).toHaveCount(1);
});

// Duplicate hints: subjects are minted, since a hint about a seeded society could have come from the bundled catalogue.

test('the duplicate column finds a second copy the bundled catalogue never held, and says so when nothing resembles a society', async ({ page, login }) => {
  await test.step('the duplicate column finds a second copy the bundled catalogue never held', async () => {
    /* A typo pair: neither name is a substring of the other and both share the run stamp, so locators never match the wrong row or a previous run. */
    const stamp = String(Date.now()).slice(-7);
    const original = `Quollhaven Ridge ${stamp}`;
    const typo = `Quollhaven Rydge ${stamp}`;
    await mintSociety(original, { mobile: uniqueMobile() });
    await mintSociety(typo, { mobile: uniqueMobile() });

    await login.asAdmin();
    await openTab(page, 'candidates', typo);

    const row = named(page, typo);
    await expect(row).toHaveCount(1);
    /* The hint is fetched, so the column has a "Checking…" state; wait for the chip, since `not.toContainText('No obvious match')`
       would pass immediately against a column that has not started. */
    await expect(row.getByText(original)).toBeVisible({ timeout: 20000 });
    await expect(row).not.toContainText('No obvious match');

    /* And the chip is the shortcut it exists to be: one click puts the operator in the merge dialog
       with this pair already chosen. */
    await row.getByRole('button', { name: original }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge society' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(typo);
  });
  await test.step('a society that resembles nothing says so, rather than saying nothing', async () => {
    /* "Checking…" must settle into "No obvious match"; one that never settles is what a failed fetch leaves if the page does not record it. */
    // Locality and pin add to a name score, so anything minted beside it would be offered as a duplicate.
    const name = `Ynthracite Bqorvald ${String(Date.now()).slice(-7)}`;
    await mintSociety(name, { mobile: uniqueMobile(), apart: true });

    await login.asAdmin();
    await openTab(page, 'candidates', name);

    const row = named(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.getByText('No obvious match')).toBeVisible({ timeout: 20000 });
  });
  await test.step('the duplicate endpoint refuses a hint count outside its range rather than quietly changing it', async () => {
    const headers = await authHeaders(ACTORS.admin);
    const slug = await mintSociety(`Limitcheck Villa ${String(Date.now()).slice(-7)}`, { mobile: uniqueMobile() });

    for (const bad of ['0', '-1', '26', '1000']) {
      const res = await fetch(`${API}/admin/society-candidates/${slug}/duplicates?limit=${bad}`, { headers });
      expect(res.status, `limit=${bad}`).toBe(400);
    }

    const ok = await fetch(`${API}/admin/society-candidates/${slug}/duplicates?limit=25`, { headers });
    expect(ok.status).toBe(200);
  });
});

test('a duplicate check that fails says so, instead of saying "No obvious match"', async ({ page, login }) => {
  /* A request that did not answer must not record `[]` and render "nothing like this", the case where the operator most needs to look twice. */
  const name = `Failcheck Manor ${String(Date.now()).slice(-7)}`;
  await mintSociety(name, { mobile: uniqueMobile() });

  await page.route('**/admin/society-candidates/*/duplicates*', (route) => route.abort('failed'));

  await login.asAdmin();
  await openTab(page, 'candidates', name);

  const row = named(page, name);
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Could not check')).toBeVisible({ timeout: 20000 });
  await expect(row).not.toContainText('No obvious match');
});
