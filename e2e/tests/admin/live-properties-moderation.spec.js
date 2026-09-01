import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, apiLogin, uniqueMobile, signIn } from '../../helpers/liveAuth.js';

/*
   The four moderation decisions, against the real API.

   ## Why these were untested live

   `live-property-integration` proves the queue is served by `/admin/properties` and that toggling
   featured issues a real request. It stops there, because everything past that point *changes* a
   listing, and the seeded catalogue is what forty other specs assert against. So the decisions
   themselves -- approve, reject, flag, archive -- had no live coverage at all, and they are the
   part of the console with the most rules behind them.

   This spec creates its own listing per test, under an owner with a mobile no other run will use.
   Nothing here touches a fixture, so nothing here can be the reason another spec goes red.

   ## What is actually being pinned

   Not "the button works". These four verbs are deliberately *not* interchangeable, and the
   distinctions live in the API rather than in the console:

     - `PATCH /properties/{id}/status` accepts `pending | approved | rejected` and **refuses**
       `flagged` and `archived`, because each of those has its own route that records something
       `/status` cannot: a flag reason, or an archive under a different authorization. Allowing them
       here would be a second, reason-less way to do a thing the API already models.
     - A rejection carries a reason onto the audit row, which is what makes it reviewable later.
     - Archiving is reversible and restore returns the listing to `pending`, not to whatever it was
       before -- an un-archived listing has to be looked at again.
     - None of the four echoes the row back. The console re-reads the list, and a caller that read a
       resolved value would work on mocks and read `undefined` here.

   And the boundary that matters most: a listing the moderator has taken off the site is invisible to
   the public route but still visible to **its owner**, who is the one person entitled to know what
   happened to their own submission.

   Fixtures: none. Every listing in this file is created by the test that moderates it.
*/

const admin = () => authHeaders('9000000000');

const NEW_LISTING = {
  title: 'Moderation subject',
  deal: 'rent',
  propertyType: 'Flat',
  price: 28000,
  locality: 'Baner',
  city: 'Pune',
  bhk: 2,
  area: 850,
};

/**
 * A brand-new listing under a brand-new owner, returned with both handles the tests need.
 *
 * The owner is created by the login itself (`/auth/login` registers an unknown mobile on first
 * verification), so there is no separate provisioning step and no seeded account to disturb.
 */
async function freshListing(title = NEW_LISTING.title) {
  const ownerMobile = uniqueMobile();
  const headers = await authHeaders(ownerMobile);
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST', headers, body: JSON.stringify({ ...NEW_LISTING, title }),
  });
  expect(res.status).toBe(201);
  const listing = await res.json();
  return { id: listing.id, ownerMobile, headers };
}

