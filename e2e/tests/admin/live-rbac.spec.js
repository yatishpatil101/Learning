/* Who may open the back-office console, and what a narrowed account may actually do.
 *
 * Replaces the console half of the mock `rbac.spec.js`, which asserted a model that no longer
 * exists: named custom roles, a `manager` role, and a `properties:verify` sub-scope. All three were
 * console inventions. `Role` is `buyer|owner|staff|admin` and always was; the settings key the
 * custom roles were stored under was deleted by V61, so the bundles granted nothing; and
 * `properties:verify` was never a permission the server could be asked about.
 *
 * What replaced them is a per-account document of permission atoms, and the important thing about
 * it is *where* it is enforced. `/admin` is administrator-only — that is a deliberate ruling, not
 * an oversight — so an operations account's atoms do not decide which console it sees. They decide
 * what the API will do for it. The old spec could not tell those two apart, because in the mock the
 * browser was the server; here they are separate machines and the assertions go to the right one.
 */
import { test, expect, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const navLink = (page, name) => page.locator('nav').getByRole('link', { name, exact: true });

/** Every module in the console sidebar, in the order `ADMIN_MODULES` declares them. */
const ALL_TABS = [
  'Dashboard', 'Analytics', 'Post on Behalf', 'Staff Activity', 'Properties', 'Users',
  'Services', 'Enquiries', 'Finance', 'Content', 'Reports', 'Flatmates', 'Societies',
  'Localities', 'Team & Access', 'Settings',
];

test('an administrator sees every module in the console', async ({ page, login, consoleErrors }) => {
  /* An administrator holds all 27 atoms, so this is really an assertion that the nav is driven by
     the resolved set at all: it is now filtered by `canAccessModule(user, key)` against
     `user.permissions`, which arrives on `GET /me`. If that field went missing the sidebar would
     collapse to Dashboard alone rather than fail open. */
  await login.asAdmin();
  await page.goto('/admin');
  for (const tab of ALL_TABS) {
    await expect(navLink(page, tab)).toBeVisible();
  }
  expect(consoleErrors).toHaveLength(0);
});

test('an operations account cannot open the admin console at all', async ({ page, login, consoleErrors }) => {
  /* The coarse gate, asserted on the account type that used to have a way around it. `manager` was
     that way around it, and it is gone. An ops staffer belongs in the service portal; the atoms
     they hold widen what the API grants them there, never which shell they may load. */
  await login.asStaff('rental');
  await page.goto('/admin/properties');
  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  expect(consoleErrors).toHaveLength(0);
});

test('narrowing an account is enforced by the server, not by the console', async ({ login }) => {
  /* The assertion the mock spec could never make. It scoped a user in the same store the browser
     read from, so it proved only that the console agreed with itself; a server that ignored the
     document entirely would have passed it.
    
     Here the narrowing is written through `PUT /users/{id}/permissions` and then tested with the
     narrowed account's *own* token, so what is being asserted is the guard on the route. */
  const { mobile } = await login.scopeStaff('rental', ['properties:read']);
  const headers = await authHeaders(mobile);

  // Kept, because it is exactly what they were scoped to.
  const allowed = await fetch(`${API}/admin/properties?size=1`, { headers });
  expect(allowed.status).toBe(200);

  /* Withheld, and withheld as 403 rather than 404: the account is authenticated and the route
     exists, so pretending otherwise would send an operator hunting for a broken URL.

     `GET /reports` is the moderation queue, not a consumer route — the matching `POST` is the one
     any signed-in user may call, and the two share a path deliberately. */
  const denied = await fetch(`${API}/reports?size=1`, { headers });
  expect(denied.status).toBe(403);
});

test('a live staff sign-in takes its identity from the server, not from the screen', async ({ page, login, consoleErrors }) => {
  /* `/staff-login` used to resolve who you are in the page itself, by looking the mobile up in the
     mock team registry and falling back to a radio group when that missed. Both are demo
     affordances and both were gated, but the gate meant a product page imported `lib/mockApi` and
     read a build-mode flag whose only job was to switch itself off. The resolution now lives in
     `providers/mock/authProvider.js`; the http provider is a different module and has no registry
     to consult, because its identity arrives in a token it did not mint.

     So the assertion is that the browser holds exactly what the server says and nothing beside it.
     It is made against the API with this account's own token, from outside the browser, because a
     session compared only against the console's own sidebar would agree with itself: a page that
     went back to trusting an in-browser identity would render a perfectly consistent lie. */
  await login.asStaff('rental');
  const me = await (await fetch(`${API}/auth/me`, { headers: await authHeaders(STAFF.rental) })).json();
  expect(me.role).toBe('staff');

  const session = await page.evaluate(() => {
    const raw = localStorage.getItem('puneNestUser') || sessionStorage.getItem('puneNestUser');
    return raw ? JSON.parse(raw) : null;
  });
  expect(session).not.toBeNull();
  expect(session.role).toBe(me.role);
  expect(session.mobile.replace(/\D/g, '').slice(-10)).toBe(STAFF.rental);

  /* The two fields the mock registry is the only possible source of. `roleId` named a custom-role
     bundle that V61 deleted, and `moduleAccess` was the console's own scoping model — the server
     answers with permission atoms instead. Either one arriving live means a mock lookup leaked
     across the seam, and neither would show on screen, so the screen could not catch it. */
  expect(session.roleId ?? null).toBeNull();
  expect(session.moduleAccess ?? []).toEqual([]);

  expect(consoleErrors).toHaveLength(0);
});

test('an operations account can never be granted an administrator-only atom', async ({ login }) => {
  /* The ceiling, asserted at the route rather than in the grid. The console hides the six
     administrator-only rows for a staff account, but hiding a control is a courtesy to the operator
     and not a control: anything that only the UI refuses is not refused. */
  const { id } = await login.scopeStaff('rental', ['properties:read']);
  const res = await fetch(`${API}/users/${id}/permissions`, {
    method: 'PUT',
    headers: await authHeaders('9000000000'),
    body: JSON.stringify({ permissions: ['properties:read', 'settings:write'] }),
  });
  expect(res.status).toBe(422);
  const body = await res.json();
  // The envelope names the offending atom, so the refusal is actionable without server logs.
  expect(body.message).toMatch(/settings:write/);
});

test('an unknown permission name is refused rather than silently dropped', async ({ login }) => {
  /* A typo that stored quietly would be the worst outcome available: the operator sees the save
     succeed, the account holds one atom fewer than intended, and nothing anywhere says so. */
  const { id } = await login.scopeStaff('rental', ['properties:read']);
  const res = await fetch(`${API}/users/${id}/permissions`, {
    method: 'PUT',
    headers: await authHeaders('9000000000'),
    body: JSON.stringify({ permissions: ['properties:reed'] }),
  });
  expect(res.status).toBe(422);
});

test('the catalogue the console renders is the one the server enforces', async () => {
  /* The grid on Team & Access is built from this response and holds no list of its own. That is the
     point: a hard-coded copy in the console is a second source of truth that drifts silently, and
     the symptom would be a tickable box that grants nothing. */
  const res = await fetch(`${API}/admin/permission-catalogue`, {
    headers: await authHeaders('9000000000'),
  });
  expect(res.status).toBe(200);
  const catalogue = await res.json();
  expect(catalogue.length).toBeGreaterThan(0);

  const names = catalogue.map((p) => p.name);
  expect(names).toContain('properties:write');
  // `properties:verify` was a console-only sub-scope with no route behind it; it died with the
  // module map that invented it, and this is the assertion that it does not come back.
  expect(names).not.toContain('properties:verify');

  const adminOnly = catalogue.filter((p) => p.adminOnly).map((p) => p.name);
  expect(adminOnly.sort()).toEqual([
    'audit:read', 'conversations:read', 'finance:read',
    'settings:read', 'settings:write', 'users:write',
  ]);
});
