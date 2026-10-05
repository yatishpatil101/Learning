// Every fixture is minted through the consumer path, because the seed's five flatmate rows are all already `approved`.
import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, E2E_OTP, apiLogin, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';
import { tenantRoomAgreement } from '../../helpers/flatmateAgreement.js';

const STAFF = '9733798115';

// One host per test: the anti-broker cap counts non-owner-tier supply per host.
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

// Use a real PDF header because the view button allowlists by scheme and MIME.
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

async function consentTo(token, society) {
  const ownerMobile = uniqueMobile();
  for (const payload of [{ ownerMobile, society, locality: 'Kothrud' },
    { ownerMobile, society, locality: 'Kothrud', otp: E2E_OTP }]) {
    const res = await fetch(`${API}/flatmates/owner-consent`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`owner consent → ${res.status} ${await res.text()}`);
  }
  return ownerMobile;
}

async function seedTenantRoom(host, society, agreementDoc = undefined, extra = {}) {
  const { accessToken } = await apiLogin(host.mobile);
  const ownerConsentMobile = await consentTo(accessToken, society);
  const agreement = await tenantRoomAgreement(accessToken);
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
    ...agreement,
    ...(agreementDoc === undefined ? {} : { agreementDoc: { ...agreement.agreementDoc, ...agreementDoc } }),
    ...extra,
    ownerConsentMobile,
  });
  return { room, accessToken };
}

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

// A visible group, plus an application to a seeded rental listing.
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

  // Use the desk decision route because groups must pass moderation before applying.
  const { accessToken: staffToken } = await apiLogin(STAFF);
  const publish = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH',
    headers: auth(staffToken),
    body: JSON.stringify({ modStatus: 'approved' }),
  });
  if (!publish.ok) throw new Error(`publish group → ${publish.status} ${await publish.text()}`);

  // The public feed returns only rentals a stranger may see.
  const listings = await fetch(`${API}/properties?deal=rent&size=5`).then((r) => r.json());
  const flat = (listings.content || [])[0];
  if (!flat) throw new Error('seedApplication: no approved rental listing in the seed');

  const application = await post(`/flatmates/groups/${group.id}/apply`, accessToken, {
    listingId: flat.id,
  });
  return { group, application, flat };
}

const card = (page, text) => page.getByTestId('flatmate-queue-card').filter({ hasText: text });
const cardFor = (page, text) => card(page, text).first();

const openTab = (page, label) =>
  page.getByRole('group', { name: 'Flatmate queues' }).getByRole('button', { name: label }).click();

