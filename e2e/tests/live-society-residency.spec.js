/**
 * LIVE integration check for the `society` domain — residency, claims, and who reviews them (D240).
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `draazy_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/live-society-residency.spec.js --config=playwright.config.js
 *
 * ## Why this file is API-level and not a browser walk
 *
 * The society hub does not call these endpoints yet — it is still reading `dzSocietyResidents` and
 * `dzSocietyClaims` out of the browser, which is the whole reason this slice exists. Wiring the hub
 * is the last step of the wave, and it needs the routes to be real first. A spec that drove the UI
 * today would therefore be testing localStorage with extra steps.
 *
 * What it *can* prove now is the half that no unit test can: that the rules survive a real HTTP
 * round trip against a real Postgres with a real security chain in front of them. Specifically that
 * the partial unique index actually refuses a second verified resident (a rule the backend tests
 * exercise inside one rolled-back transaction), that the membership read is genuinely reachable
 * without a token, and that it genuinely withholds the claimant's number from an anonymous caller.
 *
 * ## Why it mints its own accounts
 *
 * Every seeded consumer is shared, and residency is exclusive: a spec that verified a seeded user
 * into a seeded society would poison that flat for every later run, and the second run would fail
 * against a fixture the first run created. `signedInAsNew` gives each run its own people.
 *
 * The society is minted for the same reason, and not merely picked out of the directory: see
 * `helpers/liveSociety.js`, which exists because picking one is what made this file count three
 * verified residents where it had verified one.
 */
import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

/**
 * The seeded platform admin.
 *
 * Ops rather than a `staff` account on purpose: the claim queue is gated on the `societies:read`
 * and `societies:write` atoms, and no seeded staff team holds them yet. Admin is the account the
 * other back-office live specs use for the same reason.
 */
const OPS = '9000000000';

/**
 * A brand-new account, over HTTP only.
 *
 * `signedInAsNew` is the usual way to mint one, but it drives the browser sign-in as well, and
 * these tests never open a page. `POST /auth/login` auto-registers an unknown mobile, so one call
 * is the whole registration.
 *
 * `uniqueMobile()` is a timestamp tail and two calls in the same millisecond return the same
 * number, which here would silently make two "different" residents one person — the exact thing
 * every assertion below is about. Hence the retry until the number is genuinely new to this run.
 */
const minted = new Set();

async function newAccount() {
  let mobile = uniqueMobile();
  while (minted.has(mobile)) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 2); });
    mobile = uniqueMobile();
  }
  minted.add(mobile);
  await apiLogin(mobile, { api: API });
  return mobile;
}

/**
 * A society this test, and only this test, is writing to.
 *
 * Minted rather than chosen. Every assertion below is exclusive — one verified resident per flat,
 * one committee per society, one count of residents — so a building shared with a sibling test is
 * not a flake but a wrong answer, and the seeded directory is shared by every worker at once.
 * Unclaimed on arrival, which is what sends residency decisions through the ops queue.
 */
async function freshSociety(request) {
  return mintSociety(request, await newAccount(), 'Residency');
}

const apply = async (request, mobile, slug, flat, extra = {}) =>
  request.post(`${API}/societies/${slug}/residents`, {
    headers: await authHeaders(mobile),
    data: { flat, relation: 'owner', ...extra },
  });

const decide = async (request, mobile, slug, id, status) =>
  request.patch(`${API}/societies/${slug}/residents/${id}`, {
    headers: await authHeaders(mobile),
    data: { status },
  });

