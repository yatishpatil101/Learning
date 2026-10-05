import { expect, test } from '../../fixtures/live.js';
import { API, apiLogin, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

// A meter number unique to this test run, so a cluster here can only contain this test's rows.
const meterNo = () => `MSEDCL-DUP-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;

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

// A registered owner nobody else in the suite shares, plus their token.
async function freshOwner() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, token: accessToken };
}

// An admin token, for the three staff routes under test.
async function adminToken() {
  const { accessToken } = await apiLogin('9000000000');
  return accessToken;
}

// One listing, created on the wire so `reindex` runs and the row carries the signals the desk reads.
async function createListing(token, { meter, title }) {
  const created = await ok('POST', '/me/listings', token, {
    title,
    deal: 'rent',
    propertyType: 'apartment',
    price: 32000,
    bhk: 2,
    locality: 'Kothrud',
    city: 'Pune',
    floor: 4,
    electricityMeterNo: meter,
    images: await uploadedListingPhotos(token),
  });
  return created.id;
}

// The desk, as the server reports it.
const readDesk = (token) => ok('GET', '/admin/properties/duplicates', token);

// The listing body `POST /admin/properties` takes, minus the two fields each test varies.
const ON_BEHALF_LISTING = {
  deal: 'rent',
  propertyType: 'apartment',
  price: 32000,
  bhk: 2,
  locality: 'Kothrud',
  city: 'Pune',
  floor: 4,
};

// Located by member, never by position.
function clusterWith(desk, id) {
  return (desk.clusters || []).find((c) => c.listings.some((l) => l.id === id));
}

test.describe('LIVE: the duplicates desk (D255)', () => {
  test('two owners on one meter surface as a cross-owner cluster', async () => {
    // The deliberate divergence from `ListingDuplicateProbe`, which compares across owners only.
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    const a = await createListing(incumbent.token, { meter, title: 'Sunrise Residency 2BHK — first' });
    const b = await createListing(collider.token, { meter, title: 'Sunrise Residency 2BHK — second' });

    // Merge cleanup removes both rows from the shared queue through the console write path.
    const token = await adminToken();
    const desk = await readDesk(token);

    // Positive anchor before anything else.
    const cluster = clusterWith(desk, a);
    expect(cluster, 'the pair sharing a meter did not cluster at all').toBeTruthy();

    // Both members, and only these two.
    expect(cluster.listings.map((l) => l.id).sort()).toEqual([a, b].sort());

    // The meter is the address arm, not the photo arm.
    expect(cluster.reason).toBe('address');

    // Different accounts, so this is the moderation case rather than the phone call.
    expect(cluster.sameOwner).toBe(false);

    // The desk read a bounded window and said so.
    expect(desk.truncated).toBe(false);
    expect(desk.scanned).toBeGreaterThanOrEqual(2);
  });

  test('one owner listed twice by the concierge desk is clustered, and labelled as themselves', async () => {
    // Derived clusters have no id, so verdicts key off sorted member ids.
    const meter = meterNo();
    const owner = await freshOwner();
    const staff = await adminToken();

    const first = await ok('POST', '/admin/properties', staff, {
      ownerMobile: owner.mobile,
      listing: { ...ON_BEHALF_LISTING, title: 'Green Acres 2BHK — first call', electricityMeterNo: meter },
    });
    const second = await ok('POST', '/admin/properties', staff, {
      ownerMobile: owner.mobile,
      listing: { ...ON_BEHALF_LISTING, title: 'Green Acres 2BHK — second call', electricityMeterNo: meter },
    });

    // This exemption is the precondition; without it the scenario below cannot start.
    const cluster = clusterWith(await readDesk(staff), first.id);

    expect(cluster, 'an owner listed twice by the desk was not clustered').toBeTruthy();
    expect(cluster.listings.map((l) => l.id).sort()).toEqual([first.id, second.id].sort());

    // Without owner context, staff can mistake self-duplicates for hostile hijacks.
    expect(cluster.sameOwner).toBe(true);
  });

  test('a merge archives the losers, leaves the keeper untouched, and clears the cluster', async () => {
    // This proves the console reads the server contract instead of deriving it locally.
    const meter = meterNo();
    const keeper = await freshOwner();
    const loser = await freshOwner();

    const keepId = await createListing(keeper.token, { meter, title: 'Palm Grove 2BHK — keep this' });
    const dropId = await createListing(loser.token, { meter, title: 'Palm Grove 2BHK — archive this' });

    const token = await adminToken();
    expect(clusterWith(await readDesk(token), keepId), 'nothing to merge').toBeTruthy();

    // Losers are named explicitly rather than inferred from the cluster.
    const merged = await api('POST', '/admin/properties/duplicates/merge', token, { keepId, dropIds: [dropId] });
    expect(merged.status).toBe(204);

    // The loser is archived, not deleted.
    const dropped = await ok('GET', `/me/listings/${dropId}`, loser.token);
    expect(dropped.archived).toBe(true);

    // The keeper must not receive synthetic duplicate fields with no backing column.
    const kept = await ok('GET', `/me/listings/${keepId}`, keeper.token);
    expect(kept.archived).toBe(false);

    // The cluster disappears because a member left, not because it was marked resolved.
    expect(clusterWith(await readDesk(token), keepId)).toBeUndefined();
  });

  test('a dismissal settles that exact set, and a third colliding listing asks again', async () => {
    const meter = meterNo();
    const first = await freshOwner();
    const second = await freshOwner();
    const third = await freshOwner();

    const a = await createListing(first.token, { meter, title: 'Lake View 2BHK — A' });
    const b = await createListing(second.token, { meter, title: 'Lake View 2BHK — B' });

    const token = await adminToken();

    // BEFORE.
    const before = clusterWith(await readDesk(token), a);
    expect(before, 'the pair was not on the desk before dismissing it').toBeTruthy();

    const dismissed = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [a, b] });
    expect(dismissed.status).toBe(204);

    expect(clusterWith(await readDesk(token), a), 'the dismissed pair came back unchanged').toBeUndefined();

    // A unique index on the signature makes the naive implementation throw here instead.
    const again = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [a, b] });
    expect(again.status).toBe(204);

    // `C` forms a new `{A,B,C}` cluster that has not inherited the old verdict.
    const c = await createListing(third.token, { meter, title: 'Lake View 2BHK — C' });

    const after = clusterWith(await readDesk(token), c);
    expect(after, 'a third colliding listing did not resurface the dismissed set').toBeTruthy();
    expect(after.listings.map((l) => l.id).sort()).toEqual([a, b, c].sort());
  });

  test('the desk refuses a dismissal it cannot key, rather than storing a meaningless one', async () => {
    const token = await adminToken();

    // A single id is not a cluster.
    const single = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [crypto.randomUUID()] });
    expect(single.status).toBe(400);

    // And an empty set is refused by validation before it reaches that rule.
    const empty = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [] });
    expect(empty.status).toBe(422);
  });

  test('the desk is staff-only: an owner cannot read it or act on it', async () => {
    const owner = await freshOwner();

    // Every listing on this desk is rendered with contact details revealed, because the desk exists to ring somebody.
    const read = await api('GET', '/admin/properties/duplicates', owner.token);
    expect(read.status).toBe(403);

    // Both writes archive or silence supply, so neither is available to a consumer either.
    const merge = await api('POST', '/admin/properties/duplicates/merge', owner.token,
      { keepId: crypto.randomUUID(), dropIds: [crypto.randomUUID()] });
    expect(merge.status).toBe(403);

    const dismiss = await api('POST', '/admin/properties/duplicates/dismiss', owner.token,
      { ids: [crypto.randomUUID(), crypto.randomUUID()] });
    expect(dismiss.status).toBe(403);
  });

  test('the tab renders the cluster an operator has to choose between', async ({ page, login }) => {
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    const title = `Duplicate Desk Fixture ${Date.now().toString(36)}`;
    const a = await createListing(incumbent.token, { meter, title: `${title} — A` });
    await createListing(collider.token, { meter, title: `${title} — B` });

    await login.asAdmin();
    await page.goto('/admin/properties?tab=duplicates');

    // The container anchor keeps scoped assertions from passing on a missing panel.
    await expect(page.getByRole('tab', { name: /^Duplicates/ })).toHaveAttribute('aria-selected', 'true');

    // Shared catalogues can show other collisions, so locate by fixture title, not position.
    const card = page.locator('.dz-card').filter({ hasText: `${title} — A` }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    await expect(card.getByText(`${title} — B`)).toBeVisible();

    // The provider translates wire vocabulary so moderators never see raw `address`.
    await expect(card.getByText(/same address \/ electricity meter/)).toBeVisible();

    // This absence sits behind positive anchors because missing panels also satisfy absence.
    await expect(card.getByText('same owner')).toHaveCount(0);

    // One button per member, because "keep this one" is the only action the desk exists to take.
    await expect(card.getByRole('button', { name: /Keep this, archive the rest/ })).toHaveCount(2);

    const token = await adminToken();
    const cluster = clusterWith(await readDesk(token), a);
    if (cluster) {
      const [keep, ...drops] = cluster.listings.map((l) => l.id);
      await api('POST', '/admin/properties/duplicates/merge', token, { keepId: keep, dropIds: drops });
    }
  });
});
