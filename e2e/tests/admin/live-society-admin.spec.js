/**
 * The society **overlay editor** — the Directory tab's Edit dialog — against the live API.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-society-admin.spec.js --config=playwright.config.js
 *
 * ## Why this is its own file rather than more of `live-societies.spec.js`
 *
 * That file covers the five *queues* — claims, residents, candidates, merges, moderation — which
 * are work items arriving from outside and being decided. This is the opposite motion: an operator
 * correcting the record on a building nobody has queued. The two share a screen and nothing else,
 * and a file that covered both would be named after the URL instead of after a behaviour.
 *
 * ## What was actually wrong, and why a live spec is the only thing that could have caught it
 *
 * Until this slice the dialog wrote `pnSocietyOverlay` in `localStorage`. Five fields — registration
 * verified, conveyance done, claim status, maintenance per sqft, and an internal note — saved to the
 * browser that typed them and nowhere else. Four of those five are exactly what a buyer reads to
 * judge whether a building's paperwork is in order, so an operator who ticked "conveyance done"
 * corrected the record for themselves and for no one, while being told it had saved.
 *
 * That bug is invisible to a mock-mode spec **by construction**: a seeded spec asserts against the
 * same `localStorage` the dialog wrote, so it passes precisely because the write never left the
 * browser. `tests/admin/societies.spec.js` covered the dialog and was green throughout — it has
 * since been deleted for that reason, its surviving claims moved to
 * `admin/live-societies-directory.spec.js`. The only
 * assertion that can tell the two apart is one that reads the value back from somewhere the browser
 * cannot have reached — which is what every test below does, over the API with a token of its own.
 *
 * ## Nothing here seeds storage
 *
 * No `addInitScript`, no `localStorage.setItem`. The rule from `live-societies.spec.js` applies with
 * extra force here, because browser storage is the very thing this screen was wrongly using.
 *
 * ## Why the Directory tab's first row, rather than a named society
 *
 * The Directory tab is a real server page now — `GET /societies`, twenty rows, with a search box —
 * so a named society *is* reachable. This still drives whichever row is first, deliberately: the
 * point of these tests is the edit round trip, and pinning them to a particular building would
 * couple them to the seeded catalogue's alphabetical head, which is a fixture detail that has moved
 * before. The slug is read back off the PATCH the dialog itself issues, so the test never has to
 * know which building it picked.
 *
 * What did change with the move to server paging: the row is now whatever `name ASC` puts first
 * across the whole catalogue rather than whatever the bundled chunk happened to load, and it is a
 * row the server returned — so an edit made here is visible to the next reader, which is the thing
 * these tests exist to prove.
 *
 * Fixtures: `docs/system/fixture-registry.md` → the `society` rows.
 */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** A note no other run — or other test in this file — could have written. */
const uniqueNote = (label) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

/** Open the Directory tab and wait for its table, not its heading. */
async function openDirectory(page) {
  await page.goto('/admin/societies?tab=directory');
  await expect(page.getByRole('heading', { name: 'Societies', exact: true })).toBeVisible({ timeout: 20000 });
  // Rows are in the DOM twice — `Table` renders an `sm:hidden` stacked card per row before the
  // `hidden sm:block` table. Scope to the table or every count is doubled.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20000 });
}

/** The dialog, by its aria-label rather than its heading — the heading is the society's name. */
const dialog = (page) => page.getByRole('dialog', { name: 'Edit society' });

/** Mint a community society over the API and return its slug. */
async function mintSociety(name, mobile) {
  const headers = await authHeaders(mobile);
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ name, localitySlug: 'wakad', lat: 18.5989, lng: 73.7629 }),
  });
  expect(res.status, `mint ${name}`).toBeLessThan(300);
  return (await res.json()).slug;
}

