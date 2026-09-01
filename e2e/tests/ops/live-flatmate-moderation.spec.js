/**
 * Ops → flatmate desk, against the **live** backend.
 *
 * Three boards on one page, and the mock could only ever model one of them. `lib/data/flatmates.js`
 * knew about host verification and nothing at all about the D72 moderation axis or about group
 * applications — so the desk's other two thirds have never been exercised by a test until now.
 *
 * ## Every fixture here is minted through the consumer path
 *
 * `punenest_e2e` seeds five flatmate supply rows and **all five are already `approved`**, so the
 * Pending moderation board is empty at baseline. Seeding straight into the table would prove the
 * board renders; posting through `POST /flatmates/rooms` and `POST /flatmates/groups` proves it
 * shows what the product actually produces — including the D72 default, which is the entire reason
 * the board exists.
 *
 * Each test uses its own host account. The anti-broker cap counts non-owner-tier supply per host,
 * so sharing one would make these tests depend on the order they run in.
 *
 * ## The two axes, and why they each get a test
 *
 * A flatmate row carries two independent verdicts. **Verification** answers "is this host who they
 * say they are" and moves a trust badge. **Moderation** answers "may the city see this" and moves
 * visibility. They are deliberately unable to reach each other: approving a verification does not
 * publish the post, and publishing a post grants no badge. Both are asserted below, because a desk
 * that quietly conflated them would look correct on every screenshot.
 *
 * ## Badge is a translation layer
 *
 * `Badge` relabels `pending` as **Under Review**. Asserting the wire word would be asserting a lie
 * about the screen, so the mapping is stated once here and the vocabulary itself is checked where
 * it belongs — in the Java tests, against the endpoints.
 */
import { expect, test } from '../../fixtures/live.js';
import { API, apiLogin } from '../../helpers/liveAuth.js';

const STAFF = '9733798115';

/**
 * One host per test — see the anti-broker cap note above.
 *
 * Every name here must be `status = 'active'` in the seed. That is not a style rule: six seeded
 * users are `suspended`, and since V77 login enforces the column, so signing in as one fails with a
 * 403 that reads like a broken fixture. `verifyReject` was Sakshi Iyer, who is one of the six.
 */
const HOSTS = {
  verifyApprove: { mobile: '9700000003', name: 'Arjun Rao' },
  verifyReject: { mobile: '9712728163', name: 'Aditya Iyer' },
  publish: { mobile: '9240355264', name: 'Aarav Reddy' },
  remove: { mobile: '9253229149', name: 'Pooja Shah' },
  apply: { mobile: '9272696131', name: 'Rahul Jain' },
};

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const stamp = () => Date.now().toString(36).slice(-5);

