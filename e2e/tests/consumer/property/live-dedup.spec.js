/**
 * LIVE: the duplicate probe — the half of dedup that reads *other people's* listings.
 *
 * ## The bug this suite exists to keep closed
 *
 * Both cross-owner signals used to be computed in the browser, in `evaluateListingDedup`, against
 * `rawDb().listings`. That store is the local mirror: against a live API it holds only the listings
 * *this browser itself posted*. A real owner's browser has never seen another owner's listing, so
 * the cross-owner question was being put to a store structurally incapable of answering it.
 *
 * Every mock spec passed. The feature had never once fired for anybody.
 *
 * Both arms now run on the server, on write, against everybody's listings:
 *
 *   - the **doorway arm** (`ListingDuplicateProbe#flagSameDoorway`) on the address key and the
 *     electricity meter, and
 *   - the **photograph arm** (`#flagSamePhotos`) on the perceptual hashes the wizard computes and
 *     now actually sends (V116).
 *
 * ## Why the meter needed a migration to be worth testing
 *
 * The client normalised the meter with `digits()` before comparing; the server compared the raw
 * string. So `1700 4455 6677`, `1700-4455-6677` and `170044556677` were three different meters to
 * the server and one meter to the client. V115 adds a derived `electricity_meter_key` column and
 * compares on that. Test 1 is that migration's proof, and it runs against a **seeded** fixture, so
 * it proves the backfill and not just the write path.
 *
 * ## What is deliberately not here
 *
 * "Have I already listed this?" — the owner-scoped self-arm — is `tests/platform/live-own-duplicate`
 * and stays there. The two must never merge: an owner-facing cross-owner answer would turn a
 * guessed meter number into a lookup on a stranger's utility account. Test 3 is the assertion that
 * they have not.
 *
 *   cd e2e; npx playwright test tests/consumer/property/live-dedup.spec.js --config=playwright.live.config.js
 */
import { expect, test } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * The seeded duplicate-guard owner. **Read-only in this file.**
 *
 * He holds an Owner Plus plan (allowance 2) with one slot used, and `live-dup-modal` needs that
 * free second slot to reach the duplicate modal rather than the quota paywall. Workers are 1 and
 * the database resets only at global setup, so a listing posted as him here would still be there
 * when that spec runs and would fail it. Only `duplicate-check` is called with his token, which
 * creates nothing.
 */
const KUNAL = '9700000090';
/** His seeded listing, and the id every answer below has to name. */
const KUNAL_LISTING = 'd0000000-0000-4000-8000-0000000000d1';
/** His meter as the seed writes it. The key is the digits: 170044556677. */
const METER_SPELLINGS = ['1700 4455 6677', '1700-4455-6677', '170044556677'];

/** 16 hex characters — the same 64-bit aHash `frontend/src/lib/data/imageHash.js` produces. */
const PHOTO = 'ffff0000ffff0000';
/** Two bits away from PHOTO: a re-compressed copy of the same shot. Threshold is 10. */
const PHOTO_RECOMPRESSED = 'ffff0000ffff0003';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A fresh owner nobody else in this file shares. */
async function owner() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 26000,
  city: 'Pune',
  bhk: 2,
  area: 900,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
};

/**
 * A listing created through the real owner route.
 *
 * Never by writing `address_key`, `electricity_meter_key` or a hash row directly: the claim under
 * test is that the create path derives them, and a fixture that set them by hand would assert that
 * claim against itself.
 */
async function listing(headers, fields) {
  const created = await api('POST', '/me/listings', headers, {
    title: 'Bright 2BHK',
    locality: 'Baner',
    ...BASE_LISTING,
    ...fields,
  });
  expect(created.status).toBe(201);
  return created.body.id;
}

const caseFile = (headers, id) => api('GET', `/properties/${id}/verification`, headers);

