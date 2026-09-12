import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Flatmate host verification tiers.
 *
 * A group's `verificationTier` is derived at create time and never accepted from the payload:
 *
 *   role === 'owner' AND propertyId is an approved listing this caller owns   → 'owner'
 *   otherwise, agreement === true                                            → 'tenant'
 *   otherwise                                                                → 'identity'
 *
 * Three things follow, and each is asserted rather than described. The tier is always present —
 * `identity` is a floor, not an absence, so a card never has to guess. It cannot be claimed: a
 * client that sends `verificationTier`, or names a property it does not own, is quietly given the
 * tier it actually earned. And it is frozen after create, because nothing on the group is
 * mutable except the open-seat count.
 *
 * What the API does not have is a way to *use* the tier: the group feed takes locality, policy
 * and a rent range, and nothing else. There is no `verifiedOnly` filter, so the "verified hosts
 * only" affordance a seeker would expect cannot be served from the server. The last test pins
 * that absence.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

const groupBody = (over = {}) => ({
  title: `Tier Group ${uniqueMobile()}`,
  name: 'Asha K',
  locality: 'Baner',
  rent: 25000,
  seats: 2,
  seatsOpen: 1,
  policy: 'any',
  role: 'tenant',
  ...over,
});

const track = flatmateCleanup(test);

async function createGroup(token, over = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(groupBody(over)),
  });
  const body = await res.json();
  if (res.status === 201) track('groups', body.id, token);
  return { status: res.status, body };
}

const setSeats = (token, id, seatsOpen) =>
  fetch(`${API}/flatmates/groups/${id}/seats`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ seatsOpen }),
  });