const status = async (id, body, headers) => {
  const res = await fetch(`${API}/properties/${id}/status`, {
    method: 'PATCH', headers: headers || (await admin()), body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const ownerView = async (id, headers) =>
  (await fetch(`${API}/me/listings/${id}`, { headers })).status;

const publicView = async (id) => (await fetch(`${API}/properties/${id}`)).status;

test('a new listing is pending, off the public site, and visible to its owner', async () => {
  const { id, headers } = await freshListing();

  /* The starting state every other test in this file departs from, asserted once here rather than
     re-asserted in each -- a listing that arrived already approved would make three of the tests
     below pass for the wrong reason. */
  expect(await publicView(id)).toBe(404);
  expect(await ownerView(id, headers)).toBe(200);
});

test('approving puts it on the public site; rejecting takes it off again', async () => {
  const { id, headers } = await freshListing('Approve then reject');

  expect((await status(id, { status: 'approved' })).status).toBe(200);
  expect(await publicView(id)).toBe(200);

  /* The reason is not decoration: it is what makes a rejection reviewable by somebody who was not
     in the room. The route accepts the decision without one, so this asserts the path that carries
     it rather than the path that does not. */
  expect((await status(id, { status: 'rejected', reason: 'Photos are of a different flat' })).status).toBe(200);
  expect(await publicView(id)).toBe(404);

  /* And the boundary. The owner is the one person entitled to know what became of their own
     submission, so the refusal the public gets is not the refusal they get. */
  expect(await ownerView(id, headers)).toBe(200);
});

test('the status route refuses the two decisions that belong to other routes', async () => {
  const { id } = await freshListing('Refused transitions');

  /* `flagged` and `archived` are reachable, just not from here. Each has a route that records
     something this one cannot -- a flag reason, or an archive under an authorization an owner also
     holds -- so accepting them here would be a second way to do the same thing that quietly loses
     the record of why. A 400 is the server declining to offer it. */
  expect((await status(id, { status: 'flagged' })).status).toBe(400);
  expect((await status(id, { status: 'archived' })).status).toBe(400);

  /* Nothing moved. Worth asserting, because a route that rejected the request *after* applying it
     would look identical from the status code alone. */
  expect(await publicView(id)).toBe(404);
  expect((await status(id, { status: 'approved' })).status).toBe(200);
  expect(await publicView(id)).toBe(200);
});

test('flagging takes an approved listing off the site and keeps the reason', async () => {
  const { id, headers } = await freshListing('Flag subject');
  expect((await status(id, { status: 'approved' })).status).toBe(200);
  expect(await publicView(id)).toBe(200);

  const REASON = 'Owner mobile belongs to a different listing';
  const flagged = await fetch(`${API}/properties/${id}/flag`, {
    method: 'POST', headers: await admin(), body: JSON.stringify({ reason: REASON }),
  });
  expect(flagged.status).toBe(200);
  expect(await publicView(id)).toBe(404);

  /* Read back from the queue, which is the only route that will admit a flagged listing exists.
     `flagReason` is what a second moderator sees before deciding whether to clear it, so a flag
     that lost its reason is a work item nobody can action. */
  const queue = await fetch(`${API}/admin/properties?size=100&status=flagged`, { headers: await admin() });
  const row = (await queue.json()).content.find((p) => p.id === id);
  expect(row).toBeTruthy();
  expect(row.flagReason).toBe(REASON);

  /* And the other half of the same field: the owner's own read of the very same listing does not
     carry it. `/me/listings/{id}` answers for a flagged listing -- the owner is entitled to know
     their submission was pulled -- but the moderator's note is written for the desk, and it
     usually repeats what somebody reported about this owner. Handing it back hands the reporter
     back with it.

     Asserted here rather than against the public detail route because that route 404s a flagged
     listing, so it would pass whether the field were gated or not. This one reads a 200 body that
     genuinely could carry the reason and does not. */
  const mine = await fetch(`${API}/me/listings/${id}`, { headers });
  expect(mine.status).toBe(200);
  const ownerCopy = await mine.json();
  expect(ownerCopy.status).toBe('flagged');
  expect(ownerCopy.flagReason).toBeUndefined();

  /* Clearing returns it to the site. The pair is tested together because a flag that cannot be
     lifted is a delete with extra steps, and the console offers it as a reversible action.

     One path, two methods: `DELETE` is the lowering of the same flag `POST` raised. And note what
     it lowers it *to* -- `approved`, unconditionally, not whatever the listing held before. So a
     pending listing that is flagged and then cleared reaches the public site without ever passing
     the verification queue. That is the server's behaviour and the mock's, and this asserts it
     rather than the restore neither of them performs. */
  const cleared = await fetch(`${API}/properties/${id}/flag`, { method: 'DELETE', headers: await admin() });
  // 204, where raising it was a 200 — the lowering has nothing to say and does not pretend to.
  expect(cleared.status).toBe(204);
  expect(await publicView(id)).toBe(200);
});

test('archiving is reversible, and restoring sends the listing back for moderation', async () => {
  const { id, headers } = await freshListing('Archive subject');
  expect((await status(id, { status: 'approved' })).status).toBe(200);

  const archived = await fetch(`${API}/properties/${id}/archive`, {
    method: 'PATCH', headers: await admin(), body: JSON.stringify({ reason: 'Duplicate of an older post' }),
  });
  expect(archived.status).toBe(200);
  expect(await publicView(id)).toBe(404);

  const restored = await fetch(`${API}/properties/${id}/restore`, { method: 'PATCH', headers: await admin() });
  expect(restored.status).toBe(200);

  /* Back to `pending`, not back to `approved`. A listing that was pulled and then put back has to
     be looked at again -- restoring it straight to the public site would make archive-and-restore a
     way to launder a listing past moderation. */
  expect(await publicView(id)).toBe(404);
  expect(await ownerView(id, headers)).toBe(200);

  const queue = await fetch(`${API}/admin/properties?size=100&status=pending`, { headers: await admin() });
  expect((await queue.json()).content.some((p) => p.id === id)).toBe(true);
});

test('moderating is not something a signed-in owner may do to their own listing', async () => {
  const { id, headers } = await freshListing('Self approval');

  /* The obvious escalation, and the one a client-side-only guard would miss entirely: the owner
     already holds a valid session and already owns the row. What they do not hold is
     `properties:write`. Asserted from the owner's own token rather than an anonymous one, because
     an anonymous 401 would prove only that the route needs a session. */
  expect((await status(id, { status: 'approved' }, headers)).status).toBe(403);
  expect(await publicView(id)).toBe(404);
});

test('an unknown listing is a 404, not a 500, on every decision', async () => {
  const missing = '00000000-0000-4000-8000-000000000000';
  const headers = await admin();

  /* A well-formed id for a listing that does not exist. Grouped into one test because the answer is
     the same fact four times, and four near-identical tests would only make the file longer. */
  expect((await status(missing, { status: 'approved' })).status).toBe(404);
  for (const [path, method] of [['flag', 'POST'], ['archive', 'PATCH'], ['restore', 'PATCH']]) {
    const res = await fetch(`${API}/properties/${missing}/${path}`, {
      method, headers, body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status, `${method} /${path}`).toBe(404);
  }
});

test('the queue shows what the public catalogue will not', async () => {
  const { id } = await freshListing('Queue visibility');
  const session = await apiLogin('9000000000');
  expect(session.user.role).toBe('admin');

  /* The queue's whole reason for existing: it is the only route that returns a listing no public
     search will admit exists. Asserted against a listing this test created, so it holds regardless
     of what the seed happens to contain. */
  const queue = await fetch(`${API}/admin/properties?size=100&status=pending`, { headers: await admin() });
  expect(queue.status).toBe(200);
  expect((await queue.json()).content.some((p) => p.id === id)).toBe(true);

  const publicList = await fetch(`${API}/properties?size=100`);
  expect((await publicList.json()).content.some((p) => p.id === id)).toBe(false);
});

/*
   The one test in this file that goes through the screen.

   Everything above talks to the API directly, which is right for the decisions -- their rules live
   in the service. This one cannot, because both defects it pins live *between* the screen and the
   API, where an API-level test steps straight over them.

     1. The modal called `updateListingFields`, which is `PATCH /me/listings/{id}` -- the **owner's**
        route, resolved owner-scoped. A moderator correcting somebody else's listing is not its
        owner, so the API answered 404 for every listing on the desk. `PATCH /properties/{id}/admin`
        had existed and gone unused since slice 6.
     2. The corrected configuration was sent as `bhk`, and `toListingUpdate` reads `bhkNum`, so even
        on a listing the moderator did own the field was deleted from the request body on its way
        out. The PATCH succeeded carrying nothing, and the console said "Listing updated".

   Both passed every mock spec over this modal, and for the same reason: the mock provider's
   `updateListingFields` is `Object.assign(listing, patch)`, which has no owner to check and accepts
   any key it is handed.

   The status assertion at the end is not incidental. A moderator edit is the one write that
   deliberately does *not* send the listing back for review -- reverting would push the moderator's
   own correction into the moderator's own queue -- so a fix that reached the API through the owner
   route would save the number and take the listing off search, which is a different bug rather than
   the absence of this one.
*/
test('a moderator can correct a BHK on a listing they do not own', async ({ page }) => {
  const title = `BHK correction ${Date.now()}`;
  const { id, headers } = await freshListing(title);

  /* Approve first, so the last two assertions can tell "stayed live" apart from "was never live".
     The listing is owned by a mobile this run minted; the admin below is a different person, which
     is the whole point. */
  expect((await status(id, { status: 'approved' })).status).toBe(200);
  expect(await publicView(id)).toBe(200);

  await signIn(page, ACTORS.admin, { screen: 'staff' });
  await page.goto('/admin/properties');
  /* Search by the title this test minted, so the row is this listing and not whichever one the
     seed happens to sort first. */
  await page.getByPlaceholder('Search title, owner, locality').first().fill(title);
  await page.locator('[title="Edit"]').first().click();
  await expect(page.getByRole('dialog', { name: 'Edit listing' })).toBeVisible();

  /* Seeded from the number, not from the "2 BHK" label the card renders -- the box is numeric
     because the contract stores an integer. */
  const bhkBox = page.getByLabel('Configuration (BHK)');
  await expect(bhkBox).toHaveValue('2');
  await bhkBox.fill('3');
  await page.getByRole('button', { name: /Save changes/i }).click();
  /* The modal closes only on a write the API accepted; a refusal leaves it open with a toast. */
  await expect(page.getByRole('dialog', { name: 'Edit listing' })).toHaveCount(0);

  /* Read back from the API rather than from the screen. The console re-renders from its own
     refresh, and a value that only ever existed in the browser is exactly what defect 2 looked
     like. */
  const after = await (await fetch(`${API}/me/listings/${id}`, { headers })).json();
  expect(Number(after.bhk)).toBe(3);

  /* And the difference from the owner path: the correction does not cost the owner their listing's
     visibility while a second moderator re-approves what the first one just fixed. */
  expect(after.status).toBe('approved');
  expect(await publicView(id)).toBe(200);
});
