/**
 * The group-application loop, end to end, against the **live** backend.
 *
 * This is a loop the mock never had. `lib/groupApplications.js` seeded two rows into
 * `localStorage` and offered an owner two buttons; nothing in the product could *create* an
 * application, so the admin moderation board it fed was a screen that could never have a row on it.
 * The apply route, the owner inbox and the card below were built in wave 2c to close that.
 *
 * Two tests, one per half of the loop, because they fail for different reasons:
 *
 * - **The card** proves the consumer entry point exists and is scoped. It appears only for a signed-in
 *   visitor who hosts a group with an open seat, on somebody else's rental listing — four conditions,
 *   and the card renders nothing far more often than it renders something.
 * - **The inbox** proves the owner's end. `decideGroupApplication` is a seam delegate, and a wrong
 *   delegate shape is invisible to lint and to the build; it shows up only as a screen that will not
 *   act. The `status` written here is the owner's axis and is deliberately unreachable from the ops
 *   desk, which writes `modStatus` instead.
 *
 * Both use their own group, because a group that has already applied to a listing cannot apply again
 * — `existsByListingIdAndGroupId` is a uniqueness rule, not a race guard.
 */
import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin } from '../../../helpers/liveAuth.js';

const STAFF = '9733798115';

/** Meera is `login.asOwner()`, and she owns the only seeded approved rentals. */
const OWNER = '9470744469';

/** One group host per test — an applied group cannot apply again. */
const HOSTS = {
  card: { mobile: '9700000001', name: 'Rahul Mehta' },
  inbox: { mobile: '9700000002', name: 'Priya Nair' },
};

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const stamp = () => Date.now().toString(36).slice(-5);

/**
 * One of Meera's approved rentals, read the way the browser would.
 *
 * The two tests take **different** listings, because the live database is reset once per run and
 * not between tests: sharing one would leave the second test asserting that its own row vanished
 * while the first test's row was still on the screen saying the same sentence.
 */
async function ownerRental(index) {
  const { accessToken } = await apiLogin(OWNER);
  const mine = await fetch(`${API}/me/listings?size=50`, { headers: auth(accessToken) })
    .then((r) => r.json());
  const rentals = (mine.content || []).filter((p) => p.deal === 'rent' && p.status === 'approved');
  const flat = rentals[index];
  if (!flat) throw new Error(`ownerRental(${index}): the seeded owner has only ${rentals.length} approved rentals`);
  return flat;
}

/**
 * A group its host may actually apply with.
 *
 * Published through the desk's own route rather than the database, because `apply` checks
 * `group.isVisible()` in Java — a group still awaiting moderation is refused, and a fixture that
 * skipped this step would fail with a message about visibility rather than about what it tests.
 */
async function visibleGroup(host, title) {
  const { accessToken } = await apiLogin(host.mobile);
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      title,
      locality: 'Kothrud',
      policy: 'any',
      rent: 45000,
      seats: 3,
      seatsOpen: 1,
      name: host.name,
      role: 'tenant',
    }),
  });
  if (!res.ok) throw new Error(`create group → ${res.status} ${await res.text()}`);
  const group = await res.json();

  const { accessToken: staffToken } = await apiLogin(STAFF);
  const publish = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH',
    headers: auth(staffToken),
    body: JSON.stringify({ modStatus: 'approved' }),
  });
  if (!publish.ok) throw new Error(`publish group → ${publish.status} ${await publish.text()}`);
  return { group, accessToken };
}

test.describe('Flatmates → a group applies for a whole flat (live)', () => {
  test('the listing page offers a group to apply with, and applying reaches the owner', async ({ page, login }) => {
    const host = HOSTS.card;
    const title = `Card group ${stamp()}`;
    await visibleGroup(host, title);
    const flat = await ownerRental(0);

    await login.asBuyer();
    await page.goto(`/property/${flat.slug}`);

    const card = page.locator('.group-apply-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Rent this as a group');
    await card.locator('.apply-group-btn').filter({ hasText: title }).click();

    // The card swaps itself for a confirmation rather than staying pressable — a second application
    // from the same group would be refused by the server anyway, and offering it would be a lie.
    await expect(page.getByText(/Applied\. The owner decides from their dashboard/i)).toBeVisible();

    // And it is genuinely on the owner's side of the wire, not just on the screen.
    const { accessToken } = await apiLogin(OWNER);
    const inbox = await fetch(`${API}/me/group-applications?size=50`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const row = (inbox.content || []).find((a) => a.groupTitle === title);
    expect(row).toBeTruthy();
    expect(row.status).toBe('pending');
    // Per-head is computed server-side from rent ÷ seats; the card never sends it.
    expect(row.perHead).toBeGreaterThan(0);
  });

  test('the owner answers from the dashboard, and the answer is theirs alone', async ({ page, login }) => {
    const host = HOSTS.inbox;
    const title = `Inbox group ${stamp()}`;
    const { group, accessToken: hostToken } = await visibleGroup(host, title);
    const flat = await ownerRental(1);

    const applied = await fetch(`${API}/flatmates/groups/${group.id}/apply`, {
      method: 'POST',
      headers: auth(hostToken),
      body: JSON.stringify({ listingId: flat.id }),
    });
    if (!applied.ok) throw new Error(`apply → ${applied.status} ${await applied.text()}`);

    await login.asOwner();
    await page.goto('/dashboard');

    // The group title, not the listing's: the Action Center is one list of every kind of pending
    // decision, and the listing name alone is not unique across it.
    const item = page.getByTestId('action-item').filter({ hasText: title });
    await expect(item).toContainText(`Group wants to rent ${flat.title}`);
    await item.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByText('Group application accepted')).toBeVisible();
    // Answered applications leave the Action Center — it lists what still needs a decision.
    await expect(page.getByTestId('action-item').filter({ hasText: title })).toHaveCount(0);

    /* The owner wrote `status`; `modStatus` is the ops desk's column and must be untouched. Two
       independent verdicts on one row is the rule the admin board has always claimed, and this is
       the half of it that lives on the consumer side. */
    const { accessToken } = await apiLogin(OWNER);
    const inbox = await fetch(`${API}/me/group-applications?size=50`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const row = (inbox.content || []).find((a) => a.groupTitle === title);
    expect(row.status).toBe('accepted');
    expect(row.modStatus).toBe('live');
  });
});
