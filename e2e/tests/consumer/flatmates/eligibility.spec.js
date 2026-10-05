import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const AGREEMENT_EVIDENCE = {
  agreement: true,
  agreementDoc: {},
};

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

const groupBody = (over = {}) => ({
  title: `Tier Group ${Number(uniqueMobile()).toString(36)}`,
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
    body: JSON.stringify(groupBody(over.agreementDoc
      ? { ...over, agreementDoc: (await tenantRoomAgreement(token)).agreementDoc }
      : over)),
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
  test('a tier is earned from role, agreement and ownership — never claimed in the payload', async () => {
    test.slow();

    await test.step('an identity-only post carries the identity tier, not a blank one', async () => {
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

    await test.step('declaring a rent agreement earns the tenant tier', async () => {
      const host = await newHost();

      const { status, body: group } = await createGroup(host.accessToken, {
        role: 'tenant', ...AGREEMENT_EVIDENCE,
      });

      expect(status).toBe(201);
      expect(group.verificationTier).toBe('tenant');
      expect(group.agreementDeclared).toBe(true);
    });

    await test.step('a tier cannot be claimed in the payload', async () => {
      const host = await newHost();

      const { body: group } = await createGroup(host.accessToken, {
        verificationTier: 'owner', role: 'tenant',
      });

      expect(group.verificationTier).toBe('identity');
    });
  });

  test('naming a property you do not own does not buy the owner tier', async ({ page }) => {
    const host = await newHost();

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
});
