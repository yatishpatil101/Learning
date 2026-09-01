/**
 * LIVE integration check — restoring an archived account onto an email address a live account now
 * holds must be REFUSED with something the operator can act on, not silently succeed.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore` drops `live-*.spec.js`); needs
 * a backend on :8081 under the `dev,e2e` profiles. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-user-restore-email-collision.spec.js --config=playwright.live.config.js
 *
 * ## What this covers, and the honest limit on it
 *
 * The defect: `users.email` had no uniqueness guarantee, `UserAdminService.addStaff` checked only
 * LIVE rows, and archiving is a soft delete. So create `a@x.com`, archive it, create `a@x.com`
 * again, restore the first — two live rows on one address. `AuthService.staffLogin` resolves the
 * account with `findByEmailAndArchivedFalse`, an Optional-returning lookup, so from that moment on
 * every staff sign-in for that address is a 500, for BOTH people, with no way back through the back
 * office because the restore reported success.
 *
 * **This has to be an API-level spec, and that is a finding rather than a shortcut.** The back-office
 * Users screen (`frontend/src/pages/admin/AdminUsers.jsx`) archives and restores through
 * `mockApi.restoreRecord` — a localStorage write. `user` is not in `VITE_API_DOMAINS`; the screen
 * never calls `PATCH /users/{id}/restore` at all. So there is currently no click path that can
 * surface the server's 409, and a UI spec asserting an error toast would be asserting a control flow
 * that does not exist. Until that screen is moved onto the seam, the operator-visible behaviour IS
 * the API response — which is what this asserts, through the same route the screen will call.
 *
 * The last test is the one that matters most, and it is the one a weaker spec would omit: after the
 * refusal, staff login for the contested address must still work. A guard that answers 409 and
 * restores anyway would pass every assertion above it.
 */
import { test, expect } from '@playwright/test';
import { E2E_OTP } from '../../helpers/liveAuth.js';

/** A seeded admin — the same account `live-property-integration.spec.js` moderates with. */
const ADMIN_MOBILE = '9000000000';

/**
 * A unique address and mobile per run.
 *
 * This spec creates real rows it cannot delete - there is no DELETE endpoint for a user, archiving
 * is the strongest thing available - so a fixed literal would collide with its own previous run and
 * fail forever, which is the D100 trap. The live run now resets `punenest_e2e` to baseline first,
 * which would also solve it; the per-run suffix stays because it is what keeps this spec honest
 * when someone debugs it with `E2E_SKIP_RESET=1`, and because a spec that silently depends on a
 * clean database is a spec that fails mysteriously the one time it does not get one.
 */
const RUN = Date.now().toString().slice(-8);
const ADDRESS = `restore.collision.${RUN}@punenest.test`;
const mobile = (n) => `9${String(RUN).padStart(9, '0').slice(0, 8)}${n}`;

/**
 * An admin access token, obtained through the real OTP path.
 *
 * Not a staff-password login: the seed carries NO credentials at all (`password_hash` is NULL on
 * every seeded row, deliberately — see the header of `R__zz_dev_demo_data.sql`), so there is no
 * password to present. Done once and the token shared, which is now about speed rather than
 * necessity: the `e2e` profile lifts the send budget that a per-test sign-in used to exhaust.
 */
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

    // 2. A replacement on the same address. This is ALLOWED, and is the step that makes the defect
    //    reachable: while the first row is archived the address genuinely has no live claimant, so
    //    `existsByEmailAndArchivedFalse` is right to let it through.
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

    // 4. The refusal must not be cosmetic. A guard that answers 409 and restores anyway is the
    //    original defect wearing an error message - and it would pass every assertion above.
    //
    //    Asked through `?archived=true` rather than by reading a field on the account. `UserResponse`
    //    carries no `archived` flag at all, and its `status` is a separate column that `archive()`
    //    never touches -- an archived user reports `status: "active"` over the API. Recorded as a
    //    finding; asserting on `status` here would be asserting on a bug. The archived *list* is the
    //    contract that does answer this question, and it is the one the back office reads.
    const archivedList = await request.get('/api/users?archived=true&size=200', auth());
    expect(archivedList.status()).toBe(200);
    // `content`, not `items` -- PageResponse names the page's rows `content`.
    const stillArchived = (await archivedList.json()).content.some((u) => u.id === first);
    expect(stillArchived, 'the refused account must still be archived').toBe(true);
  });

  test('leaves staff login for the contested address unambiguous', async ({ request }) => {
    // The whole point of the fix: two live rows on one address turn this into a 500 forever, because
    // `findByEmailAndArchivedFalse` returns an Optional and two matches is an
    // IncorrectResultSizeDataAccessException, not a failed login.
    //
    // 401, not 200, and that is not a weaker check. D206 removed the password parameter from
    // `POST /users/staff` outright -- the account is activated by its own holder redeeming the
    // invite, so no password the spec supplies is ever stored and no credential here can succeed.
    // What still distinguishes the defect is *which* failure comes back: 401 means the lookup
    // resolved to exactly one row and rejected the credential, 500 means it matched two and the
    // collision is back. That is the assertion worth making.
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
      email: `restore.lonely.${RUN}@punenest.test`,
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
