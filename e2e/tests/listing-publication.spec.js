import { ACTORS, expect, test } from '../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';

/* Exactly one route publishes a listing, and it is the one a moderator presses; `DELETE /flag` returns the
   listing to PENDING. Driven through the API because a confirm dialog cannot stop the route behind it. */

const BODY = (title) => ({
  title,
  deal: 'rent',
  propertyType: 'apartment',
  price: 25000,
  locality: 'Kothrud',
  city: 'Pune',
});

/* `uniqueMobile()` is `Date.now()`-derived, so two calls in the same millisecond return the same
   number — which would silently make two "different" owners one owner. */
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

/** Post a listing as a brand-new owner and hand back its id. */
async function freshListing(request, title) {
  const headers = await authHeaders(newOwner());
  const res = await request.post(`${API}/me/listings`, { headers, data: BODY(title) });
  expect(res.status(), await res.text()).toBe(201);
  return { id: (await res.json()).id, headers };
}

/** 404, not 403: the public read must not confirm that an unapproved listing exists. */
async function expectNotPublic(request, id) {
  expect((await request.get(`${API}/properties/${id}`)).status()).toBe(404);
}

test.describe('listing publication (live)', () => {
  test('a pending listing is invisible, and clearing a flag does not publish it', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);
    const { id } = await freshListing(request, 'Flag-clear publication probe');

    await expectNotPublic(request, id);

    /* Flag then unflag. The flagged state is reachable only from the console, so this is the exact
       sequence a moderator performs when a complaint turns out to be nothing. */
    const flagged = await request.post(`${API}/properties/${id}/flag`, {
      headers: admin,
      data: { reason: 'Reported by a neighbour' },
    });
    expect(flagged.status(), await flagged.text()).toBeLessThan(300);

    const cleared = await request.delete(`${API}/properties/${id}/flag`, { headers: admin });
    expect(cleared.status()).toBe(204);

    /* Asserting the 404 rather than the stored status is deliberate: "pending" is an implementation word,
       "a stranger cannot read it" is the promise. */
    await expectNotPublic(request, id);
  });

  test('approving from the queue publishes, whether pressed once or in bulk', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);

    /* Two listings through the same route, because "Approve selected" is a loop over the single-row action.
       Pinning both is what stops a future bulk path growing its own, laxer publication rule. */
    const single = await freshListing(request, 'Single approve probe');
    const bulk = await freshListing(request, 'Bulk approve probe');

    for (const { id } of [single, bulk]) {
      const approved = await request.patch(`${API}/properties/${id}/status`, {
        headers: admin,
        data: { status: 'approved' },
      });
      expect(approved.status(), await approved.text()).toBeLessThan(300);
    }

    for (const { id } of [single, bulk]) {
      const read = await request.get(`${API}/properties/${id}`);
      expect(read.status(), `approved listing ${id} is still not publicly readable`).toBe(200);
      expect((await read.json()).status).toBe('approved');
    }
  });

  test('a rejected listing returns to the queue when its owner replies', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);
    const { id, headers } = await freshListing(request, 'Rectification loop probe');

    /* Open the case file as the owner, then reject it with a reason. A rejection with nothing to
       act on is a dead end, so the route refuses one — see `RejectionNeedsReason`. */
    const opened = await request.post(`${API}/properties/${id}/verification`, { headers });
    expect(opened.status(), await opened.text()).toBe(201);

    const rejected = await request.post(`${API}/properties/${id}/verification/decision`, {
      headers: admin,
      data: { decision: 'reject', note: 'The electricity bill is not legible.' },
    });
    expect(rejected.status(), await rejected.text()).toBe(200);
    await expectNotPublic(request, id);

    /* The owner's own reply is what reopens it: a terminal rejection means a fixable listing dies of a
       blurred photograph, with the owner able to read the reason and unable to answer it. */
    const replied = await request.post(`${API}/properties/${id}/verification/messages`, {
      headers,
      data: { body: 'Re-uploaded a clearer scan of the bill.' },
    });
    expect(replied.status(), await replied.text()).toBe(201);

    const caseFile = await request.get(`${API}/properties/${id}/verification`, { headers });
    expect(caseFile.status()).toBe(200);
    expect((await caseFile.json()).status).toBe('pending');

    /* Still not live: this separates "the owner can try again" from "the owner can publish by replying",
       which would be a second publication route. */
    await expectNotPublic(request, id);
  });
});