async function review(page, text) {
  await cardFor(page, text).getByRole('button', { name: 'Review' }).click();
  const dialog = page.getByRole('dialog', { name: /^Review / });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openDesk(page, login) {
  if (login) await login.asStaff('rental');
  await page.goto('/ops/flatmate-review');
  await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
  // If this fires, the desk fell back to its offline panel and nothing below means anything.
  await expect(page.getByText(/needs the live API/i)).toHaveCount(0);
}

test.describe('Ops → flatmate desk (live)', () => {
  test('the desk has three status tabs and no board switcher, type tabs narrow the queue, and the queue can be searched, sorted and cut by date', async ({ page, login }) => {
    await test.step('one Pending tab, three tabs in all — no board switcher', async () => {
      await openDesk(page, login);
      const tabs = page.getByRole('group', { name: 'Flatmate queues' }).getByRole('button');
      await expect(tabs).toHaveText(['Pending', 'Published', 'Hidden & removed']);
      await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('group', { name: 'Flatmate boards' })).toHaveCount(0);
    });
    await test.step('type tabs under each status narrow the queue to rooms, groups (applications included) or seeker posts', async () => {
      const marker = `Type tab seeker ${stamp()}`;
      await seedSeekerPost({ mobile: uniqueMobile(), name: 'Type Tab' }, marker);
      await openDesk(page);

      const types = page.getByRole('group', { name: 'Post type' }).getByRole('button');
      await expect(types).toHaveText(['All', 'Room', 'Group', 'Seeker post']);
      await expect(types.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(cardFor(page, marker)).toBeVisible();

      const kindLabels = page.getByTestId('flatmate-queue-card').locator('span.uppercase');
      const openType = async (label) => {
        const tab = page.getByRole('group', { name: 'Post type' }).getByRole('button', { name: label, exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-pressed', 'true');
      };

      await openType('Seeker post');
      await expect(cardFor(page, marker)).toBeVisible();
      for (const label of await kindLabels.allTextContents()) expect(label).toBe('Seeker post');

      await openType('Room');
      await expect(card(page, marker)).toHaveCount(0);
      for (const label of await kindLabels.allTextContents()) expect(label).toBe('Room');

      await openType('Group');
      await expect(card(page, marker)).toHaveCount(0);
      for (const label of await kindLabels.allTextContents()) expect(['Group', 'Group application']).toContain(label);

      await openTab(page, 'Published');
      await expect(page.getByRole('group', { name: 'Post type' }).getByRole('button', { name: 'Group', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
    await test.step('the queue can be searched, sorted and cut by date like the property queues', async () => {
      const tag = `Sort probe ${stamp()}`;
      await seedSeekerPost({ mobile: uniqueMobile(), name: 'Sort One' }, `${tag} first`);
      await seedSeekerPost({ mobile: uniqueMobile(), name: 'Sort Two' }, `${tag} second`);
      await openDesk(page);

      await page.getByRole('textbox', { name: 'Search the queue' }).fill(tag);
      const cards = page.getByTestId('flatmate-queue-card');
      await expect(cards).toHaveCount(2);
      await expect(page.getByRole('status').filter({ hasText: 'items' })).toHaveText('2 items');
      await expect(cards.first()).toContainText(`${tag} first`);

      await page.getByRole('button', { name: 'Sort' }).click();
      await page.getByRole('option', { name: 'Newest first' }).click();
      await expect(cards.first()).toContainText(`${tag} second`);

      await page.getByRole('button', { name: 'Today', exact: true }).click();
      await expect(cards).toHaveCount(2);

      await page.getByRole('textbox', { name: 'Search the queue' }).fill(`${tag} nothing-like-this`);
      await expect(cards).toHaveCount(0);
      await expect(page.getByText('Nothing matches these filters.')).toBeVisible();
    });
  });

  test('a tenant room waits in Pending for both its publish and its badge, decided separately', async ({ page, login }) => {
    const host = HOSTS.verifyApprove;
    // Rows are found by the society name, not the host's.
    const society = `Verify Heights ${stamp()}`;
    const { room } = await seedTenantRoom(host, society);
    expect(room.modStatus).toBe('pending');
    const onPublicBoard = async () => {
      const feed = await fetch(`${API}/flatmates/feed?tab=move-in&locality=Kothrud&size=100`).then((r) => r.json());
      return (feed.content || []).some((r) => r.id === room.id);
    };
    expect(await onPublicBoard()).toBe(false);
    await openDesk(page, login);

    await expect(cardFor(page, society)).toContainText('Badge claim · tenant');
    await expect(cardFor(page, society)).toContainText('Awaiting publish');

    let dialog = await review(page, society);
    await expect(dialog.locator('.flatmate-badge-section')).toContainText('tenant-tier claim');
    // Masked, and masked on the server: `FlatmateReviewDto` masks in its only constructor rather than trusting each client.
    await expect(page.getByText(host.mobile)).toHaveCount(0);

    await dialog.locator('.approve-review-btn').click();
    await expect(dialog.locator('.flatmate-badge-section')).toContainText('approved');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(cardFor(page, society)).toContainText('Awaiting publish');
    await expect(cardFor(page, society)).not.toContainText('Badge claim');
    expect(await onPublicBoard()).toBe(false);

    dialog = await review(page, society);
    await dialog.getByRole('button', { name: 'Publish' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(card(page, society)).toHaveCount(0);
    await openTab(page, 'Published');
    await expect(cardFor(page, society)).toBeVisible();
    expect(await onPublicBoard()).toBe(true);
  });

  test('a badge rejection needs a reason, and the reason is shown back', async ({ page, login }) => {
    const society = `Reject Court ${stamp()}`;
    await seedTenantRoom(HOSTS.verifyReject, society);
    await openDesk(page, login);

    let dialog = await review(page, society);
    await dialog.locator('.reject-review-btn').click();
    await expect(dialog.getByRole('button', { name: 'Confirm rejection' })).toBeDisabled();

    await dialog.getByPlaceholder('Reason for rejection').fill('The agreement names a different flat.');
    await dialog.getByRole('button', { name: 'Confirm rejection' }).click();
    await expect(dialog.locator('.flatmate-badge-section')).toContainText('different flat');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    await expect(cardFor(page, society)).toContainText('Awaiting publish');
    await expect(cardFor(page, society)).not.toContainText('Badge claim');
    dialog = await review(page, society);
    await expect(dialog.locator('.flatmate-badge-section')).toContainText('different flat');
  });

  test('a room the host deletes leaves Pending, badge claim and all', async ({ page, login }) => {
    const society = `Withdrawn Court ${stamp()}`;
    const { room, accessToken } = await seedTenantRoom({ mobile: uniqueMobile() }, society);
    await openDesk(page, login);
    await expect(cardFor(page, society)).toContainText('Badge claim · tenant');

    const del = await fetch(`${API}/flatmates/rooms/${room.id}`, { method: 'DELETE', headers: auth(accessToken) });
    expect(del.ok).toBe(true);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toBeVisible();
    await expect(card(page, society)).toHaveCount(0);
  });

  test('a new seeker post is live at once, and waits on Pending as not yet reviewed until a moderator looks', async ({ page, login }) => {
    const marker = `Looking near Kothrud ${stamp()}`;
    await seedSeekerPost(HOSTS.publish, marker);

    const feed = await fetch(`${API}/flatmates/feed?tab=team-up&q=${encodeURIComponent(marker)}&size=100`).then((r) => r.text());
    expect(feed.includes(marker), 'a post with no flat publishes itself').toBe(true);

    await openDesk(page, login);
    await expect(cardFor(page, marker)).toContainText('Live · not yet reviewed');

    const dialog = await review(page, marker);
    await expect(dialog).toContainText('Engineer');
    await expect(dialog).toContainText('16,000');
    await expect(dialog.locator('.flatmate-mod-recheck')).toContainText('new post');
    await dialog.getByRole('button', { name: 'Looks fine' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(card(page, marker)).toHaveCount(0);
  });

  test('removing a post takes an optional note, and the free text is never truncated', async ({ page, login }) => {
    const marker = `Contact 99999 in the free text ${stamp()}`;
    await seedSeekerPost(HOSTS.remove, marker);
    await openDesk(page, login);

    const dialog = await review(page, marker);
    await expect(dialog.locator('.flatmate-mod-text')).toHaveText(marker);

    await dialog.getByPlaceholder('Internal note (optional)').fill('Phone number in the free text.');
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(card(page, marker)).toHaveCount(0);
    await openTab(page, 'Hidden & removed');
    await expect(cardFor(page, marker)).toContainText('removed');
  });

  test('a group application can be hidden without answering for the owner', async ({ page, login }) => {
    const title = `Three of us for a 3BHK ${stamp()}`;
    const { flat } = await seedApplication(HOSTS.apply, title);
    await openDesk(page, login);
    await openTab(page, 'Published');

    const application = card(page, title).filter({ hasText: 'Group application' });
    await expect(application).toBeVisible();

    await application.getByRole('button', { name: 'Review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Review group application' });
    await expect(dialog).toContainText(flat.title);
    await expect(dialog).toContainText('Per head');
    await expect(dialog).toContainText('Owner: pending');

    await dialog.getByPlaceholder('Internal note (optional)').fill('Group members look duplicated.');
    await dialog.getByRole('button', { name: 'Hide for review' }).click();
    await expect(dialog).toHaveCount(0);

    await openTab(page, 'Hidden & removed');
    const hidden = card(page, title).filter({ hasText: 'Group application' });
    await expect(hidden).toContainText('Hidden for review');
    await hidden.getByRole('button', { name: 'Review' }).click();
    await expect(page.getByRole('dialog', { name: 'Review group application' })).toContainText('Owner: pending');
  });

  test('swapping the photos on a published room flags a re-check, and a chip-list edit does not', async ({ page, login }) => {
    const swapped = `Swap Heights ${stamp()}`;
    const quiet = `Quiet Court ${stamp()}`;
    const { room: swapRoom, accessToken: swapToken } = await seedTenantRoom(HOSTS.swapPhoto, swapped);
    const { room: quietRoom, accessToken: quietToken } = await seedTenantRoom(HOSTS.quietEdit, quiet);

    // Publish first so the edit is to something already visible.
    const { accessToken: staffToken } = await apiLogin(STAFF);
    for (const id of [swapRoom.id, quietRoom.id]) {
      const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
        method: 'PATCH',
        headers: auth(staffToken),
        body: JSON.stringify({ modStatus: 'approved' }),
      });
      if (!res.ok) throw new Error(`publish room → ${res.status} ${await res.text()}`);
    }

    const body = async (token, society, overrides) => ({
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
      ...(await tenantRoomAgreement(token)),
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
    await edit(swapRoom.id, swapToken, await body(swapToken, swapped, { photos: [SWAPPED_IN] }));
    await edit(quietRoom.id, quietToken, await body(quietToken, quiet, { foodPref: 'veg' }));

    const feed = await fetch(`${API}/flatmates/feed?tab=move-in&size=100`).then((r) => r.json());
    expect((feed.content || []).some((r) => r.id === swapRoom.id)).toBe(true);

    await openDesk(page, login);

    await expect(cardFor(page, swapped)).toContainText('Edited since review');
    await expect(cardFor(page, quiet)).not.toContainText('Edited since review');

    const dialog = await review(page, swapped);
    await expect(dialog.locator('.flatmate-mod-recheck')).toContainText('photos');
    await expect(dialog.locator('.flatmate-mod-photos img')).toHaveAttribute('src', SWAPPED_IN);

    await dialog.getByRole('button', { name: 'Looks fine' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(cardFor(page, swapped)).not.toContainText('Edited since review');
  });

  test('the uploaded agreement opens in a new tab, and uploaded photos show on the popup', async ({ page, login }) => {
    // Use two hosts because the anti-broker cap counts supply per host.
    const withDoc = `Paper Towers ${stamp()}`;
    const UPLOADED = '/api/dev/storage/public/photos/e2e/room.jpg';
    await seedTenantRoom(HOSTS.withDoc, withDoc, {
      name: 'rent-agreement.pdf',
      size: 32,
      mime: 'application/pdf',
      dataUrl: AGREEMENT_PDF,
    }, { photos: [UPLOADED] });

    await openDesk(page, login);
    const dialog = await review(page, withDoc);
    await expect(dialog.locator('.flatmate-mod-photos img')).toHaveAttribute('src', UPLOADED);
    const downloaded = new Promise((resolve) => {
      page.context().once('page', (tab) => tab.once('download', (d) => resolve(d.url())));
    });
    await dialog.getByRole('button', { name: 'View agreement' }).click();
    expect(await downloaded).toMatch(/^blob:http/);
  });

  // This redirect guard protects the desk when the flatmates module is off.
  test('the retired /ops bookmark hands the operator to this desk, and will not launder a switched-off module onto it', async ({ page, login }) => {
      // Same administrator, same navigation, module switched off.
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/staff-login/);

    await login.asBuyer();
    // Prove restore through the screen because the read path differs from the write path.
    await page.goto('/admin/flatmates');
    await expect(page).toHaveURL(/\/staff-login/);

    await login.asAdmin();
    await page.goto('/ops/flatmate-review');
    await expect(page).toHaveURL(/\/admin\/flatmates$/);
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
      await page.goto('/admin/flatmates');
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toHaveCount(0);

      // The retired bookmark forwards into the same gate, so it cannot reach the desk either.
      await page.goto('/ops/flatmate-review');
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { name: 'Flatmate Moderation' })).toHaveCount(0);
    } finally {
      await setTab(true);
    }

    await page.goto('/ops/flatmate-review');
    await expect(page).toHaveURL(/\/admin\/flatmates$/);
  });
});