test.describe('LIVE — the cross-owner duplicate probe', () => {
  test('one meter number spelled three ways is one meter number', async () => {
    const headers = await authHeaders(KUNAL);

    for (const spelling of METER_SPELLINGS) {
      const res = await api('POST', '/me/listings/duplicate-check', headers, {
        city: 'Pune',
        locality: 'Baner',
        electricityMeterNo: spelling,
      });
      expect(res.status, `spelling ${spelling}`).toBe(200);
      expect(res.body.found, `spelling ${spelling}`).toBe(true);
      expect(res.body.existingId, `spelling ${spelling}`).toBe(KUNAL_LISTING);
    }

    // The row that would otherwise pass. Without it "every spelling matches" is also satisfied by a
    // server that matches everything — including a stranger's meter, which is the failure mode that
    // turns this endpoint into a lookup on somebody else's utility account. Same length, same
    // prefix, last two digits changed.
    const nearMiss = await api('POST', '/me/listings/duplicate-check', headers, {
      city: 'Pune',
      locality: 'Baner',
      electricityMeterNo: '1700 4455 6699',
    });
    expect(nearMiss.status).toBe(200);
    expect(nearMiss.body.found).toBe(false);
  });

  test('a stranger on the same doorway is flagged to ops, on write, without being told', async () => {
    const first = await owner();
    const second = await owner();
    const admin = await authHeaders('9000000000');

    // A doorway nobody else in the fixture set shares, unit token included: "Rohan Nilay, Kharadi"
    // names a building and every flat in it would look like one property.
    const address = `Flat 902, C Wing, Probe Heights ${Date.now()}`;
    const firstId = await listing(first.headers, { address, locality: 'Kharadi' });

    // Precondition, asserted rather than assumed: nothing is on file against the first listing.
    // Its own create-time probe ran when the second listing did not exist yet.
    expect((await caseFile(admin, firstId)).status).toBe(404);

    // The same doorway, written as somebody else would write it. Different case, different
    // whitespace, different order of the filler words — the key is normalised, so it is the same
    // key. A different owner, so this posts and is flagged rather than blocked.
    const secondId = await listing(second.headers, {
      address: address.replace('Flat 902, C Wing,', 'C-902,').toUpperCase(),
      locality: 'Kharadi',
    });

    const opsView = await caseFile(admin, secondId);
    expect(opsView.status).toBe(200);
    expect(opsView.body.messages).toHaveLength(1);
    expect(opsView.body.messages[0].internal).toBe(true);
    expect(opsView.body.messages[0].body).toContain('matches an active listing by another owner');
    expect(opsView.body.messages[0].body).toContain(firstId);
  });

  test('the finding is invisible to the owner it was written about', async () => {
    const first = await owner();
    const second = await owner();
    const admin = await authHeaders('9000000000');

    const address = `Flat 55, A Wing, Quiet Court ${Date.now()}`;
    await listing(first.headers, { address, locality: 'Kharadi' });
    const secondId = await listing(second.headers, { address, locality: 'Kharadi' });

    // The positive anchor, first. Without it the absence below is satisfied by a route that is
    // simply broken, or by a probe that never fired — and this is the assertion people most want to
    // believe without checking.
    const opsView = await caseFile(admin, secondId);
    expect(opsView.status).toBe(200);
    expect(opsView.body.messages[0].internal).toBe(true);

    // Same route, same listing, the owner's own token. Not a redacted case file — no case file.
    //
    // 404 rather than an empty 200 is the point rather than an implementation detail. An empty 200
    // is itself the answer to the question the probe asks: post a listing carrying a guessed meter
    // number, then ask your own case file whether it exists. Quieter than the note, and the same
    // oracle. See PropertyVerificationService#ownerVisibleCase.
    const ownerView = await caseFile(second.headers, secondId);
    expect(ownerView.status).toBe(404);

    // And the same silence on the owner's own review inbox, which is the surface they would
    // actually look at.
    const inbox = await api('GET', '/me/property-reviews', second.headers);
    expect(inbox.status).toBe(200);
    expect(inbox.body.content).toHaveLength(0);
  });

  test('reused photographs are caught across localities, where the address arm is blind', async () => {
    const first = await owner();
    const second = await owner();
    const admin = await authHeaders('9000000000');

    // Neither listing carries an address or a meter, and they are in different parts of the city.
    // Photographs are the only thing that can connect them — which is the whole case for the arm:
    // lifting somebody's pictures and retyping everything else is the cheapest possible duplicate,
    // and it is exactly the one the doorway arm cannot see.
    const firstId = await listing(first.headers, {
      locality: 'Kothrud',
      title: 'Bright 2BHK in Kothrud',
      photoHashes: [PHOTO],
    });

    // Not the identical string: two bits away, which is what re-saving a JPEG does to its hash.
    // An equality check would pass every test written with the same constant and still fail on the
    // only input this feature will ever really see.
    const secondId = await listing(second.headers, {
      locality: 'Baner',
      title: 'Bright 2BHK in Baner',
      photoHashes: [PHOTO_RECOMPRESSED],
    });

    const opsView = await caseFile(admin, secondId);
    expect(opsView.status).toBe(200);
    expect(opsView.body.messages).toHaveLength(1);
    expect(opsView.body.messages[0].internal).toBe(true);
    expect(opsView.body.messages[0].body).toContain('reuses photographs');
    expect(opsView.body.messages[0].body).toContain(firstId);
  });

  test('the owner who posted first is not accused of copying themselves', async () => {
    const first = await owner();
    const stranger = await owner();
    const admin = await authHeaders('9000000000');

    const hash = 'aaaa5555aaaa5555';
    const firstId = await listing(first.headers, { locality: 'Kothrud', photoHashes: [hash] });
    const strangerId = await listing(stranger.headers, { locality: 'Wakad', photoHashes: [hash] });

    // The positive anchor: the pair really does collide, so the silence below means the note was
    // not written rather than that there was nothing to write.
    const flagged = await caseFile(admin, strangerId);
    expect(flagged.status).toBe(200);
    expect(flagged.body.messages[0].body).toContain('reuses photographs');
    expect(flagged.body.messages[0].body).toContain(firstId);

    // And the earlier listing — the one whose photograph was reused — has nothing on file. The
    // write path files against the listing being written and only that one, which is the difference
    // between "this submission looks like a copy" and accusing the person who posted first of
    // copying the person who copied them. The catch-up sweep is what eventually reads it, on its
    // own schedule, and `ListingNoticesTest#theSweepReadsPhotoOnlyListings` is that claim's proof —
    // it needs a listing carrying no meter and no address to be reachable at all, which is what the
    // photo clause in `findRecentSignalCarrying` buys.
    expect((await caseFile(admin, firstId)).status).toBe(404);
  });
});
