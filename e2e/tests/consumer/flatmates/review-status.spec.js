import { test, expect } from '@playwright/test';
import { API, E2E_OTP, apiLogin, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { withSocietyId } from '../../../helpers/liveSociety.js';
/* `reviewStatus` is joined onto the feed rows server-side (`FlatmateReviewStatuses`), so every row
   here is created over HTTP and published through real moderation — the two gates are independent. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);
const stamp = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const REGISTERED = {
  agreementDoc: {},
};

async function adminToken() {
  return (await apiLogin(ACTORS.admin)).accessToken;
}
/* Both OTP legs are the only way the flag is set — `FlatmateMapper` drops a client-supplied
   `ownerConsent`. V30 keys the row on the flat, so the address must match the post's. */
async function consentTo(token, address) {
  const ownerMobile = uniqueMobile(); // never the host's own — the server refuses self-consent
  for (const payload of [{ ownerMobile, ...address }, { ownerMobile, otp: E2E_OTP, ...address }]) {
    const response = await fetch(`${API}/flatmates/owner-consent`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify(payload),
    });
    expect(response.status, `owner-consent ${JSON.stringify(payload)}`).toBe(200);
  }
  return ownerMobile;
}
/** Let a row past the moderation gate, which is a different gate from the one under test. */
async function publish(id) {
  const response = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(await adminToken()),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e review-status fixture' }),
  });
  expect(response.status).toBeLessThan(300);
}

async function createGroup(token, body) {
  const response = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      locality: 'Baner', rent: 40000, seats: 3, seatsOpen: 1, policy: 'any', name: 'Review Host',
      ...body,
      ...(body.agreementDoc ? { agreementDoc: (await tenantRoomAgreement(token)).agreementDoc } : {}),
    }),
  });
  const group = await response.json();
  expect(response.status, JSON.stringify(group)).toBe(201);
  track('groups', group.id, token);
  await publish(group.id);
  return group;
}

async function createRoom(token, body) {
  const payload = (body.hostRole || 'tenant') === 'tenant'
    ? { ...body, ...(await tenantRoomAgreement(token)), ...(body.ownerConsentMobile ? { ownerConsentMobile: body.ownerConsentMobile } : {}) }
    : body;
  const response = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      bhk: '2', roomType: 'Private room', attachedBath: 'attached', furnishing: 'semi',
      locality: 'Baner', rentShare: 15000, deposit: 30000, availableFrom: '2026-12-01',
      lookingFor: 'any', foodPref: 'any', photos: ['https://cdn.example/review-status.jpg'],
      ...(await withSocietyId(token, payload)),
    }),
  });
  const room = await response.json();
  expect(response.status, JSON.stringify(room)).toBe(201);
  track('rooms', room.id, token);
  await publish(room.id);
  return room;
}
/* Reads the queue rather than the database: going round the route would prove the desk's verdict
   and the board's render separately while assuming the join between them. */

async function decide(target, decision, note = 'e2e verdict') {
  const token = await adminToken();
  const queue = await (await fetch(`${API}/admin/flatmate-reviews?size=100`, {
    headers: auth(token),
  })).json();
  const row = queue.content.find((r) => r.groupId === target || r.roomId === target);
  expect(row, `an agreement-backed post must be queued for Ops (${target})`).toBeTruthy();

  const response = await fetch(`${API}/admin/flatmate-reviews/${row.id}`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ decision, note }),
  });
  const decided = await response.json();
  expect(response.status, JSON.stringify(decided)).toBe(200);
  expect(decided.status).toBe(decision);
}

async function tapChip(page, chip) {
  await chip.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await chip.click();
}
async function openTeamUp(page) {
  await page.goto(`${BASE}/flatmates`);
  const tab = page.getByRole('button', { name: /Team up/i }).first();
  await expect(tab).toBeVisible({ timeout: 20_000 });
  await tab.click();
}

async function openRooms(page) {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 20_000 });
}

async function openDetail(page, kind, id) {
  const loaded = page.waitForResponse((res) => res.url().includes(`/flatmates/${kind}s/${id}`) && res.ok());
  await page.goto(`${BASE}/flatmates/${kind}/${id}`);
  await loaded;
}

