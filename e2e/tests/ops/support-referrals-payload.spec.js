import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, authHeaders, seedConsent, staffSignInUi } from '../../helpers/liveAuth.js';

/* Payload cost of the staff-side reads (support desk, referral desk, /admin/my-work, staff sign-in);
   behaviour is covered by support-queue.spec.js and referrals.spec.js. */

const STAFF_USER_KEYS = ['id', 'name', 'mobile', 'email', 'role', 'permissions', 'desks'];
const REFERRAL_KEYS = ['id', 'referrer', 'referrerMobile', 'referred', 'referredMobile', 'channel', 'reward',
  'rewardAmount', 'status', 'risk', 'identityVerified', 'identityUnique', 'sameDevice', 'sameIp', 'velocityHigh',
  'activated', 'at'];

const searchOf = (url) => new URL(url).searchParams;

async function raiseTicket(subject) {
  const { accessToken } = await apiLogin(ACTORS.buyer);
  const res = await fetch(`${API}/support/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ subject, category: 'payment', body: 'Payload check, please ignore.' }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

test('a staff sign-in carries the slim identity and is not followed by an /auth/me read', async ({ page, consoleErrors }) => {
  const calls = [];
  page.on('request', (req) => calls.push(`${req.method()} ${new URL(req.url()).pathname}`));
  let signedIn = null;
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname.endsWith('/auth/staff-login/verify') && res.status() === 200) {
      signedIn = await res.json();
    }
  });

  await page.goto('/staff-login');
  await staffSignInUi(page, STAFF.rental);
  await expect(page).not.toHaveURL(/\/staff-login/);
  await expect.poll(() => signedIn).not.toBeNull();

  expect(signedIn.user.role).toBe('staff');
  expect(Object.keys(signedIn.user).filter((k) => !STAFF_USER_KEYS.includes(k))).toEqual([]);
  expect(Array.isArray(signedIn.user.permissions)).toBe(true);
  const afterSignIn = calls.slice(calls.indexOf('POST /api/auth/staff-login/verify') + 1);
  expect(afterSignIn.filter((c) => c === 'GET /api/auth/me')).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('/admin/my-work is the caller and their own queues, nothing else', async () => {
  const headers = await authHeaders(STAFF.rental);
  const body = await fetch(`${API}/admin/my-work`, { headers }).then((r) => r.json());

  expect(Object.keys(body).sort()).toEqual(['queues', 'staff', 'windowDays']);
  expect(body.staff).toHaveLength(1);
  expect(Object.keys(body.staff[0]).sort()).toEqual(['byFunction', 'functions', 'handled', 'name']);
  for (const queue of body.queues) {
    expect(Object.keys(queue).filter((k) => !['function', 'open', 'oldestWaitingSince'].includes(k))).toEqual([]);
    expect(body.staff[0].functions).toContain(queue.function);
  }
});

test('the support desk reads counts once, and opening a ticket is a single read', async ({ page, login, consoleErrors }) => {
  const subject = `Payload check ${Date.now().toString(36)}`;
  const id = await raiseTicket(subject);
  await seedConsent(page);
  await login.asStaff('rental');

  const lists = [];
  const opened = [];
  page.on('request', (req) => {
    const { pathname } = new URL(req.url());
    if (pathname === '/api/admin/support-tickets') lists.push(searchOf(req.url()));
    if (pathname.startsWith(`/api/support/tickets/${id}`)) opened.push(`${req.method()} ${pathname}`);
  });
  let thread = null;
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname === `/api/support/tickets/${id}` && res.status() === 200) thread = await res.json();
  });

  await page.goto('/ops/support');
  const row = page.getByTestId('queue-row').filter({ hasText: subject });
  await expect(row).toBeVisible();
  expect(lists).toHaveLength(1);
  expect(lists[0].get('counts')).toBe('true');

  await page.getByRole('tab', { name: /^All/ }).click();
  await expect.poll(() => lists.length).toBe(2);
  expect(lists[1].get('counts')).toBeNull();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => lists.length).toBe(3);
  expect(lists[2].get('counts')).toBe('true');

  await row.getByRole('button', { name: 'Reply' }).click();
  await expect(page.getByRole('dialog').getByText('Payload check, please ignore.')).toBeVisible();
  expect(opened).toEqual([`GET /api/support/tickets/${id}`]);
  expect(thread.messages.length).toBeGreaterThan(0);
  for (const message of thread.messages) {
    expect(message).not.toHaveProperty('authorId');
    expect(message).not.toHaveProperty('attachments');
  }
  expect(consoleErrors).toEqual([]);
});

test('the referral desk pages and filters on the server, with counts only when asked', async ({ page, login, consoleErrors }) => {
  await login.asStaff('rental');

  const reads = [];
  const rows = [];
  page.on('request', (req) => {
    if (new URL(req.url()).pathname === '/api/referrals' && req.method() === 'GET') reads.push(searchOf(req.url()));
  });
  page.on('response', async (res) => {
    if (new URL(res.url()).pathname === '/api/referrals' && res.status() === 200) {
      const content = (await res.json().catch(() => null))?.content ?? [];
      rows.push(...content);
    }
  });

  await page.goto('/ops/referrals');
  await expect(page.getByRole('heading', { name: 'Referral Verification' })).toBeVisible();
  await expect.poll(() => reads.length).toBe(1);
  expect(reads[0].get('size')).toBe('20');
  expect(reads[0].get('status')).toBe('pending,qualified');
  expect(reads[0].get('counts')).toBe('true');
  await expect(page.getByTestId('tab-count-pending')).toHaveText(/^[\d,]+$/);

  await page.getByRole('tab', { name: /^Rewarded/ }).click();
  await expect.poll(() => reads.length).toBe(2);
  expect(reads[1].get('status')).toBe('rewarded');
  expect(reads[1].get('counts')).toBeNull();

  await page.getByPlaceholder('Referrer, referred or ID').fill('zz-no-such-person');
  await expect.poll(() => reads.length).toBe(3);
  expect(reads[2].get('q')).toBe('zz-no-such-person');
  await expect(page.getByText('No referrals match this search.')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => reads.length).toBe(4);
  expect(reads[3].get('counts')).toBe('true');

  for (const read of reads) expect(read.get('size')).not.toBe('100');
  for (const row of rows) expect(Object.keys(row).filter((k) => !REFERRAL_KEYS.includes(k))).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