test('the dialog opens from the server, and what it saves outlives the browser that typed it', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await openDirectory(page);

  const note = uniqueNote('Committee contactable via the secretary;');

  /* Assert the *read* before touching anything. `openEdit` used to seed the form from
     `getSocietyOverlay(slug)` — a localStorage lookup — which meant the note was written to the
     server by the save below and then read straight back out of this browser, so a round trip that
     never involved the server looked identical to one that did. Waiting on the GET is what
     distinguishes them, and it has to be armed before the click. */
  const opened = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'GET',
    { timeout: 20000 },
  );
  await page.locator('table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
  expect((await opened).status(), 'the editor reads the society from the server').toBe(200);

  await expect(dialog(page)).toBeVisible();

  /* Absolute values, never a toggle. A checkbox flipped from whatever it happened to be leaves the
     assertion depending on the row's prior state, which on a persisted e2e database is a function
     of whatever ran last. */
  await dialog(page).getByRole('checkbox').first().setChecked(true);
  await dialog(page).getByRole('checkbox').nth(1).setChecked(true);
  await dialog(page).getByLabel(/Maintenance/i).fill('7');
  await dialog(page).getByLabel(/Admin note/i).fill(note);

  const saved = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await dialog(page).getByRole('button', { name: 'Save' }).click();

  const res = await saved;
  expect(res.status(), 'the save reaches the server').toBe(200);
  const slug = new URL(res.url()).pathname.split('/').pop();

  await expect(page.getByText('Society details saved')).toBeVisible();
  await expect(dialog(page)).toHaveCount(0);

  /* The assertion this file exists for. Read back over the API with a token minted here, so nothing
     in the answer can have come from the page's own storage, its React state, or its cache. If the
     dialog were still writing an overlay, everything above would pass and this would not. */
  const back = await fetch(`${API}/admin/societies/${slug}`, { headers: await authHeaders('9000000000') });
  expect(back.status).toBe(200);
  const row = await back.json();
  expect(row.adminNote, 'the note is on the server, not in this browser').toBe(note);
  expect(row.registration).toBe(true);
  expect(row.conveyance).toBe(true);
  expect(Number(row.maintenancePerSqft)).toBe(7);

  expect(consoleErrors).toHaveLength(0);
});

test('a refused save keeps the dialog open and does not claim it worked', async ({ page, login }) => {
  await login.asAdmin();
  await openDirectory(page);

  await page.locator('table tbody tr').first().getByRole('button', { name: 'Edit' }).click();
  await expect(dialog(page)).toBeVisible();

  /* `@DecimalMax("100")` on the request record. 500/sqft is not a typo anyone would catch by eye on
     a screen that used to accept it silently — the old form wrote whatever it was given to
     localStorage and could not fail, which is why the success toast was fired unconditionally. */
  await dialog(page).getByLabel(/Maintenance/i).fill('500');

  const refused = page.waitForResponse(
    (r) => /\/api\/admin\/societies\/[^/?]+$/.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 20000 },
  );
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  expect((await refused).status(), 'the server refuses an out-of-range figure').toBe(422);

  /* Both halves matter, and each is trivially false-passable alone: a dialog that closed on failure
     would still show no success toast, and a success toast beside an open dialog would still leave
     the operator informed. Together they are the claim — the edit was not accepted and the operator
     has not been told otherwise. */
  await expect(page.getByText('Society details saved')).toHaveCount(0);
  await expect(dialog(page)).toBeVisible();
});

test('the internal note stays off the payload a visitor gets, while the four public facts land on it', async () => {
  const slug = await mintSociety(`Notetest Residency ${String(Date.now()).slice(-7)}`, uniqueMobile());
  const note = uniqueNote('Chairperson disputes the conveyance date;');
  const admin = await authHeaders('9000000000');

  const res = await fetch(`${API}/admin/societies/${slug}`, {
    method: 'PATCH',
    headers: { ...admin, 'content-type': 'application/json' },
    body: JSON.stringify({ registration: true, conveyance: true, maintenancePerSqft: 4.5, adminNote: note }),
  });
  expect(res.status).toBe(200);

  /* Signed out, deliberately — `GET /societies/{slug}` is the payload every anonymous reader gets,
     and "the note is private" is a claim about that reader and no other. */
  const pub = await fetch(`${API}/societies/${slug}`);
  expect(pub.status).toBe(200);
  const body = await pub.json();

  /* Asserted twice, because either assertion alone has an obvious false pass: an absent `adminNote`
     key proves nothing if the prose were copied into some other field, and a substring sweep of the
     serialised body proves nothing about the contract. */
  expect(body.adminNote, 'no note field on the public shape').toBeUndefined();
  expect(JSON.stringify(body), 'the prose appears nowhere in the payload').not.toContain(note);

  /* The control. Without this the test above passes just as well against a PATCH that silently
     discarded everything, which is the failure mode it is supposed to be ruling out. */
  expect(body.registration).toBe(true);
  expect(body.conveyance).toBe(true);
});
