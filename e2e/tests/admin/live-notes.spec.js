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
     - **One listing, one case file.** A listing answers to a slug *and* a uuid, the contract takes
       either, and different screens hold different ones. Until `NoteEntityKey` that made two
       histories with nothing on screen to say so. Every suite was blind to it by construction —
       the console specs speak slug on both sides of every assertion, these speak uuid on both
       sides — so the assertion had to be one that crosses.

   ## What is asserted through the browser and what is asserted through `fetch`

   Through the browser: the notes panel on a person, because `/admin/users` has a server-side search
   and a fresh row can be reached by name in one step; and the review modal's communication log,
   because "the note is rendered on the timeline" is a claim about a screen that no API call can
   answer. Both are round trips — the log is re-read after a reload, which is exactly what the
   localStorage store could fake.

   Everything else is asserted against the API. A listing this file creates would be somewhere on
   page four of the console's catalogue, and a spec that pages to find it is asserting about
   pagination.

   Fixtures: Sakshi Rao, read-only, for the drawer. Every listing here is created by its own test,
   except where a *seeded* one is needed because only seeded listings have a slug.
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

/**
 * A seeded listing that answers to both of its public identifiers.
 *
 * Only seeded rows have a slug — nothing in the application mints one, so a listing this file
 * creates has a uuid and nothing else, and could not show the split below even when it existed.
 */
async function slugAndUuid() {
  const res = await fetch(`${API}/admin/properties?status=approved&size=1`, { headers: await admin() });
  expect(res.status).toBe(200);
  const row = (await res.json()).content?.[0];
  expect(row?.slug, 'seeded listings carry a slug — see the V5 catalogue seed').toBeTruthy();
  return { slug: row.slug, uuid: row.id, title: row.title };
}

