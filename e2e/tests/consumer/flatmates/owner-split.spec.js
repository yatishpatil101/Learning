import { test, expect } from '@playwright/test';
import {
  open, seed, readRooms, readReviews, rentListing,
  publishListing, approveListing, OWNER, OTHER,
} from '../../../helpers/app.js';

/* Owner supply: letting one flat room by room.

   Rooms may only be carved out of a rent listing the owner already has. These
   specs guard the trust rules around that, because this is the flow that mints
   the supply seekers are asked to believe in. */

const openMyProperties = async (page) => {
  await open(page, '/dashboard');
  await page.getByRole('button', { name: /My Properties/i }).first().click();
  await expect(page.getByText('3 BHK in Test Society')).toBeVisible();
};

const openOverflow = (page) => page.getByRole('button', { name: /More/i }).first().click();

/* Open the split modal and price every room it offers.

   The modal pre-seeds one room per bedroom (a 3 BHK starts with 3), and the
   confirm button stays disabled until every room has a rent — so a partial fill
   would silently never submit. `want` trims or extends that set first. */
const splitInto = async (page, want) => {
  await openOverflow(page);
  await page.getByText('Let room by room').click();
  await expect(page.getByText('Let this flat room by room')).toBeVisible();

  const modal = page.locator('.sf-modal');
  const rentOf = (i) => modal.locator('input[inputmode="numeric"]').nth(i * 2);

  let shown = await modal.getByRole('button', { name: /Remove this room/ }).count();
  if (shown === 0) shown = 1; // a single room has no remove control
  while (shown > want) {
    await modal.getByRole('button', { name: /Remove this room/ }).last().click();
    shown -= 1;
  }
  while (shown < want) {
    await modal.getByRole('button', { name: /Add a room/ }).click();
    shown += 1;
  }

  for (let i = 0; i < want; i += 1) await rentOf(i).fill(String(15000 - i * 2000));

  const confirm = modal.getByRole('button', { name: /List \d+ rooms?/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(modal).toBeHidden();
};

test.describe('Owner splits a flat into rooms', () => {
  test('offers the split only on a rent listing', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ deal: 'buy', price: 9_000_000 }));
    await openMyProperties(page);

    // A sale listing can never be sliced into rooms, so the action is absent
    // however the owner reaches for it.
    await expect(page.getByText('Let room by room')).toHaveCount(0);
    const canSplit = await page.evaluate(async () => {
      const mod = await import('/src/lib/data/flatSplit.js');
      return mod.canSplitIntoRooms({ id: 'L-e2e-1', deal: 'buy' });
    });
    expect(canSplit).toBe(false);
  });

  test('creates one record per declared room, priced per room', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing());
    await openMyProperties(page);
    await splitInto(page, 3);

    const rooms = await readRooms(page);
    expect(rooms).toHaveLength(3);
    // Every room inherits the parent listing — the key that ties them into one
    // flat for the occupancy ledger and the joint agreement.
    expect(rooms.every((r) => r.propertyId === 'L-e2e-1')).toBe(true);
    expect(rooms.every((r) => r.priceBasis === 'room')).toBe(true);
    // Occupancy is the tenants' choice, so every room starts empty.
    expect(rooms.every((r) => r.occupants === 0)).toBe(true);
    // A master bedroom's private bathroom is implied by its kind.
    expect(rooms.find((r) => r.roomKind === 'master').attachedBath).toBe('attached');
  });

  test('withholds the owner badge while the listing is unverified', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ status: 'pending' }));
    await openMyProperties(page);
    await splitInto(page, 2);

    // Being attached to a listing is not proof of ownership: a pending listing
    // has not been checked, so its rooms must not claim to be owner-verified.
    const rooms = await readRooms(page);
    expect(rooms.every((r) => r.verified === false)).toBe(true);
    expect(rooms.every((r) => r.verificationTier === 'identity')).toBe(true);

    // ...and the unproven claim goes to Ops rather than straight to seekers.
    expect((await readReviews(page)).length).toBeGreaterThan(0);
  });

  test('grants the owner badge when the listing is already approved', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ status: 'approved' }));
    await openMyProperties(page);
    await splitInto(page, 2);

    const rooms = await readRooms(page);
    expect(rooms.every((r) => r.verified === true)).toBe(true);
    expect(rooms.every((r) => r.verificationTier === 'owner')).toBe(true);
  });

  test('promotes the rooms once the flat is approved later', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ status: 'pending' }));
    await openMyProperties(page);
    await splitInto(page, 2);
    expect((await readRooms(page)).every((r) => r.verified === false)).toBe(true);

    // The badge is stored per room (seekers can't read the owner's listing
    // store), so approval is reconciled on the owner's next visit.
    await approveListing(page, 'L-e2e-1', OWNER.mobile);
    await open(page, '/flatmates');
    await expect(page.getByRole('button', { name: /Move in now/i })).toBeVisible();

    const rooms = await readRooms(page);
    expect(rooms.every((r) => r.verified === true)).toBe(true);
    expect(rooms.every((r) => r.verificationTier === 'owner')).toBe(true);
  });

  test('refuses to split the same flat twice', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ status: 'approved' }));
    await openMyProperties(page);
    await splitInto(page, 2);
    expect(await readRooms(page)).toHaveLength(2);

    // A second split would put two room sets on one propertyId and corrupt the
    // occupancy ledger, so the action is withdrawn entirely.
    await openOverflow(page);
    await expect(page.getByText('Let room by room')).toHaveCount(0);
    await expect(page.getByText('Stop letting room by room')).toBeVisible();
  });

  test('reports the split state on the listing card', async ({ page }) => {
    await seed(page, { user: OWNER });
    await publishListing(page, rentListing({ status: 'approved' }));
    await openMyProperties(page);
    await splitInto(page, 2);

    // The card reports the split on both the mobile and desktop layouts.
    await expect(page.getByText(/2 rooms listed/).first()).toBeVisible();
    // While the flat is empty it can still honestly be let whole.
    await expect(page.getByText('Whole-flat listing still live').first()).toBeVisible();
  });

  test("a non-owner cannot split someone else's listing", async ({ page }) => {
    // The dashboard only shows your own listings, but the rule has to hold in
    // the data layer too — this store is localStorage, not a security boundary.
    await seed(page, { user: OTHER });
    await open(page, '/flatmates');
    const res = await page.evaluate(async () => {
      const mod = await import('/src/lib/data/flatSplit.js');
      return mod.splitFlat(
        { id: 'L-not-mine', deal: 'rent', bhk: '2', ownerMobile: '9800000001' },
        { maxOccupants: 2, rooms: [{ roomKind: 'master', rent: 15000 }], ownerMobile: '9800000003' },
      );
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('notOwner');
  });

  test('rejects a room set the flat cannot physically hold', async ({ page }) => {
    await seed(page, { user: OWNER });
    await open(page, '/flatmates');

    const tooFewPeople = await page.evaluate(async () => {
      const mod = await import('/src/lib/data/flatSplit.js');
      return mod.validateSplit({
        bhk: '3',
        maxOccupants: 1,
        rooms: [{ roomKind: 'master', rent: 15000 }, { roomKind: 'bedroom', rent: 12000 }],
      });
    });
    // Every room needs at least one person, so a cap below the room count lies.
    expect(tooFewPeople).toMatchObject({ ok: false, reason: 'capOutOfRange' });

    const tooManyRooms = await page.evaluate(async () => {
      const mod = await import('/src/lib/data/flatSplit.js');
      return mod.validateSplit({
        bhk: '1',
        maxOccupants: 3,
        rooms: [
          { roomKind: 'master', rent: 1 },
          { roomKind: 'bedroom', rent: 1 },
          { roomKind: 'living', rent: 1 },
        ],
      });
    });
    // A 1 BHK is one bedroom plus a hall — a third room does not exist.
    expect(tooManyRooms).toMatchObject({ ok: false, reason: 'tooManyRooms' });
  });

  test('caps occupancy at the flat limit, not per room', async ({ page }) => {
    await seed(page, {
      user: OWNER,
      rooms: [
        { id: 'rmx-a', propertyId: 'L-cap', occupants: 0, maxOccupants: 2, priceBasis: 'room', budget: 15000, ownerMobile: OWNER.mobile },
        { id: 'rmx-b', propertyId: 'L-cap', occupants: 0, maxOccupants: 2, priceBasis: 'room', budget: 12000, ownerMobile: OWNER.mobile },
      ],
    });
    await open(page, '/flatmates');

    const result = await page.evaluate(async () => {
      const mod = await import('/src/lib/data/flatSplit.js');
      // Tenants decide how they share, so the owner records the outcome — but
      // the society's flat limit still binds across every room.
      const first = mod.setRoomOccupants('rmx-a', 2);
      const second = mod.setRoomOccupants('rmx-b', 3);
      return { first, second, total: mod.splitOccupants('L-cap') };
    });
    expect(result.first.occupants).toBe(2);
    expect(result.second.occupants).toBe(0); // the flat's cap of 2 is already spent
    expect(result.total).toBe(2);
  });
});

