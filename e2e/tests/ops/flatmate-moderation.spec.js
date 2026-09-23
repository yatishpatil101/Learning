/* Every fixture is minted through the consumer path, because the seed's five flatmate rows are all
 * already `approved`. `Badge` relabels the wire's `pending` as "Under Review". */
import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders } from '../../helpers/liveAuth.js';

const STAFF = '9733798115';

/* One host per test: the anti-broker cap counts non-owner-tier supply per host. Every name must be
 * `status = 'active'` in the seed — since V77 a suspended user's login 403s. */
const HOSTS = {
  verifyApprove: { mobile: '9700000003', name: 'Arjun Rao' },
  verifyReject: { mobile: '9712728163', name: 'Aditya Iyer' },
  publish: { mobile: '9240355264', name: 'Aarav Reddy' },
  remove: { mobile: '9253229149', name: 'Pooja Shah' },
  apply: { mobile: '9272696131', name: 'Rahul Jain' },
  withDoc: { mobile: '9283184696', name: 'Nikhil Nair' },
  withoutDoc: { mobile: '9396565787', name: 'Kabir Rao' },
  swapPhoto: { mobile: '9808019141', name: 'Neha Sharma' },
  quietEdit: { mobile: '9382625379', name: 'Aarav Deshpande' },
};

/* A real PDF header, not a stub: the `isViewableDoc` predicate behind the button allowlists by
 * scheme and MIME, so a render-only fixture would agree with a build whose button opens nothing. */
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

