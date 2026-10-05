import { expect, test } from '../../../fixtures/live.js';
import { API, apiLogin } from '../../../helpers/liveAuth.js';

const STAFF = '9733798115';

const OWNER = '9470744469';
/** One group host per test — an applied group cannot apply again. */
const HOSTS = {
  card: { mobile: '9700000001', name: 'Rahul Mehta' },
  inbox: { mobile: '9700000002', name: 'Priya Nair' },
};

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

const stamp = () => Date.now().toString(36).slice(-5);

async function ownerRental(index) {
    // And it is genuinely on the owner's side of the wire, not just on the screen.
  const { accessToken } = await apiLogin(OWNER);
  const mine = await fetch(`${API}/me/listings?size=50`, { headers: auth(accessToken) })
    .then((r) => r.json());
  const rentals = (mine.content || []).filter((p) => p.deal === 'rent' && p.status === 'approved');
  const flat = rentals[index];
  if (!flat) throw new Error(`ownerRental(${index}): the seeded owner has only ${rentals.length} approved rentals`);
  return flat;
}

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

    await expect(page.getByText(/Applied\. You'll be notified/i)).toBeVisible();
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

    const item = page.getByTestId('action-item').filter({ hasText: title });
    await expect(item).toContainText(`Group wants to rent ${flat.title}`);
    await item.getByRole('button', { name: 'Accept' }).click();

    await expect(page.getByText('Group application accepted')).toBeVisible();
    await expect(page.getByTestId('action-item').filter({ hasText: title })).toHaveCount(0);
    // The owner wrote `status`; `modStatus` is the ops desk's column and must be untouched.
    const { accessToken } = await apiLogin(OWNER);
    const inbox = await fetch(`${API}/me/group-applications?size=50`, { headers: auth(accessToken) })
      .then((r) => r.json());
    const row = (inbox.content || []).find((a) => a.groupTitle === title);
    expect(row.status).toBe('accepted');
    expect(row.modStatus).toBe('live');
  });
});