test.describe('live: society residency and claims', () => {
  test('a flat can only have one verified resident, and rejecting frees it', async ({ request }) => {
    const slug = await freshSociety(request);
    const first = await newAccount();
    const second = await newAccount();

    const firstRes = await apply(request, first, slug, '704', { wing: 'B' });
    expect(firstRes.status(), await firstRes.text()).toBe(200);
    const firstRow = await firstRes.json();
    // The server normalises wing+flat into one key, stripping separators as well as spaces, so
    // "B-704" and "B704" are one flat rather than two people in the same room.
    expect(firstRow.unitKey).toBe('B704');
    expect(firstRow.assignedTo).toBe('ops');

    expect((await decide(request, OPS, slug, firstRow.id, 'verified')).status()).toBe(200);

    // Same flat, written differently. Recorded and flagged, not refused: the server cannot tell a
    // handover from an impostor, and the committee can.
    const secondRes = await apply(request, second, slug, '704 ', { wing: 'b-' });
    expect(secondRes.status()).toBe(200);
    const secondRow = await secondRes.json();
    expect(secondRow.unitKey).toBe('B704');
    expect(secondRow.flagged).toBe('conflict');

    // The refusal happens at the decision, where a human is looking.
    expect((await decide(request, OPS, slug, secondRow.id, 'verified')).status()).toBe(409);

    // A flat changes hands. Rejecting the outgoing resident must be enough — needing a DBA here
    // would mean every sale in Pune became a support ticket.
    expect((await decide(request, OPS, slug, firstRow.id, 'rejected')).status()).toBe(200);
    const handover = await decide(request, OPS, slug, secondRow.id, 'verified');
    expect(handover.status(), await handover.text()).toBe(200);
    expect((await handover.json()).flagged).toBeFalsy();
  });

  test('membership reads without a token and withholds the claimant’s number', async ({ request }) => {
    const slug = await freshSociety(request);
    const claimant = await newAccount();

    const anonymous = await request.get(`${API}/societies/${slug}/membership`);
    expect(anonymous.status(), 'the hub renders before anybody signs in').toBe(200);
    const before = await anonymous.json();
    expect(before.resident).toBeNull();
    expect(before.admin).toBe(false);
    expect(before.claim).toBeNull();

    const claimed = await request.post(`${API}/societies/${slug}/claim`, {
      headers: await authHeaders(claimant),
      data: { name: 'Committee Secretary', role: 'Hon. Secretary', email: 'sec@example.com' },
    });
    expect(claimed.status(), await claimed.text()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}/membership`)).json();
    expect(after.claim.status).toBe('pending');
    expect(after.claim.claimantName).toBe('Committee Secretary');
    // The point of the endpoint being public is also its risk. Neither of these may ever appear.
    expect(after.claim.claimantMobile).toBeFalsy();
    expect(after.claim.email).toBeFalsy();
  });

  test('approving a claim hands the society and its waiting queue to the committee', async ({ request }) => {
    const slug = await freshSociety(request);
    const committee = await newAccount();
    const resident = await newAccount();
    const neighbour = await newAccount();

    // Filed while nobody ran the society, so ops own it.
    const waiting = await (await apply(request, resident, slug, '11', { wing: 'A' })).json();
    expect(waiting.assignedTo).toBe('ops');

    const claim = await (await request.post(`${API}/societies/${slug}/claim`, {
      headers: await authHeaders(committee),
      data: { name: 'Committee Chair', role: 'Chairman' },
    })).json();

    const approved = await request.patch(`${API}/admin/society-claims/${claim.id}`, {
      headers: await authHeaders(OPS),
      data: { status: 'approved' },
    });
    expect(approved.status(), await approved.text()).toBe(200);

    // The society's own badge moves with the claim — a committee holding a permission the hub draws
    // no control for is worse than no committee at all.
    const detail = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(detail.claimStatus).toBe('claimed');

    // And the queue moves too, including the request ops had not got to yet.
    const mine = await (await request.get(`${API}/societies/${slug}/membership`, {
      headers: await authHeaders(resident),
    })).json();
    expect(mine.resident.assignedTo).toBe('committee');
    expect(mine.admin).toBe(false);

    const theirs = await (await request.get(`${API}/societies/${slug}/membership`, {
      headers: await authHeaders(committee),
    })).json();
    expect(theirs.admin).toBe(true);

    // The committee can now do the reviewing, and a neighbour still cannot read the queue —
    // it carries names and mobiles.
    const queue = await request.get(`${API}/societies/${slug}/residents?status=pending`, {
      headers: await authHeaders(committee),
    });
    expect(queue.status()).toBe(200);
    const rows = (await queue.json()).content;
    expect(rows.some((r) => r.id === waiting.id && r.mobile === resident)).toBe(true);

    expect((await request.get(`${API}/societies/${slug}/residents`, {
      headers: await authHeaders(neighbour),
    })).status()).toBe(403);

    const verified = await decide(request, committee, slug, waiting.id, 'verified');
    expect(verified.status(), await verified.text()).toBe(200);

    const count = await (await request.get(`${API}/societies/${slug}/membership`)).json();
    expect(count.verifiedResidents).toBe(1);
  });

  test('a second committee cannot claim a society that is already spoken for', async ({ request }) => {
    const slug = await freshSociety(request);
    const real = await newAccount();
    const rival = await newAccount();

    expect((await request.post(`${API}/societies/${slug}/claim`, {
      headers: await authHeaders(real),
      data: { name: 'Real Committee' },
    })).status()).toBe(200);

    expect((await request.post(`${API}/societies/${slug}/claim`, {
      headers: await authHeaders(rival),
      data: { name: 'Rival Committee' },
    })).status()).toBe(409);

    // The claimant correcting their own pending claim is not a rival — it is a typo.
    const amended = await request.post(`${API}/societies/${slug}/claim`, {
      headers: await authHeaders(real),
      data: { name: 'Real Committee', role: 'Treasurer' },
    });
    expect(amended.status()).toBe(200);
    expect((await amended.json()).role).toBe('Treasurer');
  });

  test('the seeded fixture carries both queues, and only one of them is the committee’s', async ({ request }) => {
    // Not a duplicate of the tests above: those prove the *transition*, this proves the seed the
    // hub work will read. A fixture nothing asserts on is a fixture that rots — and the whole
    // point of seeding these two societies is that a hub spec can arrive at a verified resident
    // and a sitting committee without creating either.
    const claimed = await (await request.get(`${API}/societies/blue-ridge-towers-hinjawadi/membership`)).json();
    expect(claimed.claim.status).toBe('approved');
    expect(claimed.verifiedResidents).toBe(1);

    // The committee reads its own inbox; ops never had to touch this society.
    const committee = await request.get(
      `${API}/societies/blue-ridge-towers-hinjawadi/residents?status=pending`,
      { headers: await authHeaders('9464709344') },
    );
    expect(committee.status(), 'the approved claimant is the committee').toBe(200);
    const inbox = (await committee.json()).content;
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.every((r) => r.assignedTo === 'committee')).toBe(true);

    // The other society's claim is still waiting, so its residents wait with ops. Without this row
    // "assigned_to is always committee" would pass every assertion the fixture can make.
    const pending = await (await request.get(`${API}/societies/kumar-palaash-hinjawadi/membership`)).json();
    expect(pending.claim.status).toBe('pending');
    const ops = await request.get(
      `${API}/societies/kumar-palaash-hinjawadi/residents?status=pending`,
      { headers: await authHeaders(OPS) },
    );
    expect(ops.status()).toBe(200);
    expect((await ops.json()).content.every((r) => r.assignedTo === 'ops')).toBe(true);
  });
});