/* `agreementDeclared: true` is what makes the server derive the **tenant** tier, which is what
 * enqueues a verification review. The group request spells the same two ideas `role`/`agreement`. */
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
     listings a stranger may see. The hosts above are buyer accounts, so none of them owns one. */
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

    /* Masked, and masked on the server: `FlatmateReviewDto` masks in its only constructor rather
       than trusting each client. A desk that can phone a host can be socially engineered. */
    await expect(page.getByText(host.mobile)).toHaveCount(0);

    await row.locator('.approve-review-btn').click();

    // Decided rows leave Pending, which is the whole point of a queue.
    await expect(rowFor(page, society)).toHaveCount(0);
    await openTab(page, 'Verification queues', 'Ops-verified');
    await expect(rowFor(page, society)).toBeVisible();

    /* "Untouched" means **still live**, not "still pending": a tenant-tier room is published the
       moment it is posted, so the bug this catches is the approval nudging it OFF the board. Read
       from both sides, because a queue read returning nothing would look identical to a pass. */
    expect(room.modStatus).toBe('live');
    const { accessToken: staffToken } = await apiLogin(STAFF);
    const onBoard = async (state) => {
      const queue = await fetch(`${API}/admin/flatmates/moderation?kind=room&modStatus=${state}&size=100`,
        { headers: auth(staffToken) }).then((r) => r.json());
      return (queue.content || []).some((q) => q.id === room.id);
    };
    expect(await onBoard('live')).toBe(true);
    expect(await onBoard('pending')).toBe(false);
  });

  test('a rejection without a reason is refused before it reaches the wire', async ({ page, login }) => {
    const society = `Reject Court ${stamp()}`;
    await seedTenantRoom(HOSTS.verifyReject, society);
    await openDesk(page, login);

    await rowFor(page, society).locator('.reject-review-btn').click();

    /* The desk stops a blank reason, and `FlatmateModerationService` refuses one again if it ever
       gets through: a host told "no" without being told why cannot fix anything. */
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

    // Default board is `post` / `pending`, which is where a brand-new post lands.
    const row = rowFor(page, marker);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Under Review');

    // Before publishing, the public feed cannot see it — that is the whole claim of the gate.
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
    /* The free text is rendered in full and never truncated: it is where a phone number goes when
       the contact field will not take one. */
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

    /* Hiding writes the moderation column and must not answer for the owner. The button says "Hide
       for review", never "Flag" — that word belongs to the server-raised `flag_for_review` column. */
    await row.getByRole('button', { name: 'Hide for review' }).click();
    await page.getByPlaceholder(/Internal note/i).fill('Group members look duplicated.');
    await page.getByRole('button', { name: /^Confirm$/ }).click();

    await expect(rowFor(page, title)).toContainText('Hidden for review');
    await expect(rowFor(page, title)).toContainText('Under Review');
  });

  /* A tenant-tier room keeps its `approved` state when its photos are swapped, so without a
     Re-check board it sits buried among published rooms with nothing to say it changed. The quiet
     room is asserted on the same screen: a queue that also fills with chip edits gets skimmed. */
  test('swapping the photos on a published room puts it on Re-check, and a chip-list edit does not', async ({ page, login }) => {
    const swapped = `Swap Heights ${stamp()}`;
    const quiet = `Quiet Court ${stamp()}`;
    const { room: swapRoom, accessToken: swapToken } = await seedTenantRoom(HOSTS.swapPhoto, swapped);
    const { room: quietRoom, accessToken: quietToken } = await seedTenantRoom(HOSTS.quietEdit, quiet);

    /* Published first, so what follows is an edit to something the city can already see: a room
       still in Pending has nothing to re-check. */
    const { accessToken: staffToken } = await apiLogin(STAFF);
    for (const id of [swapRoom.id, quietRoom.id]) {
      const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
        method: 'PATCH',
        headers: auth(staffToken),
        body: JSON.stringify({ modStatus: 'approved' }),
      });
      if (!res.ok) throw new Error(`publish room → ${res.status} ${await res.text()}`);
    }

    /* The room PATCH takes the whole body, so both edits resend everything and differ in exactly
       one field — the classifier has to tell them apart from two identically shaped requests. */
    const body = (society, overrides) => ({
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
      ...overrides,
    });

    const edit = async (id, token, payload) => {
      const res = await fetch(`${API}/flatmates/rooms/${id}`, {
        method: 'PATCH',
        headers: auth(token),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`edit room → ${res.status} ${await res.text()}`);
    };

    const SWAPPED_IN = 'https://cdn.example/swapped-in.jpg';
    await edit(swapRoom.id, swapToken, body(swapped, { photos: [SWAPPED_IN] }));
    // A value the wizard only offers as one of three chips. It cannot carry a phone number, so
    // there is nothing here for a human to read.
    await edit(quietRoom.id, quietToken, body(quiet, { foodPref: 'veg' }));

    /* Still up: taking a room dark every time its gallery changes teaches hosts to leave a stale
       gallery alone, which is its own harm. */
    const feed = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    expect((feed.content || []).some((r) => r.id === swapRoom.id)).toBe(true);

    await openDesk(page, login);
    await openBoard(page, 'Moderation');
    await openTab(page, 'Which board', 'Rooms');
    await openTab(page, 'Moderation states', 'Re-check');

    const row = rowFor(page, swapped);
    await expect(row).toBeVisible();
    // Which field moved, named on the row: a moderator opening this board needs to know what they
    // are being asked to look at before they look.
    await expect(row.locator('.flatmate-mod-recheck')).toContainText('photos');

    /* The swapped-in picture is *on the row*: a number burned into an image, or a photo lifted from
       another listing, is invisible to a desk that only renders the text. */
    await expect(row.locator('.flatmate-mod-photos img')).toHaveAttribute('src', SWAPPED_IN);

    // And the quiet room is not here, on the same screen, in the same run.
    await expect(rowFor(page, quiet)).toHaveCount(0);

    /* Deciding clears the work item whatever the verdict — a board that kept decided rows would
       grow without limit and stop being a queue. */
    await row.getByRole('button', { name: 'Publish' }).click();
    await expect(rowFor(page, swapped)).toHaveCount(0);
  });

  test('the uploaded agreement is openable from the row, and a row without one says so', async ({ page, login }) => {
    /* Two hosts, not one: the anti-broker cap counts non-owner-tier supply per host, so a second
       room under the same account would be refused and the absence half would pass vacuously. */
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

    /* `VerificationBoard` renders three mutually exclusive states from one field, and only
       "openable" and "nothing at all" are reachable — the 3 MB cap is applied in the browser. */
    await expect(rowFor(page, withDoc).getByRole('button', { name: 'View agreement' })).toBeVisible();

    /* The paired absence is the one that matters: a "View agreement" button on every tenant-tier
       row would let a moderator approve a claim with no evidence and never know it. */
    const bare = rowFor(page, withoutDoc);
    await expect(bare).toContainText('No document');
    await expect(bare.getByRole('button', { name: 'View agreement' })).toHaveCount(0);
  });

  /* `/ops/flatmate-review` carries no `FlagRoute`, so the only thing between an administrator whose
     flatmates module is off and the desk is the guard on this redirect. The switch is
     `adminFlags.tab.flatmates`, NOT the consumer `flatmates` flag the `flags` fixture writes. */
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
    // She arrived at the real desk, not its offline panel — the two look alike from the URL alone.
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
       is a different one, and an API-only restore could leave the tab dark. */
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/ops\/flatmate-review$/);
  });
});
