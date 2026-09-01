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
 *
 * ## The agreement-document test is a repayment
 *
 * `fbbfd18` deleted the Ops half of `tests/consumer/flatmates/agreement-evidence.spec.js`, because
 * the desk it drove is live-only in this build and the mock one renders a notice saying so. That
 * commit's message claimed the deleted assertions had moved here. Two of them had not: nothing in
 * this file could open an uploaded agreement, and nothing asserted the `No document` state. The
 * last test below is those two, against the real desk.
 */
import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders } from '../../helpers/liveAuth.js';

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
  withDoc: { mobile: '9283184696', name: 'Nikhil Nair' },
  withoutDoc: { mobile: '9396565787', name: 'Kabir Rao' },
};

/**
 * The smallest thing that is genuinely a PDF, as the consumer's `readAgreementDoc` would have
 * produced it: `{ name, size, mime, dataUrl }`, the file base64'd inline.
 *
 * A one-byte `data:application/pdf;base64,` would have been enough for the mapper — `viewable` is
 * `!!doc?.dataUrl` and nothing on the desk parses the bytes. It is a real header anyway because the
 * predicate the button's `onClick` runs (`isViewableDoc`) allowlists by scheme and MIME, and a
 * fixture that only satisfied the render but not the open would make this test agree with a build
 * where the button opens nothing.
 */
const AGREEMENT_PDF = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsOfCg==';

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
 *
 * `agreementDoc` is separate from the declaration on purpose and is left off by default: declaring
 * a tenancy and uploading the paper are two acts, and a host may do the first without the second.
 * The desk has to be able to tell them apart, which is what the last test here checks.
 */
async function seedTenantRoom(host, society, agreementDoc = null) {
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
    ...(agreementDoc ? { agreementDoc } : {}),
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

  test('the uploaded agreement is openable from the row, and a row without one says so', async ({ page, login }) => {
    /* Two hosts, not one. The anti-broker cap counts non-owner-tier supply per host, so a second
       room under the same account would be refused and the absence half of this test would pass
       because nothing was ever posted. */
    const withDoc = `Paper Towers ${stamp()}`;
    const withoutDoc = `Promise Residency ${stamp()}`;
    await seedTenantRoom(HOSTS.withDoc, withDoc, {
      name: 'rent-agreement.pdf',
      size: 32,
      mime: 'application/pdf',
      dataUrl: AGREEMENT_PDF,
    });
    await seedTenantRoom(HOSTS.withoutDoc, withoutDoc);

    await openDesk(page, login);

    /* The document is the evidence the whole verification axis runs on. `VerificationBoard` renders
       three mutually exclusive states from one field — openable, on file but too large to preview,
       and nothing at all — and only the first and last are reachable through the product, because
       the 3 MB cap is applied in the browser before the upload leaves it.
       This is the assertion `agreement-evidence.spec.js` used to make against the mock store. */
    await expect(rowFor(page, withDoc).getByRole('button', { name: 'View agreement' })).toBeVisible();

    /* And the paired absence, which is the one that matters. A desk that showed "View agreement" on
       every tenant-tier row would let a moderator approve a claim with no evidence behind it and
       never know they had — the button would simply open nothing. `No document` is the honest
       render, and asserting the button is *gone* is what stops it drifting back. */
    const bare = rowFor(page, withoutDoc);
    await expect(bare).toContainText('No document');
    await expect(bare.getByRole('button', { name: 'View agreement' })).toHaveCount(0);
  });

  /**
   * The retired `/admin/flatmates` route, brought over from `admin/flatmates.spec.js` when that
   * file was retired outright — and widened, because the mock file's own docblock described a
   * guard that none of its three tests touched.
   *
   * What it claimed was that the redirect keeps its guards: "an admin without the Flatmates module,
   * or with the flag off, should be refused here rather than bounced onto a desk they may not open
   * — and that is the one thing a redirect can quietly get wrong, so it is what these three tests
   * check." It was not what they checked. They checked the happy path, and then that an anonymous
   * visitor and a buyer both land on staff-login — two identities `RoleRoute` had already turned
   * away one level up, on a route that has nothing to do with flatmates.
   *
   * The guard worth proving is the flag, and it is worth proving *because the destination does not
   * carry it*. `/ops/flatmate-review` (App.jsx:379) sits bare inside the ops shell — no
   * `FlagRoute`, no `ModuleRoute`. That is right: the `flatmates` flag governs the admin console's
   * module, not whether the operations team may work its own desk. But it means the only thing
   * between an administrator whose flatmates module is switched off and flatmate moderation is the
   * `FlagRoute` wrapped around this redirect. Drop it and the retired route becomes a laundering
   * route — same administrator, same switched-off module, arriving anyway.
   *
   * The module half of that sentence is deliberately not asserted, because it cannot be asserted
   * honestly here. `ModuleRoute` reads `user.permissions` off `/auth/me`, and the only live way to
   * narrow an account is `PUT /users/{id}/permissions`, which `fixtures/live.js` reaches through a
   * `?role=staff` directory listing. A staffer never survives `roles={['admin']}` to meet
   * `ModuleRoute` at all, and the single seeded administrator is shared by every spec in the run,
   * so narrowing her would leak as flakiness in files that never mention flatmates. Written down
   * rather than half-tested.
   *
   * The adversarial identity is that administrator, twice in the same test. Flag on she reaches the
   * desk; flag off the identical navigation lands her on `/admin`. Nothing about her changes
   * between the two, which is what makes the second half a statement about the guard rather than
   * about her account — and the direct visit that follows, which still opens the desk with the flag
   * still off, is what stops "she was refused" from being satisfied by a desk that was simply down.
   *
   * The switch is `adminFlags.tab.flatmates` in the shared settings document, not the consumer
   * `flatmates` feature flag the `flags` fixture writes. They are different keys in different
   * blocks read by different providers, and reaching for the wrong one produces a test that turns
   * something off, navigates, and proves nothing — which is what the first draft of this did.
   * `try/finally` for the restore, because a lane that left an admin tab switched off would take
   * unrelated files down on the next run.
   *
   * Mutation-proved: unwrapping the `<FlagRoute flag="flatmates">` from the `/admin/flatmates`
   * route in `App.jsx` reddens the `/admin` landing alone, with the flag-off administrator standing
   * on the moderation desk.
   */
  test('the retired admin route hands the operator to this desk, and will not launder a switched-off module onto it', async ({ page, login }) => {
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/staff-login/);

    await login.asBuyer();
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/staff-login/);

    await login.asAdmin();
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/ops\/flatmate-review$/);
    await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
    // The live strengthening the mock could not make: she arrived at the real desk, not its
    // offline panel. On the mock both look like a successful redirect.
    await expect(page.getByText(/needs the live API/i)).toHaveCount(0);

    const setTab = async (value) => {
      const res = await fetch(`${API}/admin/settings`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ adminFlags: { tab: { flatmates: value } } }),
      });
      expect(res.status, `could not set adminFlags.tab.flatmates to ${value}`).toBe(200);
    };

    await setTab(false);
    try {
      /* Same administrator, same navigation, module switched off. */
      await page.goto('/admin/flatmates');
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toHaveCount(0);

      /* And the desk is still there, still open, with the flag still off — so what refused her was
         the redirect's own guard and not the destination being unavailable to anybody. */
      await page.goto('/ops/flatmate-review');
      await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
    } finally {
      await setTab(true);
    }

    /* Restored, and proved through the screen rather than through the response above: the read path
       is a different one, and a restore that satisfied the API while leaving the tab dark is the
       leak the `finally` exists to avoid. */
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/ops\/flatmate-review$/);
  });
});
