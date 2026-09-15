/* The verification case file, all of it one server transaction. Fixtures go through
   `POST /me/listings`, not the wizard, which writes rows the duplicate detector never sees. */
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

test.describe('LIVE: the verification case file', () => {
  test('a duplicate meter files a staff-only note the owner is never shown', async () => {
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    await createListing(incumbent.token, { meter });
    const flagged = await createListing(collider.token, { meter });

    // The listing is not refused: a second listing on one meter is usually a broker relisting
    // somebody's flat but is sometimes a genuine re-let. Ops gets told; the owner gets published.
    const mine = await ok('GET', `/me/listings/${flagged}`, collider.token);
    expect(mine.status).not.toBe('rejected');

    // 404 rather than an empty thread: an empty thread would still tell the owner a file had been
    // opened on them, which is the disclosure the staff-only flag exists to avoid.
    const asOwner = await api('GET', `/properties/${flagged}/verification`, collider.token);
    expect(asOwner.status).toBe(404);

    // The same route, same case, read by staff.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const asStaff = await ok('GET', `/properties/${flagged}/verification`, staffToken);
    const notes = asStaff.messages.filter((m) => m.internal);
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // The note names the incumbent listing, because a flag a moderator has to go and reconstruct is
    // a flag they will not action.
    expect(notes.some((m) => m.body.includes('Possible duplicate'))).toBe(true);

    // `review_messages.body` is free text, outside the projection that keeps the meter off every
    // public response — copying it in would route a guarded field around its own guard.
    expect(notes.every((m) => !m.body.includes(meter))).toBe(true);

    // Filtering alone left staff unable to tell a staff-only finding from something the owner was
    // told — both arrive as `from: ops` in one conversation. `internal` is what separates them.
    expect(notes.every((m) => m.from === 'ops')).toBe(true);
  });

  test('the server, not the browser, explains a stays-live edit in the thread', async () => {
    const owner = await freshOwner();
    const id = await createListing(owner.token);

    // Approved first: `Property.requestRecheck` refuses on anything not publicly visible, so a
    // pending listing produces no work item.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    // Opening the case file is a separate call from deciding it (`PropertyReviewModal` calls it on
    // open); creating a listing opens no case, so `decide` on an un-opened one answers 404.
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
    // It names the field that moved. Composed server-side, so an edit made through any other client
    // produces the same sentence rather than silence.
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
