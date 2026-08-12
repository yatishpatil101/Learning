/**
 * LIVE integration check — restoring an archived account onto an email address a live account now
 * holds must be REFUSED with something the operator can act on, not silently succeed.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore` drops `live-*.spec.js`); needs
 * a backend on :8081 and the seeded dev Postgres. Run it explicitly:
 *
 *   cd e2e; $env:BACKEND_LOG='<the log of the backend you started>'
 *   npx playwright test tests/admin/live-user-restore-email-collision.spec.js --config=playwright.live.config.js
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
import fs from 'node:fs';

const LOG = process.env.BACKEND_LOG || `${process.env.TEMP}\\boot7.log`;
/** A seeded admin — the same account `live-property-integration.spec.js` moderates with. */
const ADMIN_MOBILE = '9000000000';

/**
 * A unique address and mobile per run.
 *
 * The dev database is NOT reset between runs and this spec creates real rows it cannot delete (there
 * is no DELETE endpoint for a user — archiving is the strongest thing available). A fixed literal
 * would therefore collide with its own previous run on the second execution and fail forever, which
 * is the D100 trap. Anything left behind is archived and inert.
 */
const RUN = Date.now().toString().slice(-8);
const ADDRESS = `restore.collision.${RUN}@punenest.test`;
const mobile = (n) => `9${String(RUN).padStart(9, '0').slice(0, 8)}${n}`;

function readOtp(m) {
  const lines = fs.readFileSync(LOG, 'utf8').split('\n');
  const hits = lines.filter((l) => l.includes('[MOCK OTP]') && l.includes(`mobile=${m}`));
  if (!hits.length) throw new Error(`No OTP logged for ${m} in ${LOG}`);
  return hits[hits.length - 1].match(/code=(\d+)/)[1];
}

/** The log line is written by the request thread, so it can trail the HTTP response slightly. */
async function otpFor(m) {
  for (let i = 0; i < 20; i += 1) {
    try { return readOtp(m); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return readOtp(m);
}

/**
 * An admin access token, obtained through the real OTP path.
 *
 * Not a staff-password login: the dev seed carries NO credentials at all (`password_hash` is NULL on
 * every seeded row, deliberately — see the header of `R__zz_dev_demo_data.sql`), so there is no
 * password to present. `OtpService` allows 5 sends per mobile per hour, so this is done once and the
 * token shared; a per-test sign-in would exhaust the window and surface as a 429 that reads like a
 * product bug.
 */
let adminToken;

test.beforeAll(async ({ request }) => {
  const before = (() => { try { return readOtp(ADMIN_MOBILE); } catch { return null; } })();
  await request.post('/api/auth/login', { data: { mobile: ADMIN_MOBILE } });
  let code = await otpFor(ADMIN_MOBILE);
  for (let i = 0; i < 20 && code === before; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    code = await otpFor(ADMIN_MOBILE);
  }
  const res = await request.post('/api/auth/login', { data: { mobile: ADMIN_MOBILE, otp: code } });
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
    //    original defect wearing an error message — and it would pass every assertion above.
    const after = await request.get(`/api/users/${first}`, auth());
    expect(after.status()).toBe(200);
    expect((await after.json()).status, 'the refused account must still be archived')
      .toBe('archived');
  });

  test('leaves staff login for the contested address working', async ({ request }) => {
    // The whole point of the fix: two live rows on one address turn this into a 500 forever, because
    // `findByEmailAndArchivedFalse` returns an Optional and two matches is an
    // IncorrectResultSizeDataAccessException, not a failed login. 200 here proves exactly one row.
    const res = await request.post('/api/auth/staff-login', {
      data: { email: ADDRESS, password: 'Probe-pass-2!' },
    });
    expect(res.status(), 'the surviving account must still be able to sign in').toBe(200);
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
