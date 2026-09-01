// @ts-check
import { expect, test } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

/**
 * LIVE: the Duplicates desk (D255).
 *
 * The successor to `admin/duplicates.spec.js`, which said of itself: "MOCK-ONLY, and not by
 * preference — the feature under test does not exist on a live build… It becomes convertible the
 * day `GET /admin/listings/duplicates` and a server-side merge exist." They exist now, so this is
 * that conversion, and the mock file goes.
 *
 * ## What the old arrangement got wrong, and why this file is shaped the way it is
 *
 * The clustering used to run in the browser, over `rawDb().listings` — the fixture store seeded into
 * `localStorage` at boot on *every* build. So against the live API the tab did not sit blank waiting
 * for a backend; it computed a confident answer about a catalogue it had never seen. Measured on
 * 2026-08-25: `Duplicate listings: 0` while `GET /admin/properties` returned 71 rows containing four
 * repeated titles. The merge button was worse — `resolveDuplicate` archived the loser into
 * `localStorage` and set `duplicateFlag` and `duplicateOf`, two columns no table on this platform
 * has ever had.
 *
 * That history sets this file's bar. **Every listing here is created over the wire**, because the
 * server derives clusters from `electricity_meter_key` / `address_key` / photo hashes, and those
 * are written by `ListingDuplicateProbe.reindex` inside the create transaction. A row inserted by
 * SQL carries none of them — measured on this lane's seeded database, all 123 properties had a null
 * `address_key` and exactly one had a meter key, so a test that seeded that way would assert
 * against a desk that could not see its own fixture and would pass for the wrong reason.
 *
 * ## The two things worth proving that a list test would not
 *
 * *A dismissal is keyed on the member set, not on a cluster id.* Derived clusters have no identity —
 * they are recomputed per request — so the verdict is stored against a hash of the sorted member
 * ids. The resurfacing rule then falls out of the key rather than needing one, and the last test
 * below is the proof: dismiss `{A,B}`, add a colliding `C`, and `{A,B,C}` is a different set that is
 * correctly asked again, because nobody has ever been shown `C` in this company.
 *
 * *A merge does not touch the listing it keeps.* There is no canonical flag to set. The losers are
 * archived — reversibly, by the ordinary staff route that already writes an audit row.
 *
 * ## Fixtures
 *
 * Every owner is minted per-test with a mobile no other run will use, and every collision is built
 * on a meter number unique to the test. The live database is shared with other sessions and is not
 * reset between runs, so this file never asserts a total: it asserts things about *its own*
 * listings, located by id. A test that counted clusters would be red whenever a colleague's run
 * happened to overlap it.
 *
 *   cd e2e; npx playwright test tests/admin/live-duplicates.spec.js --config=playwright.config.js
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** A meter number unique to this test run, so a cluster here can only contain this test's rows. */
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

/** A registered owner nobody else in the suite shares, plus their token. */
async function freshOwner() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, token: accessToken };
}

/** An admin token, for the three staff routes under test. */
async function adminToken() {
  const { accessToken } = await apiLogin('9000000000');
  return accessToken;
}

/**
 * One listing, created on the wire so `reindex` runs and the row carries the signals the desk reads.
 *
 * `title` is varied per listing so the assertions below can tell the members of a cluster apart on
 * screen — the desk's whole job is helping an operator choose between them.
 */
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
  });
  return created.id;
}

/** The desk, as the server reports it. */
const readDesk = (token) => ok('GET', '/admin/properties/duplicates', token);

/** The listing body `POST /admin/properties` takes, minus the two fields each test varies. */
const ON_BEHALF_LISTING = {
  deal: 'rent',
  propertyType: 'apartment',
  price: 32000,
  bhk: 2,
  locality: 'Kothrud',
  city: 'Pune',
  floor: 4,
};

/** The one cluster containing `id`, or `undefined`. Located by member, never by position. */
function clusterWith(desk, id) {
  return (desk.clusters || []).find((c) => c.listings.some((l) => l.id === id));
}

