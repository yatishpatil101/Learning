// This covers the live atom model, not the retired mock role model.
import { test, expect, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const navLink = (page, name) => page.locator('nav').getByRole('link', { name, exact: true });

// Every module the admin sidebar shows; staff see only the desks they hold, admin and manager see all six.
const ALL_TABS = [
  'Dashboard', 'KYC Review', 'Analytics', 'Post on Behalf', 'Team Activity',
  'Properties', 'Users', 'Rent Agreement', 'Property & Legal', 'Home Loans', 'Interior & Renovation',
  'Packers & Movers', 'Property Valuation', 'Support queue', 'Enquiries',
  'Referrals', 'Finance', 'Content', 'Reports', 'Flatmates', 'Societies', 'Localities',
  'Team & Access', 'Settings',
];

test('an administrator sees every module in the console', async ({ page, login, consoleErrors }) => {
  // Admin has every atom, so this proves nav uses `GET /me` permissions at all.
  await login.asAdmin();
  await page.goto('/admin');
  for (const tab of ALL_TABS) {
    await expect(navLink(page, tab)).toBeVisible();
  }
  expect(consoleErrors).toHaveLength(0);
});

test('an operations account is moved to the staff portal, never served the admin console', async ({ page, login, consoleErrors }) => {
  await login.asStaff('rental');
  await page.goto('/admin/properties');
  await page.waitForURL('**/staff/properties');
  expect(new URL(page.url()).pathname).toBe('/staff/properties');
  await expect(page.getByRole('heading', { name: 'Properties', exact: true })).toBeVisible();
  await expect(navLink(page, 'Settings')).toHaveCount(0);
  await expect(navLink(page, 'Team & Access')).toHaveCount(0);
  expect(consoleErrors).toHaveLength(0);
});

test('narrowing an account is enforced by the server, not by the console', async ({ login }) => {
  // The assertion the mock spec could never make.
  const { mobile, id } = await login.scopeStaff('rental', ['properties:read']);
  const headers = await authHeaders(mobile);

  // Kept, because it is exactly what they were scoped to.
  const allowed = await fetch(`${API}/admin/properties?size=1`, { headers });
  expect(allowed.status).toBe(200);

  // Use 403, not 404: the user is authenticated and the route exists.
  const denied = await fetch(`${API}/reports?size=1`, { headers });
  expect(denied.status).toBe(403);

  // The ceiling, asserted at the route rather than in the grid.
  const ceiling = await fetch(`${API}/users/${id}/permissions`, {
    method: 'PUT',
    headers: await authHeaders('9000000000'),
    body: JSON.stringify({ functions: ['support', 'settings:write'] }),
  });
  expect(ceiling.status).toBe(422);
  // The envelope names the offending atom, so the refusal is actionable without server logs.
  expect((await ceiling.json()).message).toMatch(/settings:write/);
});

test('a live staff sign-in takes its identity from the server, not from the screen', async ({ page, login, consoleErrors }) => {
  // Staff identity must come from the API, not the old mock registry fallback.
  await login.asStaff('rental');
  const me = await (await fetch(`${API}/auth/me`, { headers: await authHeaders(STAFF.rental) })).json();
  expect(me.role).toBe('staff');

  const session = await page.evaluate(() => {
    const raw = localStorage.getItem('draazyUser') || sessionStorage.getItem('draazyUser');
    return raw ? JSON.parse(raw) : null;
  });
  expect(session).not.toBeNull();
  expect(session.role).toBe(me.role);
  expect(session.mobile.replace(/\D/g, '').slice(-10)).toBe(STAFF.rental);

  // The two fields the mock registry is the only possible source of.
  expect(session.roleId ?? null).toBeNull();
  expect(session.moduleAccess ?? []).toEqual([]);

  expect(consoleErrors).toHaveLength(0);
});

test('the function catalogue the console renders is served by the server', async () => {
  // The console must not ship a second hard-coded permission source of truth.
  const res = await fetch(`${API}/admin/function-catalogue`, {
    headers: await authHeaders('9000000000'),
  });
  expect(res.status).toBe(200);
  const catalogue = await res.json();
  expect(catalogue.length).toBeGreaterThan(0);

  const names = catalogue.map((f) => f.name);
  expect(names).toContain('kyc');
  expect(names).toContain('support');
  expect(names).toContain('desk:rental');
});
