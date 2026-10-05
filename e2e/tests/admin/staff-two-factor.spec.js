/* Staff and admin sign in with password + authenticator.
 * The probe account 9000000101 is seeded by db/seed-staff/R__zz_DML_dev_staff_credentials.sql and
 * is the only account this spec resets, so other specs' sessions are never revoked. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import {
  API, E2E_STAFF_CODE, STAFF_PASSWORD, authHeaders, staffEmail, uniqueMobile,
} from '../../helpers/liveAuth.js';

const PROBE = { mobile: '9000000101', name: 'Two-factor Probe' };

const post = (path, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });

async function memberRow(page, name) {
  await expect(page.getByText(/Showing \d+–\d+ of \d+ members/)).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(name) });
  if ((await row.count()) === 0) await page.getByRole('button', { name: 'Next page' }).click();
  await expect(row.first()).toBeVisible();
  return row.first();
}

async function signOut(page) {
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

test('the password step opens no session', async () => {
  const res = await post('/auth/staff-login', { email: staffEmail(ACTORS.admin), password: STAFF_PASSWORD });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ mfa: 'totp' });
  expect(body.challenge).toBeTruthy();
  expect(body.accessToken).toBeUndefined();
  expect(res.headers.get('set-cookie')).toBeNull();
});

test('admin signs in with password + code and lands on the console', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await expect(page).toHaveURL(/\/admin/);
  expect(consoleErrors).toHaveLength(0);
});

test.describe.serial('the probe account', () => {
  test('a wrong password is refused without saying which half was wrong', async ({ page }) => {
    await page.goto('/staff-login');
    await page.locator('#staff-email').fill(staffEmail(PROBE.mobile));
    await page.locator('#staff-password').fill('not-the-password');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('#staff-login-error')).toBeVisible();
    await expect(page.locator('#staff-code')).toHaveCount(0);
  });

  test('admin resets 2FA from Team, and the probe re-enrols with a QR and recovery codes', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await page.goto('/admin/team');
    const row = await memberRow(page, PROBE.name);
    page.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: `Reset 2FA for ${PROBE.name}` }).click();
    await expect(page.getByText(`${PROBE.name} must set up a new authenticator`)).toBeVisible();

    await signOut(page);
    await page.goto('/staff-login');
    await page.locator('#staff-email').fill(staffEmail(PROBE.mobile));
    await page.locator('#staff-password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Set up your authenticator' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Authenticator QR code' })).toBeVisible();
    await expect(page.locator('#staff-totp-secret')).toHaveText(/^[A-Z2-7]{16,}$/);
    await page.locator('#staff-code').fill(E2E_STAFF_CODE);
    await page.getByRole('button', { name: 'Confirm & sign in' }).click();

    await expect(page.locator('#staff-recovery-codes li')).toHaveCount(10);
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/staff$/);
    expect(consoleErrors).toHaveLength(0);
  });
});

test('reissuing an invite refuses yourself and consumers, and works on a colleague', async () => {
  const admin = await authHeaders(ACTORS.admin);
  const me = await (await fetch(`${API}/auth/me`, { headers: admin })).json();
  expect((await post(`/users/${me.id}/reissue-invite`, null, admin)).status).toBe(403);
  expect((await post(`/users/${me.id}/reset-2fa`, null, admin)).status).toBe(403);

  const buyer = await authHeaders(ACTORS.buyer);
  const buyerMe = await (await fetch(`${API}/auth/me`, { headers: buyer })).json();
  expect((await post(`/users/${buyerMe.id}/reissue-invite`, null, admin)).status).toBe(409);

  const mobile = uniqueMobile();
  const created = await post('/users/staff', {
    name: `Invite Probe ${mobile}`, mobile, email: `invite.${mobile}@draazy.test`, role: 'staff', team: 'rental',
  }, admin);
  expect(created.status).toBe(201);
  const { user, inviteUrl } = await created.json();
  expect(inviteUrl).toMatch(/\/staff-invite#/);
  const reissued = await post(`/users/${user.id}/reissue-invite`, null, admin);
  expect(reissued.status).toBe(200);
  expect((await reissued.json()).inviteUrl).toMatch(/\/staff-invite#/);

  await fetch(`${API}/users/${user.id}/archive`, {
    method: 'PATCH', headers: admin, body: JSON.stringify({ reason: 'Invite probe finished' }),
  });
});

test('the invite page refuses a bad code with the server message', async ({ page, consoleErrors }) => {
  await page.goto('/staff-invite#not-a-real-token');
  await expect(page.locator('#invite-token')).toHaveValue('not-a-real-token');
  await page.locator('#invite-password').fill('a-long-enough-password');
  await page.locator('#invite-repeat').fill('a-long-enough-password');
  await page.getByRole('button', { name: 'Set password' }).click();
  await expect(page.locator('#staff-invite-error')).toBeVisible();
  // The refused redeem is the one expected network error on this page.
  expect(consoleErrors.filter((e) => !/40[0-9]/.test(String(e)))).toHaveLength(0);
});
