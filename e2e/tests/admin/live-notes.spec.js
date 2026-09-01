import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/*
   Internal notes, against the real API and the real table.

   ## Why this file has to exist separately from `admin/notes.spec.js`

   The mock spec proves the screens. It cannot prove the thing the item was actually about. Until
   this ledger item, five moderation screens wrote their notes into `db.internalNotes` in the
   browser's own localStorage while the decision printed beside them was a genuine API call landing
   in the audit log. Every mock assertion about a note passed, because the same browser that wrote
   it read it back — and would have gone on passing on the day the feature was found to be a
   private diary that nobody else could see.

   So the assertions below are the ones a single-browser suite structurally cannot make:

     - **Two accounts, one table.** A staffer files a note through their own token; an administrator
       reads it back through theirs, and finds the staffer's real name on it rather than "You" or
       the id of whoever happens to be looking. Deliberately inter-transparent: there are no
       per-team walls, because a note nobody else can read is a note the next person on the case
       will rewrite from scratch.
     - **The byline is the server's, not the sender's.** Nothing in the request says who wrote it.
     - **An edit does not launder authorship.** Notes are mutable on purpose — they are retained
       customer information that goes stale, not scratch — but the person who filed it stays on it.
     - **The wall holds.** A consumer's token gets nothing, in either direction.
     - **The wire word is `property`.** The console has said `listing` since it was a mock; the
       schema says `property`, like every other route. One mapper bridges the two and the server
       refuses the console's word outright, so a second spelling cannot quietly take root.

   ## What is asserted through the browser and what is asserted through `fetch`

   Only the notes panel on a person goes through the UI, because `/admin/users` has a server-side
   search and a fresh row can be reached by name in one step. The listing notes are asserted against
   the API: a listing this file creates would be somewhere on page four of the console's catalogue,
   and a spec that pages to find it is asserting about pagination.

   Fixtures: Sakshi Rao, read-only, for the drawer. Every listing here is created by its own test.
*/

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
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A listing nobody else's spec knows about, under an owner created by the login itself. */
async function freshListing(title) {
  const headers = await authHeaders(uniqueMobile());
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title, deal: 'rent', propertyType: 'Flat', price: 24000,
      locality: 'Baner', city: 'Pune', bhk: 2, area: 780,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

test.describe('LIVE — notes are one table, read by everyone in the back office', () => {
  test('a note one account files is read by another, under the writer\u2019s name', async () => {
    const id = await freshListing('Note subject — cross account');

    const written = await addNote('property', id, {
      text: 'Owner says the photos are the builder\u2019s renders.',
      action: 'Flagged',
    }, await staff());
    expect(written.status).toBe(201);

    /* Nothing in that request named an author. The id came off the token, and the name off the
       users table at read time — so a staffer who is later renamed is renamed on their old notes
       too, which is the correct behaviour for a record about a customer rather than a signature. */
    expect(written.body.authorName).toBeTruthy();
    expect(written.body.text).toContain('builder');

    const seen = await listNotes('property', id);
    expect(seen.status).toBe(200);
    expect(Array.isArray(seen.body)).toBe(true);
    expect(seen.body).toHaveLength(1);
    expect(seen.body[0].authorName).toBe(written.body.authorName);
    expect(seen.body[0].action).toBe('Flagged');
  });

  test('an edit changes the words and not the byline', async () => {
    const id = await freshListing('Note subject — edited');

    const first = await addNote('property', id, { text: 'Waiting on the rent agreement.' }, await staff());
    expect(first.status).toBe(201);
    const author = first.body.authorName;

    /* An administrator correcting a colleague's note is the ordinary case, not an exception: the
       note describes the case, and the case moved on. What must not happen is the correction
       quietly reassigning the observation to whoever touched it last. */
    const res = await fetch(`${API}/admin/notes/${first.body.id}`, {
      method: 'PATCH', headers: await admin(),
      body: JSON.stringify({ text: 'Rent agreement arrived; nothing outstanding.' }),
    });
    expect(res.status).toBe(200);
    const edited = await res.json();
    expect(edited.text).toBe('Rent agreement arrived; nothing outstanding.');
    expect(edited.authorName).toBe(author);
    expect(new Date(edited.updatedAt).getTime()).toBeGreaterThan(new Date(edited.createdAt).getTime());
  });

  test('a note belongs to one record and does not follow the id anywhere else', async () => {
    const id = await freshListing('Note subject — scoped');
    expect((await addNote('property', id, { text: 'Only about the listing.' })).status).toBe(201);

    /* Same id, different family. The table is keyed on the pair, and a lookup that dropped the
       type would hand a note about a listing to whoever opened the account drawer for a user whose
       id happened to collide — which is exactly the kind of leak a single shared notes table
       invites if the key is written carelessly. */
    const asUser = await listNotes('user', id);
    expect(asUser.status).toBe(200);
    expect(asUser.body).toHaveLength(0);
  });

  test('the console\u2019s word for a listing is not the wire\u2019s', async () => {
    const id = await freshListing('Note subject — wire word');

    /* `listing` is what every admin screen has called it since the mock era, and the mapper in
       `services/providers/http/noteMapper.js` is the single place that translates. The server
       refusing it outright is what keeps that one place honest — a permissive server would let a
       second spelling into the table and nobody would notice until a read came back short. */
    const refused = await addNote('listing', id, { text: 'Should not land.' });
    expect(refused.status).toBe(400);

    expect((await listNotes('listing', id)).status).toBe(400);
  });

  test('a consumer is not shown what the back office knows about them', async () => {
    const id = await freshListing('Note subject — walled');
    expect((await addNote('property', id, { text: 'Team only.' })).status).toBe(201);

    const buyer = await authHeaders('9700000001');
    expect((await listNotes('property', id, buyer)).status).toBe(403);
    expect((await addNote('property', id, { text: 'Let me in.' }, buyer)).status).toBe(403);
  });
});

test.describe('LIVE — notes on a person', () => {
  test('the drawer shows a note a different account filed, and keeps it across a reload', async ({ page, login }) => {
    /* The subject is read-only here: the note is a row of its own and Sakshi's account is not
       touched by writing one, so this stays safe to run beside the other user specs. */
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

    /* `Table` renders a stacked mobile card for every row before the table itself, so an unscoped
       action lookup resolves to a permanently hidden duplicate. */
    const row = page.locator('table').getByRole('row', { name: /Sakshi Rao/ }).first();
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

    await page.reload();
    await page.getByPlaceholder('Search name, mobile, email…').fill('Sakshi Rao');
    await page.locator('table').getByRole('row', { name: /Sakshi Rao/ }).first()
      .locator('[title="View activity"]').click();
    await expect(page.getByTestId('user-notes').getByTestId('user-note').filter({ hasText: second }))
      .toHaveCount(1);
  });
});
