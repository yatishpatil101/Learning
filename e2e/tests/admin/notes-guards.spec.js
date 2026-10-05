// The two note guards about *not writing*; a note that exists is `admin/notes.spec.js`'s.
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

// `pages/admin/properties/constants.js` — enough to be accepted, filed under a real locality.
const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

// Shared databases make moderation size warnings about the catalogue, not this screen.
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

// A pending listing with a title nothing else can match, under an owner nobody else shares.
async function pendingListing(tag) {
  const title = `Zztest note ${tag} ${Date.now()}`;
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, { ...BASE_LISTING, title, images: await uploadedListingPhotos(headers) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, title };
}

// The notes on one listing, read outside the browser that filed them.
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
      reasonCode: 'other',
      reason: 'Zztest cleanup \u2014 synthetic note fixture',
    });
  }
  created.clear();
});

async function openArchiveFor(page, title) {
  await page.goto('/admin/properties?tab=verify');
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();

  const search = page.getByPlaceholder('Title, owner, mobile or ID').first();
  await search.fill(title);

  const card = page.getByTestId('queue-row').filter({ hasText: title });
  await expect(card).toHaveCount(1);

  await card.getByRole('button', { name: 'Archive', exact: true }).click();
  const archive = page.getByRole('dialog', { name: 'Archive listing' });
  await expect(archive).toBeVisible();
  return archive;
}

test('archiving files no note unless one is typed, and then exactly that note', async ({ page, login, consoleErrors }) => {
  await test.step('archiving without a note files no note, and does not report a failure for the note it never sent', async () => {
    const listing = await pendingListing('silent');
    await login.asAdmin();

    const archive = await openArchiveFor(page, listing.title);

    // The note field is left untouched on purpose: the label says "optional", and the ordinary case
    // is that nobody types anything.
    await archive.getByRole('button', { name: 'Archive', exact: true }).click();

    // Exact match because failure text contains the success phrase.
    await expect(page.getByText('Listing archived', { exact: true })).toBeVisible();
    await expect(page.getByText(/could not be saved/)).toHaveCount(0);

    // And the table agrees with the screen: nothing was written, so there was nothing to fail.
    expect(await notesOn(listing.id), 'archiving in silence must not leave an empty bullet under the operator\u2019s name').toEqual([]);

    expect(realErrors(consoleErrors)).toHaveLength(0);
  });
  await test.step('archiving with a note files exactly that note, so the silent case above is a real absence', async () => {
    const listing = await pendingListing('spoken');
    const text = `Owner asked us to take this down \u2014 ${Date.now()}`;

    const archive = await openArchiveFor(page, listing.title);
    // The default path keeps notes hidden behind their toggle.
    await archive.getByRole('button', { name: 'Internal note (optional)' }).click();
    await archive.getByPlaceholder('Add a note for the team...').fill(text);
    await archive.getByRole('button', { name: 'Archive', exact: true }).click();

    await expect(page.getByText('Listing archived', { exact: true })).toBeVisible();

    // Same modal anchor prevents an always-empty reader from satisfying absence checks.
    const notes = await notesOn(listing.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe(text);
    // `submitArchive` passes 'Archived' as the action label, and the byline is resolved server-side
    // from the token rather than sent by the browser.
    expect(notes[0].action).toBe('Archived');
    expect(notes[0].authorName, 'the byline is the server\u2019s answer, not the page\u2019s').toBeTruthy();
  });
});

test('the Add note button refuses whitespace, and takes real text', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await page.getByTestId('queue-row').locator('[title="View activity"]').first().click();

  const notes = page.getByTestId('user-notes');
  const add = notes.getByRole('button', { name: 'Add note' });

  await expect(add).toBeDisabled();
  await notes.getByRole('textbox').fill('   ');
  await expect(add, 'three spaces are not a note').toBeDisabled();

  // Positive control proves the button is permission-disabled, not always disabled.
  await notes.getByRole('textbox').fill('   real text   ');
  await expect(add, 'a note with words in it must be fileable').toBeEnabled();
});