async function post(path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * A room posted with `agreementDeclared: true`.
 *
 * That flag is what makes the server derive the **tenant** tier, and a tenant-tier row is what
 * enqueues a verification review — an owner-tier one never does, because owning the flat is the
 * claim the review exists to check. Without it this fixture would silently produce nothing for the
 * verification board to show.
 *
 * The field names are the room request's own (`hostRole`, `agreementDeclared`); the group request
 * spells the same two ideas `role` and `agreement`. Getting them wrong is silent — the post is
 * accepted, owner-tier is assumed, and no review is ever enqueued.
 */
async function seedTenantRoom(host, society) {
  const { accessToken } = await apiLogin(host.mobile);
  const room = await post('/flatmates/rooms', accessToken, {
    bhk: '2',
    roomType: 'Private room',
    attachedBath: 'attached',
    furnishing: 'semi',
    locality: 'Kothrud',
    society,
    rentShare: 15000,
    deposit: 30000,
    availableFrom: '2026-12-01',
    lookingFor: 'any',
    foodPref: 'any',
    photos: ['https://cdn.example/1.jpg'],
    note: 'Quiet building, sunny room.',
    hostRole: 'tenant',
    agreementDeclared: true,
  });
  return { room, accessToken };
}

/** A seeker post — the simplest thing that lands on the Pending moderation board. */
async function seedSeekerPost(host, freeText) {
  const { accessToken } = await apiLogin(host.mobile);
  const created = await post('/flatmates/posts', accessToken, {
    name: host.name,
    age: 27,
    occupation: 'Engineer',
    budget: 16000,
    localities: ['Kothrud'],
    moveIn: '2026-12-01',
    // The moderation board's "What they typed" column. Everything below matches on this, because
    // it is the field a moderator is actually reading.
    note: freeText,
  });
  return { created, accessToken };
}

/** A visible group, plus an application to a seeded rental listing. */
async function seedApplication(host, title) {
  const { accessToken } = await apiLogin(host.mobile);
  const group = await post('/flatmates/groups', accessToken, {
    title,
    locality: 'Kothrud',
    policy: 'any',
    rent: 45000,
    seats: 3,
    seatsOpen: 1,
    name: host.name,
    role: 'tenant',
  });

  /* A group must be past moderation before it may apply, so this borrows the desk's own decision
     route rather than reaching into the database — the same act a moderator would perform. */
  const { accessToken: staffToken } = await apiLogin(STAFF);
  const publish = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH',
    headers: auth(staffToken),
    body: JSON.stringify({ modStatus: 'approved' }),
  });
  if (!publish.ok) throw new Error(`publish group → ${publish.status} ${await publish.text()}`);

  /* Any seeded rental will do, and the public feed is the honest way to find one: it returns only
     listings a stranger may see, which is the same set the server will accept an application for.
     The hosts above are buyer accounts, so none of them owns one. */
  const listings = await fetch(`${API}/properties?deal=rent&size=5`).then((r) => r.json());
  const flat = (listings.content || [])[0];
  if (!flat) throw new Error('seedApplication: no approved rental listing in the seed');

  const application = await post(`/flatmates/groups/${group.id}/apply`, accessToken, {
    listingId: flat.id,
  });
  return { group, application, flat };
}

const rowFor = (page, text) => page.getByRole('row').filter({ hasText: text }).first();

/** Move between the three boards. The switcher is a button group, not tabs. */
const openBoard = (page, label) =>
  page.getByRole('group', { name: 'Flatmate boards' }).getByRole('button', { name: label }).click();

/** Move between the tab strips inside a board. */
const openTab = (page, group, label) =>
  page.getByRole('group', { name: group }).getByRole('button', { name: label }).click();

