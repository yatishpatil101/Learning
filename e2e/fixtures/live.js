// Shared test base for the **live** suite: the same two fixtures as `fixtures/base.js`, but `login`
// completes the real OTP form, so the session is a genuine JWT. Actors: `docs/system/fixture-registry.md`.
import { test as base, expect } from '@playwright/test';
import { trackErrors } from '../helpers/console.js';
import { API, authHeaders, signedInAs, signedInAsNew, signIn } from '../helpers/liveAuth.js';

// Named actors are read roles; an owner with no listings is not useful here.
export const ACTORS = {
  // Meera owns the four anchor listings, so every owner-side screen has something to render.
  owner: '9470744469',
  // Rahul carries the demand-side fixtures: 2 saved, 1 alert, 2 notifications, a review, a deal.
  buyer: '9700000001',
  // Priya is a `buyer` who holds the active tenancy — there is no `tenant` role in the schema, and
  // "tenant" in the UI means "has a tenancy", which she does.
  tenant: '9700000002',
  admin: '9000000000',
  manager: '9000000001',
};

// One staffer per service team.
export const STAFF = {
  rental: '9733798115',
  legal: '9223611750',
  loans: '9812733640',
  interior: '9710931232',
  packers: '9542346771',
  valuation: '9743304170',
};

// Every function a `staff` account may hold, mirroring `BackOfficeFunctions.CATALOGUE`.
export const BASELINE_STAFF = [
  'kyc', 'propertyVerification', 'listingModeration', 'postOnBehalf', 'flatmates', 'localities', 'reviews',
  'desk:rental', 'desk:legal', 'desk:loans', 'desk:interior', 'desk:packers', 'desk:valuation',
  'support', 'enquiries', 'users', 'reports', 'referrals', 'content', 'societies',
];

// An Indian mobile, and *only* a whole one — the lookarounds pin the match to a complete digit run.
export const MOBILE = /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/;

export const test = base.extend({
  consoleErrors: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(errors);
  },

  // Flags are one shared row, so this fixture snapshots and restores touched keys.
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
        const res = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.admin) });
        before = res.ok ? (await res.json()).flags ?? {} : {};
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

  // Restore each touched city to its prior value, not `false`, because it may already be live.
  cities: async ({}, use) => {
    let before;
    const touched = new Set();

    const read = async () => {
      const res = await fetch(`${API}/bootstrap`);
      if (!res.ok) throw new Error(`reading cities failed (${res.status})`);
      return (await res.json()).cities;
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
    // Accounts this test narrowed → the functions they stored before, so teardown restores exactly those.
    const scoped = new Map();

    // `identity:write` is administrator-only, so a staffer's `kyc` function can view a case but never decide it.
    const functionsFor = (names) => {
      const mapped = new Set();
      for (const name of names) {
        if (name === 'dashboard:read') {
          continue;
        } else if (BASELINE_STAFF.includes(name)) {
          mapped.add(name);
        } else if (['identity:read', 'identity:write', 'users:read'].includes(name)) {
          mapped.add('kyc');
        } else if (['properties:read', 'properties:verify'].includes(name)) {
          mapped.add('propertyVerification');
        } else if (name === 'properties:moderate') {
          mapped.add('listingModeration');
        } else if (name === 'postOnBehalf:write') {
          mapped.add('postOnBehalf');
        } else if (['services:read', 'services:write', 'registrations:write'].includes(name)) {
          mapped.add('desk:rental');
        } else if (['tickets:read', 'tickets:write', 'notes:read', 'notes:write'].includes(name)) {
          mapped.add('support');
        } else if (name === 'enquiries:read') {
          mapped.add('enquiries');
        } else if (['content:read', 'content:write'].includes(name)) {
          mapped.add('content');
        } else if (['societies:read', 'societies:write'].includes(name)) {
          mapped.add('societies');
        } else if (['reports:read', 'reports:write'].includes(name)) {
          mapped.add('reports');
        } else if (['referrals:read', 'referrals:write'].includes(name)) {
          mapped.add('referrals');
        } else if (['reviews:read', 'reviews:write'].includes(name)) {
          mapped.add('reviews');
        } else if (['localities:read', 'localities:write'].includes(name)) {
          mapped.add('localities');
        } else if (['flatmates:read', 'flatmates:write'].includes(name)) {
          mapped.add('flatmates');
        } else {
          mapped.add(name);
        }
      }
      return [...mapped];
    };

    const put = async (id, permissions) => {
      const res = await fetch(`${API}/users/${id}/permissions`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ functions: functionsFor(permissions) }),
      });
      if (!res.ok) {
        throw new Error(`scoping ${id} to ${JSON.stringify(permissions)} failed (${res.status})`);
      }
      return res.json();
    };

    const scope = async (mobile, atoms) => {
      const want = String(mobile).replace(/\D/g, '');
      const res = await fetch(`${API}/users?role=staff&q=${want}&size=5`, {
        headers: await authHeaders(ACTORS.admin),
      });
      if (!res.ok) throw new Error(`listing staff failed (${res.status})`);
      const page1 = await res.json();
      const masked = `${want.slice(0, 2)}XXXXX${want.slice(-3)}`;
      const row = (page1.content || page1.items || []).find((u) => u.mobile === masked);
      if (!row) throw new Error(`no back-office account shown as ${want} — see fixtures/live.js`);
      if (!scoped.has(row.id)) {
        const stored = await fetch(`${API}/users/${row.id}/permissions`, { headers: await authHeaders(ACTORS.admin) });
        if (!stored.ok) throw new Error(`reading ${row.id} permissions failed (${stored.status})`);
        const access = await stored.json();
        scoped.set(row.id, access.scoped ? access.functions : [...BASELINE_STAFF]);
      }
      await put(row.id, atoms);
      return row.id;
    };

    await use({
      asBuyer: () => signedInAs(page, ACTORS.buyer),
      asOwner: () => signedInAs(page, ACTORS.owner),
      asTenant: () => signedInAs(page, ACTORS.tenant),
      // `ACTORS.owner` has spent her allowance, so paywall specs need a new owner.
      asNewOwner: () => signedInAsNew(page),
      // Back-office sign-ins go through `/staff-login` rather than the session cache, because the
      // screen decides where you land and that redirect is part of what the spec is asserting.
      asAdmin: () => signIn(page, ACTORS.admin, { screen: 'staff', role: /Administrator/ }),
      asManager: () => signIn(page, ACTORS.manager, { screen: 'staff' }),
      asStaff: (team = 'rental') => {
        const mobile = STAFF[String(team).toLowerCase()];
        if (!mobile) throw new Error(`no seeded staffer for team "${team}" — see fixtures/live.js`);
        return signIn(page, mobile, { screen: 'staff' });
      },
      // This scopes API permissions only; it does not sign the staffer in.
      scopeStaff: async (team, atoms) => {
        const mobile = STAFF[String(team).toLowerCase()];
        if (!mobile) throw new Error(`no seeded staffer for team "${team}" — see fixtures/live.js`);
        const id = await scope(mobile, atoms);
        return { id, mobile };
      },
    });

    for (const [id, functions] of scoped) {
      await put(id, functions);
    }
  },
});

export { expect };