test.describe('Whole-flat listing and its rooms stay consistent', () => {
  const splitRoom = (occupants) => ({
    id: 'rmx-1',
    propertyId: 'L-e2e-1',
    priceBasis: 'room',
    occupancy: 'empty',
    occupants,
    maxOccupants: 3,
    roomKind: 'master',
    budget: 15000,
    society: 'Test Society',
    locality: 'Baner',
    localities: ['Baner'],
    ownerMobile: OWNER.mobile,
    verified: true,
    verificationTier: 'owner',
    moveIn: 'now',
    gender: 'any',
    tags: [],
    status: 'approved',
    time: 'Just now',
  });

  const wholeFlatIsPublic = (page) => page.evaluate(async () => {
    const api = await import('/src/lib/mockApi.js');
    const list = await api.listProperties({}, 'newest');
    return list.some((p) => p.id === 'L-e2e-1');
  });

  test('stays public while the flat is empty', async ({ page }) => {
    await seed(page, { user: OWNER, rooms: [splitRoom(0)] });
    await publishListing(page, rentListing({ status: 'approved' }));
    await open(page, '/flatmates');

    // Nobody has committed, so the whole flat is still genuinely available.
    expect(await wholeFlatIsPublic(page)).toBe(true);
  });

  test('hides from public search once the first tenant moves in', async ({ page }) => {
    await seed(page, { user: OWNER, rooms: [splitRoom(1)] });
    await publishListing(page, rentListing({ status: 'approved' }));
    await open(page, '/flatmates');

    // The flat can no longer be let whole, so advertising it would promise
    // something that no longer exists.
    expect(await wholeFlatIsPublic(page)).toBe(false);
  });

  test('tells the owner why their whole-flat listing disappeared', async ({ page }) => {
    await seed(page, { user: OWNER, rooms: [splitRoom(1)] });
    await publishListing(page, rentListing({ status: 'approved' }));
    await openMyProperties(page);

    // A silent disappearance reads as a bug, so the card states the cause.
    await expect(page.getByText(/whole-flat listing hidden/i).first()).toBeVisible();
  });

  test('cannot withdraw a split once someone lives there', async ({ page }) => {
    await seed(page, { user: OWNER, rooms: [splitRoom(1)] });
    await publishListing(page, rentListing({ status: 'approved' }));
    await openMyProperties(page);
    await openOverflow(page);

    // Deleting those rooms would erase a live tenancy.
    await expect(page.getByText('Stop letting room by room')).toHaveCount(0);
  });
});
