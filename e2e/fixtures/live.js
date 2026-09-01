// Shared test base for the **live** suite — the counterpart of `fixtures/base.js`.
//
//   import { test, expect } from '../fixtures/live.js';
//
// Same two fixtures as `base.js` (`consoleErrors`, `login`) with the same method names, so a
// converted spec changes its import line and nothing else. That symmetry is the whole point: the
// legacy suite is 220 files, and a conversion that also rewrites every call site would be 220
// opportunities to change behaviour by accident while claiming to be a port.
//
// What differs is underneath. `base.js`'s `login` writes `puneNestUser` into localStorage; this one
// completes the real OTP form against the backend, so the session is a genuine JWT and every
// request the page makes afterwards is authorised the way production authorises it. A spec that
// passes here has proved something the seeded version never could.
//
// Read `docs/system/fixture-registry.md` before adding an actor below. The rule there applies to
// this file too: a live spec may only depend on rows the seed names on purpose.

import { test as base, expect } from '@playwright/test';
import { trackErrors } from '../helpers/console.js';
import { API, authHeaders, signedInAs, signIn } from '../helpers/liveAuth.js';

/**
 * The seeded people the role helpers sign in as.
 *
 * Named actors rather than fresh registrations, because the roles below are *read* roles: an owner
 * with no listings is not an owner as far as any screen is concerned, and a spec that registered
 * one would have to build a whole world before it could assert anything. Specs that must not
 * collide — registration, onboarding, anything mutating — should call `uniqueMobile()` directly
 * instead of using these.
 */
export const ACTORS = {
  // Meera owns the four anchor listings, so every owner-side screen has something to render.
  owner: '9470744469',
  // Rahul carries the demand-side fixtures: 2 saved, 1 alert, 2 notifications, a review, a deal.
  buyer: '9700000001',
  // Priya is a `buyer` who holds the active tenancy — there is no `tenant` role in the schema, and
  // "tenant" in the UI means "has a tenancy", which she does.
  tenant: '9700000002',
  admin: '9000000000',
};

/**
 * One staffer per service team.
 *
 * Deliberately **not** Karan Chavan (`9383334640`) for valuation: `ops/live-drafting-desk.spec.js`
 * signs in as Karan and takes ownership of requests, and assignment is exclusive. Two specs sharing
 * an assignee would take turns failing on each other's leftovers, in a way that reads as flakiness
 * rather than as a fixture collision.
 */
export const STAFF = {
  rental: '9733798115',
  legal: '9223611750',
  loans: '9812733640',
  interior: '9710931232',
  packers: '9542346771',
  valuation: '9743304170',
};

/**
 * Every permission atom a `staff` account is allowed to hold — `BackOfficePermissions.STAFF_BASELINE`,
 * which is the catalogue minus the six administrator-only entries.
 *
 * Used only by teardown, to widen a staffer this run narrowed back to what an unscoped one holds.
 * Fetched rather than hard-coded would be better; it is not, because teardown must still run when
 * the server is the thing that broke, and a restore that needs a working server to work is not a
 * restore. Drift is caught immediately: `PUT` answers 422 for any name it does not enforce, so a
 * renamed atom fails the next run's teardown loudly rather than leaving accounts narrowed.
 */
export const BASELINE_STAFF = [
  'dashboard:read', 'users:read', 'content:read', 'content:write',
  'properties:read', 'properties:write', 'postOnBehalf:write', 'enquiries:read',
  'services:read', 'services:write', 'societies:read', 'societies:write',
  'localities:read', 'localities:write', 'tickets:read', 'tickets:write',
  'reports:read', 'reports:write', 'flatmates:read', 'flatmates:write',
];

