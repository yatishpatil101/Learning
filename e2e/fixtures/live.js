// Shared test base for the **live** suite: the same two fixtures as `fixtures/base.js`, but `login`
// completes the real OTP form, so the session is a genuine JWT. Actors: `docs/system/fixture-registry.md`.

import { test as base, expect } from '@playwright/test';
import { trackErrors } from '../helpers/console.js';
import { API, authHeaders, signedInAs, signedInAsNew, signIn } from '../helpers/liveAuth.js';

/* The seeded people the role helpers sign in as — named actors because these are *read* roles and an
   owner with no listings is not an owner. Mutating specs should call `uniqueMobile()` instead. */
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

/* One staffer per service team. Deliberately **not** Karan Chavan (`9383334640`) for valuation:
   `ops/live-drafting-desk.spec.js` owns him, and assignment is exclusive. */
export const STAFF = {
  rental: '9733798115',
  legal: '9223611750',
  loans: '9812733640',
  interior: '9710931232',
  packers: '9542346771',
  valuation: '9743304170',
};

/* Every permission atom a `staff` account may hold, mirroring `BackOfficePermissions.STAFF_BASELINE`.
   Hard-coded rather than fetched because teardown must still run when the server is what broke; drift
   surfaces at once, since `PUT` answers 422 for any name it does not enforce. */
export const BASELINE_STAFF = [
  'dashboard:read', 'users:read', 'content:read', 'content:write',
  'properties:read', 'properties:write', 'postOnBehalf:write', 'enquiries:read',
  'services:read', 'services:write', 'societies:read', 'societies:write',
  'localities:read', 'localities:write', 'tickets:read', 'tickets:write',
  'reports:read', 'reports:write', 'notes:read', 'notes:write',
  'flatmates:read', 'flatmates:write',
];

/* An Indian mobile, and *only* a whole one — the lookarounds pin the match to a complete digit run.
   Unanchored, `[6-9]\d{9}` finds a "mobile" inside request ids and `Date.now()` stamps. */
export const MOBILE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/;

export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(errors);
  },

  /* Set feature flags on the server and put them back — the restore is why this is a fixture: flags
     are one row shared by the whole run. Restores to the snapshot, not a blanket `true`, because
     absent means *enabled* for `maintenanceMode`. */
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

  /* Take a city live or off, restoring only the slugs this test touched, and each to what it
     actually was rather than to `false`: a city already live before the spec ran must stay live. */
  cities: async ({}, use) => {
    let before;
    const touched = new Set();

    const read = async () => {
      const res = await fetch(`${API}/cities`);
      if (!res.ok) throw new Error(`reading cities failed (${res.status})`);
      return await res.json();
    };

    const write = async (slug, live) => {
      const res = await fetch(`${API}/admin/cities/${slug}`, {
        method: 'PATCH',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ live }),
      });
      if (!res.ok) throw new Error(`writing city ${slug} failed (${res.status})`);
    };

    const set = async (slug, live) => {
      if (before === undefined) {
        before = Object.fromEntries((await read()).map((city) => [city.slug, city.live === true]));
      }
      touched.add(slug);
      await write(slug, live);
    };

    await use({ set });

    if (before !== undefined) {
      for (const slug of touched) {
        await write(slug, before[slug] === true);
      }
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

    /* The directory read is admin-only and still masks mobiles, so the lookup goes through the mask
       rather than around it: `9733798115` is only ever published as `97XXXXX115`. The form is lossy,
       but happens to be unique across the sixteen seeded back-office accounts. */
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
      /* A brand-new owner, for screens behind the listing paywall: `ACTORS.owner` has spent her
         free-tier allowance on purpose, so `/list-property` renders the upgrade prompt for her, and
         no seeded actor can hold an unspent allowance permanently. Resolves the new mobile too. */
      asNewOwner: () => signedInAsNew(page),
      // Back-office sign-ins go through `/staff-login` rather than the session cache, because the
      // screen decides where you land and that redirect is part of what the spec is asserting.
      asAdmin: () => signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/ }),
      asStaff: (team = 'rental') => {
        const mobile = STAFF[String(team).toLowerCase()];
        if (!mobile) throw new Error(`no seeded staffer for team "${team}" — see fixtures/live.js`);
        return signIn(page, mobile, { screen: 'staff' });
      },
      /* Narrow a seeded staffer to named permission atoms and hand back their id — it does **not**
         sign anyone in; atoms govern what the API will do, not which console opens. Teardown writes
         the role's full baseline back, because `PUT` has no inverse by design. */
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
