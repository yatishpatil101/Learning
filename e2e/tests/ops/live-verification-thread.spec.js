/**
 * D218 — the verification case file, against the **live** backend.
 *
 * Three things landed in D218 that no mock-mode spec can exercise, because in mock mode none of
 * them exist: the server posts the re-review explanation itself, a duplicate electricity meter
 * files a staff-only note, and that note is withheld from the owner while being *labelled* for
 * staff. All three are properties of one transaction on the server. A spec that stubbed any of
 * them would be asserting its own stub.
 *
 * ## Why the fixtures are minted through the API and not the wizard
 *
 * `list-property/submit.js` still writes to localStorage and runs its own browser-side duplicate
 * check — the owner wizard has never touched the services seam (recorded in `tasks/todo.md`,
 * wave 5). Driving the UI to create these listings would therefore produce rows the server's
 * detector never sees, and the spec would pass while proving nothing. So the world is built on the
 * wire, through `POST /me/listings`, which is the same entry point `AdminPostOnBehalf` uses and the
 * one the detector actually sits behind.
 *
 * ## Fresh owners every time
 *
 * `oneOwnerDoesNotCollideWithThemselves` is a real rule: the probe excludes the lister's own rows,
 * so a collision needs two distinct people. Both are registered fresh via `uniqueMobile()` rather
 * than borrowed from `ACTORS`, because these tests create listings and a seeded owner's listing
 * count is load-bearing for `live-property-integration.spec.js`.
 *
 * ## The meter number is per-run
 *
 * The live database is reset at the start of a run but not between tests, and a hard-coded meter
 * would collide with the previous *test* rather than with the fixture this one built. Each test
 * mints its own.
 *
 *   cd e2e; npx playwright test tests/ops/live-verification-thread.spec.js --config=playwright.live.config.js
 */
import { expect, test, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** A meter number unique to this test, for the reason in the file header. */
const meterNo = () => `MSEDCL-E2E-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: auth(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function ok(method, path, token, body) {
  const res = await api(method, path, token, body);
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A registered owner nobody else in the suite shares, plus their token. */
async function freshOwner() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, token: accessToken };
}

/** One listing, created on the wire so the server's duplicate detector actually sees it. */
async function createListing(token, { meter, address } = {}) {
  const created = await ok('POST', '/me/listings', token, {
    title: '2BHK in Kothrud',
    deal: 'rent',
    propertyType: 'apartment',
    price: 32000,
    bhk: 2,
    locality: 'Kothrud',
    city: 'Pune',
    floor: 4,
    ...(meter ? { electricityMeterNo: meter } : {}),
    ...(address ? { address } : {}),
  });
  return created.id;
}

test.describe('LIVE: the verification case file (D218)', () => {
  test('a duplicate meter files a staff-only note the owner is never shown', async () => {
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    await createListing(incumbent.token, { meter });
    const flagged = await createListing(collider.token, { meter });

    // The listing itself is not refused. That is the product decision the note exists to serve: a
    // second listing on one meter is usually a broker relisting somebody's flat, but it is
    // sometimes a genuine re-let, and refusing outright would punish the honest case to catch the
    // dishonest one. Ops gets told; the owner gets published.
    const mine = await ok('GET', `/me/listings/${flagged}`, collider.token);
    expect(mine.status).not.toBe('rejected');

    // The owner's view of their own case file. The case *exists* — the note opened it — but every
    // message in it is staff-only, so what the owner is served is a 404 rather than an empty
    // thread. An empty thread would still tell them a file had been opened on them, which is the
    // disclosure the flag exists to avoid.
    const asOwner = await api('GET', `/properties/${flagged}/verification`, collider.token);
    expect(asOwner.status).toBe(404);

    // The same route, same case, read by staff.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const asStaff = await ok('GET', `/properties/${flagged}/verification`, staffToken);
    const notes = asStaff.messages.filter((m) => m.internal);
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // The note names the incumbent listing, because a flag a moderator has to go and reconstruct is
    // a flag they will not action. `describe()` emits the incumbent's slug/id plus its status,
    // owner-verified state and listed date — enough to tell which of the two moved.
    expect(notes.some((m) => m.body.includes('Possible duplicate'))).toBe(true);

    // And it does *not* carry the meter number, which is the point worth asserting rather than
    // assuming. `review_messages.body` is free text: it sits outside the PrivateFieldVisibility
    // projection that keeps the meter off every public response, and outside the erasure
    // classification that accounts for the column. Copying the value into a note would route a
    // guarded field around its own guard, in a place no mapper test would ever look. The moderator
    // does not need it — they can open either listing — so the cheap version of "make the note
    // self-contained" is the one that has to stay refused.
    expect(notes.every((m) => !m.body.includes(meter))).toBe(true);

    // `internal` is the D218 wire field and this is the whole reason it exists: filtering alone
    // left staff unable to tell a staff-only finding from something the owner was actually told —
    // both arrive as `from: ops`, in one conversation — and a moderator who quotes the first back
    // to an owner has made the disclosure the filter was meant to prevent.
    expect(notes.every((m) => m.from === 'ops')).toBe(true);
  });

  test('the server, not the browser, explains a stays-live edit in the thread', async () => {
    const owner = await freshOwner();
    const id = await createListing(owner.token);

    // Approved first. `Property.requestRecheck` refuses on anything not publicly visible, so on a
    // pending listing there is no work item — and D218 stopped the note being posted regardless,
    // which had been telling owners of off-search listings that they were live.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    // Opening the case file is a separate call from deciding it, and the desk really does make it:
    // `PropertyReviewModal` calls `startPropertyReview` on open, which is this route. Creating a
    // listing does not open a case — only the duplicate probe and an explicit submit do — so
    // `decide` on an un-opened case answers 404 (`requireCase`). The first test in this file gets
    // its case for free because the probe opened one; this one has to ask.
    await ok('POST', `/properties/${id}/verification`, staffToken);
    await ok('POST', `/properties/${id}/verification/decision`, staffToken,
      { decision: 'approve', note: 'e2e fixture' });

    // A material edit: price is a re-check field, not a re-moderation one.
    await ok('PATCH', `/me/listings/${id}`, owner.token, { price: 41000 });

    const after = await ok('GET', `/me/listings/${id}`, owner.token);
    expect(after.status).toBe('approved');
    expect(after.recheckPending).toBe(true);

    // The owner can read this one: it is addressed to them, so it is not internal.
    const thread = await ok('GET', `/properties/${id}/verification`, owner.token);
    const note = thread.messages.find((m) => m.from === 'ops' && /re-checking/i.test(m.body));
    expect(note, `messages: ${JSON.stringify(thread.messages)}`).toBeTruthy();
    expect(note.internal).toBe(false);
    // It names the field that moved. Until D218 this sentence was composed in the browser by
    // `PropertyReviewModal`, which meant an edit made through any other client — or through the
    // API — produced silence, and the note said "approved" whether or not the write had succeeded.
    expect(note.body.toLowerCase()).toContain('price');
  });

  test('a pending listing is not told that it stays live', async () => {
    const owner = await freshOwner();
    const id = await createListing(owner.token);

    await ok('PATCH', `/me/listings/${id}`, owner.token, { price: 41000 });

    const after = await ok('GET', `/me/listings/${id}`, owner.token);
    expect(after.status).toBe('pending');
    expect(after.recheckPending).toBe(false);

    // And no case file was manufactured to hold a note about work nobody is doing. A thread opened
    // by a note that should not have been written is a case a moderator has to read and close.
    const thread = await api('GET', `/properties/${id}/verification`, owner.token);
    expect(thread.status).toBe(404);
  });
});