export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(errors);
  },

  /**
   * Set feature flags on the server, and put them back afterwards.
   *
   * **The restore is the reason this is a fixture and not a helper function.** Flags are one row in
   * one table shared by the whole run: a spec that switches `savedListings` off and then fails an
   * assertion leaves it off for every spec that follows, and the resulting cascade reads as
   * flakiness rather than as the leak it is. Playwright runs fixture teardown even when the test
   * body throws, which a `finally` in each spec would also do and an `afterEach` in each file would
   * be one more thing to remember. Here it cannot be forgotten.
   *
   * Restoring means restoring to what was actually there, snapshotted on first use. Blanket-setting
   * everything back to `true` would be right for the default-on features and catastrophic for
   * `maintenanceMode`, where absent means *enabled* and the seed sets `false` on purpose. A flag
   * that was absent goes back to `true`, which is what absent means for everything else and is the
   * closest a merging `PUT` can get to deleting a key.
   *
   * Writes go through `PUT /admin/settings` because that is the only writer — there is no public
   * write, deliberately. Reads go through the public `GET /flags`, which is the same route the
   * browser uses, so the snapshot is the client's own view rather than a privileged one.
   */
  flags: async ({}, use) => {
    let before = null;
    const touched = new Set();

    const write = async (patch) => {
      const res = await fetch(`${API}/admin/settings`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ flags: patch }),
      });
      if (!res.ok) {
        throw new Error(`setting flags ${JSON.stringify(patch)} failed (${res.status})`);
      }
    };

    const set = async (patch) => {
      if (before === null) {
        const res = await fetch(`${API}/flags`);
        before = res.ok ? await res.json() : {};
      }
      Object.keys(patch).forEach((key) => touched.add(key));
      await write(patch);
    };

    const only = (value) => async (...keys) =>
      set(Object.fromEntries(keys.map((key) => [key, value])));

    await use({ set, enable: only(true), disable: only(false) });

    if (touched.size) {
      await write(Object.fromEntries([...touched].map((key) => [key, before[key] ?? true])));
    }
  },

  login: async ({ page }, use) => {
    /* Accounts this test narrowed, so teardown can widen them back. A Set because a spec may scope
       the same staffer twice and restoring twice is wasted round trips, not a second restore. */
    const scoped = new Set();

    const put = async (id, permissions) => {
      const res = await fetch(`${API}/users/${id}/permissions`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ permissions }),
      });
      if (!res.ok) {
        throw new Error(`scoping ${id} to ${JSON.stringify(permissions)} failed (${res.status})`);
      }
      return res.json();
    };

    /* Find the account by mobile and narrow it.
     *
     * The directory read is admin-only and still masks mobiles — an administrator has no business
     * needing a colleague's number to administer their access — so the lookup has to go through
     * the mask rather than around it: `9733798115` is only ever published as `97XXXXX115`. Note
     * that this is a deliberately lossy form, and the server's own documentation warns two people
     * can mask to the same string; it happens to be unique across the sixteen seeded back-office
     * accounts, and the `find` returning the wrong row would surface immediately as a spec
     * asserting on the wrong person's nav rather than as a silent pass. */
    const masked = (mobile) => {
      const digits = String(mobile).replace(/\D/g, '');
      return `${digits.slice(0, 2)}XXXXX${digits.slice(-3)}`;
    };

    const scope = async (mobile, atoms) => {
      const res = await fetch(`${API}/users?role=staff&size=100`, {
        headers: await authHeaders(ACTORS.admin),
      });
      if (!res.ok) throw new Error(`listing staff failed (${res.status})`);
      const page1 = await res.json();
      const want = masked(mobile);
      const row = (page1.content || page1.items || []).find((u) => u.mobile === want);
      if (!row) throw new Error(`no back-office account shown as ${want} — see fixtures/live.js`);
      await put(row.id, atoms);
      return row.id;
    };

    await use({
      asBuyer: () => signedInAs(page, ACTORS.buyer),
      asOwner: () => signedInAs(page, ACTORS.owner),
      asTenant: () => signedInAs(page, ACTORS.tenant),
      // Back-office sign-ins go through `/staff-login` rather than the session cache, because the
      // screen decides where you land and that redirect is part of what the spec is asserting.
      asAdmin: () => signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/ }),
      asStaff: (team = 'rental') => {
        const mobile = STAFF[String(team).toLowerCase()];
        if (!mobile) throw new Error(`no seeded staffer for team "${team}" — see fixtures/live.js`);
        return signIn(page, mobile, { screen: 'staff' });
      },
      /**
       * Narrow a seeded staffer to a named set of permission atoms, and hand back their id.
       *
       * This replaces `login.asManager('Verifications')`, but it deliberately does *not* sign
       * anyone in. `/admin` is administrator-only — an operations account's atoms govern what the
       * **API** will do for it, not which console it may open — so the assertion a scoped account
       * supports is made against the server, with that account's own token, not against a sidebar
       * it will never see.
       *
       * There are no custom roles (V61 deleted the settings key they were stored under) and no
       * `manager` role, so the only way to produce a scoped account is the feature itself. That
       * makes the arrangement honest: the spec narrows by the same route an administrator would
       * use, so a spec that passes has proved that route works.
       *
       * Restoring is not deleting. `PUT` has no inverse and there is no route that removes a
       * document, by design — an access-control record that can vanish is one nobody can audit —
       * so teardown writes the role's full baseline back, which resolves to exactly what an
       * unscoped account holds. The row survives the run; its effect does not.
       *
       * Teardown runs even when the body throws, which is the reason this is a fixture. A leaked
       * narrowing would silently disarm every later spec that signs in as the same staffer.
       */
      scopeStaff: async (team, atoms) => {
        const mobile = STAFF[String(team).toLowerCase()];
        if (!mobile) throw new Error(`no seeded staffer for team "${team}" — see fixtures/live.js`);
        const id = await scope(mobile, atoms);
        scoped.add(id);
        return { id, mobile };
      },
    });

    for (const id of scoped) {
      await put(id, [...BASELINE_STAFF]);
    }
  },
});

export { expect };