test.describe('LIVE: the duplicates desk (D255)', () => {
  test('two owners on one meter surface as a cross-owner cluster', async () => {
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    const a = await createListing(incumbent.token, { meter, title: 'Sunrise Residency 2BHK — first' });
    const b = await createListing(collider.token, { meter, title: 'Sunrise Residency 2BHK — second' });

    const token = await adminToken();
    const desk = await readDesk(token);

    /* Positive anchor before anything else. Every other assertion in this test is about the shape of
       one cluster, and all of them would pass vacuously against a desk that returned nothing. */
    const cluster = clusterWith(desk, a);
    expect(cluster, 'the pair sharing a meter did not cluster at all').toBeTruthy();

    /* Both members, and only these two. A clustering that swept in a stranger's listing would be
       worse than one that missed the pair: the operator's next action archives whatever is here. */
    expect(cluster.listings.map((l) => l.id).sort()).toEqual([a, b].sort());

    /* The meter is the address arm, not the photo arm. Neither listing has a photo, so a cluster
       claiming `image` would mean the band index had matched two empty sets. */
    expect(cluster.reason).toBe('address');

    /* Different accounts, so this is the moderation case rather than the phone call. The write-time
       probe only ever compares across owners; the desk sees both and has to say which it found. */
    expect(cluster.sameOwner).toBe(false);

    /* The desk read a bounded window and said so. `false` here is not decoration: a truncated
       clustering does not render as a short list, it renders as a clean one, because a pair split
       across the ceiling disappears entirely. This lane's catalogue is far under the cap. */
    expect(desk.truncated).toBe(false);
    expect(desk.scanned).toBeGreaterThanOrEqual(2);
  });

  test('one owner listed twice by the concierge desk is clustered, and labelled as themselves', async () => {
    /* The deliberate divergence from `ListingDuplicateProbe`, which compares across owners only. A
       note filed on somebody for colliding with themselves is noise at the moment of posting; seen
       from this desk the same fact is a supply problem, because one flat occupying two slots in
       search distorts results however many accounts it came from.
    *
    * **How a same-owner collision actually happens is worth recording, because it is not what it
    * looks like.** The first version of this test posted twice as the owner and was refused:
    * `422 listing_quota_exhausted`, "You already have 1 of 1 listings live." The free tier is one
    * live listing, so an owner *cannot* self-post a duplicate — the paywall blocks the second one
    * before the detector ever sees it. Which means the same-owner case arrives almost entirely
    * through the one route that is exempt from that ceiling: this desk. `POST /admin/properties`
    * was exempted so an operator on a call with somebody who owns three flats could record all
    * three, and the cost of that exemption is exactly this — the owner rang again, got a different
    * operator, and the flat is now on the catalogue twice under one account.
    *
    * That is the strongest available argument for `sameOwner` existing at all. The cross-owner probe
    * cannot see this by construction, the quota guarantees the honest owner never triggers it, and
    * the desk that creates it is the desk that has to clean it up. */
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

    /* Both accepted. If this ever starts refusing, the test above it is the one that breaks, and
       this assertion is what says why: the exemption is the precondition of the whole scenario. */
    const cluster = clusterWith(await readDesk(staff), first.id);

    expect(cluster, 'an owner listed twice by the desk was not clustered').toBeTruthy();
    expect(cluster.listings.map((l) => l.id).sort()).toEqual([first.id, second.id].sort());

    /* The flag is the entire reason including these is safe. Without it an operator reads an
       owner's own duplicate as a stranger hijacking their listing and archives the wrong one — and
       here the "stranger" would have been their own colleague. */
    expect(cluster.sameOwner).toBe(true);
  });

  test('a merge archives the losers, leaves the keeper untouched, and clears the cluster', async () => {
    const meter = meterNo();
    const keeper = await freshOwner();
    const loser = await freshOwner();

    const keepId = await createListing(keeper.token, { meter, title: 'Palm Grove 2BHK — keep this' });
    const dropId = await createListing(loser.token, { meter, title: 'Palm Grove 2BHK — archive this' });

    const token = await adminToken();
    expect(clusterWith(await readDesk(token), keepId), 'nothing to merge').toBeTruthy();

    /* Losers are named explicitly rather than inferred from the cluster. The operator's screen and
       the server's derivation are two moments apart, so a listing that joined in between is one the
       operator never saw — and this route archives whatever it is handed. */
    const merged = await api('POST', '/admin/properties/duplicates/merge', token, { keepId, dropIds: [dropId] });
    expect(merged.status).toBe(204);

    /* The loser is archived, not deleted. A merge is a judgement call made from two thumbnails and
       a price, and the platform has to be able to take it back. */
    const dropped = await ok('GET', `/me/listings/${dropId}`, loser.token);
    expect(dropped.archived).toBe(true);

    /* And the keeper is untouched — still un-archived, still in whatever status it had. This is the
       assertion the old implementation could not have passed: it wrote `duplicateFlag` and
       `duplicateOf` onto the keeper, two fields with no column behind them. */
    const kept = await ok('GET', `/me/listings/${keepId}`, keeper.token);
    expect(kept.archived).toBe(false);

    /* The cluster is gone because one of its two members no longer occupies a slot, which is the
       honest reason — not because anything was marked as resolved. */
    expect(clusterWith(await readDesk(token), keepId)).toBeUndefined();
  });

  test('a dismissal settles that exact set, and a third colliding listing asks again', async () => {
    /* The design proof. Derived clusters have no id to store a verdict against, so the verdict is
       keyed on a hash of the sorted member ids — which makes the resurfacing rule a consequence of
       the key rather than a rule someone has to remember to write. */
    const meter = meterNo();
    const first = await freshOwner();
    const second = await freshOwner();
    const third = await freshOwner();

    const a = await createListing(first.token, { meter, title: 'Lake View 2BHK — A' });
    const b = await createListing(second.token, { meter, title: 'Lake View 2BHK — B' });

    const token = await adminToken();

    /* BEFORE. Without this the test would pass against a desk that never showed the pair at all,
       and "it is not there after I dismissed it" would be a statement about nothing. */
    const before = clusterWith(await readDesk(token), a);
    expect(before, 'the pair was not on the desk before dismissing it').toBeTruthy();

    const dismissed = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [a, b] });
    expect(dismissed.status).toBe(204);

    expect(clusterWith(await readDesk(token), a), 'the dismissed pair came back unchanged').toBeUndefined();

    /* Idempotent: one double-click, or two operators reaching the same verdict, is one fact. A
       unique index on the signature makes the naive implementation throw here instead. */
    const again = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [a, b] });
    expect(again.status).toBe(204);

    /* Now the part that a cluster-id-keyed table would get wrong. `C` collides with both, so the
       cluster is `{A,B,C}` — a set nobody has passed judgement on, containing a listing nobody has
       been shown. It must be asked again, and it must arrive as one cluster of three rather than as
       the dismissed pair plus a stray. */
    const c = await createListing(third.token, { meter, title: 'Lake View 2BHK — C' });

    const after = clusterWith(await readDesk(token), c);
    expect(after, 'a third colliding listing did not resurface the dismissed set').toBeTruthy();
    expect(after.listings.map((l) => l.id).sort()).toEqual([a, b, c].sort());
  });

  test('the desk refuses a dismissal it cannot key, rather than storing a meaningless one', async () => {
    const token = await adminToken();

    /* A single id is not a cluster. Accepting it would write a signature that no derived cluster can
       ever equal — a row that silences nothing, forever, while looking like a recorded decision. */
    const single = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [crypto.randomUUID()] });
    expect(single.status).toBe(400);

    /* And an empty set is refused by validation before it reaches that rule. 422 rather than 400
       because it is a well-formed request carrying an unacceptable value — the same envelope every
       other rejected field on this API uses, which is what makes it worth pinning: a route that
       answered 400 here would be the only one, and a client's error handling is written once. */
    const empty = await api('POST', '/admin/properties/duplicates/dismiss', token, { ids: [] });
    expect(empty.status).toBe(422);
  });

  test('the desk is staff-only: an owner cannot read it or act on it', async () => {
    const owner = await freshOwner();

    /* Every listing on this desk is rendered with contact details revealed, because the desk exists
       to ring somebody. That makes the read itself a disclosure, and the guard on it load-bearing:
       a consumer session reaching this route would be handed every owner's phone number in the
       clustered set. */
    const read = await api('GET', '/admin/properties/duplicates', owner.token);
    expect(read.status).toBe(403);

    /* Both writes archive or silence supply, so neither is available to a consumer either. */
    const merge = await api('POST', '/admin/properties/duplicates/merge', owner.token,
      { keepId: crypto.randomUUID(), dropIds: [crypto.randomUUID()] });
    expect(merge.status).toBe(403);

    const dismiss = await api('POST', '/admin/properties/duplicates/dismiss', owner.token,
      { ids: [crypto.randomUUID(), crypto.randomUUID()] });
    expect(dismiss.status).toBe(403);
  });

  test('the tab renders the cluster an operator has to choose between', async ({ page, login }) => {
    /* The UI half. Everything above pins the contract; this pins that the console actually reads it
       — which is the exact thing that was broken for four releases, when the tab computed its own
       answer from `localStorage` and never called the server at all. */
    const meter = meterNo();
    const incumbent = await freshOwner();
    const collider = await freshOwner();

    const title = `Duplicate Desk Fixture ${Date.now().toString(36)}`;
    const a = await createListing(incumbent.token, { meter, title: `${title} — A` });
    await createListing(collider.token, { meter, title: `${title} — B` });

    await login.asAdmin();
    await page.goto('/admin/properties?tab=duplicates');

    /* The tab opened. A dialog- or panel-scoped spec reports nothing when its container never
       appears, and every assertion below is scoped to this one. */
    await expect(page.getByRole('tab', { name: /^Duplicates/ })).toHaveAttribute('aria-selected', 'true');

    /* Located by the fixture's own title, never by position: this catalogue is shared, and other
       sessions' collisions may well be on screen at the same time. */
    const card = page.locator('.pn-card').filter({ hasText: `${title} — A` }).first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    /* Both members on screen. An operator choosing which listing survives needs to see the thing
       they are choosing against. */
    await expect(card.getByText(`${title} — B`)).toBeVisible();

    /* The reason, translated. The wire says `address`; a moderator is not required to know that
       vocabulary, and the provider owns the translation so both builds hand the component the same
       already-resolved label. */
    await expect(card.getByText(/same address \/ electricity meter/)).toBeVisible();

    /* Different owners, so the "same owner" label must *not* be here — this is the one absence in
       the file, and it sits behind three positive anchors above for the reason the register keeps
       recording: an absence check on a panel that never rendered passes on its own. */
    await expect(card.getByText('same owner')).toHaveCount(0);

    /* And the decision is offered. One button per member, because "keep this one" is the only
       action the desk exists to take. */
    await expect(card.getByRole('button', { name: /Keep this, archive the rest/ })).toHaveCount(2);

    /* Cleanup: the merge is the cheapest way to take both rows off a shared verification queue,
       and it exercises the console's own write path on the way out. */
    const token = await adminToken();
    const cluster = clusterWith(await readDesk(token), a);
    if (cluster) {
      const [keep, ...drops] = cluster.listings.map((l) => l.id);
      await api('POST', '/admin/properties/duplicates/merge', token, { keepId: keep, dropIds: drops });
    }
  });
});
