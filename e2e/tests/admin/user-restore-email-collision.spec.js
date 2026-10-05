// Restore must refuse email collisions or sign-in can 500 for both live users.
import { test, expect } from '@playwright/test';
import { apiLogin } from '../../helpers/liveAuth.js';

// A seeded admin — the same account `property-integration.spec.js` moderates with.
const ADMIN_MOBILE = '9000000000';

// Use unique emails because archived rows cannot be deleted between runs.
const RUN = Date.now().toString().slice(-8);
const ADDRESS = `restore.collision.${RUN}@draazy.test`;
const mobile = (n) => `9${String(RUN).padStart(9, '0').slice(0, 8)}${n}`;

let adminToken;

test.beforeAll(async () => {
  adminToken = (await apiLogin(ADMIN_MOBILE)).accessToken;
  expect(adminToken, 'admin access token').toBeTruthy();
});

const auth = () => ({ headers: { Authorization: `Bearer ${adminToken}` } });

async function createStaff(request, { name, mobile: m, email }) {
  const res = await request.post('/api/users/staff', {
    ...auth(),
    data: { name, mobile: m, email, role: 'staff', functions: ['desk:rental'] },
  });
  expect(res.status(), `create ${email}`).toBe(201);
  return (await res.json()).user.id;
}

test.describe('restoring onto a taken email address', () => {
  test('is refused with a 409 that names the address, and leaves the account archived', async ({
    request,
  }) => {
    const first = await createStaff(request, {
      name: 'Collision First',
      mobile: mobile('1'),
      email: ADDRESS,
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
    });
    expect(second).not.toBe(first);

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
