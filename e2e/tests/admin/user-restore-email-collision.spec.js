/* Restoring an archived account onto an email a live account now holds must be REFUSED: two live
   rows on one address make `findByEmailAndArchivedFalse` throw, 500-ing sign-in for both people. */
import { test, expect } from '@playwright/test';
import { E2E_OTP } from '../../helpers/liveAuth.js';

/** A seeded admin — the same account `property-integration.spec.js` moderates with. */
const ADMIN_MOBILE = '9000000000';

/* A unique address and mobile per run. This spec creates rows it cannot delete — archiving is the
   strongest verb available — so a fixed literal would collide with its own previous run forever. */
const RUN = Date.now().toString().slice(-8);
const ADDRESS = `restore.collision.${RUN}@draazy.test`;
const mobile = (n) => `9${String(RUN).padStart(9, '0').slice(0, 8)}${n}`;

/* An admin token through the real OTP path, not a staff-password login: the seed carries no
   credentials at all, so there is no password to present. Shared once, for speed. */
let adminToken;

test.beforeAll(async ({ request }) => {
  await request.post('/api/auth/login', { data: { mobile: ADMIN_MOBILE } });
  const res = await request.post('/api/auth/login', { data: { mobile: ADMIN_MOBILE, otp: E2E_OTP } });
  expect(res.status(), 'admin OTP login').toBe(200);
  adminToken = (await res.json()).accessToken;
  expect(adminToken, 'admin access token').toBeTruthy();
});

const auth = () => ({ headers: { Authorization: `Bearer ${adminToken}` } });

async function createStaff(request, { name, mobile: m, email, password }) {
  const res = await request.post('/api/users/staff', {
    ...auth(),
    data: { name, mobile: m, email, role: 'staff', password },
  });
  expect(res.status(), `create ${email}`).toBe(201);
  return (await res.json()).id;
}

test.describe('restoring onto a taken email address', () => {
  test('is refused with a 409 that names the address, and leaves the account archived', async ({
    request,
  }) => {
    // 1. A colleague, then their departure.
    const first = await createStaff(request, {
      name: 'Collision First',
      mobile: mobile('1'),
      email: ADDRESS,
      password: 'Probe-pass-1!',
    });
    expect((await request.patch(`/api/users/${first}/archive`, {
      ...auth(),
      data: { reason: 'Left the company (live collision probe)' },
    })).status(), 'archive the first account').toBe(200);

    // 2. A replacement on the same address, allowed because while the first row is archived the
    //    address genuinely has no live claimant. This is what makes the defect reachable.
    const second = await createStaff(request, {
      name: 'Collision Second',
      mobile: mobile('2'),
      email: ADDRESS,
      password: 'Probe-pass-2!',
    });
    expect(second).not.toBe(first);

    // 3. Somebody changes their mind. This is where it used to go wrong.
    const restore = await request.patch(`/api/users/${first}/restore`, auth());
    expect(restore.status(), 'restoring onto a live address must be refused').toBe(409);

    const body = await restore.json();
    // Envelope field is `error`, not `code`.
    expect(body.error).toBe('conflict');
    // Naming the address is the actionable half. Without it the operator is told a restore failed
    // and not which field, on an account whose email is not even shown in the list view.
    expect(body.message).toContain(ADDRESS);

    // 4. The refusal must not be cosmetic — a guard that answers 409 and restores anyway passes every
    //    assertion above. Asked through `?archived=true`, since an archived user reports "active".
    const archivedList = await request.get('/api/users?archived=true&size=200', auth());
    expect(archivedList.status()).toBe(200);
    // `content`, not `items` -- PageResponse names the page's rows `content`.
    const stillArchived = (await archivedList.json()).content.some((u) => u.id === first);
    expect(stillArchived, 'the refused account must still be archived').toBe(true);
  });

  test('leaves staff login for the contested address unambiguous', async ({ request }) => {
    // Which failure comes back is the whole signal: 401 means the lookup resolved to one row,
    // 500 means it matched two and the collision is back. No password here can ever succeed.
    const res = await request.post('/api/auth/staff-login', {
      data: { email: ADDRESS, password: 'Probe-pass-2!' },
    });
    expect(res.status(), 'a 500 here means two live rows share the address again').toBe(401);
  });

  test('an address with no live claimant can still be restored', async ({ request }) => {
    // The guard must refuse a collision, not refuse restores. Without this the suite would pass with
    // `restore` hard-wired to 409 — which would strand every archived colleague permanently.
    const lonely = await createStaff(request, {
      name: 'Collision Lonely',
      mobile: mobile('3'),
      email: `restore.lonely.${RUN}@draazy.test`,
      password: 'Probe-pass-3!',
    });
    expect((await request.patch(`/api/users/${lonely}/archive`, {
      ...auth(),
      data: { reason: 'Temporary (live collision probe)' },
    })).status()).toBe(200);

    expect((await request.patch(`/api/users/${lonely}/restore`, auth())).status()).toBe(200);
    expect((await (await request.get(`/api/users/${lonely}`, auth())).json()).status)
      .toBe('active');

    // Leave the dev database tidy: this account served its purpose and should not sit live in the
    // directory. Archiving is the strongest cleanup available — there is no user DELETE.
    await request.patch(`/api/users/${lonely}/archive`, {
      ...auth(),
      data: { reason: 'Live collision probe finished' },
    });
  });
});