async function openFilters(page) {
  const toggle = page.getByRole('button', { name: /^Filters/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('a tenant group waits on Ops without the badge it asked for, then an approval turns it Tenant-verified', async ({ page }) => {
  test.slow();
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live approved verdict ${stamp()} in Baner`;
  const consentMobile = await consentTo(accessToken, { title, locality: 'Baner' });
  const group = await createGroup(accessToken, {
    title, role: 'tenant', agreement: true, consentMobile, ...REGISTERED,
  });
  expect(group.verificationTier).toBe('tenant');
  await signedInAs(page, mobile);
  const card = page.locator('main');

  await test.step('a tenant group waiting on Ops says so, and is not given the badge it asked for', async () => {
    await openDetail(page, 'group', group.id);

    await expect(card.getByText('Agreement under review', { exact: true })).toBeVisible();
    await expect(card.getByText('Tenant-verified', { exact: true })).toHaveCount(0);
  });

  await test.step('an Ops approval turns the same group into Tenant-verified', async () => {
    await decide(group.id, 'approved');

    await openDetail(page, 'group', group.id);
    await expect(card.getByText('Tenant-verified', { exact: true })).toBeVisible();
    await expect(card.getByText('Agreement verified', { exact: true })).toBeVisible();
    await expect(card.getByText('Agreement under review', { exact: true })).toHaveCount(0);
  });
});

test('a rejected group stays on the board, says the agreement was not verified, and gives the host the reason', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const group = await createGroup(accessToken, {
    title: `Live rejected verdict ${stamp()} in Baner`, role: 'tenant', agreement: true, ...REGISTERED,
  });

  await decide(group.id, 'rejected', 'Registration number does not match the document');

  await signedInAs(page, mobile);
  await openDetail(page, 'group', group.id);
  const card = page.locator('main');
  await expect(card.getByText('Agreement not verified', { exact: true })).toBeVisible();
  await expect(card.getByText('Tenant-verified', { exact: true })).toHaveCount(0);

  await tapChip(page, page.getByRole('button', { name: 'Agreement not verified' }).first());
  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText('Registration number does not match the document');
  await expect(tip).toContainText('Edit your post to fix it');
});
test('"Verified only" keeps the approved tenant group and drops the one still waiting', async ({ page }) => {
  const viewer = uniqueMobile();
  const { accessToken: approvedToken } = await apiLogin(uniqueMobile());
  const { accessToken: pendingToken } = await apiLogin(uniqueMobile());

  const approvedTitle = `Live filter approved ${stamp()} in Baner`;
  const consentMobile = await consentTo(approvedToken, { title: approvedTitle, locality: 'Baner' });
  const approved = await createGroup(approvedToken, {
    title: approvedTitle, role: 'tenant', agreement: true, consentMobile, ...REGISTERED,
  });
  // The one still waiting needs no consent: it is never approved, so the gate never applies.
  const pending = await createGroup(pendingToken, {
    title: `Live filter pending ${stamp()} in Baner`, role: 'tenant', agreement: true, ...REGISTERED,
  });
  await decide(approved.id, 'approved');

  await signedInAs(page, viewer);
  await openTeamUp(page);
  const approvedCard = page.locator(`[data-sf-id="g:${approved.id}"]`);
  const pendingCard = page.locator(`[data-sf-id="g:${pending.id}"]`);
  // Both present first: an all-absent assertion would also pass if the board were empty.
  await expect(approvedCard).toBeVisible({ timeout: 15_000 });
  await expect(pendingCard).toBeVisible();

  await openFilters(page);
  await page.getByRole('button', { name: 'Verified only', exact: true }).click();
  await expect(approvedCard).toBeVisible();
  await expect(pendingCard).toHaveCount(0);
});

test('the same verdict drives a room card, and the room filter with it', async ({ page }) => {
  const viewer = uniqueMobile();
  const { accessToken: tenantToken } = await apiLogin(uniqueMobile());
  const { accessToken: plainToken } = await apiLogin(uniqueMobile());
  const society = `Review Claim Villa ${stamp()}`;
  const ownerConsentMobile = await consentTo(tenantToken, { society, locality: 'Baner' });

  const claimed = await createRoom(tenantToken, {
    society, hostRole: 'tenant', agreementDeclared: true, ownerConsentMobile,
    ownerConsent: true, ...REGISTERED,
  });
  expect(claimed.verificationTier).toBe('tenant');
  const plain = await createRoom(plainToken, { society: `Plain Room ${stamp()}`, hostRole: 'owner' });
  expect(plain.verificationTier).toBe('identity');

  await signedInAs(page, viewer);
  await openDetail(page, 'room', claimed.id);
  const chip = page.getByText('Agreement under review', { exact: true }).first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).not.toContainText(/\bOps\b/);

  await decide(claimed.id, 'approved');

  await openRooms(page);
  const claimedCard = page.locator(`[data-sf-id="r:${claimed.id}"]`);
  await expect(claimedCard.getByRole('img', { name: 'Tenant-verified', exact: true })).toBeVisible({ timeout: 15_000 });

  await openFilters(page);
  await page.getByRole('button', { name: 'Verified only', exact: true }).click();
  await expect(claimedCard).toBeVisible();
  await expect(page.locator(`[data-sf-id="r:${plain.id}"]`)).toHaveCount(0);
});

test('a post nobody had to review carries neither a badge nor a review chip', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const title = `Live no claim ${stamp()} in Baner`;
  const group = await createGroup(accessToken, { title, role: 'tenant' });
  expect(group.verificationTier).toBe('identity');

  await signedInAs(page, mobile);
  await openDetail(page, 'group', group.id);
  const card = page.locator('main');
  await expect(card.getByText(title).first()).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Agreement under review', { exact: true })).toHaveCount(0);
  await expect(card.getByText(/Tenant-verified|Owner-verified/)).toHaveCount(0);
});

test('tapping the agreement chip explains it in place, without the host detail', async ({ page }) => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const room = await createRoom(accessToken, {
    society: `Chip Explain ${stamp()}`, hostRole: 'tenant', agreementDeclared: true, ...REGISTERED,
  });

  await signedInAs(page, uniqueMobile());
  await openDetail(page, 'room', room.id);
  await tapChip(page, page.getByRole('button', { name: 'Agreement under review' }).first());

  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText("we're checking it");
  await expect(tip).not.toContainText('OTP consent');
});

test('the host is told which step the badge is waiting on', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const room = await createRoom(accessToken, {
    society: `Chip Checklist ${stamp()}`, hostRole: 'tenant', agreementDeclared: true, ...REGISTERED,
  });

  await signedInAs(page, mobile);
  const detail = page.waitForResponse((res) => res.url().includes(`/flatmates/rooms/${room.id}`) && res.ok());
  await page.goto(`${BASE}/flatmates/room/${room.id}`);
  await detail;
  await tapChip(page, page.getByRole('button', { name: 'Agreement under review' }).first());

  const tip = page.getByRole('tooltip');
  await expect(tip).toContainText("Waiting on the property owner's OTP consent");
});
