import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

// Internal notes, against the real API and the real table.
const RENTAL_STAFF = '9733798115';

const admin = () => authHeaders('9000000000');
const staff = () => authHeaders(RENTAL_STAFF);

const notesUrl = (type, id) => `${API}/admin/notes/${type}/${encodeURIComponent(id)}`;

async function listNotes(type, id, headers) {
  const res = await fetch(notesUrl(type, id), { headers: headers || (await admin()) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function addNote(type, id, body, headers) {
  const res = await fetch(notesUrl(type, id), {
    method: 'POST',
    headers: headers || (await admin()),
    body: JSON.stringify(body),
    // No assertion here on the Add note button being disabled for an empty box.
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// A listing nobody else's spec knows about, under an owner created by the login itself.
async function freshListing(title) {
  const headers = await authHeaders(uniqueMobile());
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title, deal: 'rent', propertyType: 'Flat', price: 24000,
      locality: 'Baner', city: 'Pune', bhk: 2, area: 780, images: await uploadedListingPhotos(headers),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

// A seeded listing that answers to both of its public identifiers.
async function slugAndUuid() {
  const res = await fetch(`${API}/admin/properties?status=approved&size=1`, { headers: await admin() });
  expect(res.status).toBe(200);
  const row = (await res.json()).content?.[0];
  expect(row?.slug, 'seeded listings carry a slug — see the V5 catalogue seed').toBeTruthy();
  return { slug: row.slug, uuid: row.id, title: row.title };
}

// Expand the collapsed "Internal note (optional)" disclosure and type into it.
async function writeNote(dialog, text) {
  await dialog.getByRole('button', { name: /Internal note \(optional\)/ }).click();
  const box = dialog.getByPlaceholder(/Add a note for the team/);
  await expect(box).toBeVisible();
  await box.fill(text);
}

test.describe('LIVE — notes are one table, read by everyone in the back office', () => {
  test('a note is shared across back-office accounts under the writer\u2019s name, scoped to its own record, and walled off from consumers', async () => {
    await test.step('a note one account files is read by another, under the writer\u2019s name', async () => {
      const id = await freshListing('Note subject — cross account');

      const written = await addNote('property', id, {
        text: 'Owner says the photos are the builder\u2019s renders.',
        action: 'Flagged',
      }, await staff());
      expect(written.status).toBe(201);

      // Nothing in that request named an author.
      expect(written.body.authorName).toBeTruthy();
      expect(written.body.text).toContain('builder');

      const seen = await listNotes('property', id);
      expect(seen.status).toBe(200);
      expect(Array.isArray(seen.body)).toBe(true);
      expect(seen.body).toHaveLength(1);
      expect(seen.body[0].authorName).toBe(written.body.authorName);
      expect(seen.body[0].action).toBe('Flagged');
    });
    await test.step('a note belongs to one record and does not follow the id anywhere else', async () => {
      const id = await freshListing('Note subject — scoped');
      expect((await addNote('property', id, { text: 'Only about the listing.' })).status).toBe(201);

      // The shared table must key by entity type and id to avoid cross-entity note leaks.
      const asUser = await listNotes('user', id);
      expect(asUser.status).toBe(200);
      expect(asUser.body).toHaveLength(0);
    });
    await test.step('a consumer is not shown what the back office knows about them', async () => {
      const id = await freshListing('Note subject — walled');
      expect((await addNote('property', id, { text: 'Team only.' })).status).toBe(201);

      const buyer = await authHeaders('9700000001');
      expect((await listNotes('property', id, buyer)).status).toBe(403);
      expect((await addNote('property', id, { text: 'Let me in.' }, buyer)).status).toBe(403);
    });
  });

  test('notes key listings by wire type and either public id, and an id with no listing still takes a note', async () => {
    await test.step('the console\u2019s word for a listing is not the wire\u2019s', async () => {
      const id = await freshListing('Note subject — wire word');

      // The mapper is the only place that translates the UI's `listing` vocabulary.
      const refused = await addNote('listing', id, { text: 'Should not land.' });
      expect(refused.status).toBe(400);

      expect((await listNotes('listing', id)).status).toBe(400);
    });
    await test.step('both ids a listing answers to open the same case file', async () => {
      const { slug, uuid } = await slugAndUuid();

      // Listings have two public ids, and both must reach the same free-text note key.
      const viaEnquiries = `Rang the owner back about their enquiry ${Date.now()}`;
      expect((await addNote('property', uuid, { text: viaEnquiries, action: 'responded' })).status).toBe(201);

      const viaConsole = `Photos re-checked against the RERA filing ${Date.now()}`;
      expect((await addNote('property', slug, { text: viaConsole, action: 'Approved' })).status).toBe(201);

      for (const [label, id] of [['slug', slug], ['uuid', uuid]]) {
        const seen = await listNotes('property', id);
        expect(seen.status, `read by ${label}`).toBe(200);
        const texts = seen.body.map((n) => n.text);
        expect(texts, `read by ${label} is missing the note filed under the other id`)
          .toEqual(expect.arrayContaining([viaEnquiries, viaConsole]));
      }
    });
    await test.step('an id that resolves to no listing still takes a note', async () => {
      // Normalising a slug to a uuid must not turn into existence-checking by the back door.
      const orphan = `never-a-listing-${Date.now()}`;
      const written = await addNote('property', orphan, { text: 'Owner deleted the listing mid-call.' });
      expect(written.status).toBe(201);

      const seen = await listNotes('property', orphan);
      expect(seen.status).toBe(200);
      expect(seen.body).toHaveLength(1);
    });
  });

});

test.describe('LIVE — notes on the communication log', () => {
  test('a note taken during a review is on the timeline when the case file is reopened', async ({ page, login }) => {
    // Converted from `admin/notes.spec.js`, which could only ever prove the rendering.
    const id = await freshListing('Case file — timeline');

    await login.asAdmin();
    // Deep-link because the decision also moves the listing off its queue.
    await page.goto(`/admin/properties?review=${id}`);
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    const modal = page.getByRole('dialog');
    const text = 'Rang the owner; the rent excludes maintenance.';
    await writeNote(modal, text);
    const unticked = modal.getByRole('group', { name: 'Verification checklist' }).getByRole('checkbox', { checked: false });
    for (let left = await unticked.count(); left > 0; left -= 1) {
      await unticked.first().click();
      await expect(unticked).toHaveCount(left - 1);
    }

    await modal.getByRole('button', { name: /^Approve$/ }).click();
    await expect(page.getByText(/Approved & published/)).toBeVisible();

    // Reopen from scratch. Nothing of the first visit survives this.
    await page.goto(`/admin/properties?review=${id}`);
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    await page.getByTestId('review-section-messages').click();
    // `CommunicationLog` had an indigo `note` style and nothing producing one.
    const log = page.getByRole('button', { name: /Communication log/ });
    await expect(log).toBeVisible();
    await log.click();

    const entry = page.getByTestId('comms-entry').filter({ hasText: 'Rang the owner' });
    await expect(entry).toHaveCount(1);
    await expect(entry.getByTestId('comms-entry-detail')).toHaveText(text);
    // The byline the outreach rows cannot carry: the notes route resolves the author server-side.
    await expect(entry).toContainText('Note \u2014 Approved');
  });
});

test.describe('LIVE — notes on a person', () => {
  test('the drawer shows a note a different account filed, and keeps it across a reload', async ({ page, login }) => {
    // Writing a note must not mutate the user row this drawer is showing.
    const res = await fetch(`${API}/users?q=Sakshi%20Rao&size=5`, { headers: await admin() });
    expect(res.status).toBe(200);
    const found = (await res.json()).content.find((u) => /Sakshi Rao/.test(u.name));
    expect(found, 'Sakshi Rao is a seeded fixture — see docs/system/fixture-registry.md').toBeTruthy();

    const stamp = `Called about the deposit dispute ${Date.now()}`;
    const written = await addNote('user', found.id, { text: stamp }, await staff());
    expect(written.status).toBe(201);

    await login.asAdmin();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.getByPlaceholder('Search name, mobile, email…').fill('Sakshi Rao');

    const row = page.getByTestId('queue-row').filter({ hasText: 'Sakshi Rao' }).first();
    await expect(row).toBeVisible();
    await row.locator('[title="View activity"]').click();
    await expect(page.getByRole('heading', { name: /Activity — Sakshi Rao/ })).toBeVisible();

    const panel = page.getByTestId('user-notes');
    const note = panel.getByTestId('user-note').filter({ hasText: stamp });
    await expect(note).toHaveCount(1);
    // Somebody else's name, on a note this browser never wrote.
    await expect(note).toContainText(written.body.authorName);

    // Add a second one through the screen, and prove it survived the trip rather than the state.
    const second = `Second call, ${Date.now()}`;
    await panel.getByRole('textbox').fill(second);
    await panel.getByRole('button', { name: 'Add note' }).click();
    await expect(panel.getByTestId('user-note').filter({ hasText: second })).toHaveCount(1);

    // Escape closes the drawer, ported from `admin/notes.spec.js` when that test was retired.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-notes')).toHaveCount(0);

    await page.reload();
    await page.getByPlaceholder('Search name, mobile, email…').fill('Sakshi Rao');
    await page.getByTestId('queue-row').filter({ hasText: 'Sakshi Rao' }).first()
      .locator('[title="View activity"]').click();
    await expect(page.getByTestId('user-notes').getByTestId('user-note').filter({ hasText: second }))
      .toHaveCount(1);
  });

  // Ported from `admin/notes.spec.js` when that file's account-note test was retired.
  test('an account nobody has written about says so, rather than showing nothing at all', async ({ page, login }) => {
    const mobile = uniqueMobile();
    // Registering through the token endpoint is what mints the account; the profile is incidental.
    await authHeaders(mobile);

    await login.asAdmin();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.getByPlaceholder('Search name, mobile, email…').fill(mobile);

    // Searched by the raw number, found by the masked one, and the two are deliberately different strings.
    const masked = `${mobile.slice(0, 2)}XXXXX${mobile.slice(-3)}`;
    await expect(page.getByTestId('queue-row'),
      'searching for a mobile that belongs to exactly one account did not narrow the directory to it',
    ).toHaveCount(1);
    const row = page.getByTestId('queue-row').filter({ hasText: masked }).first();
    await expect(row, 'the directory found the account but is not masking its number').toBeVisible();
    await row.getByRole('button', { name: 'View activity' }).click();

    const panel = page.getByTestId('user-notes');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('user-note')).toHaveCount(0);
    await expect(panel.getByText(/Nobody has written a note about this account yet/),
      'the panel is empty but says nothing, so a failed fetch and a clean account look identical',
    ).toBeVisible();

  });
});