async function openDesk(page, login) {
  await login.asStaff('rental');
  await page.goto('/ops/flatmate-review');
  await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
  // If this fires, the desk fell back to its offline panel and nothing below means anything.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

test.describe('Ops → flatmate desk (live)', () => {
  test('a tenant declaration reaches Verification and approving moves it, not the post', async ({ page, login }) => {
    const host = HOSTS.verifyApprove;
    /* Rows are found by the society name, not the host's. Several seeded accounts share a surname,
       and the board's own "Flat / address" column is the column a moderator scans anyway. */
    const society = `Verify Heights ${stamp()}`;
    const { room } = await seedTenantRoom(host, society);
    await openDesk(page, login);

    const row = rowFor(page, society);
    await expect(row).toBeVisible();
    await expect(row).toContainText('tenant-tier');

    /* Masked. The desk decides on the declaration and the agreement document, not by ringing the
       host — so the number is masked in the mapper even though the wire carries it in full. A desk
       that can phone a host can be socially engineered into doing it on someone else's behalf. */
    await expect(page.getByText(host.mobile)).toHaveCount(0);

    await row.locator('.approve-review-btn').click();

    // Decided rows leave Pending, which is the whole point of a queue.
    await expect(rowFor(page, society)).toHaveCount(0);
    await openTab(page, 'Verification queues', 'Ops-verified');
    await expect(rowFor(page, society)).toBeVisible();

    /* The room itself is untouched. Verification is a trust badge; publishing is the other axis,
       and an approval that quietly published would make D72 unenforceable. Read back through the
       desk's own moderation queue — the only caller-visible place a room's `modStatus` appears. */
    const { accessToken: staffToken } = await apiLogin(STAFF);
    const queue = await fetch(`${API}/admin/flatmates/moderation?kind=room&modStatus=pending&size=100`,
      { headers: auth(staffToken) }).then((r) => r.json());
    expect((queue.content || []).some((q) => q.id === room.id)).toBe(true);
  });

  test('a rejection without a reason is refused before it reaches the wire', async ({ page, login }) => {
    const society = `Reject Court ${stamp()}`;
    await seedTenantRoom(HOSTS.verifyReject, society);
    await openDesk(page, login);

    await rowFor(page, society).locator('.reject-review-btn').click();

    /* The desk stops a blank reason, and `FlatmateModerationService` refuses one again if it ever
       gets through. Two guards for one rule, because the client one is a courtesy and the server
       one is the rule: a host told "no" without being told why cannot fix anything. */
    await page.getByRole('button', { name: /Confirm rejection/i }).click();
    await expect(page.getByText(/Add a clear reason before rejecting/i)).toBeVisible();

    await page.getByPlaceholder(/Reason for rejection/i).fill('The agreement names a different flat.');
    await page.getByRole('button', { name: /Confirm rejection/i }).click();

    await expect(rowFor(page, society)).toHaveCount(0);
    await openTab(page, 'Verification queues', 'Rejected');
    // The reason is shown back on the row, because it is what the host was told.
    await expect(rowFor(page, society)).toContainText('different flat');
  });

  test('a new seeker post is born Pending and publishing is what makes it public', async ({ page, login }) => {
    const host = HOSTS.publish;
    const marker = `Looking near Kothrud ${stamp()}`;
    await seedSeekerPost(host, marker);
    await openDesk(page, login);
    await openBoard(page, 'Moderation');

    // Default board is `post` / `pending`, which is where a brand-new post lands under D72.
    const row = rowFor(page, marker);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Under Review');

    // Before publishing, the public feed cannot see it — that is the claim D72 makes.
    const before = await fetch(`${API}/flatmates/posts?size=100`).then((r) => r.text());
    expect(before.includes(marker)).toBe(false);

    await row.getByRole('button', { name: 'Publish' }).click();
    await expect(rowFor(page, marker)).toHaveCount(0);

    const after = await fetch(`${API}/flatmates/posts?size=100`).then((r) => r.text());
    expect(after.includes(marker)).toBe(true);
  });

  test('removing a post takes a note, and the free text is never truncated', async ({ page, login }) => {
    const host = HOSTS.remove;
    const marker = `Contact 99999 in the free text ${stamp()}`;
    await seedSeekerPost(host, marker);
    await openDesk(page, login);
    await openBoard(page, 'Moderation');

    const row = rowFor(page, marker);
    /* The free text is rendered in full and never truncated. It is where a phone number goes when
       the contact field will not take one, so a moderator who cannot read all of it cannot do the
       job the board exists for. */
    await expect(row).toContainText('99999');

    await row.getByRole('button', { name: 'Remove' }).click();
    await page.getByPlaceholder(/Internal note/i).fill('Phone number in the free text.');
    await page.getByRole('button', { name: /^Confirm$/ }).click();

    await expect(rowFor(page, marker)).toHaveCount(0);
    await openTab(page, 'Moderation states', 'Removed');
    await expect(rowFor(page, marker)).toBeVisible();
  });

  test('a real group application reaches the board that could never have a row', async ({ page, login }) => {
    const host = HOSTS.apply;
    const title = `Three of us for a 3BHK ${stamp()}`;
    const { flat } = await seedApplication(host, title);
    await openDesk(page, login);
    await openBoard(page, 'Group applications');

    const row = rowFor(page, title);
    await expect(row).toBeVisible();
    await expect(row).toContainText(flat.title);
    await expect(row).toContainText('per head');
    // Two axes on one row: the owner has not answered, and ops has not taken it down.
    await expect(row).toContainText('Under Review');

    /* Flagging writes the moderation column and must not answer for the owner. This is the rule the
       admin board has always claimed and never been able to demonstrate, because until the apply
       route existed nothing could put a row here to demonstrate it on. */
    await row.getByRole('button', { name: 'Flag' }).click();
    await page.getByPlaceholder(/Internal note/i).fill('Group members look duplicated.');
    await page.getByRole('button', { name: /^Confirm$/ }).click();

    await expect(rowFor(page, title)).toContainText('flagged');
    await expect(rowFor(page, title)).toContainText('Under Review');
  });
});
