import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, apiLogin, uploadedListingPhotos, uniqueMobile, signIn } from '../../helpers/liveAuth.js';
import { approveListing, rejectListing } from '../../helpers/moderation.js';

// Property integration already proves the queue endpoint and featured write path.
const admin = () => authHeaders('9000000000');

const NEW_LISTING = {
  title: 'Moderation subject',
  deal: 'rent',
  propertyType: 'Flat',
  price: 28000,
  locality: 'Baner',
  city: 'Pune',
  bhk: 2,
  area: 850,
};

// A brand-new listing under a brand-new owner, returned with both handles the tests need.
async function freshListing(title = NEW_LISTING.title) {
  const ownerMobile = uniqueMobile();
  const headers = await authHeaders(ownerMobile);
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST', headers, body: JSON.stringify({ ...NEW_LISTING, title, images: await uploadedListingPhotos(headers) }),
  });
  expect(res.status).toBe(201);
  const listing = await res.json();
  return { id: listing.id, ownerMobile, headers };
}

const status = async (id, body, headers) => {
  const res = await fetch(`${API}/properties/${id}/status`, {
    method: 'PATCH', headers: headers || (await admin()), body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const ownerView = async (id, headers) =>
  (await fetch(`${API}/me/listings/${id}`, { headers })).status;

const publicView = async (id) => (await fetch(`${API}/properties/${id}`)).status;

test('a new listing is pending, off the public site, and visible to its owner', async () => {
  const { id, headers } = await freshListing();

  // Assert starting state once so approved fixtures cannot make later tests pass falsely.
  expect(await publicView(id)).toBe(404);
  // Owners can know their own submission outcome; the public cannot.
  expect(await ownerView(id, headers)).toBe(200);
});

test('approving puts it on the public site; rejecting takes it off again', async ({ request }) => {
  const { id, headers } = await freshListing('Approve then reject');

  expect((await approveListing(request, id, await admin())).status()).toBe(200);
  expect(await publicView(id)).toBe(200);

  expect((await rejectListing(request, id, await admin(), {
    reasonCode: 'photos_not_real',
    reason: 'Photos are of a different flat',
  })).status()).toBe(200);
  // Nothing moved.
  expect(await publicView(id)).toBe(404);

  expect(await ownerView(id, headers)).toBe(200);
});

test('the status route refuses the two decisions that belong to other routes', async ({ request }) => {
  const { id } = await freshListing('Refused transitions');

  // `flagged` and `archived` are reachable, just not from here.
  expect((await status(id, { status: 'flagged' })).status).toBe(400);
  expect((await status(id, { status: 'archived' })).status).toBe(400);

  // Back to `pending`, not back to `approved`.
  expect(await publicView(id)).toBe(404);
  expect((await approveListing(request, id, await admin())).status()).toBe(200);
  expect(await publicView(id)).toBe(200);
});

test('flagging takes an approved listing off the site and keeps the reason', async ({ request }) => {
  const { id, headers } = await freshListing('Flag subject');
  expect((await approveListing(request, id, await admin())).status()).toBe(200);
  expect(await publicView(id)).toBe(200);

  const REASON = 'Owner mobile belongs to a different listing';
  const flagged = await fetch(`${API}/properties/${id}/flag`, {
    method: 'POST', headers: await admin(), body: JSON.stringify({ reason: REASON }),
  });
  expect(flagged.status).toBe(200);
  expect(await publicView(id)).toBe(404);

  // Read back from the queue, which is the only route that will admit a flagged listing exists.
  const queue = await fetch(`${API}/admin/properties?size=100&status=flagged`, { headers: await admin() });
  const row = (await queue.json()).content.find((p) => p.id === id);
  expect(row).toBeTruthy();
  expect(row.flagReason).toBe(REASON);

  // And the other half of the same field: the owner's own read of the very same listing does not carry it.
  const mine = await fetch(`${API}/me/listings/${id}`, { headers });
  expect(mine.status).toBe(200);
  const ownerCopy = await mine.json();
  expect(ownerCopy.status).toBe('flagged');
  expect(ownerCopy.flagReason).toBeUndefined();

  // Clearing returns it to the queue, not to the site.
  const cleared = await fetch(`${API}/properties/${id}/flag`, { method: 'DELETE', headers: await admin() });
  // 204, where raising it was a 200 — the lowering has nothing to say and does not pretend to.
  expect(cleared.status).toBe(204);
  expect(await publicView(id)).toBe(404);

  const back = await fetch(`${API}/admin/properties?size=100&status=pending`, { headers: await admin() });
  expect((await back.json()).content.find((p) => p.id === id), 'the cleared listing never reached the review queue').toBeTruthy();
});

test('archiving is reversible, and restoring sends the listing back for moderation', async ({ request }) => {
  const { id, headers } = await freshListing('Archive subject');
  expect((await approveListing(request, id, await admin())).status()).toBe(200);

  const archived = await fetch(`${API}/properties/${id}/archive`, {
    method: 'PATCH', headers: await admin(), body: JSON.stringify({ reason: 'Duplicate of an older post' }),
  });
  expect(archived.status).toBe(200);
  expect(await publicView(id)).toBe(404);

  const restored = await fetch(`${API}/properties/${id}/restore`, { method: 'PATCH', headers: await admin() });
  expect(restored.status).toBe(200);

  expect(await publicView(id)).toBe(404);
  expect(await ownerView(id, headers)).toBe(200);

  // The queue exposes listings that public search must not admit exist.
  const queue = await fetch(`${API}/admin/properties?size=100&status=pending`, { headers: await admin() });
  expect((await queue.json()).content.some((p) => p.id === id)).toBe(true);
});

test('moderating is not something a signed-in owner may do to their own listing', async () => {
  const { id, headers } = await freshListing('Self approval');

  // Owner self-approval must fail server-side, not just in the UI.
  expect((await status(id, { status: 'approved' }, headers)).status).toBe(403);
  expect(await publicView(id)).toBe(404);
});

test('an unknown listing is a 404, not a 500, on every decision', async () => {
  const missing = '00000000-0000-4000-8000-000000000000';
  const headers = await admin();

  // A well-formed id for a listing that does not exist.
  expect((await status(missing, { status: 'approved' })).status).toBe(404);
  for (const [path, method] of [['flag', 'POST'], ['archive', 'PATCH'], ['restore', 'PATCH']]) {
    const res = await fetch(`${API}/properties/${missing}/${path}`, {
      method, headers, body: JSON.stringify({ reason: 'x' }),
    });
    expect(res.status, `${method} /${path}`).toBe(404);
  }
});

test('a moderator can correct a BHK on a listing they do not own', async ({ page, request }) => {
  const title = `BHK correction ${Date.now()}`;
  const { id, headers } = await freshListing(title);

  expect((await approveListing(request, id, await admin())).status()).toBe(200);
  expect(await publicView(id)).toBe(200);

  await signIn(page, ACTORS.admin, { screen: 'staff' });
  await page.goto('/admin/properties?tab=all');
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  const row = page.getByTestId('queue-row').filter({ has: page.getByRole('heading', { name: title }) });
  await expect(row).toHaveCount(1, { timeout: 20000 });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit listing' })).toBeVisible();

  // Use the numeric field because the contract stores BHK as an integer.
  const bhkBox = page.getByLabel('Configuration (BHK)');
  await expect(bhkBox).toHaveValue('2');
  await bhkBox.fill('3');
  await page.getByRole('button', { name: /Save changes/i }).click();
  // The modal closes only on a write the API accepted; a refusal leaves it open with a toast.
  await expect(page.getByRole('dialog', { name: 'Edit listing' })).toHaveCount(0);

  // Read back from the API rather than from the screen.
  const after = await (await fetch(`${API}/me/listings/${id}`, { headers })).json();
  expect(Number(after.bhk)).toBe(3);

  // Moderator corrections must not remove an already approved listing from public view.
  expect(after.status).toBe('approved');
  expect(await publicView(id)).toBe(200);
});

test('cancelling the edit modal discards the change rather than quietly saving it', async ({ page, request }) => {
  const title = `Cancel is not a save ${Date.now()}`;
  const { id, headers } = await freshListing(title);

  expect((await approveListing(request, id, await admin())).status()).toBe(200);

  await signIn(page, ACTORS.admin, { screen: 'staff' });
  await page.goto('/admin/properties?tab=all');

  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  await expect(
    page.getByTestId('queue-row'),
    'the search should leave standing only the listing this test minted',
  ).toHaveCount(1, { timeout: 20000 });

  const row = page.getByTestId('queue-row').filter({ has: page.getByRole('heading', { name: title }) });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Edit listing' });
  await expect(modal).toBeVisible();

  const bhkBox = page.getByLabel('Configuration (BHK)');
  await expect(bhkBox).toHaveValue('2');
  await bhkBox.fill('3');
  // Without this the test cannot tell "Cancel discarded the edit" from "the edit never happened".
  await expect(bhkBox).toHaveValue('3');

  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toHaveCount(0);

  const after = await (await fetch(`${API}/me/listings/${id}`, { headers })).json();
  expect(Number(after.bhk), 'Cancel wrote the edit it was asked to throw away').toBe(2);
  // Closing must not navigate or resubmit, which could hide the listing while preserving price.
  expect(after.status).toBe('approved');
  expect(await publicView(id)).toBe(200);
});