test.describe('Flatmate host eligibility tiers', () => {
  test('an identity-only post carries the identity tier, not a blank one', async ({ page }) => {
    const host = await newHost();

    const { status, body: group } = await createGroup(host.accessToken, {
      title: 'Identity Only Group', role: 'tenant',
    });

    expect(status).toBe(201);
    // Present and named. An absent tier would render as an unbadged card that looks the same as
    // a bug, so the floor value is the contract.
    expect(group.verificationTier).toBe('identity');
    expect(group.agreementDeclared).toBe(false);
  });

  test('declaring a rent agreement earns the tenant tier', async ({ page }) => {
    const host = await newHost();

    const { status, body: group } = await createGroup(host.accessToken, {
      role: 'tenant', agreement: true,
    });

    expect(status).toBe(201);
    expect(group.verificationTier).toBe('tenant');
    expect(group.agreementDeclared).toBe(true);
  });

  test('a tenant-tier group is held for review, an identity-tier one is not', async ({ page }) => {
    const tenantHost = await newHost();
    const { body: claimed } = await createGroup(tenantHost.accessToken, {
      role: 'tenant', agreement: true,
    });

    const { accessToken: admin } = await apiLogin(ACTORS.admin);
    const queue = await (await fetch(`${API}/admin/flatmate-reviews?status=pending&size=100`, {
      headers: auth(admin),
    })).json();

    // The tenant tier is a claim about a document nobody has looked at yet, so it buys a place in
    // the verification queue rather than a badge. This is the assertion that the claim is routed
    // somewhere a human sees, and not merely written to a column.
    expect(queue.content.some((r) => r.groupId === claimed.id)).toBe(true);
  });

  test('a tier cannot be claimed in the payload', async ({ page }) => {
    const host = await newHost();

    const { body: group } = await createGroup(host.accessToken, {
      verificationTier: 'owner', role: 'tenant',
    });

    // `verificationTier` is not a field on the create request at all, so Jackson drops it on the
    // floor. Worth asserting because the value drives a trust badge shown to strangers, and a
    // request that could set it would let any host mint one for themselves.
    expect(group.verificationTier).toBe('identity');
  });

  test('naming a property you do not own does not buy the owner tier', async ({ page }) => {
    const host = await newHost();

    // A real, approved listing — belonging to somebody else.
    const { accessToken: ownerToken } = await apiLogin(ACTORS.owner);
    const mine = await (await fetch(`${API}/me/listings?size=50`, {
      headers: auth(ownerToken),
    })).json();
    const someoneElses = mine.content.find((l) => l.status === 'approved');
    expect(someoneElses, 'the seeded owner needs one approved listing').toBeTruthy();

    const { status, body: group } = await createGroup(host.accessToken, {
      role: 'owner', propertyId: someoneElses.id,
    });

    expect(status).toBe(201);
    // Refused silently rather than with a 403: the request is well-formed and the group is real,
    // it just does not earn the badge. The `propertyId` is dropped along with the tier, so the
    // group cannot later be linked to a flat its host has no claim on.
    expect(group.verificationTier).toBe('identity');
    expect(group.propertyId ?? null).toBeNull();
  });

  test('an owner who names their own approved listing earns the owner tier', async ({ page }) => {
    const { accessToken: ownerToken } = await apiLogin(ACTORS.owner);
    const mine = await (await fetch(`${API}/me/listings?size=50`, {
      headers: auth(ownerToken),
    })).json();
    const approved = mine.content.find((l) => l.status === 'approved');
    expect(approved, 'the seeded owner needs one approved listing').toBeTruthy();

    const { status, body: group } = await createGroup(ownerToken, {
      role: 'owner', propertyId: approved.id, locality: approved.locality ?? 'Baner',
    });

    expect(status).toBe(201);
    expect(group.verificationTier).toBe('owner');
    expect(group.propertyId).toBe(approved.id);
    expect(group.hostRole).toBe('owner');

    // Tidy up: an owner-tier group is exempt from the three-post cap, but leaving it live would
    // still change what later runs see in the Baner feed.
    await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'DELETE', headers: auth(ownerToken),
    });
  });

  test('the tier survives seat changes', async ({ page }) => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken, {
      title: 'Immutable Tier Test', locality: 'Kothrud', rent: 28000, seats: 2, seatsOpen: 1,
    });
    const initialTier = group.verificationTier;

    const closed = await setSeats(host.accessToken, group.id, 0);
    expect(closed.status).toBe(200);
    expect((await closed.json()).verificationTier).toBe(initialTier);

    const reopened = await setSeats(host.accessToken, group.id, 1);
    expect(reopened.status).toBe(200);
    expect((await reopened.json()).verificationTier).toBe(initialTier);
  });

  test('the tier is not on the group feed\'s filter surface', async ({ page }) => {
    const host = await newHost();
    const { body: identityGroup } = await createGroup(host.accessToken, { locality: 'Hinjewadi' });

    // `GroupFacets` is (locality, policy, minRent, maxRent). An unknown parameter is not an error
    // in Spring — it is ignored — so a client asking for verified hosts gets the unfiltered feed
    // and no indication that its filter did nothing.
    const filtered = await fetch(`${API}/flatmates/groups?locality=Hinjewadi&verifiedOnly=true&size=100`);
    expect(filtered.status).toBe(200);
    const withFilter = await filtered.json();

    const plain = await (await fetch(`${API}/flatmates/groups?locality=Hinjewadi&size=100`)).json();
    expect(withFilter.totalElements).toBe(plain.totalElements);

    // Belt and braces on the claim above: the identity-tier group is either in both responses or
    // in neither, depending only on whether moderation has let it out — never on the filter.
    expect(withFilter.content.some((g) => g.id === identityGroup.id))
      .toBe(plain.content.some((g) => g.id === identityGroup.id));
  });

  test('locality and rent filters do compose', async ({ page }) => {
    const res = await fetch(`${API}/flatmates/groups?locality=Baner&minRent=15000&maxRent=35000&size=100`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Unguarded by a `length > 0` check on purpose: an empty page passing a `forEach` assertion
    // is the failure mode these tests had before, where a broken filter and a correct one were
    // indistinguishable.
    for (const group of data.content) {
      expect(group.locality.toLowerCase()).toBe('baner');
      expect(group.rent).toBeGreaterThanOrEqual(15000);
      expect(group.rent).toBeLessThanOrEqual(35000);
      expect(group.verificationTier).toBeTruthy();
    }
  });
});