/** Expand the collapsed "Internal note (optional)" disclosure and type into it. */
async function writeNote(dialog, text) {
  await dialog.getByRole('button', { name: /Internal note \(optional\)/ }).click();
  const box = dialog.getByPlaceholder(/Add a note for the team/);
  await expect(box).toBeVisible();
  await box.fill(text);
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

  test('both ids a listing answers to open the same case file', async () => {
    const { slug, uuid } = await slugAndUuid();

    /* A listing has two public identifiers and the contract accepts either one everywhere, so both
       were arriving at a table whose `entity_id` is free text. The moderation console sends the
       slug — its seam id is `slug || uuid` — and the enquiries board sends the uuid, because an
       enquiry row carries `propertyId` straight off the wire.

       That gave one listing two histories and told nobody. Each writer read back exactly what it
       had written, so both screens looked correct: the note about having responded to an enquiry
       was filed against a key the review modal's timeline never queries, and was simply absent
       from the case file. An empty history and a history you cannot see render identically — the
       precise failure V90 was created to end, one layer down.

       Neither suite could catch it alone. The console-driven specs speak slug on both sides of
       every assertion and the API specs here speak uuid on both sides, so each was internally
       consistent and blind. This is the assertion that crosses. */
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

  test('an id that resolves to no listing still takes a note', async () => {
    /* Normalising a slug to a uuid must not turn into existence-checking by the back door. V90 made
       `entity_id` deliberately not a foreign key, because "a note about a listing that is archived
       an hour later is precisely the note worth keeping"; a resolver that refused what it could not
       find would quietly overturn that, and the note that explains a deletion is the one nobody can
       reconstruct afterwards. Unresolvable ids are stored as given, exactly as before. */
    const orphan = `never-a-listing-${Date.now()}`;
    const written = await addNote('property', orphan, { text: 'Owner deleted the listing mid-call.' });
    expect(written.status).toBe(201);

    const seen = await listNotes('property', orphan);
    expect(seen.status).toBe(200);
    expect(seen.body).toHaveLength(1);
  });
});

test.describe('LIVE — notes on the communication log', () => {
  test('a note taken during a review is on the timeline when the case file is reopened', async ({ page, login }) => {
    /* Converted from `admin/notes.spec.js`, which could only ever prove the rendering. Whether the
       row comes back is a claim about the server: the log is a fresh read after a full round trip,
       and against localStorage the browser was reading its own writing.

       The listing is created here rather than borrowed from the seed because the decision below is
       real — approving a seeded row would move it between queues that another live spec counts. */
    const id = await freshListing('Case file — timeline');

    await login.asAdmin();
    /* Deep link rather than the queue, because the decision that files the note also moves the
       listing off the queue it was sitting in. `findListing` resolves against every page the client
       has loaded, and a listing created a moment ago is the newest row on the All page. */
    await page.goto(`/admin/properties?review=${id}`);
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    const modal = page.getByRole('dialog');
    const text = 'Rang the owner; the rent excludes maintenance.';
    await writeNote(modal, text);
    /* Approving with checklist items unticked raises a `window.confirm`, which Playwright dismisses
       by default — that would abort the decision and leave this asserting nothing. */
    page.once('dialog', (d) => d.accept());
    await modal.getByRole('button', { name: /Approve & publish/ }).click();
    await expect(page.getByText(/Approved & published/)).toBeVisible();

    // Reopen from scratch. Nothing of the first visit survives this.
    await page.goto(`/admin/properties?review=${id}`);
    await expect(page.getByRole('heading', { name: 'Verify property' })).toBeVisible();

    /* `CommunicationLog` had an indigo `note` style and nothing producing one. The chaser ledger
       and the notes answer the same question — what has already been done about this listing — and
       reading them in two panels made the operator interleave them by eye. */
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

    /* Escape closes the drawer, ported from `admin/notes.spec.js` when that test was retired. It is
       the only way out of this panel that does not involve finding a control, so a drawer that
       traps the keyboard is one an operator has to reload the page to leave \u2014 and asserting that it
       is *gone*, rather than merely hidden, is what makes the reopen below a fresh fetch rather
       than a re-render of a panel that never unmounted. */
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('user-notes')).toHaveCount(0);

    await page.reload();
    await page.getByPlaceholder('Search name, mobile, email…').fill('Sakshi Rao');
    await page.locator('table').getByRole('row', { name: /Sakshi Rao/ }).first()
      .locator('[title="View activity"]').click();
    await expect(page.getByTestId('user-notes').getByTestId('user-note').filter({ hasText: second }))
      .toHaveCount(1);
  });

  /* Ported from `admin/notes.spec.js` when that file's account-note test was retired. The empty
     state is the assertion that file was carrying which nothing here made, and it is not cosmetic:
     under the mock provider it used to be the *only* state the panel could reach, because the store
     read `db.internalNotes['user:' + id]`, a key nothing ever wrote, so every account looked clean
     and every "no notes" screen was a lie that read exactly like the truth.
   *
     Against the real table the risk inverts — the panel now has to be able to say "nothing here"
     about an account that genuinely has nothing, rather than showing a spinner, an error, or the
     previous subject's notes. A freshly minted account is the only subject that can prove it: every
     seeded user is fair game for another spec to write a note against. */
  test('an account nobody has written about says so, rather than showing nothing at all', async ({ page, login }) => {
    const mobile = uniqueMobile();
    // Registering through the token endpoint is what mints the account; the profile is incidental.
    await authHeaders(mobile);

    await login.asAdmin();
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    await page.getByPlaceholder('Search name, mobile, email…').fill(mobile);

    /* Searched by the raw number, found by the masked one, and the two are deliberately different
       strings. `q` is a server-side filter that matches the real column, but the directory's DTO
       ships `97XXXXX080` — so a locator built from the number this test typed can never match the
       row that number just found. Asserting one row as well as its shape keeps the search honest:
       a `q` the server quietly ignored would return the whole first page and fail the count. */
    const masked = `${mobile.slice(0, 2)}XXXXX${mobile.slice(-3)}`;
    await expect(page.locator('table tbody tr'),
      'searching for a mobile that belongs to exactly one account did not narrow the directory to it',
    ).toHaveCount(1);
    const row = page.locator('table').getByRole('row', { name: new RegExp(masked) }).first();
    await expect(row, 'the directory found the account but is not masking its number').toBeVisible();
    await row.getByRole('button', { name: 'View activity' }).click();

    const panel = page.getByTestId('user-notes');
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('user-note')).toHaveCount(0);
    await expect(panel.getByText(/Nobody has written a note about this account yet/),
      'the panel is empty but says nothing, so a failed fetch and a clean account look identical',
    ).toBeVisible();

    /* No assertion here on the Add note button being disabled for an empty box. That is a claim
       about the form and nothing else — it is decided in the component before any request exists —
       so it stays in `admin/notes.spec.js`, where it runs in seconds and against no server at all. */
  });
});
