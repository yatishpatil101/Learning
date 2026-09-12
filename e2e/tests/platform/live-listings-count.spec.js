// @ts-check
/**
 * `users.listings_count` — the owner-vs-seeker persona, against the live API.
 *
 * ## The defect this exists to hold down
 *
 * The column was declared in the old `V2__identity_access.sql` — now folded into
 * `V02__DDL_identity_access.sql` — and written by **nothing**. No Java code
 * ever called a setter, so on any real deployment it read `0` for every account that had ever
 * existed, no matter how many listings that account had posted. Everything downstream inherited
 * the zero: `ReferralService.channelOf` could only ever answer `"seeker"`, and the admin user
 * directory showed `0 listings` beside owners with a page of them.
 *
 * The same gap swallowed the `owner` *role*. Nothing assigns `Roles.Wire.OWNER` either — both
 * signup paths mint `buyer` and `setRole` has no call site outside account creation — so the
 * frontend's `role === 'owner'` persona tests were a constant false, and the property picker they
 * gated (`useRentAgreement`) never opened for anybody.
 *
 * **Why no existing test caught either.** The demo seed writes `role` and `listings_count` as
 * literals, so every fixture owner arrived already holding numbers the running application could
 * not produce. Dev and e2e were exercising a state the product could not reach. That is why the
 * assertions below all run against an account this file mints *through the API* — the counter has
 * to be produced by the act of posting, not handed over by a seed. Under the old code the second
 * test failed on `1`, having read `0`.
 *
 * ## What is deliberately not asserted
 *
 * That the counter tracks live inventory. It does not, and must not: it counts every listing ever
 * posted, including ones since rejected or archived, because the question it answers is "did this
 * person come here to list" — which does not stop being true when the desk rejects a listing. The
 * live count a visitor could open is a separate number, counted at the point of use
 * (`PropertyRepository.countByOwnerIdAndStatusAndArchivedFalse`). The third test pins that
 * distinction, since a future reader "fixing" the counter to decrement is the obvious wrong move.
 */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** Enough to be accepted, filed under a real locality — same shape the moderation specs post. */
const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

/**
 * Owners minted here, so their listings can be taken back out of the catalogue.
 *
 * Rejection rather than deletion: there is no delete route, and rejection is what the moderation
 * desk itself uses to withdraw a listing, so teardown leaves the database in a shape the product
 * can actually produce. Note this does NOT restore `listings_count` — by design, per the third
 * test — but the owners are throwaway, so nothing later reads them.
 */
const owners = new Set();

test.afterEach(async () => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    /* Soft rather than a bare `continue`: a teardown that cannot read the listings back leaves
       Zztest rows live in the shared e2e database, and silence here would let that accumulate run
       after run while every test still reported green. Soft so one owner's failed cleanup does not
       abort the loop and strand the rest. */
    expect.soft(res.status, `teardown could not list ${mobile}'s listings`).toBe(200);
    if (res.status !== 200) continue;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
    for (const row of rows) {
      const patched = await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup — listings_count fixture' }),
      });
      expect.soft(patched.status, `teardown could not withdraw ${row.id}`).toBe(200);
    }
  }
  owners.clear();
});

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

/** A brand-new account, plus its auth headers. Fresh every time — the counter starts at 0. */
async function newOwner() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  owners.add(mobile);
  return { mobile, headers };
}

test.describe('listings_count — live', () => {
  test('a new account starts at zero and is not an owner', async () => {
    const { headers } = await newOwner();

    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    /* Asserted as the number 0, not as falsy. The frontend reads `(listingsCount ?? 0) > 0`, so an
       absent field and a zero are the same persona — but they are not the same contract, and a
       field that quietly stopped being serialised would leave every account looking like a seeker
       forever. That is precisely the failure this file exists to prevent, so it must not be the
       thing that makes it pass. */
    expect(me.body.listingsCount).toBe(0);
    expect(me.body.role).toBe('buyer');
  });

  test('posting a listing makes the account an owner', async () => {
    const { headers } = await newOwner();

    const created = await api('POST', '/me/listings', headers, {
      ...BASE_LISTING,
      title: `Zztest listings_count ${Date.now()}`,
    });
    expect(created.status).toBe(201);

    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    // The assertion the old code failed: it read 0 here, on an account that had just posted.
    expect(me.body.listingsCount).toBe(1);

    /* And the role is still `buyer`. Not an oversight being documented — the point. The persona
       moved without the role moving, which is why the frontend now reads the counter instead:
       waiting for `role` to become `owner` is waiting for something no code path performs. */
    expect(me.body.role).toBe('buyer');
  });

  test('the count survives the listing being rejected', async () => {
    const { headers } = await newOwner();

    const created = await api('POST', '/me/listings', headers, {
      ...BASE_LISTING,
      title: `Zztest listings_count rejected ${Date.now()}`,
    });
    expect(created.status).toBe(201);

    const adminHeaders = await authHeaders(ACTORS.admin);
    const rejected = await api('PATCH', `/properties/${created.body.id}/status`, adminHeaders, {
      status: 'rejected',
      reason: 'Zztest — proving the lifetime counter does not decrement',
    });
    expect(rejected.status).toBe(200);

    /* Still 1. The listing is gone from every surface a visitor can reach, and `GET /me/listings`
       no longer offers it as live inventory — but the person did post it, and the plan tier and
       referral channel that read this counter mean the persona, not the inventory. A future change
       that decremented here would look like tidiness and would silently demote owners whose first
       listing was rejected back to seekers. */
    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    expect(me.body.listingsCount).toBe(1);
  });
});
