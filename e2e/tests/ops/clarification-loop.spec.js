import { ACTORS, expect, test } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../helpers/liveAuth.js';

const QUESTION = 'Please tell us why this is not a duplicate listing.';
const ANSWER = 'It is my own second flat in the same society.';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function needsInfoListing() {
  const ownerMobile = uniqueMobile();
  const owner = await apiLogin(ownerMobile);
  const ownerHeaders = { 'content-type': 'application/json', authorization: `Bearer ${owner.accessToken}` };
  const title = `Zztest clarification ${Date.now().toString(36)}`;
  const created = await api('POST', '/me/listings', ownerHeaders, {
    title, deal: 'rent', propertyType: 'apartment', price: 24000, locality: 'Kothrud', city: 'Pune',
    images: await uploadedListingPhotos(ownerHeaders),
  });
  expect(created.status, created.text).toBe(201);
  const id = created.body.id;
  const admin = await authHeaders(ACTORS.admin);
  expect((await api('POST', `/properties/${id}/verification/start`, admin)).status).toBe(200);
  const asked = await api('POST', `/properties/${id}/verification/decision`, admin,
    { decision: 'needs_info', reasonCode: 'other', note: QUESTION });
  expect(asked.status, asked.text).toBe(200);
  return { id, title, ownerMobile, ownerHeaders };
}

test('the owner reads the question as Draazy Support and can reopen the thread after replying', async ({ page }) => {
  const { id, title, ownerMobile } = await needsInfoListing();
  await signedInAs(page, ownerMobile);

  await page.goto(`/dashboard?review=${id}#properties`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(QUESTION)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(/^Draazy Support/)).toBeVisible();
  await expect(page).not.toHaveURL(/review=/);

  await dialog.getByPlaceholder('Reply to Draazy Support…').fill(ANSWER);
  await dialog.getByRole('button', { name: 'Send' }).click();
  await expect(dialog.getByText(ANSWER)).toBeVisible();
  await expect(dialog.getByText(/^You/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.reload();
  const card = page.locator('.rounded-xl', { hasText: title }).first();
  await card.getByTestId('support-thread-link').click();
  await expect(page.getByRole('dialog').getByText(QUESTION)).toBeVisible();
  await expect(page.getByRole('dialog').getByText(ANSWER)).toBeVisible();
});

test('staff see an owner reply on the bell and the card, and opening it clears both', async ({ page, login }) => {
  const { id, title, ownerHeaders } = await needsInfoListing();

  await login.asAdmin();
  await page.goto('/admin/properties');
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  const card = page.getByTestId('queue-row').filter({ has: page.getByRole('heading', { name: title }) });
  await expect(card.getByTestId('awaiting-owner')).toBeVisible({ timeout: 20_000 });

  const replied = await api('POST', `/properties/${id}/verification/messages`, ownerHeaders, { body: ANSWER });
  expect(replied.status, replied.text).toBe(201);

  await page.reload();
  await page.getByPlaceholder('Title, owner, mobile or ID').first().fill(title);
  await expect(card.getByTestId('owner-replied')).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('awaiting-owner')).toHaveCount(0);

  await page.getByRole('button', { name: 'Notifications' }).click();
  const bell = page.getByTestId('admin-notifications');
  await expect(bell.getByText(/^Owner replied \(\d+\)$/)).toBeVisible();
  await bell.getByRole('button', { name: new RegExp(title) }).filter({ hasText: ANSWER }).click();
  await page.getByTestId('review-section-messages').click();
  await expect(page.getByRole('dialog').getByText(ANSWER)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByTestId('owner-replied')).toHaveCount(0);

  const after = await api('GET', '/admin/bell', await authHeaders(ACTORS.admin));
  expect(after.body.ownerReplies.items.map((r) => r.propertyId)).not.toContain(id);
});
