/* The two note guards that are about *not writing* — against the live API.
 *
 * `admin/live-notes.spec.js` owns everything about a note that exists: that two different people
 * read the same row out of one table, the byline the server resolves from the token, the entity
 * binding, the communication log, the drawer's persistence and its empty state. None of it is
 * repeated here.
 *
 * These two came off `admin/notes.spec.js`, which kept them on an explicitly stated speed argument —
 * its own docblock called that «a **speed** argument, not a coverage one, and speed is exactly the
 * ground the mock-retirement policy stopped accepting» and then kept them anyway. Converting rather
 * than deleting, because neither claim is made by any live spec, and both get materially stronger
 * on the way across:
 *
 *  - `NoteCreateRequest.text` is `@NotBlank` server-side. So on the mock the "no note filed" case
 *    was a claim about `saveNoteIfAny`'s `trim()` and nothing else; here, a client that posted the
 *    empty string would be *refused*, `saveNoteIfAny` would hand back `{error}`, and the operator
 *    would be told their archive half-worked. The screen and the table disagree in a way only a
 *    live run can see.
 *  - The mock version asserted the absence of an error toast and stopped. Absence of an error is
 *    also what a page that did nothing looks like, so this reads the notes table back over a
 *    separate connection and pairs the empty answer with a **positive anchor**: a second listing
 *    archived *with* a note, through the same modal on the same click path, which must come back
 *    holding exactly one row. Without that, "no note was written" is satisfied by a broken reader.
 *
 * ## Fixtures
 *
 * Both listings are minted by this file under throwaway owners and rejected in teardown, rather
 * than archiving whatever card happens to be first on the console. Archiving is not idempotent and
 * the live database persists for the whole run, so a spec that archived a seeded listing would take
 * it off every screen that follows and read as someone else's failure.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** `pages/admin/properties/constants.js` — enough to be accepted, filed under a real locality. */
const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

/* `listForModeration` fetches `size=100` and warns through `console.error` when the catalogue is
   larger than that. On a database that accumulates listings across a run that is a statement about
   its size, not about this screen. Anchored to the exact wording so nothing else is swallowed. */
const CATALOGUE_TRUNCATED = /^\[property\] \d+ listings matched but only \d+ were fetched/;
const realErrors = (errors) => errors.filter((e) => !CATALOGUE_TRUNCATED.test(e));

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const created = new Set();

/** A pending listing with a title nothing else can match, under an owner nobody else shares. */
async function pendingListing(tag) {
  const title = `Zztest note ${tag} ${Date.now()}`;
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, { ...BASE_LISTING, title });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, title };
}

/**
 * The notes on one listing, read outside the browser that filed them.
 *
 * `toWireType` in `providers/http/noteMapper.js` maps the client's `listing` onto the route's
 * `property`; this speaks the wire word directly because it sits below the mapper, which also makes
 * it an independent check on that translation.
 */
async function notesOn(id) {
  const headers = await authHeaders(ACTORS.admin);
  const res = await api('GET', `/admin/notes/property/${id}`, headers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic note fixture',
    });
  }
  created.clear();
});

/** Find one minted listing on the verification queue and open its Archive modal. */
async function openArchiveFor(page, title) {
  await page.goto('/admin/properties?tab=verify');
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();

  const search = page.getByPlaceholder('Search title, owner, locality\u2026').first();
  await search.fill(title);

  // The queue is server-filtered and debounced, so wait for the catalogue to narrow to this one row
  // before clicking — otherwise `.list-card` first is whatever the unfiltered page was showing.
  const card = page.locator('.list-card').filter({ hasText: title });
  await expect(card).toHaveCount(1);

  await card.locator('[title="Archive"]').click();
  const archive = page.getByRole('dialog', { name: 'Archive listing' });
  await expect(archive).toBeVisible();
  return archive;
}

test('archiving without a note files no note, and does not report a failure for the note it never sent', async ({ page, login, consoleErrors }) => {
  const listing = await pendingListing('silent');
  await login.asAdmin();

  const archive = await openArchiveFor(page, listing.title);

  // The note field is left untouched on purpose: the label says "optional", and the ordinary case
  // is that nobody types anything.
  await archive.getByRole('button', { name: 'Archive', exact: true }).click();

  /* Exact, because the failure copy is the success copy plus a clause — "Listing archived — but the
     internal note could not be saved" contains "Listing archived", so a substring match would read
     the error as a pass, which is the one outcome this test exists to catch. */
  await expect(page.getByText('Listing archived', { exact: true })).toBeVisible();
  await expect(page.getByText(/could not be saved/)).toHaveCount(0);

  // And the table agrees with the screen: nothing was written, so there was nothing to fail.
  expect(await notesOn(listing.id), 'archiving in silence must not leave an empty bullet under the operator\u2019s name').toEqual([]);

  expect(realErrors(consoleErrors)).toHaveLength(0);
});

test('archiving with a note files exactly that note, so the silent case above is a real absence', async ({ page, login }) => {
  const listing = await pendingListing('spoken');
  const text = `Owner asked us to take this down \u2014 ${Date.now()}`;
  await login.asAdmin();

  const archive = await openArchiveFor(page, listing.title);
  /* The note field is collapsed by default behind its own toggle — which is also why the test above
     is the honest default path rather than a case someone has to opt into. */
  await archive.getByRole('button', { name: 'Internal note (optional)' }).click();
  await archive.getByPlaceholder('Add a note for the team...').fill(text);
  await archive.getByRole('button', { name: 'Archive', exact: true }).click();

  await expect(page.getByText('Listing archived', { exact: true })).toBeVisible();

  /* The positive anchor for the test above, and it has to be the same modal on the same click path:
     a reader that returned `[]` for everything would satisfy "no note was written" perfectly. */
  const notes = await notesOn(listing.id);
  expect(notes).toHaveLength(1);
  expect(notes[0].text).toBe(text);
  // `submitArchive` passes 'Archived' as the action label, and the byline is resolved server-side
  // from the token rather than sent by the browser.
  expect(notes[0].action).toBe('Archived');
  expect(notes[0].authorName, 'the byline is the server\u2019s answer, not the page\u2019s').toBeTruthy();
});

test('the Add note button refuses whitespace, and takes real text', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await page.locator('table').locator('[title="View activity"]').first().click();

  const notes = page.getByTestId('user-notes');
  const add = notes.getByRole('button', { name: 'Add note' });

  await expect(add).toBeDisabled();
  await notes.getByRole('textbox').fill('   ');
  await expect(add, 'three spaces are not a note').toBeDisabled();

  /* The positive half. Without it "disabled" is satisfied by a button that is *always* disabled —
     which is the more likely regression, since it is what a broken permission check produces, and
     it would leave this desk unable to write a note at all while every assertion above still
     passed. Nothing is submitted: the claim is about the control, and the note table is
     `live-notes.spec.js`'s. */
  await notes.getByRole('textbox').fill('   real text   ');
  await expect(add, 'a note with words in it must be fileable').toBeEnabled();
});
